import test from 'node:test';
import assert from 'node:assert/strict';
import { replayRace } from '../src/race.js';
import type { RaceInput } from '../src/race.js';
import {
  ANGLE_STEPS, GoldmineGame, ITEM_KINDS, LEVEL_TICKS, MINE, SHOP_TICKS, START_DYNAMITE,
  buyCommand, generateLevel, goalFor, hookDir, runnerAt, shopOffers, swingAngle,
} from '../src/goldmine.js';
import type { ItemKind, MineCommand, MineItem } from '../src/goldmine.js';

const item = (kind: ItemKind, x: number, y: number, extra: Partial<MineItem> = {}): MineItem =>
  ({ id: 0, kind, x, y, r: ITEM_KINDS[kind].r, run: null, roll: 0, ...extra });

/** Bắn thẳng xuống (lúc bắt đầu màn móc ở giữa) và chạy tới khi móc về. Trả về số bước kéo về. */
function shootStraightDown(game: GoldmineGame) {
  assert.equal(game.angle, ANGLE_STEPS / 2);
  assert.equal(game.command('shoot'), true);
  while (game.hook === 'out') game.step();
  const from = game.tick;
  while (game.hook !== 'swing') game.step();
  return game.tick - from;
}

/** Chạy hết màn hiện tại với số tiền cho trước. */
function finishLevel(game: GoldmineGame, money: number) {
  game.money = money;
  while (game.phase === 'play' && !game.over) game.step();
}

test('mục tiêu tiền cộng dồn kiểu cổ điển', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(goalFor), [650, 1195, 2010, 3095, 4450, 6075]);
});

test('bản đồ mỗi màn tất định, món không chồng nhau, nằm dưới mặt đất và đủ tiền để qua', () => {
  for (let level = 1; level <= 10; level++) {
    const items = generateLevel(77, level);
    assert.deepEqual(items, generateLevel(77, level));
    for (const [i, a] of items.entries()) {
      assert.ok(a.x - a.r >= 0 && a.x + a.r <= MINE.W && a.y - a.r > MINE.GROUND && a.y + a.r <= MINE.H);
      for (const b of items.slice(i + 1)) assert.ok((a.x - b.x) ** 2 + (a.y - b.y) ** 2 >= (a.r + b.r) ** 2);
    }
    const solid = items.filter((o) => !['bag', 'tnt', 'mouse', 'mouseGem'].includes(o.kind));
    const value = solid.reduce((sum, o) => sum + ITEM_KINDS[o.kind].value, 0);
    assert.ok(value >= (goalFor(level) - goalFor(level - 1)) * 1.3, `màn ${level} dư tiền để qua`);
  }
  assert.ok(generateLevel(77, 6).some((o) => o.kind === 'tnt') && generateLevel(77, 6).some((o) => o.run));
});

test('móc lắc như con lắc: bắt đầu ở giữa, chậm dần ở hai đầu, đối xứng', () => {
  const angles = Array.from({ length: 360 }, (_, t) => swingAngle(t));
  assert.equal(angles[0], ANGLE_STEPS / 2);
  assert.equal(Math.max(...angles), ANGLE_STEPS);
  assert.equal(Math.min(...angles), 0);
  angles.forEach((a, t) => { if (t) assert.ok(Math.abs(a - angles[t - 1]) <= 2); });
  assert.deepEqual(hookDir(ANGLE_STEPS / 2), { dx: 0, dy: 1024 });
  for (let i = 0; i <= ANGLE_STEPS; i++) assert.equal(hookDir(i).dx + hookDir(ANGLE_STEPS - i).dx, 0);
});

test('chuột chạy qua lại trong đoạn của nó', () => {
  const run = { x0: 100, x1: 200, phase: 30 };
  const xs = Array.from({ length: 400 }, (_, t) => runnerAt(run, t).x);
  assert.ok(xs.every((x) => x >= 100 && x <= 200));
  assert.equal(Math.min(...xs), 100);
  assert.equal(Math.max(...xs), 200);
});

test('gắp được thì cộng tiền, vật nặng kéo chậm hơn, bắn trượt thì về tay không', () => {
  const light = new GoldmineGame({ seed: 1, levels: 1 });
  light.items = [item('goldXS', MINE.PIVOT_X, 300)];
  const lightTicks = shootStraightDown(light);
  assert.equal(light.money, 50);
  assert.deepEqual(light.cash, { amount: 50, at: light.tick });

  const heavy = new GoldmineGame({ seed: 1, levels: 1 });
  heavy.items = [item('goldL', MINE.PIVOT_X, 300)];
  assert.ok(shootStraightDown(heavy) > lightTicks * 2);
  assert.equal(heavy.money, 500);

  const miss = new GoldmineGame({ seed: 1, levels: 1 });
  miss.items = [item('goldL', 40, 300)];
  shootStraightDown(miss);
  assert.equal(miss.money, 0);
  assert.equal(miss.command('boom'), false, 'không có gì để nổ');
});

test('thuốc nổ phá món đang kéo; TNT phá mọi thứ quanh nó', () => {
  const game = new GoldmineGame({ seed: 1, levels: 1 });
  game.items = [item('rockL', MINE.PIVOT_X, 300)];
  game.command('shoot');
  while (!game.grab) game.step();
  assert.equal(game.command('boom'), true);
  assert.equal(game.dynamite, START_DYNAMITE - 1);
  while (game.hook !== 'swing') game.step();
  assert.equal(game.money, 0);

  const tnt = new GoldmineGame({ seed: 1, levels: 1 });
  tnt.items = [item('tnt', MINE.PIVOT_X, 250), { ...item('goldL', MINE.PIVOT_X + 40, 290), id: 1 }, { ...item('goldS', 40, 300), id: 2 }];
  shootStraightDown(tnt);
  assert.deepEqual(tnt.items.map((o) => o.id), [2], 'chỉ món ở xa còn lại');
  assert.equal(tnt.money, 0);
  assert.ok(tnt.blast);
});

