import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogFolders, mockGrade, mockYear, schoolSubject } from './exam-scope-catalog';

test('교과서 과목 이름', () => {
  assert.equal(schoolSubject('공통영어1_NE능률민병천'), '공통영어 1');
  assert.equal(schoolSubject('영어I_YBM박준언'), '영어 1');
  assert.equal(schoolSubject('영어II_천재'), '영어 2');
  assert.equal(schoolSubject('영어독해와작문_능률'), '영어독해와작문');
});

test('모의고사 학년·연도', () => {
  assert.equal(mockGrade('26년 6월 고2 영어모의고사'), '고2');
  assert.equal(mockYear('26년 6월 고2 영어모의고사'), 2026);
  assert.equal(mockGrade('수능_2025'), '고3');
});

test('폴더: 모의고사 학년별 최신순, 교과서 과목별, 부교재는 허용분만', () => {
  const f = buildCatalogFolders({
    allTextbooks: ['25년 3월 고1 영어모의고사', '26년 6월 고1 영어모의고사', '26년 3월 고1 영어모의고사', '공통영어1_동아', '지금필수(2026)', '수능만만'],
    schoolKeys: ['공통영어1_동아'],
    allowedSupplements: ['지금필수(2026)'],
  });
  assert.deepEqual(f.map((x) => x.label), ['고1 모의고사', '공통영어 1', '부교재']);
  assert.deepEqual(f[0].groups.map((g) => [g.label, g.textbooks.map((t) => t.key)]), [
    ['2026년', ['26년 6월 고1 영어모의고사', '26년 3월 고1 영어모의고사']],
    ['2025년', ['25년 3월 고1 영어모의고사']],
  ]);
  assert.deepEqual(f[2].groups[0].textbooks.map((t) => t.key), ['지금필수(2026)']);
  // 관리자(null)는 부교재 전부
  const all = buildCatalogFolders({ allTextbooks: ['지금필수(2026)', '수능만만'], schoolKeys: [], allowedSupplements: null });
  assert.equal(all.find((x) => x.key === 'supplement')?.groups[0].textbooks.length, 2);
});
