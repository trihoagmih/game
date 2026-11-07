// Rắn săn mồi — lõi trò chơi, chạy giống hệt ở client và server.
// Phong cách điện thoại đen trắng đời đầu: bàn 24×14 ô, 9 cấp tốc độ, mỗi mồi ăn được điểm = cấp,
// cứ 5 mồi lại hiện một "con thưởng" (chiếm 2 ô) chỉ ở lại một lúc, ăn càng sớm càng nhiều điểm.
//
// Trò tất định theo (seed, mê cung, cấp) và danh sách lượt rẽ [tick, hướng]: client chơi thật,
// server phát lại đúng các lượt rẽ đó để tự tính điểm — không tin điểm client gửi lên.

export const W = 24;
export const H = 14;
/** Thời gian một bước (ms) theo cấp 1..9. */
export const SPEEDS = [300, 250, 210, 175, 145, 120, 100, 85, 70];
export const START_LEN = 1;
export const BONUS_EVERY = 5;
export const BONUS_TICKS = 40;
export const BONUS_KINDS = 4; // số hình con thưởng (client vẽ)

export const MAZES = ['none', 'box', 'tunnel', 'rooms', 'rails'];

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;
export type Direction = keyof typeof DIRS;
export interface SnakeOptions { seed: number; maze?: string; level?: number }
export type SnakeInput = [tick: number, direction: Direction];
export interface SnakeBonus { cells: number[]; kind: number; ttl: number }
export interface SnakePlayerView {
  id: string; name: string; score: number; length: number; eaten: number; tick: number;
  accepted: number; done: boolean; dead: boolean; gaveUp: boolean; timedOut: boolean;
  endedAt: number | null; seq: number; snake: number[]; dir: Direction; food: number; bonus: SnakeBonus | null;
}
export interface SnakeScore { id: string; name: string; games: number; wins: number; best: number; longest: number }
export interface SnakeView {
  options: {maxSeats: number; level: number; maze: string; minutes: number};
  seats: {id: string; name: string}[]; ready: string[]; waitingFor: string[];
  status: string; gameNo: number; myId: string | null; seed: number; tickMs: number;
  startIn: number; timeLeft: number; timeTotal: number; solo: boolean; players: SnakePlayerView[];
  result: {winner: string | null; ranking: string[]; endedAt: number} | null; wins: SnakeScore[];
}
const OPP: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

// PRNG dùng chung với Nối thú (mulberry32, có state()) để bản lưu phục hồi của server khôi phục được
import { rng } from './onet.js';

export { rng };

/** Các ô tường của từng mê cung (chỉ số = y*W + x). */
export function mazeWalls(maze: string) {
  const set = new Set<number>();
  const add = (x: number, y: number) => set.add(y * W + x);
  const border = () => {
    for (let x = 0; x < W; x++) { add(x, 0); add(x, H - 1); }
    for (let y = 0; y < H; y++) { add(0, y); add(W - 1, y); }
  };
  switch (maze) {
    case 'box':
      border();
      break;
    case 'tunnel': // hai thanh ngang, không viền (đi xuyên mép)
      for (let x = 5; x < W - 5; x++) { add(x, 4); add(x, H - 5); }
      break;
    case 'rooms': // viền + chữ thập có cửa ở giữa
      border();
      for (let y = 0; y < H; y++) if (y < 5 || y > 8) add(11, y);
      for (let x = 0; x < W; x++) if (x < 8 || x > 15) add(x, 6);
      break;
    case 'rails': // viền có cửa ở giữa mỗi cạnh + hai thanh dọc
      for (let x = 0; x < W; x++) if (x < 9 || x > 14) { add(x, 0); add(x, H - 1); }
      for (let y = 0; y < H; y++) if (y < 5 || y > 8) { add(0, y); add(W - 1, y); }
      for (let y = 3; y < H - 3; y++) { add(6, y); add(W - 7, y); }
      break;
    default:
      break;
  }
  return set;
}

export class SnakeGame {
  declare maze: string;
  declare level: number;
  declare rand: ReturnType<typeof rng>;
  declare walls: Set<number>;
  declare snake: number[];
  declare dir: Direction;
  declare queue: Direction[];
  declare tick: number;
  declare score: number;
  declare eaten: number;
  declare alive: boolean;
  declare bonus: SnakeBonus | null;
  declare bonusSeq: number;
  declare food: number;
  /**
   * @param {{seed:number, maze?:string, level?:number}} o
   */
  constructor({ seed, maze = 'none', level = 5 }: SnakeOptions) {
    this.maze = MAZES.includes(maze) ? maze : 'none';
    this.level = Math.min(9, Math.max(1, Math.floor(level) || 5));
    this.rand = rng(seed);
    this.walls = mazeWalls(this.maze);
    const y = this.maze === 'rooms' ? 8 : H - 3; // hàng xuất phát luôn thông ít nhất tới giữa bàn
    // Đầu ở phía phải, thân kéo về trái, đang đi sang phải
    this.snake = Array.from({ length: START_LEN }, (_, i) => y * W + (START_LEN + 1 - i));
    this.dir = 'right';
    this.queue = []; // các lượt rẽ chờ (tối đa 2) — bấm nhanh hai phím trong một bước vẫn ăn
    this.tick = 0;
    this.score = 0;
    this.eaten = 0;
    this.alive = true;
    this.bonus = null; // { cells:[i,j], kind, ttl }
    this.bonusSeq = 0;
    this.food = -1;
    this.food = this._free(1);
  }

