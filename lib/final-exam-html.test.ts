/** 내신 예비시험지 양식 — `npm run test:unit` */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFinalExamSheetHtml, buildFinalExamAnswerHtml, finalExamHeader, type FinalExamQuestion } from './final-exam-html';
import { displayFinalExamTitle } from './final-exam-title';

const mc = (num: number, question: string, type = '주제'): FinalExamQuestion => ({
  num, type, sourceKey: `UNIT 01 ${num}번`, question, paragraph: 'Some passage text.', options: 'a###b###c###d###e', correctAnswer: '①', explanation: '해설',
});

test('같은 발문이 이어지면 [a~b] 묶음 지시문 하나로, 발문이 다르면 따로', () => {
  const html = buildFinalExamSheetHtml({
    title: 't',
    questions: [mc(1, '다음 글의 주제로 가장 적절한 것은?'), mc(2, '다음 글의 주제로 가장 적절한 것은?'), mc(3, '다음 글의 제목으로 가장 적절한 것은?', '제목')],
  });
  assert.equal((html.match(/class="grp"/g) ?? []).length, 1);
  assert.match(html, /\[1~2\] 다음 글의 주제로/);
  assert.match(html, /<span class="no">3\.<\/span>다음 글의 제목으로/);
});

test('선택형 뒤 서·논술형 구분, 유의 사항 문항 수', () => {
  const sj: FinalExamQuestion = { ...mc(2, '주제를 완성하시오.', '주제완성형'), subjective: true, points: 5, options: '' };
  const html = buildFinalExamSheetHtml({ title: 't', questions: [mc(1, '다음 글의 주제로 가장 적절한 것은?'), sj] });
  assert.ok(html.indexOf('>선택형<') < html.indexOf('>서·논술형<'));
  assert.match(html, /선택형 1문항, 서·논술형 1문항/);
  assert.match(html, /\[5점\]/);
});

test('선택형만 있으면 「고르십시오」(고르고십시오 X)', () => {
  const html = buildFinalExamSheetHtml({ title: 't', questions: [mc(1, 'q')] });
  assert.match(html, /가장 알맞은 답을 하나 고르십시오\./);
  assert.ok(!html.includes('고르고십시오'));
});

test('옛 이름은 화면에서만 새 이름으로 — 회원이 바꾼 이름은 그대로', () => {
  assert.equal(displayFinalExamTitle('파이널 예비 모의고사 (부산진고 · 26.06.29. · 25문항)'), '내신 예비시험지 (부산진고 · 26.06.29. · 25문항)');
  assert.equal(displayFinalExamTitle('부산진고1 기말 1회'), '부산진고1 기말 1회');
});

test('머리글 — 제목 꼬리 (학교 · 날짜 · N문항)는 머리글 칸으로', () => {
  const h = finalExamHeader({ title: '파이널 예비 모의고사 (부산진고 · 26.06.29. · 25문항)', subtitle: '총 25문항', school: '부산진고', scopeSummary: '교과서 1과' });
  assert.equal(h.title, '내신 예비시험지');
  assert.deepEqual(h.right, ['시험 범위', '교과서 1과']);
  assert.ok(h.left.includes('부산진고'));
});

test('정답과 해설 — 번호/정답 표와 출처·고유번호', () => {
  const html = buildFinalExamAnswerHtml({ title: 't', questions: [{ ...mc(1, 'q'), serialNo: 42 }] });
  assert.match(html, /<th>1<\/th>/);
  assert.match(html, /UNIT 01 1번 · V-000042/);
});
