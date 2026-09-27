/** 교과서 키 표시 이름 — `npm run test:unit` */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyTextbookName, gyogwaseoDisplay, gyogwaseoSectionOf, parseGyogwaseoKey } from './gyogwaseo-key';

test('과목 · 출판사 · 저자로 나눈다', () => {
  const d = gyogwaseoDisplay('공통영어2_YBM박준언');
  assert.deepEqual([d.subject, d.publisher, d.author, d.extra], ['공통영어2', 'YBM', '박준언', '']);
  assert.equal(d.label, '공통영어2 · YBM · 박준언');
});

test('저자 뒤 내부 꼬리표는 따로 떼어 읽는 말로 — 비슷한 두 교재가 같은 이름이 되지 않는다', () => {
  const a = gyogwaseoDisplay('공통영어2_YBM박준언');
  const b = gyogwaseoDisplay('공통영어2_YBM박준언_변형문제_강별');
  assert.equal(b.author, '박준언');
  assert.equal(b.extra, '변형문제 강별');
  assert.notEqual(a.label, b.label);
});

test('긴 출판사 이름을 먼저 맞춘다 (천재교과서 ≠ 천재 + 교과서…)', () => {
  assert.equal(parseGyogwaseoKey('영어I_천재교과서홍길동').publisher, '천재교과서');
  assert.equal(parseGyogwaseoKey('영어I_천재교육홍길동').publisher, '천재교육');
});

test('모르는 출판사는 표시 이름에서 빠지고 저자로 남는다', () => {
  const d = gyogwaseoDisplay('영어_어느출판사');
  assert.equal(d.publisher, '');
  assert.equal(d.label, '영어 · 어느출판사');
});

test('미디어영어는 과목 칩에서 기타로 모은다', () => {
  assert.equal(gyogwaseoSectionOf('미디어영어_YBM누구'), '기타');
  assert.equal(gyogwaseoSectionOf('공통영어1_NE능률민병천'), '공통영어1');
});

test('화면용 이름 — 알아보는 교과서 키만 바꾸고 나머지는 그대로', () => {
  assert.equal(friendlyTextbookName('공통영어1_NE능률민병천'), '공통영어1 · NE능률 · 민병천');
  assert.equal(friendlyTextbookName('수능특강 영어'), '수능특강 영어');
  assert.equal(friendlyTextbookName('어떤교재_부록'), '어떤교재_부록');
});
