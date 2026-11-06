// Vẽ đoán chữ: lần lượt mỗi người vẽ một từ, những người còn lại gõ đoán.
// Mỗi vòng ai cũng được vẽ một lần. Đoán càng nhanh càng nhiều điểm; người vẽ được điểm theo số người đoán đúng.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randInt } from '@game/shared/cards';
import {
  checkGuess, revealsWord, maskWord, hintCount, guessPoints, DRAWER_POINTS, cleanOps, parseCustomWords, normalizeGuess,
} from '@game/shared/scribble';
import { bool, clampInt } from './options.js';
import { ReadyGate } from './ready.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data');
export const WORDS = [...new Set(fs.readFileSync(path.join(DATA_DIR, 'scribble-words.txt'), 'utf8')
  .split('\n').map(normalizeGuess).filter(Boolean))];

const CHOOSE_MS = 15_000; // thời gian người vẽ chọn từ
const REVEAL_MS = 6_000; // xem đáp án và điểm trước lượt sau
const CHOICES = 3;
const FEED_MAX = 60;
const MAX_STORED_POINTS = 60_000; // giới hạn bộ nhớ của một bức vẽ

export class ScribbleHandler {
  constructor(room, options) {
    this.room = room;
    const custom = parseCustomWords(options.customWords);
    this.options = {
      maxSeats: clampInt(options.maxSeats, 2, 12, 8),
      rounds: clampInt(options.rounds, 1, 6, 3),
      drawSeconds: clampInt(options.drawSeconds, 30, 180, 80),
      hints: bool(options.hints, true),
      customCount: custom.length,
      onlyCustom: bool(options.onlyCustom, false) && custom.length >= 10,
    };
    this.pool = this.options.onlyCustom ? custom : [...new Set([...WORDS, ...custom])];
    this.seats = []; // [{ id, name }]
    this.ready = new ReadyGate(room);
    this.status = 'waiting'; // waiting | playing | over
    this.gameNo = 0;
    this.wins = new Map(); // id -> { id, name, games, wins }
    this.last = null; // kết quả ván gần nhất { ranking: [{ id, name, score }] }
    this._resetGame();
  }

  _resetGame() {
    clearTimeout(this.timer);
    this.hintTimers?.forEach(clearTimeout);
    this.timer = null;
    this.hintTimers = [];
    this.order = []; // id theo thứ tự vẽ
    this.scores = new Map(); // id -> { id, name, score }
    this.round = 0;
    this.drawerIdx = -1;
    this.drawerId = null;
    this.phase = null; // choose | draw | reveal
    this.turnNo = 0;
    this.choices = [];
    this.word = '';
    this.revealed = new Set();
    this.guessed = new Map(); // id -> điểm của lượt
    this.drawerGain = 0;
    this.ops = [];
    this.points = 0;
    this.used = new Set();
    this.feed = [];
    this.deadline = 0;
    this.phaseTotal = 0;
  }

  get maxPlayers() { return this.options.maxSeats; }
  playerIds() { return this.seats.map((s) => s.id); }
  isPlaying() { return this.status === 'playing'; }
  seated(id) { return this.seats.some((s) => s.id === id); }
  nameOf(id) { return this.seats.find((s) => s.id === id)?.name || this.scores.get(id)?.name || '?'; }

  rename(id, name) {
    for (const s of this.seats) if (s.id === id) s.name = name;
    const sc = this.scores.get(id);
    if (sc) sc.name = name;
    const w = this.wins.get(id);
    if (w) w.name = name;
  }

  /** Ngồi vào bàn — kể cả khi ván đang diễn ra (vào đoán ngay, tới lượt thì vẽ). */
  sit(user) {
    if (this.seated(user.id)) throw new Error('Bạn đã ngồi rồi');
    if (this.seats.length >= this.options.maxSeats) throw new Error('Bàn đã đủ người');
    this.seats.push({ id: user.id, name: user.name });
    if (this.status === 'playing') this._join(user.id, user.name);
  }

  _join(id, name) {
    if (!this.order.includes(id)) this.order.push(id);
    if (!this.scores.has(id)) this.scores.set(id, { id, name, score: 0 });
  }

