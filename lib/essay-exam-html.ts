/**
 * 서술형 출제기 — 시험지 HTML 생성 단일 소스.
 *
 * 웹 라우트 (`app/api/admin/essay-generator/generate/route.ts`) 와 CLI
 * (`scripts/cc-essay-cli.ts`) 가 모두 이 모듈을 import 해서 동일한 HTML
 * 결과를 만들어야 미리보기/저장 불일치가 발생하지 않는다.
 *
 * - `ExamData`        : Claude generation_prompt.md 가 만드는 JSON 스키마
 * - `applyExamMetaOverrides` : 사용자가 지정한 examTitle/schoolName/grade/examSubtitle 적용 (순수)
 * - `buildExamHtml`   : ExamData → HTML 문자열
 * - `buildExamHtmlWithOverrides` : applyExamMetaOverrides → buildExamHtml
 * - `readExamCss`     : assets/exam_kit/styles.css 캐싱 읽기
 */

import fs from 'node:fs';
import path from 'node:path';

// ── 타입 정의 ──────────────────────────────────────────────────────────────────

export interface MetaInfo {
  label: string;
  value: string;
}

export interface StructureRow {
  label: string;
  content: string;
}

export interface GrammarPoint {
  title: string;
  content: string;
}

export interface WordCount {
  total: number;
  words: string[];
  note: string | null;
}

export interface QuestionAnswer {
  text: string;
  structure_analysis?: StructureRow[];
  grammar_points: GrammarPoint[];
  word_count: WordCount;
  intent_title?: string;
  intent_content: string;
}

export interface Question {
  id: string;
  points: number;
  prompt: string;
  conditions: string[];
  bogi: string;
  answer_lines?: number;
  answer: QuestionAnswer;
}

export interface ExamData {
  meta: {
    title: string;
    difficulty?: string;
    subtitle: string;
    answer_subtitle?: string;
    info: MetaInfo[];
  };
  question_set: {
    tag: string;
    instruction: string;
  };
  passage: string;
  questions: Question[];
}

export interface ExamMetaOverrides {
  examTitle?: string;
  schoolName?: string;
  grade?: string;
  examSubtitle?: string;
}

// ── CSS 캐싱 읽기 ──────────────────────────────────────────────────────────────

let cachedCss: string | null = null;

export function readExamCss(): string {
  // 개발 환경에서는 styles.css 변경이 즉시 반영되도록 매번 새로 읽는다.
  if (process.env.NODE_ENV === 'production' && cachedCss != null) return cachedCss;
  const cssPath = path.join(process.cwd(), 'assets/exam_kit/styles.css');
  const content = fs.readFileSync(cssPath, 'utf-8');
  cachedCss = content;
  return content;
}

// ── 문장 구조(SVOC) 인라인 색칠 ────────────────────────────────────────────────
//
// `answer.structure_analysis` 의 각 row 는 `<code>구문</code> — 한국어 설명`
// 형식이라, <code> 안의 구문만 추출해 `answer.text` 에서 위치를 찾고 색칠 span
// 으로 감싼다. 라벨에서 SVOC 종류를 추정해 색을 매핑한다.
//   외곽(가장 긴 매칭) = 파스텔 배경,  내부(중첩) = 색깔 점선 밑줄

export type SvocKind = 'S' | 'V' | 'O' | 'C' | 'M';

export interface ColorizeResult {
  html: string;
  unmatched: { label: string; phrase: string }[];
}

function detectSvocKind(label: string): SvocKind {
  const m = label.match(/\(\s*(S|V|O|C|M|IO|DO|OC)\s*\)/);
  if (m) {
    const k = m[1];
    if (k === 'S') return 'S';
    if (k === 'V') return 'V';
    if (k === 'O' || k === 'IO' || k === 'DO') return 'O';
    if (k === 'C' || k === 'OC') return 'C';
    if (k === 'M') return 'M';
  }
  if (/주어/.test(label)) return 'S';
  if (/동사|술어/.test(label)) return 'V';
  if (/목적어/.test(label)) return 'O';
  if (/보어/.test(label)) return 'C';
  // 부사구·관계절·분사구·동격·양보 등은 모두 수식어(M) 로 본다
  return 'M';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' :
    '&#39;',
  );
}

function stripInlineHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

/**
 * `<code>...</code>` 안의 구문들을 phrase 로 추출.
 * 설명 영역(` — ` 뒤) 의 `<code>` 인용은 의미 설명용이므로 phrase 후보에서 제외.
 * 어떤 `<code>` 도 없으면 phraseArea 전체를 fallback 으로 사용한다.
 */
function extractPhrasesFromContent(content: string): string[] {
  const dashIdx = content.indexOf(' — ');
  const phraseArea = dashIdx > 0 ? content.slice(0, dashIdx) : content;

  const phrases: string[] = [];
  const re = /<code>([\s\S]*?)<\/code>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(phraseArea)) !== null) {
    const phrase = stripInlineHtml(m[1]).trim();
    if (phrase) phrases.push(phrase);
  }
  if (phrases.length === 0) {
    const cleaned = stripInlineHtml(phraseArea).trim();
    if (cleaned) phrases.push(cleaned);
  }
  return phrases;
}

function findAllOccurrences(text: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let from = 0;
  while (from <= text.length - needle.length) {
    const idx = text.indexOf(needle, from);
    if (idx < 0) break;
    out.push(idx);
    from = idx + 1;
  }
  return out;
}

export function colorizeStructure(text: string, rows: StructureRow[]): ColorizeResult {
  const outerKind: (SvocKind | null)[] = new Array(text.length).fill(null);
  const innerKind: (SvocKind | null)[] = new Array(text.length).fill(null);
  const unmatched: { label: string; phrase: string }[] = [];

  type Candidate = { phrase: string; kind: SvocKind; label: string; len: number };
  const candidates: Candidate[] = [];
  for (const row of rows) {
    const kind = detectSvocKind(row.label);
    for (const phrase of extractPhrasesFromContent(row.content)) {
      candidates.push({ phrase, kind, label: row.label, len: phrase.length });
    }
  }
  // 긴 구문이 외곽을 먼저 점유하도록 길이 desc 정렬.
  candidates.sort((a, b) => b.len - a.len);

  for (const cand of candidates) {
    const occurrences = findAllOccurrences(text, cand.phrase);
    if (occurrences.length === 0) {
      unmatched.push({ label: cand.label, phrase: cand.phrase });
      continue;
    }

    // 가장 좋은 위치 선택: outer 가 모두 비어있는 곳 우선 → 모두 채워진 곳(inner) → 일부만 채워진 첫 위치
    let chosen: { idx: number; isInner: boolean } | null = null;
    for (const idx of occurrences) {
      let allEmpty = true;
      for (let i = idx; i < idx + cand.phrase.length; i++) {
        if (outerKind[i] !== null) { allEmpty = false; break; }
      }
      if (allEmpty) { chosen = { idx, isInner: false }; break; }
    }
    if (!chosen) {
      for (const idx of occurrences) {
        let allFilled = true;
        for (let i = idx; i < idx + cand.phrase.length; i++) {
          if (outerKind[i] === null) { allFilled = false; break; }
        }
        if (allFilled) { chosen = { idx, isInner: true }; break; }
      }
    }
    if (!chosen) chosen = { idx: occurrences[0], isInner: true };

    if (chosen.isInner) {
      // 외곽이 같은 kind 로 이미 채워져 있으면 inner 마크는 생략 (중복 시각화 방지).
      let allSameKindOuter = true;
      for (let i = chosen.idx; i < chosen.idx + cand.phrase.length; i++) {
        if (outerKind[i] !== cand.kind) { allSameKindOuter = false; break; }
      }
      if (allSameKindOuter) continue;
      for (let i = chosen.idx; i < chosen.idx + cand.phrase.length; i++) {
        if (innerKind[i] === null) innerKind[i] = cand.kind;
      }
    } else {
      for (let i = chosen.idx; i < chosen.idx + cand.phrase.length; i++) {
        outerKind[i] = cand.kind;
      }
    }
  }

  let html = '';
  let i = 0;
  while (i < text.length) {
    const ok = outerKind[i];
    const ik = innerKind[i];
    let j = i;
    while (j < text.length && outerKind[j] === ok && innerKind[j] === ik) j++;
    const chunk = escapeHtml(text.slice(i, j));
    const classes: string[] = [];
    if (ok) classes.push(`svoc-${ok}`);
    if (ik) classes.push(`svoc-inner-${ik}`);
    html += classes.length > 0
      ? `<span class="${classes.join(' ')}">${chunk}</span>`
      : chunk;
    i = j;
  }

  return { html, unmatched };
}

