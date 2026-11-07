import test from 'node:test';
import assert from 'node:assert/strict';
import { replayRace } from '../src/race.js';
import type { RaceInput } from '../src/race.js';
import { DIFFICULTY, SKY, SUB, SkyhopGame, pillarX } from '../src/skyhop.js';
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

test('không chạm gì thì rơi xuống đất trước cột đầu tiên, 0 điểm', () => {
  const game = new SkyhopGame({ seed: 1, level: 2, target: 0 });
  while (!game.over) game.step();
  assert.equal(game.dead, true);
  assert.equal(game.score, 0);
  assert.ok(game.tick < 200);
  assert.equal(game.command('flap'), false, 'đã thua thì không nhận lệnh');
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
