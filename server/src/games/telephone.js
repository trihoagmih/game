// Tam sao thất bản (vẽ): viết câu → vẽ → đoán lại → vẽ… tất cả cùng làm một lúc, mỗi người một câu chuyện.
// Bức vẽ được gửi dần từng nét (gói tin lên server có giới hạn kích thước) và lưu làm bản nháp,
// hết giờ thì lấy luôn bản nháp. Cuối ván chủ phòng lật từng câu chuyện cho cả bàn xem.
import { randInt } from '@game/shared/cards';
import { cleanOps } from '@game/shared/scribble';
import { chainOf, stepKind, cleanText } from '@game/shared/telephone';
import { bool, clampInt } from './options.js';
import { ReadyGate } from './ready.js';
import { WORDS } from './scribble.js';

const GRACE_MS = 1500; // bù độ trễ mạng: bản nháp gửi sát giờ vẫn được tính
const MAX_POINTS = 30_000; // giới hạn bộ nhớ của một bức vẽ
const MIN_PLAYERS = 3;

export class TelephoneHandler {
  constructor(room, options) {
    this.room = room;
    this.options = {
      mode: options.mode === 'relay' ? 'relay' : 'classic',
      maxSeats: clampInt(options.maxSeats, MIN_PLAYERS, 12, 8),
      writeSeconds: clampInt(options.writeSeconds, 15, 120, 40),
      drawSeconds: clampInt(options.drawSeconds, 30, 240, 90),
      suggest: bool(options.suggest, true),
    };
    this.seats = []; // [{ id, name }]
    this.ready = new ReadyGate(room);
    this.status = 'waiting'; // waiting | playing | reveal | over
    this.gameNo = 0;
    this.turnNo = 0; // tăng mỗi bước — khung vẽ của client đổi bước theo số này
    this.players = []; // người chơi ván hiện tại [{ id, name, gone }]
    this.chains = [];
    this.step = 0;
    this.drafts = new Map(); // id -> { text, ops, points }
    this.done = new Set();
    this.drawings = new Map(); // drawId -> ops
    this.suggestions = new Map(); // id -> [từ gợi ý]
    this.reveal = { album: 0, shown: 0 };
    this.timer = null;
    this.deadline = 0;
    this.phaseTotal = 0;
  }

  get maxPlayers() { return this.options.maxSeats; }
  playerIds() { return this.seats.map((s) => s.id); }
  isPlaying() { return this.status === 'playing' || this.status === 'reveal'; }
  seated(id) { return this.seats.some((s) => s.id === id); }
  idx(id) { return this.players.findIndex((p) => p.id === id); }
  get relay() { return this.options.mode === 'relay'; }
  get kind() { return this.relay ? (this.step === this.players.length - 1 ? 'text' : 'draw') : stepKind(this.step); }
  chainIndex(i) { return this.relay ? 0 : chainOf(i, this.step, this.players.length); }
  previous(i) { return this.chains[this.chainIndex(i)]?.[this.relay ? this.step : this.step - 1] || null; }

  rename(id, name) {
    for (const s of this.seats) if (s.id === id) s.name = name;
    for (const p of this.players) if (p.id === id) p.name = name;
  }

  /** Ngồi được cả khi ván đang chơi — chờ ván sau. */
  sit(user) {
    if (this.seated(user.id)) throw new Error('Bạn đã ngồi rồi');
    if (this.seats.length >= this.options.maxSeats) throw new Error('Bàn đã đủ người');
    this.seats.push({ id: user.id, name: user.name });
  }

  stand(id) {
    if (!this.seated(id)) return;
    this.seats = this.seats.filter((s) => s.id !== id);
    this.ready.delete(id);
    const i = this.idx(id);
    if (this.status !== 'playing' || i < 0 || this.players[i].gone) return;
    // Rời giữa ván: phần còn lại của người đó để trống, câu chuyện vẫn đi tiếp
    this.players[i].gone = true;
    this.room.system(`${this.players[i].name} rời bàn — phần của họ sẽ để trống`);
    if (this.players.filter((p) => !p.gone).length < 2) {
      this.room.system('Còn dưới 2 người — kết thúc sớm, xem lại các câu chuyện');
      return this._toReveal();
    }
    this._checkAllDone();
  }

  onLeave(id) { this.stand(id); }

