import test from 'node:test';
import assert from 'node:assert/strict';
import { GoldmineGame, MINE, ITEM_KINDS } from '@game/shared/goldmine';
import { replayRace } from '@game/shared/race';
import { advanceRaceFrame, RaceInputQueue } from '../../client/src/games/raceRuntime.js';
import { MinePlayback } from '../../client/src/games/minePlayback.js';

test('catch-up and recovery yield at both the step cap and time budget', () => {
  const game = new GoldmineGame({ seed: 1, levels: 5 });
  advanceRaceFrame(game, 3000, [], 0, undefined, () => 0);
  assert.equal(game.tick, 250);
  let clock = 0;
  const from = game.tick;
  advanceRaceFrame(game, 3000, [], 0, undefined, () => clock++);
  assert.ok(game.tick > from && game.tick - from <= 4);
});

test('penultimate simulation step stays available for interpolation after skipped frames', () => {
  const game = new GoldmineGame({ seed: 1, levels: 5 });
  game.command('shoot');
  let previous = game.snapshot();
  advanceRaceFrame(game, 4, [], 0, () => { previous = game.snapshot(); }, () => 0);
  const current = game.snapshot();
  assert.equal(previous.levelTick, current.levelTick - 1);
  assert.ok(previous.hook.rope < current.hook.rope);
});

test('chunked recovery preserves command order, collection and final snapshot', () => {
  const game = new GoldmineGame({ seed: 1, levels: 5 });
  const expected = new GoldmineGame({ seed: 1, levels: 5 });
  const inputs: [number, 'shoot'][] = [[0, 'shoot'], [200, 'shoot'], [500, 'shoot']];
  replayRace(expected, inputs, 1200);
  let used = 0;
  while (game.tick < 1200) used = advanceRaceFrame(game, 1200, inputs, used, undefined, () => 0);
  assert.deepEqual(game.snapshot(), expected.snapshot());
});

test('unconfirmed inputs survive failures and final batches can retry after game over', () => {
  const queue = new RaceInputQueue<'shoot'>();
  queue.log.push([0, 'shoot']);
  const first = queue.prepare(10)!;
  assert.equal(queue.prepare(11), null, 'one in-flight request');
  queue.log.push([12, 'shoot']);
  queue.retry(first);
  const retry = queue.prepare(20)!;
  assert.deepEqual(retry.inputs, [[0, 'shoot'], [12, 'shoot']]);
  queue.acknowledge(first, 1);
  assert.equal(queue.confirmed, 0, 'late response from an obsolete request is ignored');
  queue.acknowledge(retry, 2);
  assert.equal(queue.confirmed, 2);
  assert.deepEqual(queue.prepare(21)?.inputs, []);
});

test('large retry queues never advance the server past unsent commands', () => {
  const queue = new RaceInputQueue<'shoot'>();
  for (let tick = 0; tick < 450; tick++) queue.log.push([tick, 'shoot']);
  const first = queue.prepare(500)!;
  assert.equal(first.inputs.length, 200);
  assert.equal(first.tick, 200);
  queue.acknowledge(first, 200);
  const next = queue.prepare(500)!;
  assert.equal(next.offset, 200);
  assert.equal(next.tick, 400);
});

test('spectator playback interpolates between sparse packets and resets across levels', () => {
  const game = new GoldmineGame({ seed: 1, levels: 5 });
  game.items = [{ id: 0, kind: 'goldXS', x: MINE.PIVOT_X, y: 300, r: ITEM_KINDS.goldXS.r, run: null, roll: 0 }];
  const playback = new MinePlayback();
  game.command('shoot');
  playback.push(game.snapshot(), game.tick, 0);
  for (let i = 0; i < 10; i++) game.step();
  playback.push(game.snapshot(), game.tick, 200);
  const a = playback.sample(300)!;
  const b = playback.sample(350)!;
  assert.ok(a.alpha < b.alpha && b.alpha < 1);
  assert.equal(b.tick, 5);
  assert.ok(b.previous.hook.rope < b.mine.hook.rope);
  game.startLevel(2);
  playback.push(game.snapshot(), game.tick, 400);
  assert.equal(playback.sample(450)?.previous.level, 2);
});
