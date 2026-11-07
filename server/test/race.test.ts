import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { GameAction } from '@game/shared/contracts';
import type { RaceInput } from '@game/shared/race';
import { SKY, SUB, SkyhopGame, TICK_MS, pillarX } from '@game/shared/skyhop';
import type { SkyCommand } from '@game/shared/skyhop';
import { GoldmineGame } from '@game/shared/goldmine';
import { SkyhopHandler } from '../src/games/skyhop.js';
import { GoldmineHandler } from '../src/games/goldmine.js';

const COUNTDOWN_MS = 3000;
const messages: string[] = [];
const room = { ownerId: 'a', system: (text: string) => { messages.push(text); }, changed() {} };
const players = [{ id: 'a', name: 'An' }, { id: 'b', name: 'Bình' }];

/** Đồng hồ giả để điều khiển `Date.now()` và các hẹn giờ của handler. */
function clock(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1_000_000 });
  t.mock.method(Math, 'random', () => 0.25); // hạt giống cố định cho ván test
  return (ms: number) => t.mock.timers.tick(ms);
}

function startSky(t: TestContext, options: Record<string, unknown> = {}, seats = players) {
  const h = new SkyhopHandler(room, { level: 1, target: 5, ...options });
  t.after(() => h.dispose());
  seats.forEach((p) => h.sit(p));
  if (seats.length > 1) {
    assert.throws(() => h.action('a', { type: 'start' }), /sẵn sàng/);
    h.action('b', { type: 'ready' });
  }
  h.action('a', { type: 'start' });
  assert.equal(h.status, 'playing');
  return h;
}

/** Client trung thực: tự chơi bằng engine cùng hạt giống và ghi lại các lần nảy. */
function playSky(game: SkyhopGame, ticks: number) {
  const inputs: RaceInput<SkyCommand>[] = [];
  while (!game.over && game.tick < ticks) {
    const birdLeft = game.scroll / SUB + SKY.BIRD_X - SKY.BIRD_R;
    const next = pillarX(game.score) + SKY.PILLAR_W < birdLeft ? game.score + 1 : game.score;
    if (game.y / SUB > game.gapCenter(next) + 22 && game.vy > 0 && game.command('flap')) inputs.push([game.tick, 'flap']);
    game.step();
  }
  return inputs;
}

const sync = (tick: number, inputs: unknown[]) => ({ type: 'raceSync', tick, inputs }) as GameAction;

/** Như client thật: cứ 300ms gửi các lệnh mới kèm tick hiện tại, tới khi hết `inputs` và tới `endTick`. */
function stream(h: SkyhopHandler | GoldmineHandler, id: string, inputs: RaceInput[], endTick: number, advance: (ms: number) => void) {
  let sent = 0;
  let tick = 0;
  while (tick < endTick) {
    advance(300);
    tick = Math.min(endTick, h.clockTick());
    const batch: RaceInput[] = [];
    while (sent < inputs.length && inputs[sent][0] <= tick) batch.push(inputs[sent++]);
    h.action(id, sync(tick, batch));
  }
}

test('tùy chọn phòng bị kẹp về khoảng hợp lệ', () => {
  const sky = new SkyhopHandler(room, { maxSeats: 99, level: 'khó', target: -5 });
  assert.deepEqual(sky.options, { maxSeats: 8, level: 2, target: 0 });
  const mine = new GoldmineHandler(room, { maxSeats: 0, levels: 50 });
  assert.deepEqual(mine.options, { maxSeats: 1, levels: 10 });
});

test('server tự phát lại lệnh để tính điểm, về đích thì thắng', (t) => {
  const advance = clock(t);
  const h = startSky(t);
  const local = new SkyhopGame({ seed: h.seed, level: 1, target: 5 });
  const inputs = playSky(local, 10_000);
  assert.equal(local.finished, true);

  advance(COUNTDOWN_MS);
  stream(h, 'a', inputs, local.tick, advance);
  const me = h.view('a').players.find((p) => p.id === 'a');
  assert.deepEqual([me?.score, me?.end, me?.done], [5, 'finished', true]);
  // Bình không gửi gì nên đã bị đẩy tới lúc rơi; hết người chơi là ván kết thúc
  assert.equal(h.status, 'over');
  assert.equal(h.players[1].end, 'dead');
  assert.equal(h.result?.winner, 'a');
  assert.deepEqual(h.view('b').wins.map((w) => [w.id, w.wins, w.best]), [['a', 1, 5], ['b', 0, 0]]);
});

