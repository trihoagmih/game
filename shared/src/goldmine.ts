// Đào vàng — móc câu lắc qua lại, chạm để phóng móc, kéo vàng/đá/kim cương về đổi tiền. Mỗi màn có
// thời gian và mục tiêu tiền cộng dồn; không đạt mục tiêu là dừng. Mọi người cùng hạt giống nên cùng
// bản đồ. Góc móc lấy từ bảng sin/cos hằng số và mọi phép tính dùng số nguyên, vì Math.sin/cos không
// bắt buộc cho cùng kết quả trên mọi trình duyệt — server phát lại phải khớp từng điểm với client.

import { rng } from './onet.js';
import type { RaceEngine, RacePlayerView, RaceView } from './race.js';

export const MINE = { W: 640, H: 400, PIVOT_X: 320, PIVOT_Y: 72, GROUND: 100 } as const;
export const SUB = 16;
export const TICK_MS = 20;
export const LEVEL_TICKS = (60 * 1000) / TICK_MS;
export const BREAK_TICKS = (3 * 1000) / TICK_MS;
export const START_DYNAMITE = 2;
export const LEVEL_COUNT = { min: 1, max: 10, default: 5 } as const;

/** sin, cos ×1024 của 0°, 2°, … 70°. */
const SIN = [0, 36, 71, 107, 143, 178, 213, 248, 282, 316, 350, 384, 416, 449, 481, 512, 543, 573, 602, 630, 658, 685, 711, 737, 761, 784, 807, 828, 849, 868, 887, 904, 920, 935, 949, 962];
const COS = [1024, 1023, 1022, 1018, 1014, 1008, 1002, 994, 984, 974, 962, 949, 935, 920, 904, 887, 868, 849, 828, 807, 784, 761, 737, 711, 685, 658, 630, 602, 573, 543, 512, 481, 449, 416, 384, 350];
/** Góc chỉ số 0..70 ứng với -70°..70° (bước 2°). */
export const ANGLE_STEPS = 70;
/** Một chu kỳ lắc đủ (qua rồi về) tính bằng bước. */
const SWING_PERIOD = 4 * ANGLE_STEPS;
const ROPE_MIN = 22 * SUB;
const EXTEND = 7 * SUB;
const PULL = 9 * SUB;
const MIN_PULL = 1 * SUB;
const HOOK_R = 6;

export const ITEM_KINDS = {
  goldS: { r: 9, value: 50, weight: 2 },
  goldM: { r: 15, value: 150, weight: 7 },
  goldL: { r: 27, value: 500, weight: 26 },
  rockS: { r: 12, value: 15, weight: 10 },
  rockL: { r: 22, value: 35, weight: 28 },
  diamond: { r: 7, value: 600, weight: 1 },
  bag: { r: 12, value: 0, weight: 3 },
} as const;
export type ItemKind = keyof typeof ITEM_KINDS;

export interface MineItem {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  r: number;
  /** Tiền nhận được; túi bí ẩn có thể là thuốc nổ thay vì tiền. */
  value: number;
  dynamite: boolean;
}

export type HookState = 'swing' | 'out' | 'back';
export type MineCommand = 'shoot' | 'boom';
export const MINE_COMMANDS: readonly MineCommand[] = ['shoot', 'boom'];

export interface MineOptions { seed: number; levels: number }

/** Phần người xem cần để vẽ lại một mỏ (không gồm giá trị bên trong túi bí ẩn). */
export interface MineSnapshot {
  level: number;
  phase: 'play' | 'break';
  levelTick: number;
  money: number;
  goal: number;
  dynamite: number;
  hook: { state: HookState; angle: number; rope: number; grab: ItemKind | null };
  items: Pick<MineItem, 'id' | 'kind' | 'x' | 'y' | 'r'>[];
}
export interface MinePlayerView extends RacePlayerView { mine: MineSnapshot }
export type GoldmineView = RaceView<{ levels: number }, MinePlayerView>;

/** Mục tiêu tiền cộng dồn phải đạt khi hết màn `level`. */
export const goalFor = (level: number) => 500 * level + 150 * level * (level - 1);

/** Hướng móc ×1024 theo chỉ số góc 0..70 (-70°..70°): dx âm là bên trái. */
export function hookDir(angle: number) {
  const i = angle - ANGLE_STEPS / 2;
  const a = Math.abs(i);
  return { dx: i < 0 ? -SIN[a] : SIN[a], dy: COS[a] };
}

/** Số món mỗi loại theo màn: càng về sau càng nhiều đá to và kim cương. */
function levelMix(level: number): [ItemKind, number][] {
  return [
    ['goldL', 1 + (level >= 2 ? 1 : 0) + (level >= 5 ? 1 : 0)],
    ['goldM', 3],
    ['goldS', 5],
    ['diamond', Math.floor(level / 2)],
    ['bag', 2],
    ['rockL', 1 + Math.floor(level / 2)],
    ['rockS', 3],
  ];
}

