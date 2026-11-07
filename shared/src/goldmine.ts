// Đào vàng — cơ chế theo kiểu game đào vàng cổ điển: móc lắc như con lắc, chạm để phóng, kéo vàng/đá/
// kim cương về đổi tiền; chuột chạy qua lại (có con ôm kim cương), thùng TNT nổ phá mọi thứ quanh nó,
// túi bí ẩn. Mỗi màn 60 giây với mục tiêu tiền cộng dồn; qua màn thì ghé cửa hàng mua thuốc nổ, nước
// tăng lực, cỏ may mắn, sách đá, nước đánh bóng kim cương. Mọi người cùng hạt giống nên cùng bản đồ.
// Góc móc lấy từ bảng hằng số và mọi phép tính dùng số nguyên, vì Math.sin/cos không bắt buộc cho cùng
// kết quả trên mọi trình duyệt — server phát lại phải khớp từng điểm với client.

import { rng } from './onet.js';
import type { RaceEngine, RacePlayerView, RaceView } from './race.js';

export const MINE = { W: 640, H: 400, PIVOT_X: 320, PIVOT_Y: 72, GROUND: 100 } as const;
export const SUB = 16;
export const TICK_MS = 20;
export const LEVEL_TICKS = (60 * 1000) / TICK_MS;
/** Thời gian tối đa ở cửa hàng; bấm "Màn tiếp" để đi sớm. */
export const SHOP_TICKS = (20 * 1000) / TICK_MS;
export const START_DYNAMITE = 1;
export const LEVEL_COUNT = { min: 1, max: 10, default: 5 } as const;

/** sin, cos ×1024 của 0°, 2°, … 70°. */
const SIN = [0, 36, 71, 107, 143, 178, 213, 248, 282, 316, 350, 384, 416, 449, 481, 512, 543, 573, 602, 630, 658, 685, 711, 737, 761, 784, 807, 828, 849, 868, 887, 904, 920, 935, 949, 962];
const COS = [1024, 1023, 1022, 1018, 1014, 1008, 1002, 994, 984, 974, 962, 949, 935, 920, 904, 887, 868, 849, 828, 807, 784, 761, 737, 711, 685, 658, 630, 602, 573, 543, 512, 481, 449, 416, 384, 350];
/** Một phần tư chu kỳ con lắc: độ lệch khỏi giữa (đơn vị 2°) theo bước, chậm dần ở hai đầu. */
const SWING = [0, 1, 2, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 22, 23, 24, 25, 26, 27, 28, 28, 29, 30, 30, 31, 31, 32, 32, 33, 33, 34, 34, 34, 34, 35, 35, 35, 35, 35];
const QUARTER = SWING.length - 1;
/** Góc chỉ số 0..70 ứng với -70°..70° (bước 2°); 35 là thẳng xuống. */
export const ANGLE_STEPS = 70;
const ROPE_MIN = 22 * SUB;
const EXTEND = 5 * SUB + (3 * SUB) / 4;
const PULL = 7 * SUB;
const MIN_PULL = SUB;
const HOOK_R = 6;
const BLAST_R = 72;

export const ITEM_KINDS = {
  goldXS: { r: 7, value: 50, weight: 1 },
  goldS: { r: 11, value: 100, weight: 3 },
  goldM: { r: 17, value: 250, weight: 8 },
  goldL: { r: 28, value: 500, weight: 48 },
  rockS: { r: 12, value: 11, weight: 24 },
  rockL: { r: 22, value: 20, weight: 52 },
  diamond: { r: 7, value: 600, weight: 1 },
  bag: { r: 12, value: 0, weight: 3 },
  mouse: { r: 9, value: 2, weight: 2 },
  mouseGem: { r: 10, value: 602, weight: 2 },
  tnt: { r: 13, value: 0, weight: 1 },
} as const;
export type ItemKind = keyof typeof ITEM_KINDS;

