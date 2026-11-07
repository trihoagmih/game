// Bay qua khe — chạm để nảy lên, luồn qua khe giữa các cột đá. Mọi người cùng hạt giống nên gặp
// cùng một dãy cột. Toàn bộ vật lý tính bằng số nguyên (đơn vị 1/16 px) để client và server phát lại
// ra đúng một kết quả trên mọi trình duyệt.

import { rng } from './onet.js';
import type { RaceEngine, RacePlayerView, RaceView } from './race.js';

/** Kích thước thế giới (px logic). */
export const SKY = { W: 288, H: 512, GROUND: 448, BIRD_X: 76, BIRD_R: 11, PILLAR_W: 52, SPACING: 172, FIRST_X: 420 } as const;
/** Số đơn vị con trong một px. */
export const SUB = 16;
export const TICK_MS = 20;
/** Trần thời lượng một ván (10 phút) để ván sinh tồn không kéo dài vô hạn. */
export const MAX_TICKS = (10 * 60 * 1000) / TICK_MS;
export const GRAVITY = 9;
export const FLAP_V = -128;
export const MAX_FALL = 170;
/** Khe kế tiếp lệch tối đa chừng này so với khe trước (px) để luôn bay kịp. */
const MAX_SHIFT = 150;
const EDGE = 48;

/** Độ khó: tốc độ cuộn (đơn vị con / bước) và chiều cao khe (px). */
export const DIFFICULTY = [
  { name: 'Dễ', speed: 36, gap: 150 },
  { name: 'Vừa', speed: 44, gap: 132 },
  { name: 'Khó', speed: 52, gap: 116 },
] as const;
/** Số khe cần qua để về đích; 0 = sinh tồn, ai trụ lâu nhất thắng. */
export const TARGET = { min: 0, max: 200, default: 30 } as const;

export type SkyCommand = 'flap';
export const SKY_COMMANDS: readonly SkyCommand[] = ['flap'];

export interface SkyOptions { seed: number; level: number; target: number }

export interface SkyPlayerView extends RacePlayerView { y: number; vy: number }
export type SkyhopView = RaceView<{ level: number; target: number }, SkyPlayerView>;

export const pillarX = (k: number) => SKY.FIRST_X + k * SKY.SPACING;

/** Khoảng cách bình phương từ tâm tròn tới hình chữ nhật có nhỏ hơn r² không. */
function circleHitsRect(cx: number, cy: number, r: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = Math.max(x0 - cx, 0, cx - x1);
  const dy = Math.max(y0 - cy, 0, cy - y1);
  return dx * dx + dy * dy < r * r;
}

export class SkyhopGame implements RaceEngine<SkyCommand> {
  declare level: number;
  declare target: number;
  declare rand: ReturnType<typeof rng>;
  declare gaps: number[];
  declare tick: number;
  declare y: number;
  declare vy: number;
  declare score: number;
  declare dead: boolean;
  declare finished: boolean;
  declare flapQueued: boolean;

  constructor({ seed, level, target }: SkyOptions) {
    this.level = Math.min(DIFFICULTY.length, Math.max(1, Math.floor(level) || 2));
    this.target = Math.min(TARGET.max, Math.max(0, Math.floor(target) || 0));
    this.rand = rng(seed);
    this.gaps = [];
    this.tick = 0;
    this.y = 220 * SUB;
    this.vy = FLAP_V; // nảy sẵn một cái lúc xuất phát để kịp phản ứng
    this.score = 0;
    this.dead = false;
    this.finished = false;
    this.flapQueued = false;
  }

  get over() { return this.dead || this.finished || this.tick >= MAX_TICKS; }
  get speed() { return DIFFICULTY[this.level - 1].speed; }
  get gap() { return DIFFICULTY[this.level - 1].gap; }
  /** Quãng đã cuộn (đơn vị con). */
  get scroll() { return this.tick * this.speed; }

  command(command: SkyCommand) {
    if (command !== 'flap' || this.over || this.flapQueued) return false;
    this.flapQueued = true;
    return true;
  }

  /** Tâm khe của cột thứ k (px), sinh lần lượt từ hạt giống nên không phụ thuộc lúc hỏi. */
  gapCenter(k: number) {
    const half = this.gap >> 1;
    const lo = half + EDGE;
    const hi = SKY.GROUND - half - EDGE;
    while (this.gaps.length <= k) {
      const prev = this.gaps.length ? this.gaps[this.gaps.length - 1] : (lo + hi) >> 1;
      const pick = lo + Math.floor(this.rand() * (hi - lo + 1));
      this.gaps.push(Math.max(prev - MAX_SHIFT, Math.min(prev + MAX_SHIFT, pick)));
    }
    return this.gaps[k];
  }

  /** Chim có chạm cột thứ k không (cột trên từ trần tới mép khe, cột dưới từ mép khe tới đất). */
  hitsPillar(k: number) {
    const x0 = pillarX(k) * SUB - this.scroll;
    const x1 = x0 + SKY.PILLAR_W * SUB;
    const c = this.gapCenter(k);
    const half = this.gap >> 1;
    const cx = SKY.BIRD_X * SUB;
    const r = SKY.BIRD_R * SUB;
    return circleHitsRect(cx, this.y, r, x0, 0, x1, (c - half) * SUB)
      || circleHitsRect(cx, this.y, r, x0, (c + half) * SUB, x1, SKY.GROUND * SUB);
  }

  step() {
    if (this.over) return;
    if (this.flapQueued) {
      this.vy = FLAP_V;
      this.flapQueued = false;
    }
    this.vy = Math.min(this.vy + GRAVITY, MAX_FALL);
    this.y += this.vy;
    const top = SKY.BIRD_R * SUB;
    if (this.y < top) {
      this.y = top;
      this.vy = Math.max(this.vy, 0);
    }
    this.tick++;
    // Cột trước `score` đã bị vượt hẳn nên chỉ cần xét hai cột kế tiếp
    if (this.y + SKY.BIRD_R * SUB >= SKY.GROUND * SUB || this.hitsPillar(this.score) || this.hitsPillar(this.score + 1)) {
      this.dead = true;
      return;
    }
    const birdLeft = this.scroll + (SKY.BIRD_X - SKY.BIRD_R) * SUB;
    while ((pillarX(this.score) + SKY.PILLAR_W) * SUB < birdLeft) this.score++;
    if (this.target && this.score >= this.target) this.finished = true;
  }
}
