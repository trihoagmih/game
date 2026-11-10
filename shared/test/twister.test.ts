import test from 'node:test';
import assert from 'node:assert/strict';
import { levelFor, parseBank, pickLine, smallerTeam, tally, teamAt, turnsPerTeam } from '../src/twister.js';
import type { TwisterLine } from '../src/twister.js';

test('hai đội thay phiên, đội mở màn đổi được; mỗi đội có số lượt bằng nhau', () => {
  assert.deepEqual([0, 1, 2, 3].map((t) => teamAt(t, 0)), [0, 1, 0, 1]);
  assert.deepEqual([0, 1, 2, 3].map((t) => teamAt(t, 1)), [1, 0, 1, 0]);
  assert.equal(turnsPerTeam(2, [3, 1]), 6, 'đội đông nhất: mỗi người đọc đủ số vòng');
  assert.equal(turnsPerTeam(1, [0, 0]), 1);
  assert.equal(smallerTeam([]), 0);
  assert.equal(smallerTeam([0]), 1);
  assert.equal(smallerTeam([0, 1]), 0);
  assert.equal(smallerTeam([1, 1, 0]), 0);
});

test('chấm theo đa số, hòa phiếu hoặc không ai chấm thì tính đọc chuẩn', () => {
  assert.deepEqual(tally(['clean', 'slip', 'slip']), { clean: 1, slip: 2, verdict: 'slip' });
  assert.equal(tally(['clean', 'slip']).verdict, 'clean');
  assert.equal(tally([]).verdict, 'clean');
});

test('độ khó: tăng dần chia ba chặng, chế độ dễ / khó giữ đúng mức', () => {
  assert.deepEqual([0, 2, 3, 5, 6, 8].map((t) => levelFor('mix', t, 9)), [1, 1, 2, 2, 3, 3]);
  assert.ok([0, 1, 2, 3, 4].every((t) => levelFor('easy', t, 5) === 1));
  assert.ok([0, 1, 2, 3, 4].every((t) => levelFor('hard', t, 5) >= 2));
});

test('chọn câu đúng độ khó, không lặp cho tới khi dùng hết', () => {
  const bank: TwisterLine[] = [{ t: 'a', l: 1 }, { t: 'b', l: 2 }, { t: 'c', l: 2 }, { t: 'd', l: 3 }];
  const used = new Set<number>();
  const first = pickLine(bank, 2, used, () => 0);
  used.add(first);
  const second = pickLine(bank, 2, used, () => 0);
  assert.notEqual(first, second);
  assert.deepEqual([first, second].map((i) => bank[i].l), [2, 2]);
  used.add(second);
  assert.equal(bank[pickLine(bank, 2, used, () => 0)].l, 2, 'hết câu mới thì dùng lại câu cùng độ khó');
});

test('bộ câu sai định dạng bị từ chối', () => {
  assert.deepEqual(parseBank([{ t: ' Nồi đồng nấu ốc ', l: 1, x: 2 }]), [{ t: 'Nồi đồng nấu ốc', l: 1, x: 2 }]);
  for (const bad of [[], {}, [{ t: '', l: 1 }], [{ t: 'a', l: 4 }], [{ t: 'a', l: 1, x: 0 }], [null]]) {
    assert.throws(() => parseBank(bad));
  }
});
