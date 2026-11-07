import test from 'node:test';
import assert from 'node:assert/strict';
import { replayRace } from '../src/race.js';
import type { RaceInput } from '../src/race.js';
import { ANGLE_STEPS, BREAK_TICKS, GoldmineGame, ITEM_KINDS, LEVEL_TICKS, MINE, START_DYNAMITE, generateLevel, goalFor, hookDir } from '../src/goldmine.js';
import type { ItemKind, MineCommand, MineItem } from '../src/goldmine.js';

const item = (kind: ItemKind, x: number, y: number): MineItem => ({ id: 0, kind, x, y, r: ITEM_KINDS[kind].r, value: ITEM_KINDS[kind].value, dynamite: false });

/** Bắn thẳng xuống (góc bắt đầu là giữa) và chạy tới khi móc về lại. Trả về số bước kéo về. */
function shootStraightDown(game: GoldmineGame) {
  assert.equal(game.angle, ANGLE_STEPS / 2);
  assert.equal(game.command('shoot'), true);
  while (game.hook === 'out') game.step();
  const from = game.tick;
  while (game.hook !== 'swing') game.step();
  return game.tick - from;
}

test('bản đồ mỗi màn tất định, món không chồng nhau và nằm dưới mặt đất', () => {
  for (let level = 1; level <= 10; level++) {
    const items = generateLevel(77, level);
    assert.deepEqual(items, generateLevel(77, level));
    assert.ok(items.length >= 12);
    for (const [i, a] of items.entries()) {
      assert.ok(a.x - a.r >= 0 && a.x + a.r <= MINE.W && a.y - a.r > MINE.GROUND && a.y + a.r <= MINE.H);
      for (const b of items.slice(i + 1)) assert.ok((a.x - b.x) ** 2 + (a.y - b.y) ** 2 >= (a.r + b.r) ** 2);
    }
    const value = items.reduce((sum, o) => sum + (o.kind === 'bag' ? 0 : o.value), 0);
    assert.ok(value >= goalFor(level) - goalFor(level - 1), `màn ${level} đủ tiền để qua`);
  }
  assert.notDeepEqual(generateLevel(77, 1), generateLevel(77, 2));
});

test('hướng móc đối xứng, ở giữa thì thẳng xuống', () => {
  assert.deepEqual(hookDir(ANGLE_STEPS / 2), { dx: 0, dy: 1024 });
  for (let i = 0; i <= ANGLE_STEPS; i++) {
    const a = hookDir(i), b = hookDir(ANGLE_STEPS - i);
    assert.equal(a.dx + b.dx, 0);
    assert.equal(a.dy, b.dy);
  }
});

test('gắp được thì cộng tiền, vật nặng kéo chậm hơn, bắn trượt thì về tay không', () => {
  const light = new GoldmineGame({ seed: 1, levels: 1 });
  light.items = [item('goldS', MINE.PIVOT_X, 300)];
  const lightTicks = shootStraightDown(light);
  assert.equal(light.money, ITEM_KINDS.goldS.value);
  assert.equal(light.items.length, 0);

  const heavy = new GoldmineGame({ seed: 1, levels: 1 });
  heavy.items = [item('goldL', MINE.PIVOT_X, 300)];
  assert.ok(shootStraightDown(heavy) > lightTicks * 2);
  assert.equal(heavy.money, ITEM_KINDS.goldL.value);

  const miss = new GoldmineGame({ seed: 1, levels: 1 });
  miss.items = [item('goldL', 40, 300)];
  shootStraightDown(miss);
  assert.equal(miss.money, 0);
  assert.equal(miss.items.length, 1);
  assert.equal(miss.command('boom'), false, 'không có gì để nổ');
});

test('thuốc nổ phá món đang kéo, không được tiền', () => {
  const game = new GoldmineGame({ seed: 1, levels: 1 });
  game.items = [item('rockL', MINE.PIVOT_X, 300)];
  game.command('shoot');
  while (!game.grab) game.step();
  assert.equal(game.command('boom'), true);
  assert.equal(game.dynamite, START_DYNAMITE - 1);
  while (game.hook !== 'swing') game.step();
  assert.equal(game.money, 0);
});

test('hết màn: thiếu tiền thì dừng, đủ thì nghỉ rồi sang màn mới, qua màn cuối là về đích', () => {
  const poor = new GoldmineGame({ seed: 3, levels: 3 });
  while (!poor.over) poor.step();
  assert.equal(poor.failed, true);
  assert.equal(poor.tick, LEVEL_TICKS);
  assert.equal(poor.command('shoot'), false);

  const rich = new GoldmineGame({ seed: 3, levels: 2 });
  rich.money = goalFor(2);
  for (let i = 0; i < LEVEL_TICKS; i++) rich.step();
  assert.equal(rich.phase, 'break');
  assert.equal(rich.command('shoot'), false, 'giờ nghỉ không bắn');
  for (let i = 0; i < BREAK_TICKS; i++) rich.step();
  assert.deepEqual([rich.level, rich.phase], [2, 'play']);
  assert.deepEqual(rich.items, generateLevel(3, 2));
  while (!rich.over) rich.step();
  assert.equal(rich.cleared, true);
  assert.equal(rich.tick, rich.maxTicks);
});

test('phát lại theo từng đoạn ra đúng trạng thái như khi chơi', () => {
  const live = new GoldmineGame({ seed: 21, levels: 2 });
  const inputs: RaceInput<MineCommand>[] = [];
  for (let t = 0; t < 2500; t++) {
    if (t % 97 === 0 && live.command('shoot')) inputs.push([live.tick, 'shoot']);
    if (t % 131 === 0 && live.command('boom')) inputs.push([live.tick, 'boom']);
    live.step();
  }
  assert.ok(inputs.length > 5);
  const copy = new GoldmineGame({ seed: 21, levels: 2 });
  let used = 0;
  for (let tick = 50; tick <= live.tick; tick += 50) used = replayRace(copy, inputs, tick, used);
  assert.deepEqual(copy.snapshot(), live.snapshot());
  assert.equal(copy.dynamite, live.dynamite);
});
