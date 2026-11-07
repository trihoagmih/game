import { replayRace } from '@game/shared/race';
import type { GameAction, Identity } from '@game/shared/contracts';
import type { RaceEnd, RaceEngine, RaceInput, RacePlayerView, RaceResult, RaceScore, RaceStatus, RaceView } from '@game/shared/race';
import type { Room } from '../lobby.js';
import { ReadyGate } from './ready.js';

// Vòng đời chung của các trò "đua song song, server phát lại" (Bay qua khe, Đào vàng): mỗi người một
// engine cùng hạt giống, client gửi lệnh [tick, lệnh] lên, server phát lại để tự tính điểm. Đồng hồ
// server chặn client chạy trước; ai im lặng quá lâu thì server tự cho chạy tiếp không có lệnh.

const COUNTDOWN_MS = 3000;
/** Client được phép chạy trước đồng hồ server chừng này. */
const AHEAD_SLACK_MS = 1500;
/** Chậm hơn chừng này thì server tự đẩy người chơi đi tiếp (tab ẩn, mất mạng, cố tình dừng). */
const BEHIND_SLACK_MS = 4000;
const MAX_INPUTS_PER_SYNC = 200;
const MAX_INPUTS = 8000;

export interface RacePlayer<G, C extends string> extends Identity {
  game: G;
  inputs: RaceInput<C>[];
  used: number;
  done: boolean;
  end: RaceEnd | null;
  endedAt: number | null;
}

type RaceRoom = Pick<Room, 'ownerId' | 'system' | 'changed'> & Partial<Pick<Room, 'recordScore' | 'workspaceRecord'>>;

/** Lớp con thêm luật riêng và `implements GameHandler` với kiểu view của mình. */
export abstract class RaceHandler<G extends RaceEngine<C>, C extends string, O extends { maxSeats: number }> {
  room: RaceRoom;
  readonly options: O;
  seats: Identity[] = [];
  readonly ready: ReadyGate;
  status: RaceStatus = 'waiting';
  players: RacePlayer<G, C>[] = [];
  seed = 0;
  startAt = 0;
  gameNo = 0;
  result: RaceResult | null = null;
  timer: ReturnType<typeof setTimeout> | null = null;
  watchTimer: ReturnType<typeof setInterval> | null = null;
  wins = new Map<string, RaceScore>();

  constructor(room: RaceRoom, options: O) {
    this.room = room;
    this.options = options;
    this.ready = new ReadyGate(room);
  }

  abstract readonly tickMs: number;
  protected abstract readonly commands: readonly C[];
  protected abstract createGame(seed: number): G;
  /** Số bước tối đa của một ván (engine tự kết thúc trước hoặc đúng lúc này). */
  protected abstract maxTicks(game: G): number;
  protected abstract scoreOf(game: G): number;
  protected abstract endOf(game: G): RaceEnd;
  /** Thứ tự xếp hạng: âm nếu `a` đứng trên `b`. */
  protected abstract compare(a: RacePlayer<G, C>, b: RacePlayer<G, C>): number;
  protected abstract endMessage(p: RacePlayer<G, C>): string;
  protected abstract startMessage(): string;

  get maxPlayers() { return this.options.maxSeats; }
  playerIds() { return this.seats.map((s) => s.id); }
  isPlaying() { return this.status === 'playing'; }
  seated(id: string) { return this.seats.some((s) => s.id === id); }
  player(id: string) { return this.players.find((p) => p.id === id); }

  rename(id: string, name: string) {
    for (const s of this.seats) if (s.id === id) s.name = name;
    const p = this.player(id);
    if (p) p.name = name;
    const w = this.wins.get(id);
    if (w) w.name = name;
  }

  sit(user: Identity) {
    if (this.seated(user.id)) throw new Error('Bạn đã ngồi rồi');
    if (this.isPlaying()) throw new Error('Ván đang diễn ra, đợi ván sau nhé');
    if (this.seats.length >= this.options.maxSeats) throw new Error('Bàn đã đủ người');
    this.seats.push({ id: user.id, name: user.name });
  }