test('từ chối tick vượt đồng hồ server và lệnh sai dạng; lệnh cũ bị bỏ qua', (t) => {
  const advance = clock(t);
  const h = startSky(t);
  assert.throws(() => h.action('a', sync(1000, [])), /Đồng hồ lệch/);
  advance(COUNTDOWN_MS + 40 * TICK_MS);
  for (const bad of [['x', 'flap'], [1.5, 'flap'], [3, 'boom'], [3], 'flap', null]) {
    assert.throws(() => h.action('a', sync(10, [bad])), /không hợp lệ/, JSON.stringify(bad));
  }
  assert.throws(() => h.action('a', sync(-1, [])), /không hợp lệ/);
  assert.throws(() => h.action('a', sync(10, Array.from({ length: 201 }, (_, i) => [i, 'flap']))), /Quá nhiều/);
  assert.throws(() => h.action('c', sync(10, [])), /chế độ xem/);

  h.action('a', sync(20, [[5, 'flap']]));
  h.action('a', sync(30, [[10, 'flap'], [25, 'flap']])); // tick 10 đã qua → bỏ qua
  assert.deepEqual(h.players[0].inputs, [[5, 'flap'], [25, 'flap']]);
  assert.equal(h.players[0].game.tick, 30);
});

test('người im lặng bị server đẩy đi tiếp nên không đứng yên được; hết người thì kết thúc', (t) => {
  const advance = clock(t);
  const h = startSky(t);
  advance(COUNTDOWN_MS + 10_000);
  assert.equal(h.status, 'over');
  assert.ok(h.players.every((p) => p.end === 'dead' && p.game.score === 0));
  assert.equal(h.result?.winner, null, 'không ai qua khe nào thì không ai thắng');
});

test('Đào vàng: view không lộ giá trị túi bí ẩn, hạt giống ẩn khi chưa chơi, xếp hạng theo tiền', (t) => {
  const advance = clock(t);
  const h = new GoldmineHandler(room, { levels: 1 });
  t.after(() => h.dispose());
  assert.equal(h.view('a').seed, 0);
  players.forEach((p) => h.sit(p));
  h.action('b', { type: 'ready' });
  h.action('a', { type: 'start' });
  const items = h.view('a').players[0].mine.items;
  assert.ok(items.length > 0);
  for (const item of items) assert.deepEqual(Object.keys(item).sort(), ['id', 'kind', 'r', 'x', 'y']);

  // An bắn theo đúng engine của mình; Bình không làm gì
  const local = new GoldmineGame({ seed: h.seed, levels: 1 });
  const inputs: RaceInput<'shoot'>[] = [];
  while (local.tick < 1500) {
    if (local.command('shoot')) inputs.push([local.tick, 'shoot']);
    local.step();
  }
  advance(COUNTDOWN_MS);
  stream(h, 'a', inputs, 1500, advance);
  assert.equal(h.players[0].game.money, local.money);
  assert.ok(local.money > 0);

  advance(70_000);
  assert.equal(h.status, 'over');
  assert.deepEqual(h.result?.ranking, ['a', 'b']);
  assert.equal(h.result?.winner, 'a');
  assert.ok(messages.some((m) => m.includes('dừng ở màn 1') || m.includes('qua hết 1 màn')));
});

test('chơi một mình bắt đầu được ngay, đứng dậy giữa ván là bỏ cuộc, dispose dọn hẹn giờ', (t) => {
  clock(t);
  const h = startSky(t, {}, [players[0]]);
  assert.ok(h.timer && h.watchTimer);
  assert.throws(() => h.sit(players[1]), /đang diễn ra/);
  h.stand('a');
  assert.equal(h.status, 'over');
  assert.equal(h.players[0].end, 'gaveUp');
  assert.equal(h.timer, null);
  assert.equal(h.watchTimer, null);
});