/** Hàng ở cửa hàng; hiệu lực cho màn kế tiếp (trừ thuốc nổ cộng ngay). */
export const GOODS = {
  dynamite: { name: 'Thuốc nổ', note: 'Ném vào món đang kéo để phá, móc về nhanh', price: [20, 300] },
  strength: { name: 'Nước tăng lực', note: 'Kéo nhanh hơn trong màn sau', price: [100, 400] },
  clover: { name: 'Cỏ may mắn', note: 'Túi bí ẩn có nhiều tiền hơn trong màn sau', price: [20, 220] },
  rockBook: { name: 'Sách sưu tầm đá', note: 'Đá đáng giá gấp 3 trong màn sau', price: [10, 150] },
  polish: { name: 'Nước đánh bóng', note: 'Kim cương đáng giá hơn trong màn sau', price: [300, 700] },
} as const;
export type Good = keyof typeof GOODS;
const GOOD_ORDER = Object.keys(GOODS) as Good[];

export interface MineItem {
  id: number;
  kind: ItemKind;
  x: number;
  y: number;
  r: number;
  /** Chuột: chạy qua lại trong [x0, x1] với pha ban đầu `phase`. */
  run: { x0: number; x1: number; phase: number } | null;
  /** Túi bí ẩn: số ngẫu nhiên 0..999 đã gieo sẵn, giải nghĩa lúc kéo về (cỏ may mắn đổi kết quả). */
  roll: number;
}

export interface Offer { good: Good; price: number; bought: boolean }
export interface Boosts { strength: boolean; clover: boolean; rockBook: boolean; polish: boolean }

export type HookState = 'swing' | 'out' | 'back';
export type MineCommand = 'shoot' | 'boom' | 'buy0' | 'buy1' | 'buy2' | 'buy3' | 'buy4' | 'leave';
export const MINE_COMMANDS: readonly MineCommand[] = ['shoot', 'boom', 'buy0', 'buy1', 'buy2', 'buy3', 'buy4', 'leave'];
/** Lệnh mua món ở ô `slot` của cửa hàng (null nếu ô không tồn tại). */
export const buyCommand = (slot: number) => MINE_COMMANDS.find((c) => c === `buy${slot}`) ?? null;

export interface MineOptions { seed: number; levels: number }

/** Phần người xem cần để vẽ lại một mỏ (không gồm kết quả bên trong túi bí ẩn). */
export interface MineSnapshot {
  level: number;
  phase: 'play' | 'shop';
  levelTick: number;
  shopLeft: number;
  money: number;
  goal: number;
  dynamite: number;
  boosts: Boosts;
  hook: { state: HookState; angle: number; rope: number; grab: ItemKind | null };
  items: { id: number; kind: ItemKind; x: number; y: number; r: number; dir: -1 | 0 | 1 }[];
  offers: Offer[];
  /** Lần cộng tiền gần nhất (để hiện "+500$"). */
  cash: { amount: number; at: number } | null;
  /** Vụ nổ gần nhất (TNT hoặc thuốc nổ). */
  blast: { x: number; y: number; at: number } | null;
}
export interface MinePlayerView extends RacePlayerView { mine: MineSnapshot }
export type GoldmineView = RaceView<{ levels: number }, MinePlayerView>;

/** Mục tiêu tiền cộng dồn của màn `level`: 650, 1195, 2010, 3095, 4450… (mỗi màn tăng thêm 270 so với lần trước). */
export const goalFor = (level: number) => (level <= 0 ? 0 : 650 + 545 * (level - 1) + 135 * (level - 1) * (level - 2));

/** Hướng móc ×1024 theo chỉ số góc 0..70: dx âm là bên trái. */
export function hookDir(angle: number) {
  const i = angle - ANGLE_STEPS / 2;
  const a = Math.abs(i);
  return { dx: i < 0 ? -SIN[a] : SIN[a], dy: COS[a] };
}

