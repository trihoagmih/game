import type { Room } from '../lobby.js';
// Líu lưỡi: hai đội thay phiên, mỗi lượt một người đọc to câu líu lưỡi trên màn hình.
// Người nghe (cả hai đội) chấm "Chuẩn" hay "Vấp"; server giữ phiếu, tự chấm và cộng điểm cho đội.
// Câu lấy ngẫu nhiên từ bộ có sẵn (data/twisters-vi.json), ít lặp lại trong cùng một phòng.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randInt } from '@game/shared/cards';
import {
  isDifficulty, isTeam, isVerdict, levelFor, parseBank, pickLine, pointsFor, smallerTeam, tally, teamAt, turnsPerTeam,
  JUDGE_SECONDS, MAX_SEATS, MIN_PLAYERS, READ_SECONDS, RESULT_SECONDS, ROUNDS, TEAM_NAMES,
} from '@game/shared/twister';
import type {
  TeamIndex, TurnOutcome, TwisterCurrentView, TwisterDifficulty, TwisterLevel, TwisterPhase, TwisterPlayerView,
  TwisterSeatView, TwisterTurnView, TwisterView, Verdict,
} from '@game/shared/twister';
import type { GameAction, Identity } from '@game/shared/contracts';
import { clampInt } from './options.js';
import { ReadyGate } from './ready.js';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/twisters-vi.json');
export const BANK = parseBank(JSON.parse(fs.readFileSync(DATA, 'utf8')));
const LOG_VIEW = 30;

interface TwisterOptions { maxSeats: number; rounds: number; readSeconds: number; difficulty: TwisterDifficulty }
type TwisterPlayer = TwisterPlayerView;
interface TwisterTurn {
  phase: TwisterPhase;
  readerId: string;
  team: TeamIndex;
  line: number;
  level: TwisterLevel;
  votes: Map<string, Verdict>;
  outcome: TwisterTurnView | null;
}
type TwisterResult = NonNullable<TwisterView['result']>;

export class TwisterHandler {
  declare room: Pick<Room, 'ownerId' | 'system' | 'changed'>;
  declare options: TwisterOptions;
  declare seats: TwisterSeatView[];
  declare ready: ReadyGate;
  declare status: TwisterView['status'];
  declare gameNo: number;
  declare players: TwisterPlayer[];
  declare first: TeamIndex;
  declare rotation: [number, number];
  declare turn: number;
  declare totalTurns: number;
  declare turnNo: number;
  declare current: TwisterTurn | null;
  declare scores: [number, number];
  declare log: TwisterTurnView[];
  declare result: TwisterResult | null;
  declare wins: [number, number];
  declare used: Set<number>;
  declare timer: ReturnType<typeof setTimeout> | null;
  declare deadline: number;
  declare phaseTotal: number;

  constructor(room: Pick<Room, 'ownerId' | 'system' | 'changed'>, options: Record<string, unknown>) {
    this.room = room;
    this.options = {
      maxSeats: clampInt(options.maxSeats, MAX_SEATS.min, MAX_SEATS.max, MAX_SEATS.default),
      rounds: clampInt(options.rounds, ROUNDS.min, ROUNDS.max, ROUNDS.default),
      readSeconds: clampInt(options.readSeconds, READ_SECONDS.min, READ_SECONDS.max, READ_SECONDS.default),
      difficulty: isDifficulty(options.difficulty) ? options.difficulty : 'mix',
    };
    this.seats = [];
    this.ready = new ReadyGate(room);
    this.status = 'waiting';
    this.gameNo = 0;
    this.players = [];
    this.first = 0;
    this.rotation = [0, 0];
    this.turn = 0;
    this.totalTurns = 0;
    this.turnNo = 0; // tăng mỗi lượt đọc — phiếu chấm gửi kèm số này để không lọt sang lượt sau
    this.current = null;
    this.scores = [0, 0];
    this.log = [];
    this.result = null;
    this.wins = [0, 0];
    this.used = new Set(); // các câu đã đọc trong phòng (chỉ số trong BANK)
    this.timer = null;
    this.deadline = 0;
    this.phaseTotal = 0;
  }