test('túi bí ẩn: kết quả gieo sẵn, cỏ may mắn cho nhiều tiền hơn', () => {
  const open = (roll: number, clover: boolean) => {
    const game = new GoldmineGame({ seed: 1, levels: 1 });
    game.boosts.clover = clover;
    game.collect(item('bag', 0, 0, { roll }));
    return [game.money, game.dynamite, game.bagStrength];
  };
  assert.deepEqual(open(50, false), [0, START_DYNAMITE + 1, false]);
  assert.deepEqual(open(200, false), [0, START_DYNAMITE, true]);
  const [plain] = open(900, false);
  const [lucky] = open(900, true);
  assert.ok(Number(lucky) >= 300 && Number(lucky) > Number(plain));
});

test('hết màn thiếu tiền thì dừng; đủ tiền thì vào cửa hàng, mua hàng có hiệu lực ở màn sau', () => {
  const poor = new GoldmineGame({ seed: 3, levels: 3 });
  finishLevel(poor, 0);
  assert.equal(poor.failed, true);
  assert.equal(poor.tick, LEVEL_TICKS);

  const rich = new GoldmineGame({ seed: 3, levels: 2 });
  finishLevel(rich, 5000);
  assert.equal(rich.phase, 'shop');
  assert.deepEqual(rich.offers, shopOffers(3, 1));
  assert.ok(rich.offers.length >= 2);
  assert.equal(rich.command('shoot'), false, 'ở cửa hàng không bắn');
  const slot = rich.offers.findIndex((o) => o.good !== 'dynamite');
  const offer = rich.offers[slot];
  assert.equal(rich.command(buyCommand(slot)!), true);
  assert.equal(rich.money, 5000 - offer.price);
  assert.equal(rich.command(buyCommand(slot)!), false, 'không mua hai lần');
  assert.equal(rich.boosts[offer.good as 'strength'], false, 'chưa có hiệu lực trong màn đã qua');
  rich.money = 0;
  const other = rich.offers.findIndex((o) => !o.bought);
  assert.equal(rich.command(buyCommand(other)!), false, 'không đủ tiền');
  assert.equal(rich.command('leave'), true);
  assert.deepEqual([rich.level, rich.phase], [2, 'play']);
  assert.equal(rich.boosts[offer.good as 'strength'], true);
});

test('sách đá: đá đáng giá gấp 3; cửa hàng tự đóng khi hết giờ; qua màn cuối là về đích', () => {
  const game = new GoldmineGame({ seed: 4, levels: 2 });
  finishLevel(game, 1000);
  for (let i = 0; i < SHOP_TICKS; i++) game.step();
  assert.deepEqual([game.level, game.phase], [2, 'play']);
  game.boosts.rockBook = true;
  game.collect(item('rockL', 0, 0));
  assert.equal(game.money, 1060);
  finishLevel(game, goalFor(2));
  assert.equal(game.cleared, true);
  assert.equal(game.tick, game.maxTicks);
});

test('phát lại theo từng đoạn (cả lệnh ở cửa hàng) ra đúng trạng thái như khi chơi', () => {
  const live = new GoldmineGame({ seed: 21, levels: 3 });
  const inputs: RaceInput<MineCommand>[] = [];
  const press = (c: MineCommand) => { if (live.command(c)) inputs.push([live.tick, c]); };
  for (let t = 0; t < 4000; t++) {
    if (t === LEVEL_TICKS - 1) live.money = 900; // đủ qua màn 1, vào cửa hàng
    if (t % 97 === 0) press('shoot');
    if (t % 131 === 0) press('boom');
    if (live.phase === 'shop') { press('buy0'); press('buy1'); if (live.shopLeft < SHOP_TICKS - 100) press('leave'); }
    live.step();
  }
  assert.ok(inputs.some(([, c]) => c === 'leave'));
  const copy = new GoldmineGame({ seed: 21, levels: 3 });
  copy.money = 0;
  let used = 0;
  // Màn 1 phải đạt mục tiêu ở bản phát lại giống bản chơi: đặt cùng số tiền đúng bước đó
  for (let tick = 50; tick <= live.tick; tick += 50) {
    if (copy.tick < LEVEL_TICKS - 1 && tick >= LEVEL_TICKS - 1) { used = replayRace(copy, inputs, LEVEL_TICKS - 1, used); copy.money = 900; }
    used = replayRace(copy, inputs, tick, used);
  }
  assert.deepEqual(copy.snapshot(), live.snapshot());
});

test('vàng lớn và đá kéo chậm hơn rõ rệt so với vàng nhỏ', () => {
  const duration = (kind: ItemKind) => {
    const game = new GoldmineGame({ seed: 1, levels: 1 });
    game.items = [item(kind, MINE.PIVOT_X, 260)];
    return shootStraightDown(game);
  };
  assert.ok(duration('goldL') > duration('goldXS') * 3);
  assert.ok(duration('rockL') > duration('goldXS') * 3);
  assert.ok(duration('rockS') > duration('goldS') * 2);
});

test('mua đồ giảm tiền hiện có nhưng giữ mốc tiền cao nhất', () => {
  const game = new GoldmineGame({ seed: 1, levels: 3 });
  game.collect(item('goldL', 100, 200));
  game.openShop();
  game.offers = [{ good: 'strength', price: 100, bought: false }];
  assert.equal(game.command('buy0'), true);
  assert.equal(game.money, 400);
  assert.equal(game.peakMoney, 500);
  game.startLevel(2);
  assert.equal(game.peakMoney, 500);
});
