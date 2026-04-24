/**
 * 워크북 어법 — Claude 어법 포인트 추출 + [ A / B ] 인라인 단락 생성
 * Python 프로젝트15/워크북_어법.py 의 핵심 로직 이식
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ClaudeGrammarPoint, WorkbookGrammarData, WorkbookGrammarPoint } from './workbook-grammar-types';

// ─── 인라인 [ A / B ] 생성 유틸 ─────────────────────────────────────────────

/** `[ ]` 안에서 깊이 0의 슬래시 개수 */
function slashesAtDepthZero(s: string): number {
  let depth = 0;
  let n = 0;
  for (const c of s) {
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === '/' && depth === 0) n++;
  }
  return n;
}

/**
 * [ A / B ] 안에 들어갈 형태에서 대괄호를 소괄호로, 깊이0 슬래시가 있으면 전체를 괄호로 감싼다.
 * Python: _sanitize_form_for_choice_bracket
 */
function sanitizeForm(s: string): string {
  const t = s.replace(/\[/g, '(').replace(/\]/g, ')').trim();
  if (slashesAtDepthZero(t) > 0) return `(${t})`;
  return t;
}

/**
 * 원문에서 targetWord(또는 correctForm)를 찾아 [ A / B ] 로 치환.
 * Python: build_inline_sentence
 * @returns { inlineText, answerPosition } 또는 null(치환 실패)
 */
function buildInlineSentence(
  text: string,
  targetWord: string,
  correctForm: string,
  wrongForm: string,
  shuffle = true,
): { inlineText: string; answerPosition: '앞' | '뒤' } | null {
  const cf = sanitizeForm(correctForm);
  const wf = sanitizeForm(wrongForm);
  if (!cf || !wf || cf === wf) return null;

  const isCorrectFirst = shuffle ? Math.random() < 0.5 : true;
  const a = isCorrectFirst ? cf : wf;
  const b = isCorrectFirst ? wf : cf;
  const bracket = `[ ${a} / ${b} ]`;
  const answerPosition: '앞' | '뒤' = isCorrectFirst ? '앞' : '뒤';

  for (const needle of [targetWord, correctForm]) {
    if (needle && text.includes(needle)) {
      return { inlineText: text.replace(needle, bracket), answerPosition };
    }
  }
  return null;
}

/**
 * 지문에서 나타나는 순서로 포인트를 정렬.
 * Python: _sort_members_for_inline_merge
 */
function sortPointsByOccurrence(
  points: ClaudeGrammarPoint[],
  text: string,
): ClaudeGrammarPoint[] {
  return [...points].sort((a, b) => {
    const ia = Math.min(
      a.target_word ? text.indexOf(a.target_word) : Infinity,
      a.correct_form ? text.indexOf(a.correct_form) : Infinity,
    );
    const ib = Math.min(
      b.target_word ? text.indexOf(b.target_word) : Infinity,
      b.correct_form ? text.indexOf(b.correct_form) : Infinity,
    );
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  });
}

/**
 * Claude 어법 포인트 목록을 받아 [ A / B ] 인라인 지문 + 정답 목록 생성.
 * Python: prepare_rows 의 단일 지문 처리 부분
 */
export function buildWorkbookPassage(
  originalText: string,
  points: ClaudeGrammarPoint[],
): { paragraph: string; grammarPoints: WorkbookGrammarPoint[]; answerText: string; truncatedCount: number } | null {
  const sorted = sortPointsByOccurrence(points, originalText);
  let text = originalText;
  const grammarPoints: WorkbookGrammarPoint[] = [];
  let truncatedCount = 0;

  const wordCount = (s: string) => s.trim().split(/\s+/).length;

  for (const pt of sorted) {
    const wrongForm = Array.isArray(pt.wrong_candidates) && pt.wrong_candidates[0]
      ? pt.wrong_candidates[0]
      : '';
    if (!wrongForm || !pt.correct_form) continue;

    if (wordCount(pt.correct_form) > 5 || wordCount(wrongForm) > 5) {
      truncatedCount++;
      continue;
    }

    const result = buildInlineSentence(text, pt.target_word, pt.correct_form, wrongForm);
    if (!result) continue;

    text = result.inlineText;
    grammarPoints.push({
      targetWord: pt.target_word,
      correctForm: pt.correct_form,
      wrongForm,
      grammarType: pt.grammar_type || '',
      answerPosition: result.answerPosition,
    });
  }

  if (grammarPoints.length === 0) return null;

  const answerText = grammarPoints
    .map((gp, i) => `${i + 1}) ${gp.correctForm}${gp.grammarType ? ` (${gp.grammarType})` : ''}`)
    .join('\n');

  return { paragraph: text, grammarPoints, answerText, truncatedCount };
}

// ─── Claude 프롬프트 ──────────────────────────────────────────────────────────