/** Góc con lắc ở bước lắc thứ `swing` (chu kỳ 4 × QUARTER bước). */
export function swingAngle(swing: number) {
  const p = Math.floor(swing / 2) % (4 * QUARTER);
  const q = Math.floor(p / QUARTER);
  const i = p % QUARTER;
  const off = q === 0 ? SWING[i] : q === 1 ? SWING[QUARTER - i] : q === 2 ? -SWING[i] : -SWING[QUARTER - i];
  return ANGLE_STEPS / 2 + off;
}

/** Vị trí x của chuột ở bước `t` của màn và hướng đang chạy. */
export function runnerAt(run: NonNullable<MineItem['run']>, t: number) {
  const span = run.x1 - run.x0;
  const travel = (t + run.phase) % (2 * span);
  return travel < span ? { x: run.x0 + travel, dir: 1 as const } : { x: run.x1 - (travel - span), dir: -1 as const };
}

/** Số món mỗi loại theo màn: càng về sau càng nhiều đá to, kim cương, chuột và TNT. */
function levelMix(level: number): [ItemKind, number][] {
  return [
    ['goldL', 1 + (level >= 3 ? 1 : 0) + (level >= 6 ? 1 : 0)],
    ['goldM', 2 + (level >= 4 ? 1 : 0)],
    ['goldS', 3],
    ['goldXS', 4],
    ['diamond', Math.min(4, Math.floor(level / 2))],
    ['tnt', level >= 2 ? 1 + Math.floor(level / 4) : 0],
    ['bag', 2],
    ['rockL', 1 + Math.floor(level / 2)],
    ['rockS', 3],
    ['mouseGem', level >= 3 ? 1 : 0],
    ['mouse', level >= 2 ? 1 + Math.floor(level / 3) : 0],
  ];
}

const levelRng = (seed: number, level: number, salt: number) => rng((seed + Math.imul(level, 0x9e3779b9) + salt) >>> 0);

/** Bản đồ một màn, chỉ phụ thuộc hạt giống ván và số màn. */
export function generateLevel(seed: number, level: number): MineItem[] {
  const rand = levelRng(seed, level, 0);
  const items: MineItem[] = [];
  const between = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const clear = (x: number, y: number, r: number) => !items.some((o) => (o.x - x) ** 2 + (o.y - y) ** 2 < (o.r + r + 6) ** 2);
  for (const [kind, count] of levelMix(level)) {
    const { r } = ITEM_KINDS[kind];
    const runner = kind === 'mouse' || kind === 'mouseGem';
    for (let n = 0; n < count; n++) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const x = between(r + 8, MINE.W - r - 8);
        const y = between(MINE.GROUND + 40 + r, MINE.H - r - 6);
        if (!clear(x, y, r)) continue;
        const span = runner ? between(120, 260) : 0;
        const x0 = Math.max(r + 4, x - (span >> 1));
        const run = runner ? { x0, x1: Math.min(MINE.W - r - 4, x0 + span), phase: between(0, 400) } : null;
        items.push({ id: items.length, kind, x, y, r, run, roll: kind === 'bag' ? between(0, 999) : 0 });
        break;
      }
    }
  }
  return items;
}

/** Hàng bày bán sau màn `level` (ít nhất 2 món), giá tăng theo màn. */
export function shopOffers(seed: number, level: number): Offer[] {
  const rand = levelRng(seed, level, 0x5f3759df);
  const offers: Offer[] = [];
  for (const good of GOOD_ORDER) {
    if (rand() < 0.4 && GOOD_ORDER.length - GOOD_ORDER.indexOf(good) > 2 - offers.length) continue;
    const [lo, hi] = GOODS[good].price;
    const price = lo + Math.floor(rand() * (hi - lo + 1)) + level * 10;
    offers.push({ good, price, bought: false });
  }
  return offers;
}

const NO_BOOSTS: Boosts = { strength: false, clover: false, rockBook: false, polish: false };