  get maxPlayers() { return this.options.maxSeats; }
  playerIds() { return this.seats.map((s) => s.id); }
  isPlaying() { return this.status === 'playing'; }
  seated(id: string) { return this.seats.some((s) => s.id === id); }
  player(id: string) { return this.players.find((p) => p.id === id); }
  active(team?: TeamIndex) { return this.players.filter((p) => !p.gone && (team === undefined || p.team === team)); }

  rename(id: string, name: string) {
    for (const s of this.seats) if (s.id === id) s.name = name;
    for (const p of this.players) if (p.id === id) p.name = name;
  }

  /** Ngồi được cả khi ván đang chơi — chờ ván sau. `seat` (0/1) là đội muốn vào, không có thì vào đội ít người hơn. */
  sit(user: Identity, seat?: string | number) {
    if (this.seated(user.id)) throw new Error('Bạn đã ngồi rồi');
    if (this.seats.length >= this.options.maxSeats) throw new Error('Bàn đã đủ người');
    const wanted = Number(seat);
    const team = seat !== undefined && seat !== '' && isTeam(wanted) ? wanted : smallerTeam(this.seats.map((s) => s.team));
    this.seats.push({ id: user.id, name: user.name, team });
  }

  stand(id: string) {
    if (!this.seated(id)) return;
    this.seats = this.seats.filter((s) => s.id !== id);
    this.ready.delete(id);
    const p = this.player(id);
    if (this.status !== 'playing' || !p || p.gone) return;
    p.gone = true;
    this.room.system(`${p.name} rời bàn`);
    if (!this.active(0).length || !this.active(1).length) return this._finish('forfeit');
    const cur = this.current;
    if (!cur) return;
    if (cur.readerId === id && cur.phase === 'read') return this._settle('skip');
    cur.votes.delete(id);
    if (cur.phase === 'judge' && this._allVoted()) this._settle();
  }

  onLeave(id: string) { this.stand(id); }

  action(id: string, a: GameAction) {
    switch (a.type) {
      case 'start':
        if (this.isPlaying()) throw new Error('Ván đang diễn ra');
        this.ready.check(id, this.seats, MIN_PLAYERS);
        return this._start();
      case 'ready':
        if (!this.seated(id)) throw new Error('Bạn đang ở chế độ xem');
        if (this.isPlaying()) throw new Error('Ván đang diễn ra');
        return this.ready.toggle(id);
      case 'twisterTeam': {
        const seat = this.seats.find((s) => s.id === id);
        if (!seat) throw new Error('Bạn đang ở chế độ xem');
        if (this.isPlaying()) throw new Error('Không đổi đội khi ván đang diễn ra');
        if (!isTeam(a.team)) throw new Error('Đội không hợp lệ');
        seat.team = a.team;
        return;
      }
      case 'next': // người đọc báo đã đọc xong → mời cả bàn chấm
        this._requireReader(id);
        return this._toJudge();
      case 'pass': // người đọc chịu thua câu này
        this._requireReader(id);
        return this._settle('skip');
      case 'twisterVote':
        return this._vote(id, a.verdict, a.turn);
      case 'stop':
        if (id !== this.room.ownerId) throw new Error('Chỉ chủ phòng mới được dừng ván');
        if (!this.isPlaying()) throw new Error('Không có ván đang chơi');
        this.room.system('Chủ phòng dừng ván');
        return this._finish('stopped');
      default:
        throw new Error('Hành động không hợp lệ');
    }
  }

  _requireReader(id: string) {
    const cur = this.current;
    if (!this.isPlaying() || !cur) throw new Error('Ván chưa bắt đầu');
    if (cur.readerId !== id) throw new Error('Chưa tới lượt bạn đọc');
    if (cur.phase !== 'read') throw new Error('Lượt đọc đã xong');
  }

