import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { GameAction } from '@game/shared/contracts';
import { HEIGHT, WIDTH, pieceCells, TetrisBoard } from '@game/shared/tetris';
import { TetrisHandler } from '../src/games/tetris.js';

const room = { ownerId: 'a', isOnline: () => true, system() {}, changed() {} };
const players = [{ id: 'a', name: 'An' }, { id: 'b', name: 'Bình' }];

function race(t: TestContext, options: Record<string, unknown>) {
  const game = new TetrisHandler(room, options);
  t.after(() => game.dispose());
  players.forEach((p) => game.sit(p));
  assert.throws(() => game.action('a', { type: 'start' }), /sẵn sàng/);
  assert.equal(game.status, 'waiting');
  game.action('b', { type: 'ready' });
  assert.throws(() => game.action('b', { type: 'start' }), /chủ phòng/);
  game.action('a', { type: 'start' });
  assert.equal(game.status, 'playing');
  return game;
}

test('Tetris counts every row of a multi-line clear and settles the board', () => {
  const board = new TetrisBoard(['O', 'O', 'O']);
  board.grid[HEIGHT - 3] = 'J' + '.'.repeat(WIDTH - 1);
  board.grid[HEIGHT - 2] = 'IIII..IIII';
  board.grid[HEIGHT - 1] = 'IIII..IIII';
  assert.equal(board.move(-5, 0), false);
  assert.equal(board.landing()?.y, HEIGHT - 2);
  board.drop();
  assert.equal(board.lines, 2);
  assert.equal(board.grid.length, HEIGHT);
  assert.equal(board.grid[HEIGHT - 1], 'J.........');
  assert.equal(board.grid[0], '..........');
  assert.equal(board.piece?.y, 0);
});

test('Tetris validates the room target, gates input and gives the win on a server-side clear', (t) => {
  for (const targetLines of [0, 101, 1.5, true, {}]) {
    assert.throws(() => new TetrisHandler(room, { targetLines }), /số nguyên/);
  }
  const game = race(t, { targetLines: '1' });
  const [a, b] = game.boards;
  assert.ok(a && b && game.round);
  assert.equal(a.pieces, b.pieces);
  assert.equal(new Set(a.pieces.slice(0, 7)).size, 7);
  const drop = { type: 'tetrisInput', input: 'drop', round: game.round } as const;
  assert.throws(() => game.action('watcher', drop), /chế độ xem/);
  game.action('a', drop);
  assert.equal(a.index, 0);
  game.startsAt = 0;
  game.action('a', { ...drop, round: 'previous round' });
  assert.equal(a.index, 0);
  const forged = { type: 'tetrisInput', input: 'left', round: game.round, lines: 100 } satisfies GameAction & { lines: number };
  game.action('a', forged);
  assert.equal(a.lines, 0);
  assert.ok(a.piece && b.piece && b.piece.x > a.piece.x);

  // Fill both bottom rows except for the square's landing columns.
  a.piece = { kind: 'O', x: 4, y: 0, rotation: 0 };
  a.grid[HEIGHT - 2] = 'IIII..IIII';
  a.grid[HEIGHT - 1] = 'IIII..IIII';
  game.lastInput[0] = -Infinity;
  game.action('a', drop);
  assert.equal(a.lines, 2);
  assert.equal(game.status, 'over');
  assert.equal(game.view('b').result?.winnerId, 'a');
  assert.equal(game.timer, null);
  game.action('b', drop);
  assert.equal(b.index, 0);

  game.action('b', { type: 'ready' });
  game.action('a', { type: 'start' });
  assert.notEqual(game.round, drop.round);
  assert.deepEqual(game.boards.map((board) => board?.lines), [0, 0]);
});

test('Tetris ends on a blocked spawn or when a player leaves', (t) => {
  const game = race(t, {});
  const [a] = game.boards;
  assert.ok(a?.piece && game.round);
  const next = a.pieces[1];
  const [[x, y]] = pieceCells({ kind: next, x: next === 'O' ? 4 : 3 });
  // Force the active piece to be clear of the spawn area.
  a.piece = { ...a.piece, y: 10 };
  a.grid[y] = '.'.repeat(x) + 'J' + '.'.repeat(WIDTH - x - 1);
  game.startsAt = 0;
  game.action('a', { type: 'tetrisInput', input: 'drop', round: game.round });
  assert.equal(a.toppedOut, true);
  assert.equal(game.view('a').result?.winnerId, 'b');
  game.action('b', { type: 'ready' });
  game.action('a', { type: 'start' });
  game.onLeave('b');
  assert.equal(game.view('a').result?.winnerId, 'a');
  assert.deepEqual(game.playerIds(), ['a']);
  assert.equal(game.timer, null);
});