export function buildSvocLegendHtml(): string {
  return `<div class="svoc-legend">
  <span class="svoc-legend-label">▸ 색상 범례</span>
  <span class="svoc-legend-chip svoc-S">S 주어</span>
  <span class="svoc-legend-chip svoc-V">V 동사</span>
  <span class="svoc-legend-chip svoc-O">O 목적어</span>
  <span class="svoc-legend-chip svoc-C">C 보어</span>
  <span class="svoc-legend-chip svoc-M">M 수식어 · 구 · 절</span>
  <span class="svoc-legend-note">점선 밑줄 = 절·구 안의 SVOC</span>
</div>`;
}

// ── 메타 오버라이드 (순수 함수) ────────────────────────────────────────────────

/**
 * 사용자가 지정한 examTitle/schoolName/grade/examSubtitle 을 ExamData 에 적용.
 * 입력 객체는 변경하지 않고 새 객체를 반환한다.
 *
 * 규칙:
 * - examTitle  : data.meta.title 덮어쓰기 (truthy 일 때만)
 * - examSubtitle : data.meta.subtitle 덮어쓰기 (truthy 일 때만)
 * - schoolName / grade : `[{label, value}]` 로 만들어 data.meta.info 앞에 삽입
 */
export function applyExamMetaOverrides(
  data: ExamData,
  overrides: ExamMetaOverrides = {},
): ExamData {
  const { examTitle, schoolName, grade, examSubtitle } = overrides;

  const extraInfo: MetaInfo[] = [];
  if (schoolName && schoolName.trim()) extraInfo.push({ label: '학교', value: schoolName.trim() });
  if (grade && grade.trim()) extraInfo.push({ label: '학년', value: grade.trim() });

  const nextMeta = { ...data.meta };
  if (examTitle && examTitle.trim()) nextMeta.title = examTitle.trim();
  if (examSubtitle && examSubtitle.trim()) nextMeta.subtitle = examSubtitle.trim();
  if (extraInfo.length > 0) {
    nextMeta.info = [...extraInfo, ...(data.meta.info ?? [])];
  } else {
    nextMeta.info = [...(data.meta.info ?? [])];
  }

  return {
    ...data,
    meta: nextMeta,
  };
}

// ── HTML 생성 (Jinja2 템플릿 → JS 변환) ────────────────────────────────────────

