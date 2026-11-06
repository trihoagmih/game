import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWord } from '@game/shared/wordchain';
import { isKnownWord, isValidSyllable } from '../src/games/wordchain.js';

const known = (w) => isKnownWord(parseWord(w));

test('loaded syllable dictionary accepts common Vietnamese syllables on LF and CRLF checkouts', () => {
  for (const syllable of ['con', 'mèo', 'cây', 'học', 'nhà']) assert.ok(isValidSyllable(syllable), syllable);
});

test('từ điển nối từ có các từ ghép thông dụng', () => {
  for (const w of [
    'con mèo', 'con bò', 'con chó', 'con gà', 'con trâu', 'con vịt', 'con lợn',
    'quả cam', 'trái xoài', 'cây dừa', 'hoa hồng', 'cái bàn', 'cái ghế',
    'đạp xe', 'hành lá', 'ăn cơm', 'uống nước', 'con người', 'hòa bình', 'hoà bình',
  ]) assert.ok(known(w), `"${w}" phải có trong từ điển`);
});

test('từ vô nghĩa vẫn bị coi là không có trong từ điển', () => {
  for (const w of ['mèo bàn', 'ghế trâu', 'cơm xoài']) assert.equal(known(w), false, w);
});

test('chỉ mục từ điển: từ cụt và từ mở đầu dễ nối', async () => {
  const { dictionary } = await import('../src/games/wordchain.js');
  const { syllableKey, FIRST_MIN_NEXT } = await import('@game/shared/wordchain');
  assert.equal(dictionary.countNext(syllableKey('chuôm')), 0, '"ao chuôm" là từ cụt');
  for (const s of ['cay', 'con', 'học', 'nhà']) assert.ok(dictionary.countNext(syllableKey(s)) >= FIRST_MIN_NEXT, s);
  assert.equal(dictionary.has(parseWord('ad hoc')), false, 'bỏ mục không phải tiếng Việt');
});