  get length() { return this.snake.length; }
  get head() { return this.snake[0]; }

  /** Đổi hướng (bỏ qua nếu quay đầu 180° hoặc trùng hướng). Trả về true nếu được nhận. */
  turn(dir: string) {
    if (!Object.hasOwn(DIRS, dir) || !this.alive) return false;
    const direction = dir as Direction;
    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
    if (direction === last || direction === OPP[last] || this.queue.length >= 2) return false;
    this.queue.push(direction);
    return true;
  }

  _occupied(i: number) {
    return this.walls.has(i) || this.snake.includes(i) || i === this.food || (this.bonus && this.bonus.cells.includes(i));
  }

  /** Chọn ngẫu nhiên một chỗ trống: n=1 một ô, n=2 hai ô liền nhau theo hàng ngang. */
  _free(n: number) {
    const spots = [];
    for (let i = 0; i < W * H; i++) {
      if (n === 2 && i % W === W - 1) continue;
      if (!this._occupied(i) && (n === 1 || !this._occupied(i + 1))) spots.push(i);
    }
    if (!spots.length) return -1;
    return spots[Math.floor(this.rand() * spots.length)];
  }

  /** Ô kế tiếp theo hướng (đi xuyên mép sang phía đối diện). */
  next(i: number, dir: Direction) {
    const [dx, dy] = DIRS[dir];
    const x = (i % W + dx + W) % W;
    const y = (Math.floor(i / W) + dy + H) % H;
    return y * W + x;
  }

  /** Một bước. Trả về sự kiện của bước: 'eat' | 'bonus' | 'die' | null. */
  step() {
    if (!this.alive) return 'die';
    if (this.queue.length) this.dir = this.queue.shift()!;
    this.tick++;
    const nh = this.next(this.head, this.dir);
    const eating = nh === this.food;
    // Đuôi sẽ dời đi trong bước này (trừ khi vừa ăn) nên đầu được đi vào ô đuôi cũ
    const body = eating ? this.snake : this.snake.slice(0, -1);
    if (this.walls.has(nh) || body.includes(nh)) {
      this.alive = false;
      return 'die';
    }
    this.snake.unshift(nh);
    let ev: 'eat' | 'bonus' | null = null;
    if (eating) {
      this.score += this.level;
      this.eaten++;
      ev = 'eat';
      this.food = -1;
      this.food = this._free(1);
      if (this.eaten % BONUS_EVERY === 0 && !this.bonus) {
        const at = this._free(2);
        if (at >= 0) this.bonus = { cells: [at, at + 1], kind: this.bonusSeq++ % BONUS_KINDS, ttl: BONUS_TICKS };
      }
    } else {
      this.snake.pop();
    }
    if (this.bonus) {
      if (this.bonus.cells.includes(nh)) {
        this.score += this.bonusPoints();
        this.bonus = null;
        ev = 'bonus';
      } else if (--this.bonus.ttl <= 0) {
        this.bonus = null;
      }
    }
    if (this.food < 0 && !this.bonus) {
      // Bàn đầy — coi như phá đảo
      this.alive = false;
      return 'die';
    }
    return ev;
  }

  /** Điểm con thưởng nếu ăn ngay bây giờ (giảm dần theo thời gian còn lại). */
  bonusPoints() {
    return this.bonus ? 5 * this.level + Math.ceil(this.bonus.ttl / 2) : 0;
  }

  /** Ảnh chụp gọn để gửi cho người xem. */
  snapshot() {
    return {
      snake: this.snake.slice(),
      dir: this.dir,
      food: this.food,
      bonus: this.bonus ? { cells: this.bonus.cells, kind: this.bonus.kind, ttl: this.bonus.ttl } : null,
    };
  }
}

/**
 * Phát lại: chạy game tới bước `toTick`, áp các lượt rẽ [tick, dir] (tick = số bước đã đi khi bấm).
 * Dừng sớm nếu rắn chết.
 */
export function replay(opts: SnakeOptions, inputs: readonly SnakeInput[], toTick: number, game = new SnakeGame(opts), from = 0) {
  let k = from;
  while (game.alive && game.tick < toTick) {
    while (k < inputs.length && inputs[k][0] <= game.tick) game.turn(inputs[k++][1]);
    game.step();
  }
  return { game, used: k };
}