  stand(id) {
    if (!this.seated(id)) return;
    this.seats = this.seats.filter((s) => s.id !== id);
    this.ready.delete(id);
    if (this.status !== 'playing') return;
    if (this.seats.length < 2) {
      this._post({ kind: 'sys', text: 'Còn dưới 2 người — ván kết thúc' });
      return this._finish();
    }
    if (id === this.drawerId && this.phase !== 'reveal') {
      this._post({ kind: 'sys', text: `${this.nameOf(id)} rời bàn khi đang vẽ` });
      return this._endTurn();
    }
    this._checkAllGuessed();
  }

  onLeave(id) { this.stand(id); }

  action(id, a) {
    switch (a.type) {
      case 'start': {
        if (this.status === 'playing') throw new Error('Ván đang diễn ra');
        this.ready.check(id, this.seats);
        return this._start();
      }
      case 'ready':
        if (!this.seated(id)) throw new Error('Bạn đang ở chế độ xem');
        if (this.status === 'playing') throw new Error('Ván đang diễn ra');
        return this.ready.toggle(id);
      case 'choose': {
        if (this.phase !== 'choose' || id !== this.drawerId) throw new Error('Chưa tới lượt bạn chọn từ');
        const i = Number(a.index);
        if (!Number.isInteger(i) || i < 0 || i >= this.choices.length) throw new Error('Lựa chọn không hợp lệ');
        return this._beginDraw(this.choices[i]);
      }
      case 'guess':
        return this._guess(id, String(a.text || '').slice(0, 60));
      case 'stop': {
        if (id !== this.room.ownerId) throw new Error('Chỉ chủ phòng mới được dừng ván');
        if (this.status !== 'playing') throw new Error('Ván chưa bắt đầu');
        this._post({ kind: 'sys', text: 'Chủ phòng dừng ván' });
        return this._finish();
      }
      default:
        throw new Error('Hành động không hợp lệ');
    }
  }

  /** Nét vẽ gửi lên liên tục (không qua room.changed): trả về gói để chuyển cho những người khác. */
  stream(id, payload) {
    if (this.status !== 'playing' || this.phase !== 'draw' || id !== this.drawerId) return null;
    if (Number(payload.turn) !== this.turnNo) return null;
    const ops = cleanOps(payload.ops);
    const out = [];
    for (const o of ops) {
      if (o.k === 'c') {
        this.ops = [];
        this.points = 0;
      } else if (o.k === 'u') {
        this.ops = this.ops.filter((x) => x.id !== o.id);
      } else {
        const n = o.p.length / 2;
        if (this.points + n > MAX_STORED_POINTS) break; // bức vẽ quá lớn: bỏ qua phần thêm
        this.points += n;
        this.ops.push(o);
      }
      out.push(o);
    }
    return out.length ? { turn: this.turnNo, ops: out } : null;
  }

  query(viewerId, q) {
    if (q.type === 'canvas') return { turn: this.turnNo, ops: this.phase === 'choose' ? [] : this.ops };
    throw new Error('Truy vấn không hợp lệ');
  }

  /** Không cho nhắc đáp án trong khung chat của phòng khi đang vẽ. */
  censorChat(id, text) {
    if (this.status === 'playing' && this.phase === 'draw' && revealsWord(text, this.word)) {
      throw new Error(id === this.drawerId || this.guessed.has(id)
        ? 'Không được để lộ đáp án'
        : 'Gõ câu đoán vào ô Đoán bên dưới khung vẽ nhé');
    }
  }

  // ---------- Diễn biến ván ----------

  _start() {
    this._resetGame();
    for (const s of this.seats) this._join(s.id, s.name);
    // Thứ tự vẽ ngẫu nhiên mỗi ván
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    this.status = 'playing';
    this.ready.clear();
    this.gameNo++;
    this.round = 1;
    this.room.system(`Ván ${this.gameNo} bắt đầu — ${this.options.rounds} vòng, thứ tự vẽ: ${this.order.map((id) => this.nameOf(id)).join(' → ')}`);
    this._nextTurn();
  }