  action(id, a) {
    switch (a.type) {
      case 'start':
        if (this.isPlaying()) throw new Error('Ván đang diễn ra');
        this.ready.check(id, this.seats, MIN_PLAYERS);
        return this._start();
      case 'ready':
        if (!this.seated(id)) throw new Error('Bạn đang ở chế độ xem');
        if (this.isPlaying()) throw new Error('Ván đang diễn ra');
        return this.ready.toggle(id);
      case 'text': { // bản nháp / nộp câu chữ ở bước viết
        const i = this._requireTask(id);
        if (this.kind !== 'text') throw new Error('Bước này là bước vẽ');
        this.drafts.get(id).text = cleanText(a.text);
        return this._setDone(id, !!a.done);
      }
      case 'done': // nộp / sửa lại bức vẽ
        this._requireTask(id);
        return this._setDone(id, !!a.done);
      case 'next':
        return this._next(id);
      case 'stop':
        if (id !== this.room.ownerId) throw new Error('Chỉ chủ phòng mới được dừng ván');
        if (this.status !== 'playing') throw new Error('Không có ván đang chơi');
        this.room.system('Chủ phòng dừng ván — xem lại các câu chuyện');
        return this._toReveal();
      default:
        throw new Error('Hành động không hợp lệ');
    }
  }

  _requireTask(id) {
    if (this.status !== 'playing') throw new Error('Ván chưa bắt đầu');
    const i = this.idx(id);
    if (i < 0 || this.players[i].gone) throw new Error('Bạn không chơi ván này');
    if (this.relay && i !== this.step) throw new Error('Chưa tới lượt của bạn');
    return i;
  }

  _setDone(id, done) {
    if (done) {
      if (this.kind === 'text' && !this.drafts.get(id).text) throw new Error(this.step === 0 ? 'Hãy viết một câu' : 'Hãy viết bạn đoán tranh vẽ gì');
      this.done.add(id);
    } else this.done.delete(id);
    this._checkAllDone();
  }

  /** Nét vẽ của bước vẽ: lưu vào bản nháp của chính người vẽ, không chuyển cho ai. */
  stream(id, payload) {
    if (this.status !== 'playing' || this.kind !== 'draw' || Number(payload.turn) !== this.turnNo) return null;
    const i = this.idx(id);
    if (i < 0 || this.players[i].gone || this.done.has(id) || (this.relay && i !== this.step)) return null;
    const d = this.drafts.get(id);
    for (const o of cleanOps(payload.ops)) {
      if (o.k === 'c') { d.ops = []; d.points = 0; } else if (o.k === 'u') d.ops = d.ops.filter((x) => x.id !== o.id);
      else {
        const n = o.p.length / 2;
        if (d.points + n > MAX_POINTS) break;
        d.points += n;
        d.ops.push(o);
      }
    }
    return null;
  }

  query(viewerId, q) {
    if (q.type === 'canvas') {
      const d = this.status === 'playing' && this.drafts.get(viewerId);
      return { turn: this.turnNo, ops: d ? d.ops : [] };
    }
    if (q.type === 'drawing') {
      const id = String(q.id || '');
      if (!this.drawings.has(id) || !this._canSee(viewerId, id)) throw new Error('Không xem được bức vẽ này');
      return { id, ops: this.drawings.get(id) };
    }
    throw new Error('Truy vấn không hợp lệ');
  }

  /** Bức vẽ chỉ lộ khi: ván xong, đã được lật, hoặc là đề bài của mình ở bước này. */
  _canSee(viewerId, drawId) {
    if (this.status === 'over') return true;
    if (this.status === 'reveal') {
      const { album, shown } = this.reveal;
      return this.chains.some((ch, c) => ch.some((e, k) => e.drawId === drawId && (c < album || (c === album && k < shown))));
    }
    const i = this.idx(viewerId);
    return i >= 0 && !this.players[i].gone && (!this.relay || i === this.step) && this.previous(i)?.drawId === drawId;
  }

  // ---------- Diễn biến ván ----------

  _start() {
    this.players = this.seats.map((s) => ({ id: s.id, name: s.name, gone: false }));
    // Thứ tự ngẫu nhiên để không đoán được ai làm tiếp câu chuyện của mình
    for (let i = this.players.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [this.players[i], this.players[j]] = [this.players[j], this.players[i]];
    }
    this.chains = this.players.map(() => []);
    if (this.relay) this.chains = [[{ by: null, name: 'Từ khóa', kind: 'text', text: this._suggest()[0] }]];
    this.drawings = new Map();
    this.suggestions = new Map(this.players.map((p) => [p.id, this._suggest()]));
    this.step = 0;
    this.status = 'playing';
    this.ready.clear();
    this.gameNo++;
    this.room.system(`Ván ${this.gameNo} bắt đầu — ${this.players.length} người, ${this.players.length} bước. ${this.relay ? 'Lần lượt vẽ lại, người cuối đoán!' : 'Mỗi người viết một câu!'}`);
    this._beginStep();
  }

  _suggest() {
    const out = new Set();
    while (out.size < 3 && out.size < WORDS.length) out.add(WORDS[randInt(WORDS.length)]);
    return [...out];
  }