  /** Người được chấm lượt này: mọi người chơi còn ở bàn trừ người đọc. */
  _voters() {
    const reader = this.current?.readerId;
    return this.active().filter((p) => p.id !== reader);
  }

  _allVoted() {
    const cur = this.current;
    return !!cur && this._voters().every((p) => cur.votes.has(p.id));
  }

  /** Chấm được ngay khi đang đọc (nghe vấp là bấm) và trong lúc chấm; được đổi ý tới khi có kết quả. */
  _vote(id: string, verdict: unknown, turn: unknown) {
    const cur = this.current;
    if (!this.isPlaying() || !cur) throw new Error('Ván chưa bắt đầu');
    if (turn !== this.turnNo) throw new Error('Lượt này đã qua');
    if (!isVerdict(verdict)) throw new Error('Phiếu chấm không hợp lệ');
    if (cur.phase === 'result') throw new Error('Lượt này đã chấm xong');
    if (cur.readerId === id) throw new Error('Người đọc không tự chấm');
    if (!this._voters().some((p) => p.id === id)) throw new Error('Bạn không chơi ván này');
    cur.votes.set(id, verdict);
    if (cur.phase === 'judge' && this._allVoted()) this._settle();
  }

  // ---------- Diễn biến ván ----------

  _start() {
    if (this.seats.every((s) => s.team === 0) || this.seats.every((s) => s.team === 1)) throw new Error('Mỗi đội cần ít nhất 1 người');
    this.players = this.seats.map((s) => ({ ...s, gone: false, reads: 0, clean: 0 }));
    const sizes = [0, 1].map((t) => this.players.filter((p) => p.team === t).length);
    this.first = this.gameNo % 2 === 0 ? 0 : 1; // đổi đội mở màn mỗi ván
    this.rotation = [0, 0];
    this.turn = 0;
    this.totalTurns = 2 * turnsPerTeam(this.options.rounds, sizes);
    this.scores = [0, 0];
    this.log = [];
    this.result = null;
    this.status = 'playing';
    this.ready.clear();
    this.gameNo++;
    this.room.system(`Ván ${this.gameNo} bắt đầu — ${this.totalTurns} lượt đọc, ${TEAM_NAMES[this.first]} mở màn!`);
    this._beginTurn();
  }

  /** Người đọc tiếp theo của đội: xoay vòng theo thứ tự ngồi, bỏ qua người đã rời bàn. */
  _nextReader(team: TeamIndex) {
    const members = this.players.filter((p) => p.team === team);
    for (let k = 0; k < members.length; k++) {
      const p = members[this.rotation[team]++ % members.length];
      if (!p.gone) return p;
    }
    return null;
  }

  _beginTurn() {
    if (this.turn >= this.totalTurns) return this._finish('done');
    const team = teamAt(this.turn, this.first);
    const reader = this._nextReader(team);
    if (!reader) return this._finish('forfeit');
    const level = levelFor(this.options.difficulty, this.turn, this.totalTurns);
    const line = pickLine(BANK, level, this.used, randInt);
    this.used.add(line);
    this.turnNo++;
    this.current = { phase: 'read', readerId: reader.id, team, line, level: BANK[line].l, votes: new Map(), outcome: null };
    this._phase('read', this.options.readSeconds * 1000);
  }

  _phase(phase: TwisterPhase, ms: number) {
    if (this.current) this.current.phase = phase;
    this.phaseTotal = ms;
    this.deadline = Date.now() + ms;
    clearTimeout(this.timer ?? undefined);
    this.timer = setTimeout(() => {
      try { this._onTimeout(); } catch (e) { console.error('twister timer', e); }
      this.room.changed();
    }, ms);
  }

  /** Hết giờ của pha hiện tại; cũng dùng khi khôi phục từ snapshot. */
  _onTimeout() {
    const cur = this.current;
    if (!this.isPlaying() || !cur) return;
    this.timer = null;
    if (cur.phase === 'read') this._toJudge();
    else if (cur.phase === 'judge') this._settle();
    else {
      this.turn++;
      this._beginTurn();
    }
  }

