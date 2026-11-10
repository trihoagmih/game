import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { BANK, TwisterHandler } from '../src/games/twister.js';

const room = { ownerId: 'a', system() {}, changed() {} };

/** Bàn 4 người: a, c vào Đội Lúa Nếp; b, d vào Đội Bưởi Chua (tự chia đều khi ngồi). */
function setup(t: TestContext, options: Record<string, unknown> = {}, ids = ['a', 'b', 'c', 'd']) {
  const g = new TwisterHandler(room, { rounds: 1, ...options });
  t.after(() => g.dispose());
  for (const id of ids) g.sit({ id, name: id.toUpperCase() });
  for (const id of ids.slice(1)) g.action(id, { type: 'ready' });
  g.action('a', { type: 'start' });
  return g;
}
const cur = (g: TwisterHandler) => {
  assert.ok(g.current, 'đang có lượt đọc');
  return g.current;
};

test('bộ câu có sẵn đủ cả ba độ khó và không trùng', () => {
  for (const level of [1, 2, 3]) assert.ok(BANK.filter((x) => x.l === level).length >= 20, `độ khó ${level}`);
  assert.equal(new Set(BANK.map((x) => x.t)).size, BANK.length);
  assert.ok(BANK.some((x) => x.lang === 'en'), 'có câu tiếng Anh');
});

test('tùy chọn phòng được chuẩn hóa, chia đội đều và đổi đội trước khi chơi', (t) => {
  const g = new TwisterHandler(room, { maxSeats: 99, rounds: -3, readSeconds: 'x', difficulty: 'evil' });
  t.after(() => g.dispose());
  assert.deepEqual(g.options, { maxSeats: 12, rounds: 1, readSeconds: 20, difficulty: 'mix' });
  g.sit({ id: 'a', name: 'A' });
  g.sit({ id: 'b', name: 'B' });
  g.sit({ id: 'c', name: 'C' }, 1);
  assert.deepEqual(g.seats.map((s) => s.team), [0, 1, 1]);
  assert.throws(() => g.action('z', { type: 'twisterTeam', team: 0 }), /xem/);
  // @ts-expect-error đội do client gửi có thể sai kiểu
  assert.throws(() => g.action('a', { type: 'twisterTeam', team: 5 }), /không hợp lệ/);
  g.action('b', { type: 'twisterTeam', team: 0 });
  g.action('c', { type: 'twisterTeam', team: 0 });
  g.action('b', { type: 'ready' });
  g.action('c', { type: 'ready' });
  assert.throws(() => g.action('a', { type: 'start' }), /Mỗi đội/);
  g.action('c', { type: 'twisterTeam', team: 1 });
  g.action('a', { type: 'start' });
  assert.equal(g.status, 'playing');
  assert.throws(() => g.action('c', { type: 'twisterTeam', team: 0 }), /đang diễn ra/);
});