  stand(id: string) {
    if (!this.seated(id)) return;
    const p = this.player(id);
    if (this.isPlaying() && p && !p.done) {
      this.out(p, 'gaveUp');
      this.room.system(`${p.name} rời bàn — bỏ cuộc`);
      this.checkEnd();
    }
    this.seats = this.seats.filter((s) => s.id !== id);
    this.ready.delete(id);
  }

  onLeave(id: string) { this.stand(id); }

  /** Số bước tối đa đã có thể chạy theo đồng hồ server. */
  clockTick(now = Date.now()) {
    return Math.max(0, Math.floor((now - this.startAt) / this.tickMs));
  }

  action(id: string, action: GameAction) {
    if (action.type === 'start') {
      if (this.isPlaying()) throw new Error('Ván đang diễn ra');
      this.ready.check(id, this.seats, 1);
      this.start();
      return;
    }
    if (!this.seated(id)) throw new Error('Bạn đang ở chế độ xem');
    if (action.type === 'ready') {
      if (this.isPlaying()) throw new Error('Ván đang diễn ra');
      this.ready.toggle(id);
      return;
    }
    if (!this.isPlaying()) throw new Error('Ván chưa bắt đầu');
    const p = this.player(id);
    if (!p) throw new Error('Bạn không chơi ván này');
    if (p.done) return; // gói tin đến trễ sau khi đã dừng — bỏ qua êm
    if (action.type === 'raceSync') {
      this.sync(p, action.tick, action.inputs);
      return;
    }
    if (action.type === 'giveup') {
      this.out(p, 'gaveUp');
      this.room.system(`${p.name} bỏ cuộc (${this.scoreOf(p.game)} điểm)`);
      this.checkEnd();
      return;
    }
    throw new Error('Hành động không hợp lệ');
  }

  /** Nhận lệnh mới (dữ liệu client, kiểm tra từng phần) rồi phát lại tới `rawTick`. */
  sync(p: RacePlayer<G, C>, rawTick: unknown, rawInputs: unknown) {
    const tick = typeof rawTick === 'number' && Number.isSafeInteger(rawTick) ? rawTick : -1;
    if (tick < 0 || !Array.isArray(rawInputs)) throw new Error('Dữ liệu không hợp lệ');
    if (tick > this.clockTick(Date.now() + AHEAD_SLACK_MS)) throw new Error('Đồng hồ lệch quá nhiều');
    if (rawInputs.length > MAX_INPUTS_PER_SYNC || p.inputs.length + rawInputs.length > MAX_INPUTS) throw new Error('Quá nhiều thao tác');
    let last = p.inputs.length ? p.inputs[p.inputs.length - 1][0] : 0;
    for (const raw of rawInputs) {
      const input = this.parseInput(raw);
      if (!input) throw new Error('Dữ liệu không hợp lệ');
      // Lệnh cũ hơn chỗ server đã chạy tới thì không sửa được nữa — bỏ qua, client sẽ tự dựng lại
      if (input[0] < p.game.tick || input[0] < last || input[0] > tick) continue;
      p.inputs.push(input);
      last = input[0];
    }
    this.advance(p, tick);
  }

  parseInput(raw: unknown): RaceInput<C> | null {
    if (!Array.isArray(raw) || raw.length !== 2) return null;
    const [tick, command] = raw as unknown[];
    if (typeof tick !== 'number' || !Number.isSafeInteger(tick) || tick < 0) return null;
    const known = this.commands.find((c) => c === command);
    return known ? [tick, known] : null;
  }

  advance(p: RacePlayer<G, C>, tick: number) {
    p.used = replayRace(p.game, p.inputs, tick, p.used);
    if (!p.game.over) return;
    this.out(p, this.endOf(p.game));
    this.room.system(this.endMessage(p));
    this.checkEnd();
  }

  out(p: RacePlayer<G, C>, end: RaceEnd) {
    if (p.done) return;
    this.room.recordScore?.({ id: p.id, name: p.name, score: this.scoreOf(p.game), at: Date.now() });
    p.done = true;
    p.end = end;
    p.endedAt = Math.max(0, Date.now() - this.startAt);
  }