function buildGrammarExtractionPrompt(passage: string, maxPoints: number): string {
  return `다음 영어 지문에서 **워크북용 양자택일 어법 연습**에 쓸 포인트를 골라 주세요.
각 포인트는 원문에 실제로 나온 단어/구를 **한 군데만** 바꿔
\`[ 오답형태 / 정답형태 ]\` 또는 \`[ 정답형태 / 오답형태 ]\` 로 넣을 예정입니다.

지문:
---
${passage}
---

요구사항:
1. 포인트당 **target_word** 는 지문에 **그대로 등장하는 부분 문자열**이어야 합니다.
2. **correct_form** 은 그 자리에 문맥상 올바른 형태이며, 지문에 나온 표기와 동일해야 합니다.
3. **wrong_candidates** 는 문자열 배열. **첫 번째 요소**가 양자택일의 상대 보기로 쓰입니다.
4. **correct_form** 과 **wrong_candidates[0]** 은 각각 **단어 수 5개 이하**여야 합니다. 5단어를 초과하는 구간은 포인트로 선택하지 마세요.
5. **correct_form**·**wrong_candidates** 안에 \`[ ]\` 대괄호를 넣지 마세요. 내부에 나눌 때는 \`( a / b )\` 처럼 **괄호**만 쓰세요.
6. **정확히 ${maxPoints}개를 목표로** 최대한 채워 주세요.
   수동태·분사·부정사·관계사·시제·수일치·접속사·전치사 등 **고등 영어 어법** 포인트가 여러 군데 있으면 모두 포함하세요.
   (${maxPoints}개 미만은 포인트가 정말 없을 때만 허용, 넘치면 안 됨)
7. 지문 앞에서 뒤 순서(등장 순서)로 출력.

출력은 반드시 아래 JSON 하나만 (다른 텍스트 금지):
{
  "grammar_points": [
    {
      "target_word": "지문에 있는 그대로의 문자열",
      "correct_form": "문맥상 올바른 형태 (지문과 동일)",
      "wrong_candidates": ["첫오답", "부가오답옵션"],
      "grammar_type": "수동태/분사/부정사/관계사/시제/수일치/접속사/전치사 중 하나",
      "confidence_score": 8
    }
  ]
}`;
}

function buildExplanationPrompt(
  passage: string,
  grammarPoints: WorkbookGrammarPoint[],
): string {
  const pointList = grammarPoints
    .map(
      (gp, i) =>
        `${i + 1}. ${gp.grammarType}: 올바른 표현 "${gp.correctForm}" vs 오답 "${gp.wrongForm}"`,
    )
    .join('\n');
  return `다음 영어 지문의 어법 양자택일 문항 해설을 한국어로 작성해주세요.

지문:
${passage}

어법 포인트:
${pointList}

각 포인트마다 왜 해당 어법이 쓰였는지 간결하게(1~2문장) 설명해주세요.
포맷: "1) 해설\n2) 해설" 형식으로만 출력.`;
}

function extractJsonObject(text: string): Record<string, unknown> {
  let s = text.trim();
  if (s.startsWith('```json')) s = s.slice(7);
  if (s.startsWith('```')) s = s.slice(3);
  if (s.endsWith('```')) s = s.slice(0, -3);
  s = s.trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('JSON 객체를 찾을 수 없습니다.');
  return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
}

// ─── 공개 API ────────────────────────────────────────────────────────────────

export type WorkbookGrammarGenerateResult = {
  questionData: WorkbookGrammarData;
  /** Claude 추출 포인트 원본 (디버그용) */
  rawPoints: ClaudeGrammarPoint[];
  /** 5단어 초과로 제외된 포인트 수 */
  truncatedCount: number;
};

/**
 * 지문에서 워크북 어법 문항 자동 생성.
 * 1단계: Claude로 어법 포인트 추출
 * 2단계: [ A / B ] 인라인 삽입
 * 3단계: Claude로 해설 생성
 */
export async function generateWorkbookGrammarQuestion(params: {
  passage: string;
  maxPoints?: number;
  skipExplanation?: boolean;
  /** BYOK: 호출자가 직접 API 키를 전달하면 env 대신 사용 */
  apiKey?: string;
}): Promise<WorkbookGrammarGenerateResult> {
  const { passage, maxPoints = 4, skipExplanation = false } = params;

  const apiKey = params.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.');

  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

  // 1단계: 어법 포인트 추출
  const extractMsg = await client.messages.create({
    model,
    max_tokens: Math.max(1500, Math.min(4096, maxPoints * 220 + 600)),
    messages: [{ role: 'user', content: buildGrammarExtractionPrompt(passage, maxPoints) }],
  });

  const rawText = extractMsg.content[0].type === 'text' ? extractMsg.content[0].text : '';
  const parsed = extractJsonObject(rawText);
  const rawPointsAny = Array.isArray(parsed.grammar_points) ? parsed.grammar_points : [];
  const rawPoints: ClaudeGrammarPoint[] = rawPointsAny.filter(
    (p): p is ClaudeGrammarPoint => typeof p === 'object' && p !== null,
  );

  if (rawPoints.length === 0) {
    throw new Error('어법 포인트를 추출하지 못했습니다. 지문을 확인해주세요.');
  }

  // 2단계: [ A / B ] 인라인 삽입
  const built = buildWorkbookPassage(passage, rawPoints);
  if (!built) {
    throw new Error('포인트와 지문을 매칭하지 못했습니다. (target_word가 지문에 없음)');
  }

  // 3단계: 해설 생성 (선택)
  let explanation = '';
  if (!skipExplanation) {
    const expMsg = await client.messages.create({
      model,
      max_tokens: 1500,
      messages: [
        { role: 'user', content: buildExplanationPrompt(passage, built.grammarPoints) },
      ],
    });
    explanation = expMsg.content[0].type === 'text' ? expMsg.content[0].text.trim() : '';
  }

  const questionData: WorkbookGrammarData = {
    Category: '워크북어법',
    Paragraph: built.paragraph,
    GrammarPoints: built.grammarPoints,
    AnswerText: built.answerText,
    Explanation: explanation,
  };

  return { questionData, rawPoints, truncatedCount: built.truncatedCount };
}