test('chỉ người đọc báo xong; người nghe chấm, đa số quyết định và đội được cộng điểm theo độ khó', (t) => {
  const g = setup(t);
  assert.equal(g.totalTurns, 4);
  const first = cur(g);
  assert.equal(first.readerId, 'a', 'đội mở màn ván đầu là Đội Lúa Nếp, người ngồi trước đọc trước');
  assert.equal(first.phase, 'read');
  assert.equal(g.view('b').current?.lang, BANK[first.line].lang ?? 'vi');
  assert.throws(() => g.action('b', { type: 'next' }), /lượt bạn/);
  assert.throws(() => g.action('a', { type: 'twisterVote', verdict: 'clean', turn: g.turnNo }), /tự chấm/);
  assert.throws(() => g.action('z', { type: 'twisterVote', verdict: 'clean', turn: g.turnNo }), /không chơi/);
  assert.throws(() => g.action('b', { type: 'twisterVote', verdict: 'clean', turn: g.turnNo - 1 }), /đã qua/);
  // @ts-expect-error phiếu do client gửi có thể sai kiểu
  assert.throws(() => g.action('b', { type: 'twisterVote', verdict: 'perfect', turn: g.turnNo }), /không hợp lệ/);
  // Nghe vấp là chấm luôn, chưa ai biết người khác chấm gì
  g.action('b', { type: 'twisterVote', verdict: 'slip', turn: g.turnNo });
  assert.deepEqual(g.view('c').current?.voted, ['b']);
  assert.equal(g.view('c').current?.myVote, null);
  assert.equal(g.view('b').current?.myVote, 'slip');
  g.action('a', { type: 'next' });
  assert.equal(cur(g).phase, 'judge');
  assert.throws(() => g.action('a', { type: 'next' }), /đã xong/);
  g.action('c', { type: 'twisterVote', verdict: 'clean', turn: g.turnNo });
  g.action('d', { type: 'twisterVote', verdict: 'clean', turn: g.turnNo });
  assert.equal(cur(g).phase, 'result', 'đủ phiếu thì chấm ngay');
  const outcome = cur(g).outcome;
  assert.ok(outcome);
  assert.deepEqual([outcome.outcome, outcome.clean, outcome.slip], ['clean', 2, 1]);
  assert.equal(outcome.points, first.level);
  assert.deepEqual(g.scores, [first.level, 0]);

  g._onTimeout();
  const second = cur(g);
  assert.equal(second.readerId, 'b', 'đến lượt đội kia');
  assert.equal(second.phase, 'read');
  g.action('b', { type: 'pass' });
  assert.equal(cur(g).outcome?.outcome, 'skip');
  assert.deepEqual(g.scores, [first.level, 0]);
  g._onTimeout();
  assert.equal(cur(g).readerId, 'c');
  g._onTimeout(); // hết giờ đọc → chấm
  g._onTimeout(); // hết giờ chấm, không ai chấm → coi là chuẩn
  assert.equal(cur(g).outcome?.outcome, 'clean');
  g._onTimeout();
  assert.equal(cur(g).readerId, 'd');
  g.action('a', { type: 'twisterVote', verdict: 'slip', turn: g.turnNo });
  g.action('b', { type: 'twisterVote', verdict: 'slip', turn: g.turnNo });
  g.action('c', { type: 'twisterVote', verdict: 'slip', turn: g.turnNo });
  g.action('d', { type: 'next' });
  assert.equal(cur(g).outcome?.outcome, 'slip', 'mọi người đã chấm khi đang nghe thì chốt luôn');
  g._onTimeout();
  assert.equal(g.status, 'over');
  assert.equal(g.current, null);
  assert.equal(g.timer, null);
  assert.equal(g.result?.winner, 0);
  assert.deepEqual(g.wins, [1, 0]);
  assert.equal(g.log.length, 4);
  assert.deepEqual(g.players.map((p) => [p.reads, p.clean]), [[1, 1], [1, 0], [1, 1], [1, 0]]);
});

test('người đọc rời bàn thì bỏ lượt; một đội hết người thì đội kia thắng', (t) => {
  const g = setup(t);
  assert.equal(cur(g).readerId, 'a');
  g.stand('a');
  assert.equal(cur(g).outcome?.outcome, 'skip');
  assert.equal(g.status, 'playing');
  g._onTimeout();
  assert.equal(cur(g).readerId, 'b');
  g.action('c', { type: 'twisterVote', verdict: 'clean', turn: g.turnNo });
  g.action('b', { type: 'next' });
  assert.equal(cur(g).phase, 'judge');
  g.stand('d');
  assert.equal(cur(g).phase, 'result', 'người chưa chấm rời đi thì đủ phiếu');
  g.stand('c');
  assert.equal(g.status, 'over');
  assert.equal(g.result?.reason, 'forfeit');
  assert.equal(g.result?.winner, 1);
});

test('ván sau đổi đội mở màn; chủ phòng dừng được ván', (t) => {
  const g = setup(t, {}, ['a', 'b']);
  g.action('a', { type: 'stop' });
  assert.equal(g.status, 'over');
  assert.equal(g.result?.winner, null);
  g.action('b', { type: 'ready' });
  g.action('a', { type: 'start' });
  assert.equal(cur(g).readerId, 'b');
  assert.throws(() => g.action('b', { type: 'stop' }), /chủ phòng/);
});
