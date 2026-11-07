import test from 'node:test';
import assert from 'node:assert/strict';
import { replayRace } from '../src/race.js';
import type { RaceInput } from '../src/race.js';
import { DIFFICULTY, READY_TICKS, SKY, SUB, SkyhopGame, medalFor, pillarX } from '../src/skyhop.js';
import type { SkyCommand } from '../src/skyhop.js';

/** Chơi tự động: nảy khi đã rơi xuống dưới tâm khe sắp tới. Trả về các lệnh đã dùng. */
function autopilot(game: SkyhopGame, ticks: number) {
  const inputs: RaceInput<SkyCommand>[] = [];
  while (!game.over && game.tick < ticks) {
    const birdLeft = game.scroll / SUB + SKY.BIRD_X - SKY.BIRD_R;
    const next = pillarX(game.score) + SKY.PILLAR_W < birdLeft ? game.score + 1 : game.score;
    if (game.y / SUB > game.gapCenter(next) + 22 && game.vy > 0 && game.command('flap')) inputs.push([game.tick, 'flap']);
    game.step();
  }
  return inputs;
}

test('màn Chuẩn bị: chim lơ lửng, cột đứng yên tới lần chạm đầu', () => {
  const game = new SkyhopGame({ seed: 1, level: 2, target: 0 });
  for (let i = 0; i < 100; i++) game.step();
  assert.deepEqual([game.startTick, game.scroll, game.vy], [null, 0, 0]);
  const y = game.y;
  assert.equal(game.command('flap'), true);
  game.step();
  assert.equal(game.startTick, 100);
  assert.ok(game.y < y, 'lần chạm đầu nảy lên');
  assert.equal(game.scroll, game.speed);
});

test('không chạm gì: quá thời gian chuẩn bị thì tự cất cánh rồi rơi, 0 điểm', () => {
  const game = new SkyhopGame({ seed: 1, level: 2, target: 0 });
  while (!game.over) game.step();
  assert.equal(game.startTick, READY_TICKS);
  assert.equal(game.dead, true);
  assert.equal(game.score, 0);
  assert.ok(game.tick < READY_TICKS + 200);
  assert.equal(game.command('flap'), false, 'đã thua thì không nhận lệnh');
});

test('huy chương theo số khe', () => {
  assert.deepEqual([9, 10, 25, 39, 40, 99].map((n) => medalFor(n)?.name ?? null), [null, 'Đồng', 'Bạc', 'Vàng', 'Bạch kim', 'Bạch kim']);
});

test('khe sinh từ hạt giống: cùng hạt giống cùng dãy, khe nằm trong màn và không lệch quá xa', () => {
  const a = new SkyhopGame({ seed: 42, level: 3, target: 0 });
  const b = new SkyhopGame({ seed: 42, level: 3, target: 0 });
  const c = new SkyhopGame({ seed: 43, level: 3, target: 0 });
  const half = DIFFICULTY[2].gap / 2;
  const gaps = Array.from({ length: 60 }, (_, k) => a.gapCenter(k));
  assert.deepEqual(gaps, Array.from({ length: 60 }, (_, k) => b.gapCenter(k)));
  assert.notDeepEqual(gaps, Array.from({ length: 60 }, (_, k) => c.gapCenter(k)));
  gaps.forEach((g, k) => {
    assert.ok(g - half > 0 && g + half < SKY.GROUND, `khe ${k}`);
    if (k) assert.ok(Math.abs(g - gaps[k - 1]) <= 150, `khe ${k} lệch quá xa`);
  });
});

test('mỗi bước chỉ nhận một lần nảy và chim không bay quá trần', () => {
  const game = new SkyhopGame({ seed: 5, level: 1, target: 0 });
  assert.equal(game.command('flap'), true);
  assert.equal(game.command('flap'), false);
  for (let i = 0; i < 60 && !game.over; i++) {
    game.command('flap');
    game.step();
    assert.ok(game.y >= SKY.BIRD_R * SUB);
  }
});

test('qua đủ số khe mục tiêu thì về đích, phát lại từng đoạn ra đúng trạng thái', () => {
  const live = new SkyhopGame({ seed: 9, level: 1, target: 8 });
  const inputs = autopilot(live, 5000);
  assert.equal(live.finished, true);
  assert.equal(live.score, 8);

  const once = new SkyhopGame({ seed: 9, level: 1, target: 8 });
  replayRace(once, inputs, live.tick);
  const pieces = new SkyhopGame({ seed: 9, level: 1, target: 8 });
  let used = 0;
  for (let tick = 37; tick < live.tick + 37; tick += 37) used = replayRace(pieces, inputs, tick, used);
  for (const copy of [once, pieces]) {
    assert.deepEqual([copy.tick, copy.y, copy.vy, copy.score, copy.finished], [live.tick, live.y, live.vy, live.score, true]);
  }
});

test('sai một nhịp là kết quả khác — server không thể bị lừa bằng điểm', () => {
  const live = new SkyhopGame({ seed: 11, level: 1, target: 0 });
  const inputs = autopilot(live, 1500);
  const shifted = inputs.map(([tick, cmd]): RaceInput<SkyCommand> => [tick + 1, cmd]);
  const copy = new SkyhopGame({ seed: 11, level: 1, target: 0 });
  replayRace(copy, shifted, live.tick);
  assert.notEqual(copy.y, live.y);
});

test('khe thu hẹp dần theo cột và dừng ở mức sàn', () => {
  const game = new SkyhopGame({ seed: 1, level: 2, target: 0 });
  assert.equal(game.gapAt(0), 132);
  assert.equal(game.gapAt(10), 128);
  assert.equal(game.gapAt(60), 108);
  assert.equal(game.gapAt(10000), 108);
  game.tick = 30001;
  assert.equal(game.over, false, 'không dừng ở giới hạn 10 phút cũ');
});

test('một lần bấm chỉ nâng chim khoảng 30px', () => {
  const game = new SkyhopGame({ seed: 1, level: 1, target: 0 });
  const initial = game.y;
  game.command('flap');
  while (game.tick === 0 || game.vy < 0) game.step();
  const rise = (initial - game.y) / SUB;
  assert.ok(rise > 20 && rise < 35);
});

test('cột về sau dao động theo thời gian, có giới hạn và khớp replay', () => {
  const a = new SkyhopGame({ seed: 42, level: 2, target: 0 });
  const b = new SkyhopGame({ seed: 42, level: 2, target: 0 });
  assert.equal(a.gapCenter(0, 0), a.gapCenter(0, 120));
  const positions = Array.from({ length: 240 }, (_, tick) => a.gapCenter(60, tick));
  assert.ok(Math.max(...positions) - Math.min(...positions) >= 46);
  positions.forEach((center, tick) => {
    assert.equal(center, b.gapCenter(60, tick));
    assert.ok(center - a.gapAt(60) / 2 > 0);
    assert.ok(center + a.gapAt(60) / 2 < SKY.GROUND);
    if (tick) assert.ok(Math.abs(center - positions[tick - 1]) <= 1);
  });
  assert.equal(a.gapCenter(60, 240), a.gapCenter(60, 0));
});
