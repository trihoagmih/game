import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { Lobby } from '../src/lobby.js';
import { GAMES, isGame } from '../src/games/index.js';
import type { GameId } from '../src/games/index.js';
import type { GameHandler } from '../src/games/types.js';
import { ReadyGate } from '../src/games/ready.js';
import { CaroHandler } from '../src/games/caro.js';
import { OnetHandler } from '../src/games/onet.js';
import { PokerHandler } from '../src/games/poker.js';
import { SamLocHandler } from '../src/games/samloc.js';
import { SnakeHandler } from '../src/games/snake.js';
import { TetrisHandler } from '../src/games/tetris.js';
import { TwisterHandler } from '../src/games/twister.js';
import { RaceHandler } from '../src/games/race.js';
import { ChickenGame } from '@game/shared/chicken';
import { SkyhopGame } from '@game/shared/skyhop';
import { TalaHandler } from '../src/games/tala.js';
import { WordChainHandler } from '../src/games/wordchain.js';
import { WordGuessHandler } from '../src/games/wordguess.js';
import { pack, unpack, encrypt, decrypt, encryptionKey } from '../src/snapshot.js';
import { resumeRoom } from '../src/resumeRoom.js';
import { rng } from '@game/shared/onet';

const io = { to: () => ({ emit() {} }) };

/** Cặp handler gốc / khôi phục khi cả hai là trò `Class`, để so trạng thái riêng của trò đó. */
function pair<T>(Class: abstract new (...args: never[]) => T, a: GameHandler, b: GameHandler): [T, T] | null {
  return a instanceof Class && b instanceof Class ? [a, b] : null;
}
/** Trường tùy chọn của handler (timer, game…) mà không phải trò nào cũng có. */
const field = (h: object, key: string): unknown => (key in h ? (h as Record<string, unknown>)[key] : undefined);

function started(t: import('node:test').TestContext, game: GameId) {
  const lobby = new Lobby(io as unknown as ConstructorParameters<typeof Lobby>[0]);
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
  if (game === 'tetris') users.forEach((user) => user.sockets.add(user.id));
  room.handler.action(owner.id, { type: game === 'chess' ? 'ready' : 'start' });
  const h = room.handler;
  if (h instanceof PokerHandler) { clearTimeout(h.nextHandTimer ?? undefined); h.nextHandTimer = null; h.game.startHand(); h._afterChange(); }
  t.after(() => room.handler.dispose());
  return { lobby, room, users };
}