  start() {
    this.seed = (Math.random() * 2 ** 32) >>> 0;
    this.players = this.seats.map((s) => ({
      id: s.id, name: s.name, game: this.createGame(this.seed), inputs: [], used: 0, done: false, end: null, endedAt: null,
    }));
    this.status = 'playing';
    this.result = null;
    this.ready.clear();
    this.gameNo++;
    this.startAt = Date.now() + COUNTDOWN_MS;
    this.arm();
    this.room.system(this.startMessage());
  }

  /** Hẹn giờ của ván, tính từ mốc tuyệt đối `startAt` nên gọi lại được khi khôi phục từ bản lưu. */
  arm() {
    this.clearTimers();
    if (!this.isPlaying() || !this.players.length) return;
    this.watchTimer = setInterval(() => this.nudge(), 1000);
    const end = this.startAt + this.maxTicks(this.players[0].game) * this.tickMs + BEHIND_SLACK_MS + 1000;
    if (!Number.isFinite(end)) return;
    this.timer = setTimeout(() => {
      if (!this.isPlaying()) return;
      for (const p of this.players) if (!p.done) this.out(p, 'timedOut');
      this.finish();
      this.room.changed();
    }, Math.max(0, end - Date.now()));
  }

  nudge() {
    if (!this.isPlaying()) return;
    const behind = this.clockTick(Date.now() - BEHIND_SLACK_MS);
    let moved = false;
    for (const p of this.players) {
      if (p.done || p.game.tick >= behind) continue;
      this.advance(p, behind);
      moved = true;
    }
    if (moved) this.room.changed();
  }

  checkEnd() {
    if (this.isPlaying() && this.players.every((p) => p.done)) this.finish();
  }

  finish() {
    this.clearTimers();
    this.status = 'over';
    const ranking = [...this.players].sort((a, b) => this.compare(a, b));
    const top = ranking[0];
    const winner = this.players.length > 1 && top && this.scoreOf(top.game) > 0 ? top.id : null;
    this.result = { winner, ranking: ranking.map((p) => p.id), endedAt: Date.now() };
    for (const p of this.players) {
      const w = this.wins.get(p.id) ?? { id: p.id, name: p.name, games: 0, wins: 0, best: 0 };
      w.name = p.name;
      w.games++;
      if (p.id === winner) w.wins++;
      w.best = Math.max(w.best, this.scoreOf(p.game));
      this.wins.set(p.id, w);
    }
    const line = ranking.map((p, i) => `${i + 1}. ${p.name} (${this.scoreOf(p.game)})`).join(', ');
    const head = this.players.length > 1 ? `${winner ? `${top.name} thắng!` : 'Không ai thắng.'} Xếp hạng:` : 'Kết thúc:';
    this.room.system(`🏁 ${head} ${line}`);
  }

  /** Phần chung của view; `extra` thêm dữ liệu riêng từng trò cho mỗi người chơi. */
  raceView<E extends object>(viewerId: string, extra: (p: RacePlayer<G, C>) => E): RaceView<O, RacePlayerView & E> {
    const playing = this.isPlaying();
    return {
      workspaceRecord: this.room.workspaceRecord?.() ?? null,
      options: this.options,
      seats: this.seats,
      ...this.ready.view(this.playerIds()),
      status: this.status,
      gameNo: this.gameNo,
      myId: this.seated(viewerId) ? viewerId : null,
      seed: this.status === 'waiting' ? 0 : this.seed,
      tickMs: this.tickMs,
      startIn: playing ? this.startAt - Date.now() : 0,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: this.scoreOf(p.game),
        tick: p.game.tick,
        accepted: p.inputs.length,
        done: p.done,
        end: p.end,
        endedAt: p.endedAt,
        ...extra(p),
      })),
      result: this.result,
      wins: [...this.wins.values()].sort((a, b) => b.wins - a.wins || b.best - a.best),
    };
  }

  clearTimers() {
    clearTimeout(this.timer ?? undefined);
    clearInterval(this.watchTimer ?? undefined);
    this.timer = null;
    this.watchTimer = null;
  }

  dispose() { this.clearTimers(); }
}