  _post(entry) {
    this.feed.push({ ...entry, n: (this.feed.at(-1)?.n || 0) + 1 });
    if (this.feed.length > FEED_MAX) this.feed.shift();
  }

  _setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.deadline = Date.now() + ms;
    this.phaseTotal = ms;
    this.timer = setTimeout(() => {
      try { fn(); } catch (e) { console.error('scribble timer', e); }
      this.room.changed();
    }, ms);
  }

  _nextTurn() {
    this.hintTimers.forEach(clearTimeout);
    this.hintTimers = [];
    // Người tiếp theo còn ngồi bàn; hết lượt của vòng thì sang vòng mới
    for (;;) {
      this.drawerIdx++;
      if (this.drawerIdx >= this.order.length) {
        this.drawerIdx = 0;
        this.round++;
        if (this.round > this.options.rounds) return this._finish();
      }
      const id = this.order[this.drawerIdx];
      if (this.seated(id) && this.room.isOnline(id)) break;
    }
    this.drawerId = this.order[this.drawerIdx];
    this.turnNo++;
    this.phase = 'choose';
    this.word = '';
    this.revealed = new Set();
    this.guessed = new Map();
    this.drawerGain = 0;
    this.ops = [];
    this.points = 0;
    this.choices = this._pickChoices();
    this._post({ kind: 'sys', text: `Vòng ${this.round}/${this.options.rounds} — ${this.nameOf(this.drawerId)} đang chọn từ để vẽ` });
    this._setTimer(CHOOSE_MS, () => {
      if (this.phase === 'choose') this._beginDraw(this.choices[randInt(this.choices.length)]);
    });
  }

  _pickChoices() {
    let fresh = this.pool.filter((w) => !this.used.has(w));
    if (fresh.length < CHOICES) {
      this.used.clear();
      fresh = this.pool.slice();
    }
    const out = [];
    while (out.length < CHOICES && fresh.length) out.push(fresh.splice(randInt(fresh.length), 1)[0]);
    return out;
  }

  _beginDraw(word) {
    this.word = word;
    this.used.add(word);
    this.choices = [];
    this.phase = 'draw';
    const total = this.options.drawSeconds * 1000;
    this._setTimer(total, () => {
      if (this.phase !== 'draw') return;
      this._post({ kind: 'sys', text: '⏰ Hết giờ!' });
      this._endTurn();
    });
    // Gợi ý: lộ dần vài chữ cái trong khoảng 45%–85% thời gian
    this._scheduleHints();
  }

  _scheduleHints() {
    const word = this.word;
    const total = this.phaseTotal;
    if (this.options.hints) {
      const n = hintCount(word);
      for (let k = this.revealed.size; k < n; k++) {
        const at = total * (0.45 + (0.4 * k) / Math.max(1, n - 1));
        this.hintTimers.push(setTimeout(() => {
          if (this.phase !== 'draw' || this.word !== word) return;
          const hidden = [...word].map((ch, i) => (ch !== ' ' && !this.revealed.has(i) ? i : -1)).filter((i) => i >= 0);
          if (hidden.length <= 1) return;
          this.revealed.add(hidden[randInt(hidden.length)]);
          this.room.changed();
        }, Math.max(0, this.deadline - total + at - Date.now())));
      }
    }
  }

  _guess(id, text) {
    if (this.status !== 'playing' || this.phase !== 'draw') throw new Error('Chưa tới lúc đoán');
    if (!this.seated(id)) throw new Error('Người xem không đoán được — hãy vào chơi');
    if (id === this.drawerId) throw new Error('Bạn đang vẽ mà!');
    if (this.guessed.has(id)) throw new Error('Bạn đã đoán đúng rồi');
    const t = normalizeGuess(text);
    if (!t) throw new Error('Hãy nhập câu đoán');
    this._join(id, this.nameOf(id));
    const name = this.nameOf(id);
    const res = checkGuess(t, this.word);
    if (res === 'correct') {
      const pts = guessPoints(this.deadline - Date.now(), this.phaseTotal, this.guessed.size);
      this.guessed.set(id, pts);
      this.scores.get(id).score += pts;
      this.drawerGain += DRAWER_POINTS;
      const d = this.scores.get(this.drawerId);
      if (d) d.score += DRAWER_POINTS;
      this._post({ kind: 'correct', id, name, text: `${name} đã đoán đúng! (+${pts})` });
      this._checkAllGuessed();
      return;
    }
    this._post({ kind: 'guess', id, name, text: t });
    if (res === 'close') this._post({ kind: 'close', to: id, text: `"${t}" gần đúng rồi!` });
  }

  /** Mọi người (trừ người vẽ) đã đoán đúng thì kết thúc lượt sớm. */
  _checkAllGuessed() {
    if (this.phase !== 'draw') return;
    const guessers = this.seats.filter((s) => s.id !== this.drawerId);
    if (guessers.length && guessers.every((s) => this.guessed.has(s.id))) {
      this._post({ kind: 'sys', text: '🎉 Tất cả đã đoán đúng!' });
      this._endTurn();
    }
  }

  _endTurn() {
    this.hintTimers.forEach(clearTimeout);
    this.hintTimers = [];
    if (this.word) this._post({ kind: 'sys', text: `Đáp án: ${this.word}` });
    this.phase = 'reveal';
    this._setTimer(REVEAL_MS, () => {
      if (this.phase === 'reveal') this._nextTurn();
    });
  }

  _finish() {
    clearTimeout(this.timer);
    this.hintTimers.forEach(clearTimeout);
    this.hintTimers = [];
    this.timer = null;
    this.deadline = 0;
    this.status = 'over';
    this.phase = null;
    const ranking = [...this.scores.values()].sort((a, b) => b.score - a.score).map((x) => ({ ...x }));
    const top = ranking[0]?.score || 0;
    const winners = ranking.filter((x) => x.score === top && top > 0).map((x) => x.id);
    for (const r of ranking) {
      const w = this.wins.get(r.id) || { id: r.id, name: r.name, games: 0, wins: 0 };
      w.name = r.name;
      w.games++;
      if (winners.includes(r.id)) w.wins++;
      this.wins.set(r.id, w);
    }
    this.last = { no: this.gameNo, ranking, winners };
    this.room.system(`🏆 Ván ${this.gameNo} kết thúc: ${ranking.map((r, i) => `${i + 1}. ${r.name} (${r.score})`).join(' · ') || 'không ai ghi điểm'}`);
  }

  view(viewerId) {
    const playing = this.status === 'playing';
    const isDrawer = viewerId === this.drawerId;
    const showWord = this.phase === 'reveal' || isDrawer || this.guessed.has(viewerId);
    return {
      options: this.options,
      seats: this.seats,
      ...this.ready.view(this.playerIds()),
      status: this.status,
      gameNo: this.gameNo,
      myId: this.seated(viewerId) ? viewerId : null,
      round: this.round,
      phase: playing ? this.phase : null,
      turnNo: this.turnNo,
      drawerId: playing ? this.drawerId : null,
      choices: playing && isDrawer && this.phase === 'choose' ? this.choices : null,
      word: playing && this.word && showWord ? this.word : null,
      mask: playing && this.word ? maskWord(this.word, this.revealed) : null,
      phaseLeft: playing && this.deadline ? Math.max(0, this.deadline - Date.now()) : 0,
      phaseTotal: this.phaseTotal,
      guessed: [...this.guessed.keys()],
      turnGains: this.phase === 'reveal'
        ? { drawer: this.drawerGain, guessers: Object.fromEntries(this.guessed) }
        : null,
      scores: [...this.scores.values()],
      order: this.order,
      feed: this.feed.filter((f) => !f.to || f.to === viewerId).map(({ to, ...f }) => f),
      last: this.last,
      wins: [...this.wins.values()].sort((x, y) => y.wins - x.wins || x.games - y.games),
    };
  }

  dispose() {
    clearTimeout(this.timer);
    this.hintTimers.forEach(clearTimeout);
  }
}