/** Bản đồ một màn, chỉ phụ thuộc hạt giống ván và số màn. */
export function generateLevel(seed: number, level: number): MineItem[] {
  const rand = rng((seed + Math.imul(level, 0x9e3779b9)) >>> 0);
  const items: MineItem[] = [];
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  for (const [kind, count] of levelMix(level)) {
    const { r, value } = ITEM_KINDS[kind];
    for (let n = 0; n < count; n++) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const x = between(r + 8, MINE.W - r - 8);
        const y = between(MINE.GROUND + 40 + r, MINE.H - r - 6);
        if (items.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < (o.r + r + 6) ** 2)) continue;
        const surprise = kind === 'bag' && rand() < 0.2;
        const bagValue = kind === 'bag' && !surprise ? between(3, 70) * 10 : 0;
        items.push({ id: items.length, kind, x, y, r, value: kind === 'bag' ? bagValue : value, dynamite: surprise });
        break;
      }
    }
  }
  return items;
}

export class GoldmineGame implements RaceEngine<MineCommand> {
  declare seed: number;
  declare levels: number;
  declare tick: number;
  declare level: number;
  declare phase: 'play' | 'break';
  declare levelTick: number;
  declare breakLeft: number;
  declare money: number;
  declare dynamite: number;
  declare items: MineItem[];
  declare hook: HookState;
  declare swing: number;
  declare rope: number;
  declare grab: MineItem | null;
  declare failed: boolean;
  declare cleared: boolean;
  /** Sự kiện của bước vừa chạy, để client phát tiếng/hiệu ứng. */
  declare event: 'grab' | 'cash' | 'boom' | null;

  constructor({ seed, levels }: MineOptions) {
    this.seed = seed >>> 0;
    this.levels = Math.min(LEVEL_COUNT.max, Math.max(LEVEL_COUNT.min, Math.floor(levels) || LEVEL_COUNT.default));
    this.tick = 0;
    this.money = 0;
    this.dynamite = START_DYNAMITE;
    this.failed = false;
    this.cleared = false;
    this.event = null;
    this.level = 0;
    this.startLevel(1);
  }

  get over() { return this.failed || this.cleared; }
  get goal() { return goalFor(this.level); }
  get maxTicks() { return this.levels * LEVEL_TICKS + (this.levels - 1) * BREAK_TICKS; }

  /** Chỉ số góc hiện tại 0..70, lắc tam giác qua lại. */
  get angle() {
    const p = this.swing % SWING_PERIOD;
    const half = SWING_PERIOD / 2;
    return (p < half ? p : SWING_PERIOD - p) >> 1;
  }

  /** Đầu móc (px). */
  tip() {
    const { dx, dy } = hookDir(this.angle);
    return {
      x: MINE.PIVOT_X + Math.trunc((this.rope * dx) / (1024 * SUB)),
      y: MINE.PIVOT_Y + Math.trunc((this.rope * dy) / (1024 * SUB)),
    };
  }

  startLevel(level: number) {
    this.level = level;
    this.phase = 'play';
    this.levelTick = 0;
    this.breakLeft = 0;
    this.items = generateLevel(this.seed, level);
    this.hook = 'swing';
    this.swing = SWING_PERIOD / 4; // bắt đầu ở giữa, đang lắc sang phải
    this.rope = ROPE_MIN;
    this.grab = null;
  }

  command(command: MineCommand) {
    if (this.over || this.phase !== 'play') return false;
    if (command === 'shoot' && this.hook === 'swing') {
      this.hook = 'out';
      return true;
    }
    if (command === 'boom' && this.hook === 'back' && this.grab && this.dynamite > 0) {
      this.dynamite--;
      this.grab = null;
      this.event = 'boom';
      return true;
    }
    return false;
  }

  step() {
    if (this.over) return;
    this.event = null;
    this.tick++;
    if (this.phase === 'break') {
      if (--this.breakLeft <= 0) this.startLevel(this.level + 1);
      return;
    }
    this.moveHook();
    if (++this.levelTick < LEVEL_TICKS) return;
    if (this.money < this.goal) this.failed = true;
    else if (this.level >= this.levels) this.cleared = true;
    else {
      this.phase = 'break';
      this.breakLeft = BREAK_TICKS;
    }
  }

  moveHook() {
    if (this.hook === 'swing') {
      this.swing++;
      return;
    }
    if (this.hook === 'out') {
      this.rope += EXTEND;
      const { x, y } = this.tip();
      const hit = this.items.find((o) => (o.x - x) ** 2 + (o.y - y) ** 2 <= (o.r + HOOK_R) ** 2);
      if (hit) {
        this.items = this.items.filter((o) => o !== hit);
        this.grab = hit;
        this.hook = 'back';
        this.event = 'grab';
      } else if (x < 0 || x > MINE.W || y > MINE.H) {
        this.hook = 'back';
      }
      return;
    }
    const weight = this.grab ? ITEM_KINDS[this.grab.kind].weight : 0;
    this.rope -= Math.max(MIN_PULL, Math.floor((PULL * 10) / (10 + weight)));
    if (this.rope > ROPE_MIN) return;
    this.rope = ROPE_MIN;
    this.hook = 'swing';
    if (!this.grab) return;
    this.money += this.grab.value;
    if (this.grab.dynamite) this.dynamite++;
    this.grab = null;
    this.event = 'cash';
  }

  snapshot(): MineSnapshot {
    return {
      level: this.level,
      phase: this.phase,
      levelTick: this.levelTick,
      money: this.money,
      goal: this.goal,
      dynamite: this.dynamite,
      hook: { state: this.hook, angle: this.angle, rope: this.rope, grab: this.grab?.kind ?? null },
      items: this.items.map(({ id, kind, x, y, r }) => ({ id, kind, x, y, r })),
    };
  }
}