export class GoldmineGame implements RaceEngine<MineCommand> {
  declare seed: number;
  declare levels: number;
  declare tick: number;
  declare level: number;
  declare phase: 'play' | 'shop';
  declare levelTick: number;
  declare shopLeft: number;
  declare money: number;
  declare peakMoney: number;
  declare dynamite: number;
  declare boosts: Boosts;
  /** Hàng đã mua, có hiệu lực từ màn kế tiếp. */
  declare pending: Boosts;
  /** Nước tăng lực nhặt được trong túi bí ẩn: có hiệu lực ngay tới hết màn. */
  declare bagStrength: boolean;
  declare offers: Offer[];
  declare items: MineItem[];
  declare hook: HookState;
  declare swing: number;
  declare rope: number;
  declare grab: MineItem | null;
  declare failed: boolean;
  declare cleared: boolean;
  declare cash: MineSnapshot['cash'];
  declare blast: MineSnapshot['blast'];

  constructor({ seed, levels }: MineOptions) {
    this.seed = seed >>> 0;
    this.levels = Math.min(LEVEL_COUNT.max, Math.max(LEVEL_COUNT.min, Math.floor(levels) || LEVEL_COUNT.default));
    this.tick = 0;
    this.money = 0;
    this.peakMoney = 0;
    this.dynamite = START_DYNAMITE;
    this.pending = { ...NO_BOOSTS };
    this.failed = false;
    this.cleared = false;
    this.cash = null;
    this.blast = null;
    this.offers = [];
    this.shopLeft = 0;
    this.level = 0;
    this.startLevel(1);
  }

  get over() { return this.failed || this.cleared; }
  get goal() { return goalFor(this.level); }
  get maxTicks() { return this.levels * LEVEL_TICKS + (this.levels - 1) * SHOP_TICKS; }
  get angle() { return swingAngle(this.swing); }

  /** Đầu móc (px). */
  tip() {
    const { dx, dy } = hookDir(this.angle);
    return {
      x: MINE.PIVOT_X + Math.trunc((this.rope * dx) / (1024 * SUB)),
      y: MINE.PIVOT_Y + Math.trunc((this.rope * dy) / (1024 * SUB)),
    };
  }

  /** Vị trí hiện tại của một món (chuột thì đang chạy). */
  position(o: MineItem) {
    return o.run ? runnerAt(o.run, this.levelTick) : { x: o.x, dir: 0 as const };
  }

  startLevel(level: number) {
    this.level = level;
    this.phase = 'play';
    this.levelTick = 0;
    this.shopLeft = 0;
    this.boosts = this.pending;
    this.pending = { ...NO_BOOSTS };
    this.bagStrength = false;
    this.offers = [];
    this.items = generateLevel(this.seed, level);
    this.hook = 'swing';
    this.swing = 0;
    this.rope = ROPE_MIN;
    this.grab = null;
  }

  command(command: MineCommand) {
    if (this.over) return false;
    if (this.phase === 'shop') return this.shopCommand(command);
    if (command === 'shoot' && this.hook === 'swing') {
      this.hook = 'out';
      return true;
    }
    if (command === 'boom' && this.hook === 'back' && this.grab && this.dynamite > 0) {
      this.dynamite--;
      const { x, y } = this.tip();
      this.blast = { x, y, at: this.tick };
      this.grab = null;
      return true;
    }
    return false;
  }

  shopCommand(command: MineCommand) {
    if (command === 'leave') {
      this.startLevel(this.level + 1);
      return true;
    }
    const slot = command.startsWith('buy') ? Number(command.slice(3)) : -1;
    const offer = this.offers[slot];
    if (!offer || offer.bought || this.money < offer.price) return false;
    offer.bought = true;
    this.money -= offer.price;
    if (offer.good === 'dynamite') this.dynamite++;
    else this.pending[offer.good] = true;
    return true;
  }

