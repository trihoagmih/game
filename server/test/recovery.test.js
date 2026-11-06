import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { Lobby } from '../src/lobby.js';
import { GAMES } from '../src/games/index.js';
import { pack, unpack, encrypt, decrypt, encryptionKey } from '../src/snapshot.js';
import { resumeRoom } from '../src/resumeRoom.js';
import { rng } from '@game/shared/onet';

const io = { to: () => ({ emit() {} }) };
function started(t, game) {
  const lobby = new Lobby(io);
  const owner = lobby.createUser('Owner', 'default');
  const room = lobby.createRoom(owner, { name: game, game, options: { dictionary: false } });
  const users = [owner];
  lobby.join(owner, room, 'play');
  for (let i = 1; i < (game === 'telephone' ? 3 : 2); i++) {
    const user = lobby.createUser(`Player ${i}`, 'default');
    users.push(user);
    lobby.join(user, room, 'play');
    room.handler.action(user.id, { type: 'ready' });
  }
  room.handler.action(owner.id, { type: game === 'chess' ? 'ready' : 'start' });
  if (game === 'poker') { clearTimeout(room.handler.nextHandTimer); room.handler.nextHandTimer = null; room.handler.game.startHand(); room.handler._afterChange(); }
  t.after(() => room.handler.dispose());
  return { lobby, room, users };
}

for (const game of Object.keys(GAMES)) test(`${game}: snapshot restores active game prototypes, private state and timers`, (t) => {
  const { lobby, room, users } = started(t, game);
  // Track commitments before snapshot, as normal views do.
  room.viewFor(users[0].id);
  const restored = unpack(pack(room));
  restored.lobby = lobby;
  restored.handler.room = restored;
  if (restored.handler.ready?.ids) restored.handler.ready.room = restored;
  assert.equal(restored.game, game);
  assert.equal(restored.handler.constructor, room.handler.constructor);
  assert.equal(restored.handler.isPlaying(), room.handler.isPlaying());
  assert.deepEqual(restored.handler.playerIds(), room.handler.playerIds());
  if ('timer' in room.handler) assert.equal(restored.handler.timer, null);
  if (game === 'poker') assert.deepEqual(restored.handler.game.hand, room.handler.game.hand);
  assert.doesNotThrow(() => restored.viewFor(users[0].id));
  if (room.handler.game) assert.equal(restored.handler.game.constructor, room.handler.game.constructor);
  if (game === 'wordchain') assert.equal(typeof restored.handler.game.isKnownWord, 'function');
  if (game === 'onet') assert.equal(restored.handler.players[0].board.rand(), room.handler.players[0].board.rand());
  if (['tala', 'samloc'].includes(game)) {
    assert.deepEqual(restored.handler.game.players, room.handler.game.players);
    assert.equal(restored.handler.fair.ref, restored.handler.game.initialDeck);
  }
  if (game === 'wordguess') assert.equal(restored.handler.game.secret, room.handler.game.secret);
  resumeRoom(restored);
  t.after(() => restored.handler.dispose());
});

test('encrypted snapshots authenticate contents and preserve RNG progress', () => {
  const key = encryptionKey('ab'.repeat(32));
  const random = rng(123);
  for (let i = 0; i < 100; i++) random();
  const copy = unpack(decrypt(encrypt(pack({ random }), key), key));
  assert.equal(copy.random(), random());
  const encrypted = encrypt(pack({ secret: 'private cards' }), key);
  assert.ok(!encrypted.includes('private cards'));
  assert.throws(() => decrypt(encrypted, encryptionKey('cd'.repeat(32))));
  assert.throws(() => encryptionKey('short'));
});

test('expired duel clocks end the restored game instead of granting a fresh clock', async (t) => {
  const { room } = started(t, 'caro');
  room.handler.dispose();
  room.handler.clocks.x = 1;
  room.handler.turnStart = Date.now() - 1000;
  resumeRoom(room);
  await wait(100);
  assert.equal(room.handler.status, 'over');
  assert.equal(room.handler.result.reason, 'timeout');
});
