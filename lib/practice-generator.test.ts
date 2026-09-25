/**
 * 학습실 문장 분할·문항 생성 테스트 — `npm run test:practice`
 * (node:test + tsx. 저장소에 테스트 러너가 없어 내장 러너를 쓴다.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateInsert, generateOrder, splitPassageSentences } from './practice-generator';

/** 20년 3월 고1 18번 앞머리 + 이어지는 문장(생성기가 돌 만큼 길게) */
const SPADLER =
  "Dear Ms. Spadler, You've written to our company complaining that your toaster, which you bought only three weeks earlier, doesn't work. " +
  'You were asking for a new toaster or a refund. ' +
  "Since the toaster has a year's warranty, we are happy to replace it. " +
  'Please take the toaster back to the store where you bought it. ' +
  'The store will give you a new one right away. ' +
  'However, you will need to show the receipt to the staff. ' +
  'Thank you for choosing our products. ' +
  'Sincerely, the customer service team.';

test('편지 첫머리 "Dear Ms." 에서 끊지 않는다 (결함: 주어진 글이 "Dear Ms." 한 조각)', () => {
  const s = splitPassageSentences(SPADLER);
  assert.ok(s[0].startsWith("Dear Ms. Spadler, You've written"), s[0]);
  assert.ok(!s.some((x) => x === 'Dear Ms.' || x.startsWith('Spadler')));
  assert.equal(s.length, 8);
});

test('편지 지문으로 만든 순서·삽입 문항에 끊긴 조각이 없다', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const o = generateOrder(splitPassageSentences(SPADLER), seed);
    assert.ok(o && o.kind === '순서');
    assert.ok(o.intro.startsWith('Dear Ms. Spadler'), o.intro);
    for (const c of [o.A, o.B, o.C]) assert.ok(!c.startsWith('Spadler'), c);
    const i = generateInsert(splitPassageSentences(SPADLER), seed);
    assert.ok(i && i.kind === '삽입');
    assert.ok(i.given !== 'Dear Ms.' && !i.given.startsWith('Spadler'), i.given);
  }
});

test('호칭·예시 약어 뒤에서는 끊지 않는다', () => {
  const cases = [
    'Yesterday Mr. Brown met Mrs. Green at the station near St. Paul.',
    'The study by Dr. Kim and Prof. Lee was published last year.',
    'Many cities, e.g. Paris and Rome, are crowded in summer.',
    'Some foods, i.e. Fruits and vegetables, are good for you.',
    'It was the classic case of David vs. Goliath in sports.',
  ];
  for (const c of cases) assert.deepEqual(splitPassageSentences(c), [c]);
});

test('이니셜 이름은 이어 붙인다', () => {
  for (const c of [
    'The philosopher G. A. Cohen provides an example of a camping trip.',
    'This is the last book of J. K. Rowling and it sold well.',
    'Senator John J. Ingalls said it would be common.',
    'The book was written by psychiatrist M. Scott Peck many years ago.',
  ]) assert.deepEqual(splitPassageSentences(c), [c]);
});

test('U.S. 뒤 고유명사는 이어지고, 보통 낱말이면 새 문장', () => {
  assert.deepEqual(splitPassageSentences('She joined the U.S. Navy after college.'), ['She joined the U.S. Navy after college.']);
  assert.deepEqual(splitPassageSentences('Railroads were the biggest companies in the U.S. Having achieved success, they grew.'), [
    'Railroads were the biggest companies in the U.S.',
    'Having achieved success, they grew.',
  ]);
});

test('문장 끝에 온 약어·이니셜은 그대로 끊는다', () => {
  assert.deepEqual(splitPassageSentences('I had to be at the lab at 7 a.m. The bus was late again.'), [
    'I had to be at the lab at 7 a.m.',
    'The bus was late again.',
  ]);
  assert.deepEqual(splitPassageSentences('We sell shoes, bags, hats, etc. Once you visit, you will see.'), [
    'We sell shoes, bags, hats, etc.',
    'Once you visit, you will see.',
  ]);
  assert.deepEqual(splitPassageSentences('Carrots are packed with vitamin A. Generally speaking, people eat too few.'), [
    'Carrots are packed with vitamin A.',
    'Generally speaking, people eat too few.',
  ]);
  assert.deepEqual(splitPassageSentences('It absorbs well with vitamin C. Vegetarians use this trick often.'), [
    'It absorbs well with vitamin C.',
    'Vegetarians use this trick often.',
  ]);
});

test('너무 짧은 첫 조각은 다음 문장에 붙인다', () => {
  assert.deepEqual(splitPassageSentences('Hi. This is a letter about the school festival.'), [
    'Hi. This is a letter about the school festival.',
  ]);
});

test('따옴표 안 대사에서는 끊지 않는다(기존 동작 유지)', () => {
  assert.deepEqual(splitPassageSentences('He shouted, "Stop. Wait for me." Then he ran after the bus.'), [
    'He shouted, "Stop. Wait for me."',
    'Then he ran after the bus.',
  ]);
});

test('이름처럼 보여도 다음이 보통 낱말이면 끊는다', () => {
  assert.deepEqual(splitPassageSentences('There is no word for the English I. Different words are used in different settings.'), [
    'There is no word for the English I.',
    'Different words are used in different settings.',
  ]);
});
