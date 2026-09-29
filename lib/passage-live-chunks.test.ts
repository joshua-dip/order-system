import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkSentence, vocabularyBySentence } from './passage-live-chunks';

test('chunkSentence: 단어 i 뒤에서 끊는다', () => {
  const s = 'Dear Readers, Thank you for your continued interest in our magazine.';
  assert.deepEqual(chunkSentence(s, [1, 3, 7]), ['Dear Readers,', 'Thank you', 'for your continued interest', 'in our magazine.']);
});

test('chunkSentence: 끊을 곳이 없거나 범위를 벗어나면 통째로', () => {
  assert.deepEqual(chunkSentence('I am the manager.', undefined), ['I am the manager.']);
  assert.deepEqual(chunkSentence('I am the manager.', [3, 99, -1]), ['I am the manager.']);
});

test('chunkSentence: 겹공백이 있어도 분석기 단어 번호와 맞는다', () => {
  // split(/\s+/) 는 겹공백을 하나로 보므로 단어 번호는 그대로
  assert.deepEqual(chunkSentence('A  b c d', [1]), ['A b', 'c d']);
});

test('vocabularyBySentence: positions 우선, 없으면 문장에서 찾는다', () => {
  const sents = ['The center will reopen.', 'Members love the center.'];
  const v = vocabularyBySentence(sents, [
    { word: 'reopen', meaning: '재개장하다', positions: [{ sentence: 0, position: 3 }] },
    { word: 'center', meaning: '센터' },
    { word: '', meaning: 'x' },
  ]);
  assert.deepEqual(v.map((x) => [x.word, x.sentences]), [['reopen', [0]], ['center', [0, 1]]]);
});
