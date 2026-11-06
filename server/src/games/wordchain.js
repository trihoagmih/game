import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WordChainGame, makeSyllableChecker, makeDictionary, FIRST_MIN_NEXT } from '@game/shared/wordchain';
import { buildWordIndex, chooseWord } from '@game/shared/wordchainBot';
import { bool, clampInt } from './options.js';
import { ReadyGate } from './ready.js';
import { BOT_LEVEL_NAMES, botLevel, isBot, newBotId, requireBotManager, thinkMs } from './bots.js';

// Từ điển (xem server/src/data/README.md): âm tiết tiếng Việt và từ ghép 2 chữ (~62.000 từ, gộp từ 3 nguồn)
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data');
const readLines = (file) => fs.readFileSync(path.join(DATA_DIR, file), 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
export const isValidSyllable = makeSyllableChecker(readLines('vi-syllables.txt'));
const WORD_LISTS = ['vi-words.txt', 'vi-words-noitu.txt', 'vi-words-common.txt'].flatMap(readLines);
// Chỉ giữ các mục có cả 2 chữ là âm tiết tiếng Việt (bỏ "acid amin", "ad hoc"… không bao giờ nối được)
export const dictionary = makeDictionary(WORD_LISTS, isValidSyllable);
export const isKnownWord = dictionary.has;
// Máy chỉ dùng từ có trong từ điển và mọi chữ đều là âm tiết hợp lệ → luôn qua được kiểm tra
const botIndex = buildWordIndex(WORD_LISTS.filter((t) => t.trim().split(/\s+/).every(isValidSyllable)));
const MAX_BOTS = 3;

const HISTORY_MAX = 10;

export class WordChainHandler {
  constructor(room, options) {
    this.room = room;
    this.options = {
      maxSeats: clampInt(options.maxSeats, 2, 8, 6),
      turnSeconds: clampInt(options.turnSeconds, 10, 60, 20),
      lives: clampInt(options.lives, 1, 3, 1),
      dictionary: bool(options.dictionary, true),
      strict: bool(options.strict, true), // từ phải có trong từ điển từ ghép
    };
    this.seats = []; // [{ id, name }] theo thứ tự lượt
    this.ready = new ReadyGate(room);
    this.status = 'waiting'; // waiting | playing | over
    this.game = null;
    this.timer = null;
    this.deadline = 0;
    this.gameNo = 0;
    this.wins = new Map(); // id -> { id, name, games, wins }
    this.history = []; // các ván đã xong (mới nhất trước), tối đa HISTORY_MAX
    this.botTimer = null;
    // Tạo bàn kèm máy
    const level = botLevel(options.bot);
    const n = level ? clampInt(options.bots, 1, Math.min(MAX_BOTS, this.options.maxSeats - 1), 1) : 0;
    for (let k = 0; k < n; k++) this._addBot(room.ownerId, { level }, true);
  }

  botName(id) { return isBot(id) ? this.seats.find((s) => s.id === id)?.name : undefined; }
  get humans() { return this.seats.filter((s) => !s.bot); }

  get maxPlayers() { return this.options.maxSeats; }
  playerIds() { return this.seats.map((s) => s.id); }
  isPlaying() { return this.status === 'playing'; }
  seated(id) { return this.seats.some((s) => s.id === id); }

  rename(id, name) {
    for (const s of this.seats) if (s.id === id) s.name = name;
    const w = this.wins.get(id);
    if (w) w.name = name;
    const p = this.game?.players.find((x) => x.id === id);
    if (p) p.name = name;
  }

  sit(user) {
    if (this.seated(user.id)) throw new Error('Bạn đã ngồi rồi');
    if (this.status !== 'playing' && this.seats.length >= this.options.maxSeats && this.seats.some((s) => s.bot)) {
      // Bàn đầy vì có máy: nhường ghế của một máy cho người thật
      const bot = this.seats.findLast((s) => s.bot);
      this.seats = this.seats.filter((s) => s !== bot);
      this.room.system(`${bot.name} nhường ghế cho ${user.name}`);
    }
    if (this.status === 'playing') throw new Error('Ván đang diễn ra, đợi ván sau nhé');
    if (this.seats.length >= this.options.maxSeats) throw new Error('Bàn đã đủ người');
    this.seats.push({ id: user.id, name: user.name });
  }

  stand(id) {
    if (!this.seated(id)) return;
    if (this.status === 'playing' && this.game.players.some((p) => p.id === id && !p.out)) {
      const name = this.game.players.find((p) => p.id === id).name;
      const wasTurn = this.game.current.id === id;
      this.game.eliminate(id);
      this.room.system(`${name} rời bàn — bị loại`);
      this._afterTurn(wasTurn);
      this._botTick();
    }
    this.seats = this.seats.filter((s) => s.id !== id);
    this.ready.delete(id);
  }

  onLeave(id) { this.stand(id); }

  action(id, a) {
    try {
      return this._action(id, a);
    } finally {
      this._botTick();
    }
  }

  _action(id, a) {
    if (a.type === 'addBot') return this._addBot(id, a);
    if (a.type === 'removeBot') return this._removeBot(id, a.id);
    if (a.type === 'start') {
      if (this.status === 'playing') throw new Error('Ván đang diễn ra');
      if (!this.humans.length) throw new Error('Cần ít nhất một người chơi thật');
      this.ready.check(id, this.seats); // máy luôn được coi là đã sẵn sàng
      return this._start();
    }
    if (!this.seated(id)) throw new Error('Bạn đang ở chế độ xem');
    switch (a.type) {
      case 'ready': {
        if (this.status === 'playing') throw new Error('Ván đang diễn ra');
        this.ready.toggle(id);
        return;
      }
      case 'word': {
        this._requirePlaying();
        const w = this.game.submit(id, String(a.text || '').slice(0, 40));
        if (this.game.result?.reason === 'deadEnd') {
          this.room.system(`🎯 Không còn từ nào bắt đầu bằng "${w.syllables[1]}" — ${this.game.players.find((p) => p.id === id).name} thắng luôn!`);
        }
        this._afterTurn(true);
        return;
      }
      case 'object': {
        this._requirePlaying();
        const last = this.game.last;
        const revoked = this.game.object(id);
        const who = this.seats.find((s) => s.id === id)?.name || '?';
        if (revoked) {
          this.room.system(`❌ Từ "${last.text}" của ${last.name} bị phản đối — ${last.name} nối lại`);
          this._afterTurn(true);
        } else if (this.game.objections.has(id)) {
          this.room.system(`${who} phản đối từ "${last.text}" (${this.game.objections.size}/${this.game.objectionsNeeded()})`);
        }
        return;
      }
      case 'giveup': {
        this._requirePlaying();
        const p = this.game.players.find((x) => x.id === id);
        if (!p || p.out) throw new Error('Bạn đã bị loại');
        const wasTurn = this.game.current.id === id;
        this.game.eliminate(id);
        this.room.system(`${p.name} chịu thua`);
        this._afterTurn(wasTurn);
        return;
      }
      default:
        throw new Error('Hành động không hợp lệ');
    }
  }

  // ---------- Máy ----------

  _addBot(id, a, silent = false) {
    requireBotManager(this, id);
    if (this.status === 'playing') throw new Error('Ván đang diễn ra, đợi ván sau nhé');
    if (this.seats.length >= this.options.maxSeats) throw new Error('Bàn đã đủ người');
    if (this.seats.filter((s) => s.bot).length >= MAX_BOTS) throw new Error(`Tối đa ${MAX_BOTS} máy mỗi bàn`);
    const level = botLevel(a.level, 'medium');
    let k = 1;
    while (this.seats.some((s) => s.name.startsWith(`🤖 Máy ${k} `))) k++;
    const seat = { id: newBotId(), name: `🤖 Máy ${k} (${BOT_LEVEL_NAMES[level]})`, bot: level };
    this.seats.push(seat);
    if (!silent) this.room.system(`Đã thêm ${seat.name} vào bàn`);
  }

  _removeBot(id, botId) {
    requireBotManager(this, id);
    if (this.status === 'playing') throw new Error('Ván đang diễn ra');
    const seat = this.seats.find((s) => s.bot && s.id === botId);
    if (!seat) throw new Error('Không tìm thấy máy');
    this.seats = this.seats.filter((s) => s !== seat);
    this.wins.delete(seat.id);
    this.room.system(`Đã bỏ ${seat.name} khỏi bàn`);
  }

  /** Tới lượt máy thì hẹn giờ cho máy nối từ (hoặc "bí" để hết giờ). */
  _botTick() {
    clearTimeout(this.botTimer);
    this.botTimer = null;
    if (this.status !== 'playing') return;
    const p = this.game.current;
    if (!p.bot) return;
    const turnMs = this.options.turnSeconds * 1000;
    // Máy nghĩ 1,5–5 giây, luôn trả lời trước khi hết giờ
    const delay = Math.min(turnMs - 1500, thinkMs(1500, p.bot === 'hard' ? 3500 : 5000));
    const chain = this.game.chain.length;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.status !== 'playing' || this.game.current.id !== p.id || this.game.chain.length !== chain) return;
      // Chỉ còn máy với nhau thì dễ bí hơn để ván sớm kết thúc
      const onlyBots = this.game.active.every((x) => x.bot);
      const word = chooseWord(this.game, p.bot, botIndex, onlyBots ? { miss: 0.25 } : undefined);
      if (!word) return; // bí: để đồng hồ chạy hết giờ
      try {
        const w = this.game.submit(p.id, word);
        if (this.game.result?.reason === 'deadEnd') {
          this.room.system(`🎯 Không còn từ nào bắt đầu bằng "${w.syllables[1]}" — ${p.name} thắng luôn!`);
        }
        this._afterTurn(true);
      } catch (e) {
        console.error('[bot]', e.message);
        return;
      }
      this._botTick();
      this.room.changed();
    }, Math.max(500, delay));
  }

  _requirePlaying() {
    if (this.status !== 'playing') throw new Error('Ván chưa bắt đầu');
  }

  _start() {
    // Mỗi ván chọn ngẫu nhiên người ra từ đầu tiên
    this.game = new WordChainGame(this.seats, {
      first: Math.floor(Math.random() * this.seats.length),
      lives: this.options.lives,
      isValidSyllable: this.options.dictionary ? isValidSyllable : null,
      isKnownWord,
      strict: this.options.dictionary && this.options.strict,
      // Có từ điển: từ mở đầu không được quá khó, nối từ cụt (không còn từ nối tiếp) thì thắng luôn
      countNext: this.options.dictionary ? dictionary.countNext : null,
    });
    this.status = 'playing';
    this.ready.clear();
    this.gameNo++;
    this.room.system(`Ván ${this.gameNo} bắt đầu: ${this.seats.map((s) => s.name).join(' → ')}. ${this.game.current.name} ra từ đầu tiên!`);
    this._resetTimer();
  }

  /** Sau mỗi thay đổi lượt: kiểm tra kết thúc, đặt lại đồng hồ nếu cần. */
  _afterTurn(resetTimer) {
    if (this.game.result) return this._finish();
    if (resetTimer) this._resetTimer();
  }

  _resetTimer() {
    clearTimeout(this.timer);
    const ms = this.options.turnSeconds * 1000;
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => this._onTimeout(), ms);
  }

  _onTimeout() {
    if (this.status !== 'playing') return;
    const p = this.game.current;
    this.game.timeout();
    this.room.system(`⏰ ${p.name} hết giờ${p.out ? ' — bị loại' : ` — còn ${p.lives} mạng`}`);
    this._afterTurn(true);
    this._botTick();
    this.room.changed();
  }

  _finish() {
    clearTimeout(this.timer);
    this.deadline = 0;
    this.status = 'over';
    const { winner, ranking } = this.game.result;
    for (const p of this.game.players) {
      const w = this.wins.get(p.id) || { id: p.id, name: p.name, games: 0, wins: 0 };
      w.name = p.name;
      w.games++;
      if (p.id === winner) w.wins++;
      this.wins.set(p.id, w);
    }
    const name = (id) => this.game.players.find((p) => p.id === id)?.name;
    // Lưu lại cả chuỗi từ của ván để xem lại theo từng ván
    this.history.unshift({
      no: this.gameNo,
      endedAt: Date.now(),
      players: this.game.players.map(({ id, name: n }) => ({ id, name: n })),
      winner,
      ranking,
      words: this.game.chain.map(({ syllables, by, known }) => ({ s: syllables, by, known })),
    });
    if (this.history.length > HISTORY_MAX) this.history.pop();
    this.room.system(`🏆 ${winner ? `${name(winner)} thắng` : 'Không ai thắng'} sau ${this.game.chain.length} từ. Xếp hạng: ${ranking.map(name).join(', ')}`);
  }

  view(viewerId) {
    const g = this.game;
    return {
      options: this.options,
      seats: this.seats,
      ...this.ready.view(this.seats.map((x) => x.id)),
      firstMinNext: this.options.dictionary ? FIRST_MIN_NEXT : 0,
      status: this.status,
      gameNo: this.gameNo,
      myId: this.seated(viewerId) ? viewerId : null,
      turnLeft: this.status === 'playing' ? Math.max(0, this.deadline - Date.now()) : 0,
      turnTotal: this.options.turnSeconds * 1000,
      game: g && {
        players: g.players.map(({ id, name, bot, lives, out, words }) => ({ id, name, bot, lives, out, words })),
        currentId: this.status === 'playing' ? g.current.id : null,
        required: g.required,
        chain: g.chain.slice(-80).map(({ text, syllables, by, name, ts, known }) => ({ text, syllables, by, name, ts, known })),
        total: g.chain.length,
        objections: [...g.objections],
        objectionsNeeded: g.last ? g.objectionsNeeded() : 0,
        result: g.result,
      },
      wins: [...this.wins.values()].sort((x, y) => y.wins - x.wins || x.games - y.games),
      history: this.history,
    };
  }

  dispose() { clearTimeout(this.timer); clearTimeout(this.botTimer); }
}
