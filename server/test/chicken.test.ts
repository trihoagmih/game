import assert from 'node:assert/strict';
import test from 'node:test';
import { ChickenGame } from '@game/shared/chicken';
import { ChickenHandler } from '../src/games/chicken.js';

const room = { ownerId: 'a', system() {}, changed() {} };

test('chicken validates seats, readiness, clock and input; replays authoritative field', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 100000 });
  const h = new ChickenHandler(room, { maxSeats: 99, level: -5 });
  t.after(() => h.dispose());
  assert.deepEqual(h.options, { maxSeats: 8, level: 1 });
  h.sit({ id: 'a', name: 'An' });
  h.sit({ id: 'b', name: 'Bình' });
  assert.throws(() => h.action('a', { type: 'start' }), /sẵn sàng/);
  h.action('b', { type: 'ready' });
  h.action('a', { type: 'start' });
  assert.throws(() => h.action('watcher', { type: 'giveup' }), /xem/);
  assert.throws(() => h.action('a', { type: 'raceSync', tick: 10000, inputs: [] }), /lệch/);
  assert.throws(() => h.action('a', { type: 'raceSync', tick: 0, inputs: [[0, 'fake']] }), /không hợp lệ/);
  assert.throws(() => h.action('a', { type: 'raceSync', gameNo: 99, tick: 1, inputs: [] }), /thay đổi/);
  t.mock.timers.tick(4200);
  const local = new ChickenGame({ seed: h.seed, level: 1 });
  local.command('left');
  while (local.tick < 60) local.step();
  h.action('a', { type: 'raceSync', gameNo: h.gameNo, offset: 0, tick: 60, inputs: [[0, 'left']] });
  assert.deepEqual(h.view('watcher').players[0].field, local.view());
  h.action('a', { type: 'raceSync', gameNo: h.gameNo, offset: 0, tick: 60, inputs: [[0, 'left']] });
  assert.equal(h.players[0].inputs.length, 1, 'lost ACK retry does not duplicate input');
  h.onLeave('a');
  assert.equal(h.players[0].end, 'gaveUp');
  h.action('b', { type: 'giveup' });
  assert.equal(h.status, 'over');
  assert.equal(h.timer, null);
  assert.equal(h.watchTimer, null);
});
