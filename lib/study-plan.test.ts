import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STUDY_PLAN, parseScopeRef, sanitizeStudyPlan, studyActivity } from './study-plan';

test('기본 설계는 7단계이고 모든 활동이 카탈로그에 있다', () => {
  assert.equal(DEFAULT_STUDY_PLAN.steps.length, 7);
  for (const s of DEFAULT_STUDY_PLAN.steps) for (const k of s.items) assert.ok(studyActivity(k), k);
  assert.deepEqual(sanitizeStudyPlan(DEFAULT_STUDY_PLAN)?.steps, DEFAULT_STUDY_PLAN.steps);
});

test('sanitizeStudyPlan: 모르는 활동·빈 단계·중복 id 정리', () => {
  const p = sanitizeStudyPlan({
    name: '',
    steps: [
      { id: 'a', title: '어휘', items: ['q-어휘', 'q-어휘', 'nope'] },
      { id: 'a', title: '영작', items: ['lesson-write-en'] },
      { id: 'b', title: '빈 단계', items: ['nope'] },
      { title: '', items: ['q-어법'] },
    ],
  });
  assert.deepEqual(p, {
    name: '내 기본 플랜',
    steps: [
      { id: 'a', title: '어휘', items: ['q-어휘'] },
      { id: 'ax', title: '영작', items: ['lesson-write-en'] },
    ],
  });
  assert.equal(sanitizeStudyPlan({ steps: [] }), null);
});

test('parseScopeRef', () => {
  assert.deepEqual(parseScopeRef('preset:6a21aa53ea123411556b630e'), { kind: 'preset', id: '6a21aa53ea123411556b630e' });
  assert.equal(parseScopeRef('order:6a21aa53ea123411556b630e'), null);
  assert.equal(parseScopeRef(null), null);
});