for (const game of Object.keys(GAMES).filter(isGame)) test(`${game}: snapshot restores active game prototypes, private state and timers`, (t) => {
  const { lobby, room, users } = started(t, game);
  // Track commitments before snapshot, as normal views do.
  room.viewFor(users[0].id);
  const restored = unpack<typeof room>(pack(room));
  restored.lobby = lobby;
  restored.handler.room = restored;
  const gate = field(restored.handler, 'ready');
  if (gate instanceof ReadyGate) gate.room = restored;
  assert.equal(restored.game, game);
  assert.equal(restored.handler.constructor, room.handler.constructor);
  assert.equal(restored.handler.isPlaying(), room.handler.isPlaying());
  assert.deepEqual(restored.handler.playerIds(), room.handler.playerIds());
  if ('timer' in room.handler) assert.equal(field(restored.handler, 'timer'), null);
  const poker = pair(PokerHandler, room.handler, restored.handler);
  if (poker) assert.deepEqual(poker[1].game.hand, poker[0].game.hand);
  assert.doesNotThrow(() => restored.viewFor(users[0].id));
  const original = field(room.handler, 'game');
  if (original) assert.equal((field(restored.handler, 'game') as object).constructor, original.constructor);
  const chain = pair(WordChainHandler, room.handler, restored.handler);
  if (chain) assert.equal(typeof chain[1].game?.isKnownWord, 'function');
  const onet = pair(OnetHandler, room.handler, restored.handler);
  if (onet) assert.equal(onet[1].players[0].board.rand(), onet[0].players[0].board.rand());
  const snake = pair(SnakeHandler, room.handler, restored.handler);
  if (snake) {
    const [a, b] = [snake[0].players[0].game, snake[1].players[0].game];
    assert.equal(b.rand(), a.rand(), 'mồi tiếp theo giống hệt sau khi khôi phục');
    assert.deepEqual(b.snake, a.snake);
    assert.ok(b.walls instanceof Set && b.walls.size === a.walls.size);
  }
  const tetris = pair(TetrisHandler, room.handler, restored.handler);
  if (tetris) {
    const [original, copy] = tetris;
    assert.deepEqual(copy.view(users[0].id), original.view(users[0].id));
    assert.equal(copy.boards[0]?.pieces, copy.boards[1]?.pieces);
    assert.equal(copy.nextFallAt, original.nextFallAt);
  }
  const twister = pair(TwisterHandler, room.handler, restored.handler);
  if (twister) {
    const [before, after] = twister;
    before.action(users[1].id, { type: 'twisterVote', verdict: 'slip', turn: before.turnNo });
    const again = unpack<typeof room>(pack(room)).handler;
    assert.ok(again instanceof TwisterHandler);
    assert.equal(after.current?.line, before.current?.line, 'câu đang đọc giữ nguyên');
    assert.equal(after.deadline, before.deadline);
    assert.ok(again.current?.votes instanceof Map);
    assert.equal(again.current?.votes.get(users[1].id), 'slip', 'phiếu đã chấm được giữ');
    assert.ok(again.used.has(before.current!.line));
    again.dispose();
  }
  const cards = pair(TalaHandler, room.handler, restored.handler) ?? pair(SamLocHandler, room.handler, restored.handler);
  if (cards) {
    assert.deepEqual(cards[1].game?.players, cards[0].game?.players);
    assert.equal(cards[1].fair.ref, cards[1].game?.initialDeck);
  }
  const race = room.handler instanceof RaceHandler && restored.handler instanceof RaceHandler ? [room.handler, restored.handler] : null;
  if (race) {
    const [before, after] = race;
    assert.equal(after.seed, before.seed);
    assert.equal(after.startAt, before.startAt);
    assert.deepEqual(after.raceView(users[0].id, () => ({})).players, before.raceView(users[0].id, () => ({})).players);
    const [a, b] = [before.players[0].game, after.players[0].game];
    assert.equal(b.constructor, a.constructor);
    if (a instanceof ChickenGame && b instanceof ChickenGame) {
      for (let i = 0; i < 300; i++) { a.step(); b.step(); }
      assert.deepEqual(b.view(), a.view(), 'trứng và gà tiếp tục giống hệt sau recovery');
      assert.equal(b.rand(), a.rand());
    }
    if (a instanceof SkyhopGame && b instanceof SkyhopGame) assert.equal(b.gapCenter(40), a.gapCenter(40), 'dãy khe tiếp tục giống hệt');
  }
  const guess = pair(WordGuessHandler, room.handler, restored.handler);
  if (guess) assert.equal(guess[1].game?.secret, guess[0].game?.secret);
  resumeRoom(restored);
  if (tetris) assert.ok(tetris[1].timer);
  if (twister) assert.ok(twister[1].timer, 'hẹn giờ pha đọc được khôi phục');
  if (race) {
    assert.ok(race[1].watchTimer, 'nhịp server được khôi phục');
    if (game === 'skyhop') assert.equal(race[1].timer, null, 'sinh tồn không có hạn chót');
    else assert.ok(race[1].timer, 'hạn chót ván được khôi phục');
  }
  t.after(() => restored.handler.dispose());
});

test('encrypted snapshots authenticate contents and preserve RNG progress', () => {
  const key = encryptionKey('ab'.repeat(32));
  const random = rng(123);
  for (let i = 0; i < 100; i++) random();
  const copy = unpack<{random: typeof random}>(decrypt(encrypt(pack({ random }), key), key));
  assert.equal(copy.random(), random());
  const encrypted = encrypt(pack({ secret: 'private cards' }), key);
  assert.ok(!encrypted.includes('private cards'));
  assert.throws(() => decrypt(encrypted, encryptionKey('cd'.repeat(32))));
  assert.throws(() => encryptionKey('short'));
});

test('expired duel clocks end the restored game instead of granting a fresh clock', async (t) => {
  const { room } = started(t, 'caro');
  const h = room.handler;
  assert.ok(h instanceof CaroHandler);
  h.dispose();
  h.clocks.x = 1;
  h.turnStart = Date.now() - 1000;
  resumeRoom(room);
  await wait(100);
  assert.equal(h.status, 'over');
  assert.equal(h.result?.reason, 'timeout');
});