export function buildExamHtml(data: ExamData, css: string): string {
  const diffBadge = data.meta.difficulty
    ? `<span class="diff-badge">${data.meta.difficulty}</span>`
    : '';

  const metaSpans = data.meta.info
    .map(item => `<span><b>${item.label}</b>${item.value}</span>`)
    .join('\n    ');

  const questionsHtml = data.questions
    .map(q => {
      const condList = q.conditions.map(c => `<li>${c}</li>`).join('\n      ');
      /* 학생용 Answer: 밑줄(작성 줄)은 항상 2줄만 */
      const writeRows = Array.from({ length: 2 }, () => '<div class="write-row"></div>').join('\n    ');
      return `<div class="sub-q">
  <div class="sub-q-title">${q.id}) ${q.prompt} <span class="points">[${q.points}점]</span></div>
  <div class="condition-box">
    <div class="label">▸ 조건</div>
    <ul>
      ${condList}
    </ul>
    <div class="label">▸ 보기</div>
    <div class="bogi">${q.bogi}</div>
  </div>
  <div class="ans-area">
    <div class="lbl">Answer:</div>
    ${writeRows}
  </div>
</div>`;
    })
    .join('\n\n');

  const ansBlocksHtml = data.questions
    .map(q => {
      // 문장 구조(SVOC) → 정답 문장에 인라인 색칠. (기존 표는 제거)
      const rows = q.answer.structure_analysis ?? [];
      const colorized = rows.length > 0
        ? colorizeStructure(q.answer.text, rows)
        : { html: escapeHtml(q.answer.text), unmatched: [] as { label: string; phrase: string }[] };
      const answerHtml = colorized.html;
      const unmatchedHtml = colorized.unmatched.length > 0
        ? `<div class="svoc-unmatched">※ 색칠 매칭 실패 ${colorized.unmatched.length}건 — ${
            colorized.unmatched.map(u => `<b>${u.label}</b> "${escapeHtml(u.phrase)}"`).join(' / ')
          }</div>`
        : '';

      const grammarHtml = `<div class="ans-section">
    <span class="sec-title">▸ 문법 포인트</span>
    <table class="ans-table">
      ${q.answer.grammar_points
        .map(pt => `<tr><th>${pt.title}</th><td>${pt.content}</td></tr>`)
        .join('\n      ')}
    </table>
  </div>`;

      const wordDisplay = q.answer.word_count.words
        .map((w, i) => `${w}(${i + 1})`)
        .join(' / ');
      const noteHtml = q.answer.word_count.note
        ? `&nbsp;&nbsp;※ ${q.answer.word_count.note}`
        : '';
      const wordCountHtml = `<div class="ans-section">
    <span class="sec-title">▸ 단어 수 검증 (총 ${q.answer.word_count.total}개)</span>
    <div class="word-count">${wordDisplay} <b>✓</b>${noteHtml}</div>
  </div>`;

      const intentTitle = q.answer.intent_title ?? '출제 의도 · 감점 포인트';
      const intentHtml = `<div class="ans-section">
    <span class="sec-title">▸ ${intentTitle}</span>
    ${q.answer.intent_content}
  </div>`;

      return `<div class="ans-block">
  <div class="ans-q-tag">${q.id}) [${q.points}점]</div>
  <div class="ans-answer">${answerHtml}</div>
  ${unmatchedHtml}
  ${grammarHtml}
  ${wordCountHtml}
  ${intentHtml}
</div>`;
    })
    .join('\n\n');

  // 정답지 헤더 바로 아래에 SVOC 색상 범례를 한 줄 표시.
  const svocLegendHtml = data.questions.some(q => (q.answer.structure_analysis ?? []).length > 0)
    ? buildSvocLegendHtml()
    : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<style>
${css}
</style>
</head>
<body>

<div class="header">
  <div class="header-row">
    <div class="title">${data.meta.title} ${diffBadge}</div>
    <div class="subtitle">${data.meta.subtitle}</div>
  </div>
  <div class="meta">
    ${metaSpans}
  </div>
</div>

<div class="q-head">
  <span class="tag">${data.question_set.tag}</span>${data.question_set.instruction}
</div>

<div class="passage">
${data.passage}
</div>

${questionsHtml}

<div class="page-break"></div>

<div class="answer-header">
  <div class="h-title">정답 및 해설</div>
  <div class="h-sub">${data.meta.answer_subtitle ?? ''}</div>
</div>

${svocLegendHtml}

${ansBlocksHtml}

</body>
</html>`;
}

/**
 * applyExamMetaOverrides → buildExamHtml 콤보.
 * route.ts 와 CLI 가 같은 분기를 쓰도록 단일 진입점으로 둔다.
 */
export function buildExamHtmlWithOverrides(
  data: ExamData,
  overrides: ExamMetaOverrides,
  css: string,
): { data: ExamData; html: string } {
  const finalData = applyExamMetaOverrides(data, overrides);
  const html = buildExamHtml(finalData, css);
  return { data: finalData, html };
}
