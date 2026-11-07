import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGame, replay, mazeWalls, MAZES, W, H, START_LEN, BONUS_EVERY } from '../src/snake.js';

test('khởi đầu: rắn dài START_LEN đốt, đi sang phải, mồi không đè lên rắn/tường, xuất phát không đụng tường', () => {
  for (const maze of MAZES) {
    const g = new SnakeGame({ seed: 7, maze, level: 9 });
    assert.equal(g.length, START_LEN);
    assert.equal(g.dir, 'right');
    assert.ok(!g.snake.includes(g.food) && !g.walls.has(g.food));
    for (const c of g.snake) assert.ok(!g.walls.has(c), maze);
    // Đi thẳng ít nhất 4 bước vẫn sống
    for (let i = 0; i < 4; i++) g.step();
    assert.ok(g.alive, maze);
  }
});

test('không quay đầu 180°, hàng đợi tối đa 2 lượt rẽ', () => {
  const g = new SnakeGame({ seed: 1 });
  assert.equal(g.turn('left'), false);
  assert.equal(g.turn('right'), false);
  assert.equal(g.turn('up'), true);
  assert.equal(g.turn('down'), false); // ngược với lượt chờ
  assert.equal(g.turn('left'), true);
  assert.equal(g.turn('down'), false); // đầy hàng đợi
  g.step();
  assert.equal(g.dir, 'up');
  g.step();
  assert.equal(g.dir, 'left');
});

test('không tường thì đi xuyên mép; hộp kín thì đụng tường là chết', () => {
  const a = new SnakeGame({ seed: 3, maze: 'none' });
  a.food = 0; // đặt mồi ở góc, ngoài đường đi
  for (let i = 0; i < W; i++) a.step();
  assert.ok(a.alive);
  assert.equal(a.head % W, (START_LEN + 1 + W) % W);
  const b = new SnakeGame({ seed: 3, maze: 'box' });
  b.food = 0; // đặt mồi ở góc, ngoài đường đi
  let ev;
  for (let i = 0; i < W && b.alive; i++) ev = b.step();
  assert.equal(ev, 'die');
  assert.ok(b.walls.has(b.next(b.head, 'right')));
});

test('ăn mồi: dài thêm, điểm = cấp; mỗi 5 mồi hiện con thưởng 2 ô', () => {
  const g = new SnakeGame({ seed: 5, level: 4 });
  for (let n = 1; n <= BONUS_EVERY; n++) {
    g.food = g.next(g.head, g.dir);
    assert.equal(g.step(), 'eat');
    assert.equal(g.length, START_LEN + n);
    assert.equal(g.score, 4 * n);
  }
  assert.ok(g.bonus);
  assert.equal(g.bonus.cells[1], g.bonus.cells[0] + 1);
  const pts = 5 * 4 + Math.ceil(g.bonus.ttl / 2);
  g.bonus.cells = [g.next(g.head, g.dir), -5];
  const before = g.score;
  assert.equal(g.step(), 'bonus');
  assert.equal(g.score - before, pts);
  assert.equal(g.bonus, null);
});

test('cắn vào thân thì chết, nhưng được đi vào ô đuôi vừa rời', () => {
  // Thân nằm ngang, đầu ở cột 6 đi sang phải (dựng tay, không phụ thuộc độ dài xuất phát)
  const line = (n: number) => Array.from({ length: n }, (_, i) => (H - 3) * W + 6 - i);
  const g = new SnakeGame({ seed: 9 });
  g.food = 0; // đặt mồi ở góc, ngoài đường đi
  // Vòng vuông 2×2 với rắn dài 4 → đầu đi đúng vào ô đuôi cũ
  g.snake = line(4);
  g.turn('up'); g.step(); g.turn('left'); g.step(); g.turn('down'); g.step();
  assert.ok(g.alive);
  const h = new SnakeGame({ seed: 9 });
  h.food = 0; // đặt mồi ở góc, ngoài đường đi
  h.snake = line(5);
  h.turn('up'); h.step(); h.turn('left'); h.step(); h.turn('down'); h.step();
  assert.equal(h.alive, false);
});

test('phát lại cùng seed + lượt rẽ cho đúng kết quả như chơi trực tiếp', () => {
  const opts = { seed: 12345, maze: 'rooms', level: 6 };
  const live = new SnakeGame(opts);
  const inputs: import('../src/snake.js').SnakeInput[] = [];
  const r = Math.random;
  const dirs = ['up', 'down', 'left', 'right'] as const;
  for (let t = 0; t < 400 && live.alive; t++) {
    if (r() < 0.25) { const d = dirs[Math.floor(r() * 4)]; if (live.turn(d)) inputs.push([live.tick, d]); }
    live.step();
  }
  const { game } = replay(opts, inputs, live.tick);
  assert.deepEqual(game.snake, live.snake);
  assert.equal(game.score, live.score);
  assert.equal(game.alive, live.alive);
  assert.equal(game.tick, live.tick);
  // Phát lại từng đoạn cũng ra cùng kết quả
  let part = replay(opts, inputs, 37);
  part = replay(opts, inputs, live.tick, part.game, part.used);
  assert.deepEqual(part.game.snake, live.snake);
});

test('mê cung có tường đúng kích thước bàn', () => {
  assert.equal(mazeWalls('none').size, 0);
  assert.equal(mazeWalls('box').size, 2 * W + 2 * H - 4);
  for (const m of MAZES) for (const i of mazeWalls(m)) assert.ok(i >= 0 && i < W * H);
});
