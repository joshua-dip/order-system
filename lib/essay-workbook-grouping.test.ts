/**
 * 서술형 워크북 지문 정렬 — `npm run test:unit`
 * (저장소에 테스트 러너가 없어 node:test + tsx 로 돌린다.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePassageKeys, groupPassages, passageNumberOf } from './essay-workbook-grouping';

/* 2027수능특강 영어 키 모양 — 19강·20강은 「01~02번」처럼 범위 번호만 있다 */
const SUNEUNG = [
  'Test 3 01번',
  '19강 01~02번',
  '20강 01~03번',
  '01강 01번',
  '01강 Gateway',
  '02강 03번',
  '02강 01번',
  '18강 04번',
  '21강 01번',
  'Test 1 01번',
  'Test 2 02번',
  'Test 2 01번',
  '19강 03~04번',
  '20강 04~06번',
  '10강 01번',
  '9강 02번',
];

test('범위 번호는 시작 번호로 읽는다', () => {
  assert.equal(passageNumberOf('19강 01~02번'), 1);
  assert.equal(passageNumberOf('20강 04~06번'), 4);
  assert.equal(passageNumberOf('3강 6-8번'), 6);
  assert.equal(passageNumberOf('01강 Gateway'), 9999);
});

test('일반 강은 숫자 순, Test 는 일반 강 뒤에서 숫자 순 (19·20강이 Test 3 뒤로 밀리지 않는다)', () => {
  const units = groupPassages([...SUNEUNG, ...SUNEUNG.map((k) => `${k} `)].sort(comparePassageKeys), (k) => k)!.map((g) => g.unit);
  assert.deepEqual(units, ['01강', '02강', '9강', '10강', '18강', '19강', '20강', '21강', 'Test 1', 'Test 2', 'Test 3']);
});

test('단원 안에서는 번호 순, 번호 없는 지문(Gateway)은 그 단원 끝', () => {
  const sorted = [...SUNEUNG].sort(comparePassageKeys);
  assert.deepEqual(sorted.slice(0, 2), ['01강 01번', '01강 Gateway']);
  assert.deepEqual(
    sorted.filter((k) => k.startsWith('19강') || k.startsWith('20강')),
    ['19강 01~02번', '19강 03~04번', '20강 01~03번', '20강 04~06번'],
  );
  assert.deepEqual(
    sorted.filter((k) => k.startsWith('Test')),
    ['Test 1 01번', 'Test 2 01번', 'Test 2 02번', 'Test 3 01번'],
  );
});

test('정렬은 키를 바꾸지 않는다 — 같은 원소 집합', () => {
  const sorted = [...SUNEUNG].sort(comparePassageKeys);
  assert.deepEqual([...sorted].sort(), [...SUNEUNG].sort());
});

test('다른 교재 키(Lesson·CHAPTER)도 숫자 순', () => {
  const keys = ['Lesson 10 본문1', 'Lesson 2 본문3', 'Lesson 2 본문1', 'Lesson 1 본문2'];
  assert.deepEqual([...keys].sort(comparePassageKeys), ['Lesson 1 본문2', 'Lesson 2 본문1', 'Lesson 2 본문3', 'Lesson 10 본문1']);
});

test('번호 없는 지문은 이름 속 숫자로 (본문2 < 본문10)', () => {
  assert.deepEqual(['Lesson 1 본문10', 'Lesson 1 본문2'].sort(comparePassageKeys), ['Lesson 1 본문2', 'Lesson 1 본문10']);
});