  _beginStep() {
    this.turnNo++;
    this.done = new Set(this.players.filter((p) => p.gone).map((p) => p.id));
    this.drafts = new Map(this.players.map((p) => [p.id, { text: '', ops: [], points: 0 }]));
    const ms = (this.kind === 'text' ? this.options.writeSeconds : this.options.drawSeconds) * 1000;
    this.phaseTotal = ms;
    this.deadline = Date.now() + ms;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.status !== 'playing') return;
      try { this._endStep(); } catch (e) { console.error('telephone timer', e); }
      this.room.changed();
    }, ms + GRACE_MS);
    if (this.relay && this.players[this.step].gone) this._endStep();
  }

  _checkAllDone() {
    if (this.status === 'playing' && (this.relay ? this.done.has(this.players[this.step].id) || this.players[this.step].gone : this.players.every((p) => this.done.has(p.id)))) this._endStep();
  }

  /** Hết bước: ghi phần của mọi người (chưa nộp thì lấy bản nháp, bỏ trống nếu không có) vào câu chuyện. */
  _endStep() {
    const n = this.players.length;
    this.players.forEach((p, i) => {
      if (this.relay && i !== this.step) return;
      const c = this.chainIndex(i);
      const d = this.drafts.get(p.id);
      const entry = { by: p.id, name: p.name, kind: this.kind };
      if (this.kind === 'text') entry.text = d.text;
      else {
        entry.drawId = `${this.gameNo}.${c}.${this.step}`;
        this.drawings.set(entry.drawId, d.ops);
      }
      this.chains[c].push(entry);
    });
    this.step++;
    if (this.step >= n) return this._toReveal();
    this._beginStep();
  }

  _toReveal() {
    clearTimeout(this.timer);
    this.deadline = 0;
    if (!this.chains.length || !this.chains[0].length) {
      this.status = 'over';
      return;
    }
    this.status = 'reveal';
    this.reveal = { album: 0, shown: 1 };
    this.room.system('📖 Cùng xem lại các câu chuyện! Chủ phòng bấm "Tiếp" để lật từng phần');
  }

  /** Chủ phòng lật phần tiếp theo; hết câu chuyện thì sang câu chuyện sau; hết thì kết thúc. */
  _next(id) {
    if (id !== this.room.ownerId) throw new Error('Chỉ chủ phòng mới được lật tiếp');
    if (this.status !== 'reveal') throw new Error('Chưa tới lúc xem lại');
    const r = this.reveal;
    if (r.shown < this.chains[r.album].length) r.shown++;
    else if (r.album < this.chains.length - 1) this.reveal = { album: r.album + 1, shown: 1 };
    else {
      this.status = 'over';
      this.room.system(`Ván ${this.gameNo} kết thúc — có thể xem lại mọi câu chuyện`);
    }
  }

  view(viewerId) {
    const playing = this.status === 'playing';
    const n = this.players.length;
    const i = this.idx(viewerId);
    let task = null;
    if (playing && i >= 0 && !this.players[i].gone && (!this.relay || i === this.step)) {
      const prev = this.previous(i);
      task = {
        kind: this.kind,
        // Đề bài từ người trước — không lộ tên để khỏi đoán theo người
        prev: prev && (prev.kind === 'text' ? { kind: 'text', text: prev.text } : { kind: 'draw', drawId: prev.drawId }),
        done: this.done.has(viewerId),
        text: this.drafts.get(viewerId)?.text || '',
        suggestions: !this.relay && this.step === 0 && this.options.suggest ? this.suggestions.get(viewerId) : null,
      };
    }
    let albums = null;
    if (this.status === 'reveal' || this.status === 'over') {
      const { album, shown } = this.reveal;
      albums = this.chains.map((ch, c) => ({
        owner: this.players[c]?.name,
        entries: this.status === 'over' ? ch : c < album ? ch : c === album ? ch.slice(0, shown) : [],
      }));
    }
    return {
      options: this.options,
      seats: this.seats,
      ...this.ready.view(this.playerIds()),
      minPlayers: MIN_PLAYERS,
      status: this.status,
      gameNo: this.gameNo,
      myId: this.seated(viewerId) ? viewerId : null,
      players: this.players.map((p) => ({ id: p.id, name: p.name, gone: p.gone, done: playing && this.done.has(p.id) })),
      step: this.step,
      activeId: playing && this.relay ? this.players[this.step].id : null,
      steps: n,
      kind: playing ? this.kind : null,
      turnNo: this.turnNo,
      phaseLeft: playing ? Math.max(0, this.deadline - Date.now()) : 0,
      phaseTotal: this.phaseTotal,
      task,
      albums,
      reveal: this.status === 'reveal' ? this.reveal : null,
    };
  }

  dispose() { clearTimeout(this.timer); }
}