  _toJudge() {
    if (!this._voters().length) return this._settle();
    if (this._allVoted()) return this._settle(); // ai cũng đã chấm trong lúc nghe
    this._phase('judge', JUDGE_SECONDS * 1000);
  }

  /** Chốt kết quả lượt: theo phiếu chấm, hoặc `skip` khi người đọc bỏ qua / rời bàn. */
  _settle(forced?: TurnOutcome) {
    const cur = this.current;
    if (!cur || cur.outcome) return;
    const voters = new Set(this._voters().map((p) => p.id));
    const counted = tally([...cur.votes].filter(([id]) => voters.has(id)).map(([, v]) => v));
    const outcome = forced ?? counted.verdict;
    const points = outcome === 'clean' ? pointsFor(cur.level) : 0;
    const reader = this.player(cur.readerId);
    const line = BANK[cur.line];
    this.scores[cur.team] += points;
    if (reader) {
      reader.reads++;
      if (outcome === 'clean') reader.clean++;
    }
    cur.outcome = {
      no: this.turn + 1, readerId: cur.readerId, readerName: reader?.name ?? '?', team: cur.team,
      text: line.t, level: cur.level, repeat: line.x ?? 1, lang: line.lang ?? 'vi', outcome, clean: counted.clean, slip: counted.slip, points,
    };
    this.log.push(cur.outcome);
    this._phase('result', RESULT_SECONDS * 1000);
  }

  _finish(reason: TwisterResult['reason']) {
    clearTimeout(this.timer ?? undefined);
    this.timer = null;
    this.deadline = 0;
    this.current = null;
    this.status = 'over';
    const alive = ([0, 1] as const).filter((t) => this.active(t).length > 0);
    const [a, b] = this.scores;
    const winner: TeamIndex | null = reason === 'forfeit' && alive.length === 1 ? alive[0] : a === b ? null : a > b ? 0 : 1;
    this.result = { winner, scores: [a, b], reason };
    if (winner !== null) this.wins[winner]++;
    this.room.system(winner === null ? `Ván ${this.gameNo} hòa ${a}–${b}!` : `${TEAM_NAMES[winner]} thắng ván ${this.gameNo} (${a}–${b})!`);
  }

  _currentView(viewerId: string): TwisterCurrentView | null {
    const cur = this.current;
    if (!this.isPlaying() || !cur) return null;
    const line = BANK[cur.line];
    const voters = this._voters();
    return {
      phase: cur.phase,
      readerId: cur.readerId,
      team: cur.team,
      text: line.t,
      level: cur.level,
      repeat: line.x ?? 1,
      lang: line.lang ?? 'vi',
      voted: voters.filter((p) => cur.votes.has(p.id)).map((p) => p.id),
      voters: voters.length,
      // Phiếu của người khác chỉ lộ (dưới dạng số đếm) khi có kết quả
      myVote: cur.votes.get(viewerId) ?? null,
      canVote: cur.phase !== 'result' && voters.some((p) => p.id === viewerId),
      outcome: cur.outcome,
    };
  }

  view(viewerId: string): TwisterView {
    const playing = this.isPlaying();
    return {
      options: this.options,
      status: this.status,
      seats: this.seats,
      ...this.ready.view(this.playerIds()),
      minPlayers: MIN_PLAYERS,
      myId: this.seated(viewerId) ? viewerId : null,
      gameNo: this.gameNo,
      players: this.players,
      turn: this.turn,
      totalTurns: this.totalTurns,
      turnNo: this.turnNo,
      current: this._currentView(viewerId),
      phaseLeft: playing ? Math.max(0, this.deadline - Date.now()) : 0,
      phaseTotal: this.phaseTotal,
      scores: this.scores,
      log: this.log.slice(-LOG_VIEW),
      result: this.result,
      wins: this.wins,
      bankSize: BANK.length,
    };
  }

  dispose() {
    clearTimeout(this.timer ?? undefined);
    this.timer = null;
  }
}
