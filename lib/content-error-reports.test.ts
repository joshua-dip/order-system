import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeErrorReportInput } from './content-error-reports';

const pid = '6a21aa53ea123411556b630e';

test('오류 신고 입력: 정상', () => {
  const r = normalizeErrorReportInput({ passageId: pid, sentenceIndex: 2, kind: '해석', message: ' 해석이 반대예요 ' });
  assert.deepEqual(r, { ok: true, value: { passageId: pid, sentenceIndex: 2, kind: '해석', message: '해석이 반대예요' } });
});

test('오류 신고 입력: 모르는 종류는 기타, 짧은 내용·잘못된 지문은 거절', () => {
  const r = normalizeErrorReportInput({ passageId: pid, kind: '??', message: '오타 있음' });
  assert.equal(r.ok && r.value.kind, '기타');
  assert.equal(normalizeErrorReportInput({ passageId: pid, message: 'a' }).ok, false);
  assert.equal(normalizeErrorReportInput({ passageId: 'x', message: '오타 있음' }).ok, false);
});