  step() {
    if (this.over) return;
    this.tick++;
    if (this.phase === 'shop') {
      if (--this.shopLeft <= 0) this.startLevel(this.level + 1);
      return;
    }
    this.moveHook();
    if (++this.levelTick < LEVEL_TICKS) return;
    if (this.money < this.goal) this.failed = true;
    else if (this.level >= this.levels) this.cleared = true;
    else this.openShop();
  }

  openShop() {
    this.phase = 'shop';
    this.shopLeft = SHOP_TICKS;
    this.offers = shopOffers(this.seed, this.level);
    this.grab = null;
    this.hook = 'swing';
    this.rope = ROPE_MIN;
  }

  moveHook() {
    if (this.hook === 'swing') {
      this.swing++;
      return;
    }
    if (this.hook === 'out') {
      this.rope += EXTEND;
      const { x, y } = this.tip();
      const hit = this.items.find((o) => (this.position(o).x - x) ** 2 + (o.y - y) ** 2 <= (o.r + HOOK_R) ** 2);
      if (hit?.kind === 'tnt') this.explode(hit);
      else if (hit) {
        this.items = this.items.filter((o) => o !== hit);
        this.grab = hit;
        this.hook = 'back';
      } else if (x < 0 || x > MINE.W || y > MINE.H) this.hook = 'back';
      return;
    }
    const weight = this.grab ? ITEM_KINDS[this.grab.kind].weight : 0;
    const strength = this.boosts.strength || this.bagStrength ? 16 : 10;
    this.rope -= Math.max(MIN_PULL, Math.floor((PULL * strength) / (10 + weight)));
    if (this.rope > ROPE_MIN) return;
    this.rope = ROPE_MIN;
    this.hook = 'swing';
    if (this.grab) this.collect(this.grab);
    this.grab = null;
  }

  /** TNT nổ: mọi món trong bán kính bị phá, móc về tay không. */
  explode(tnt: MineItem) {
    const x = this.position(tnt).x;
    this.items = this.items.filter((o) => (this.position(o).x - x) ** 2 + (o.y - tnt.y) ** 2 > BLAST_R ** 2);
    this.blast = { x, y: tnt.y, at: this.tick };
    this.hook = 'back';
  }

  /** Giá trị khi kéo về, đã tính hàng mua ở cửa hàng; túi bí ẩn giải nghĩa ở đây. */
  collect(o: MineItem) {
    let amount: number = ITEM_KINDS[o.kind].value;
    if ((o.kind === 'rockS' || o.kind === 'rockL') && this.boosts.rockBook) amount *= 3;
    if ((o.kind === 'diamond' || o.kind === 'mouseGem') && this.boosts.polish) amount += 300;
    if (o.kind === 'bag') {
      const luck = this.boosts.clover;
      if (o.roll < (luck ? 100 : 150)) {
        this.dynamite++;
        amount = 0;
      } else if (o.roll < (luck ? 180 : 250)) {
        this.bagStrength = true;
        amount = 0;
      } else amount = luck ? 300 + ((o.roll * 7) % 501) : 10 + ((o.roll * 7) % 391);
    }
    this.money += amount;
    this.peakMoney = Math.max(this.peakMoney ?? 0, this.money);
    this.cash = { amount, at: this.tick };
  }

  snapshot(): MineSnapshot {
    return {
      level: this.level,
      phase: this.phase,
      levelTick: this.levelTick,
      shopLeft: this.shopLeft,
      money: this.money,
      goal: this.goal,
      dynamite: this.dynamite,
      boosts: { ...this.boosts, strength: this.boosts.strength || this.bagStrength },
      hook: { state: this.hook, angle: this.angle, rope: this.rope, grab: this.grab?.kind ?? null },
      items: this.items.map((o) => {
        const { x, dir } = this.position(o);
        return { id: o.id, kind: o.kind, x, y: o.y, r: o.r, dir };
      }),
      offers: this.offers.map((o) => ({ ...o })),
      cash: this.cash,
      blast: this.blast,
    };
  }
}
