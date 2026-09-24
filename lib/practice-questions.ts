/**
 * 학습실 — 순서·삽입 온라인 연습.
 *
 * 문항은 판매 재고인 `generated_questions` 에서 **모의고사 완료 문항만** 꺼낸다(교과서·부교재는 쏠북 판매와
 * 겹치므로 제외). 풀이 화면에는 정답·해설을 싣지 않고, 한 문항씩 채점 요청(`checkPracticeAnswer`) 때만 돌려준다.
 */
import { ObjectId, type Db } from 'mongodb';

export const PRACTICE_KINDS = ['순서', '삽입'] as const;
export type PracticeKind = (typeof PRACTICE_KINDS)[number];

/** 한 세트에 담는 최대 문항 수 */
export const PRACTICE_MAX_SET = 40;

const CIRCLED = ['①', '②', '③', '④', '⑤'] as const;
const MOCK_TEXTBOOK_RE = /영어모의고사$/;

export interface PracticeExam {
  textbook: string;
  year: number;
  month: number;
  grade: number;
  counts: Record<string, number>;
}

export type PracticeLayout =
  | { kind: '순서'; intro: string; A: string; B: string; C: string; options: string[] }
  | { kind: '삽입'; given: string; passage: string };

export interface PracticeQuestion {
  id: string;
  kind: PracticeKind;
  hard: boolean;
  number: string;
  question: string;
  layout: PracticeLayout;
}

function typeName(kind: PracticeKind, hard: boolean): string {
  return hard ? `${kind}-고난도` : kind;
}

/** "26년 9월 고1 영어모의고사" → 정렬용 연·월·학년 */
function parseExamName(textbook: string): { year: number; month: number; grade: number } {
  const m = textbook.match(/(\d{2})년\s*(\d{1,2})월\s*고(\d)/);
  return m ? { year: 2000 + Number(m[1]), month: Number(m[2]), grade: Number(m[3]) } : { year: 0, month: 0, grade: 0 };
}

/** "26년 9월 고1 영어모의고사 18번" → "18번", "43~45번" 도 그대로 */
function numberOf(source: string): string {
  const m = source.match(/(\d+(?:\s*~\s*\d+)?)번\s*$/);
  return m ? `${m[1].replace(/\s+/g, '')}번` : source;
}

function numberSortKey(n: string): number {
  return Number(n.match(/\d+/)?.[0] ?? 999);
}

/** 순서 Paragraph: `도입 ### (A) … ### (B) … ### (C) …` 또는 빈 줄 구분 */
function parseOrder(paragraph: string): { intro: string; A: string; B: string; C: string } | null {
  const text = paragraph.replace(/\r\n/g, '\n').trim();
  const parts = text.includes('###')
    ? text.split(/\n?\s*###\s*\n?/)
    : text.split(/\n\s*\n/);
  const clean = parts.map((p) => p.trim()).filter(Boolean);
  if (clean.length !== 4) return null;
  const [intro, a, b, c] = clean;
  const strip = (s: string, label: string) => (s.startsWith(`(${label})`) ? s.slice(3).trim() : null);
  const A = strip(a, 'A');
  const B = strip(b, 'B');
  const C = strip(c, 'C');
  if (!A || !B || !C || !intro) return null;
  return { intro, A, B, C };
}

/** 삽입 Paragraph: `주어진 문장 ### 본문(①~⑤)` 또는 빈 줄 구분 */
function parseInsert(paragraph: string): { given: string; passage: string } | null {
  const text = paragraph.replace(/\r\n/g, '\n').trim();
  const m = text.includes('###') ? text.match(/^([\s\S]*?)###([\s\S]*)$/) : text.match(/^([\s\S]*?)\n\s*\n([\s\S]*)$/);
  if (!m) return null;
  const given = m[1].trim();
  const passage = m[2].trim();
  const marks = passage.match(/[①②③④⑤]/g) ?? [];
  if (!given || /[①②③④⑤]/.test(given)) return null;
  if (marks.length !== 5 || marks.join('') !== CIRCLED.join('')) return null;
  return { given, passage };
}

/** 순서 선지 5개 — `###`·줄바꿈 두 구분자 모두 */
function parseOrderOptions(raw: string): string[] | null {
  const segs = (raw.includes('###') ? raw.split('###') : raw.split('\n'))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^[①②③④⑤]\s*/, '').trim());
  return segs.length === 5 ? segs : null;
}

function toPracticeQuestion(doc: Record<string, unknown>): PracticeQuestion | null {
  const qd = (doc.question_data ?? {}) as Record<string, unknown>;
  const type = String(doc.type ?? '');
  const hard = type.endsWith('-고난도');
  const kind = (hard ? type.replace(/-고난도$/, '') : type) as PracticeKind;
  if (!PRACTICE_KINDS.includes(kind)) return null;
  if (!CIRCLED.includes(String(qd.CorrectAnswer ?? '').trim() as (typeof CIRCLED)[number])) return null;

  const paragraph = String(qd.Paragraph ?? '');
  let layout: PracticeLayout | null = null;
  if (kind === '순서') {
    const parts = parseOrder(paragraph);
    const options = parseOrderOptions(String(qd.Options ?? ''));
    if (parts && options) layout = { kind, ...parts, options };
  } else {
    const parts = parseInsert(paragraph);
    if (parts) layout = { kind, ...parts };
  }
  if (!layout) return null;

  return {
    id: String(doc._id),
    kind,
    hard,
    number: numberOf(String(doc.source ?? '')),
    question: String(qd.Question ?? '').trim(),
    layout,
  };
}

/** 연습할 수 있는 모의고사 회차 — 최신 회차부터, 학년 순 */
export async function listPracticeExams(db: Db): Promise<PracticeExam[]> {
  const rows = await db
    .collection('generated_questions')
    .aggregate([
      {
        $match: {
          status: '완료',
          textbook: { $regex: MOCK_TEXTBOOK_RE.source },
          type: { $in: PRACTICE_KINDS.flatMap((k) => [k, `${k}-고난도`]) },
        },
      },
      /* 한 지문에 변형이 여러 개여도 세트엔 번호당 하나만 나가므로 지문(출처) 수를 센다 */
      { $group: { _id: { textbook: '$textbook', type: '$type' }, sources: { $addToSet: '$source' } } },
      { $project: { n: { $size: '$sources' } } },
    ])
    .toArray();

  const byTextbook = new Map<string, PracticeExam>();
  for (const r of rows) {
    const textbook = String(r._id?.textbook ?? '');
    if (!textbook) continue;
    let exam = byTextbook.get(textbook);
    if (!exam) {
      exam = { textbook, ...parseExamName(textbook), counts: {} };
      byTextbook.set(textbook, exam);
    }
    exam.counts[String(r._id?.type)] = Number(r.n ?? 0);
  }
  return [...byTextbook.values()].sort(
    (a, b) => b.year - a.year || b.month - a.month || a.grade - b.grade || a.textbook.localeCompare(b.textbook, 'ko'),
  );
}

/**
 * 한 회차에서 연습 세트를 뽑는다. 지문(번호)마다 한 문항씩, 같은 번호에 여러 문항이면 무작위.
 * 번호 순으로 돌려주고, 화면 형식으로 나눌 수 없는 문항은 건너뛴다.
 */
export async function pickPracticeSet(
  db: Db,
  opts: { textbook: string; kinds: PracticeKind[]; hard: boolean; limit?: number },
): Promise<PracticeQuestion[]> {
  if (!MOCK_TEXTBOOK_RE.test(opts.textbook)) return [];
  const types = opts.kinds.map((k) => typeName(k, opts.hard));
  const docs = await db
    .collection('generated_questions')
    .find(
      { textbook: opts.textbook, status: '완료', type: { $in: types } },
      { projection: { type: 1, source: 1, 'question_data.Question': 1, 'question_data.Paragraph': 1, 'question_data.Options': 1, 'question_data.CorrectAnswer': 1 } },
    )
    .toArray();

  /* 번호·유형별로 묶어 무작위 하나 */
  const groups = new Map<string, PracticeQuestion[]>();
  for (const d of docs) {
    const q = toPracticeQuestion(d as Record<string, unknown>);
    if (!q) continue;
    const key = `${q.number}|${q.kind}`;
    const list = groups.get(key) ?? [];
    list.push(q);
    groups.set(key, list);
  }
  const picked = [...groups.values()].map((list) => list[Math.floor(Math.random() * list.length)]);
  picked.sort((a, b) => numberSortKey(a.number) - numberSortKey(b.number) || a.kind.localeCompare(b.kind, 'ko'));
  return picked.slice(0, Math.min(opts.limit ?? PRACTICE_MAX_SET, PRACTICE_MAX_SET));
}

/** 한 문항 채점 — 연습 범위(모의고사·완료·순서/삽입) 밖의 id 는 거절 */
export async function checkPracticeAnswer(
  db: Db,
  id: string,
  answer: string,
): Promise<{ correct: boolean; correctAnswer: string; explanation: string } | null> {
  if (!ObjectId.isValid(id)) return null;
  const doc = await db.collection('generated_questions').findOne(
    {
      _id: new ObjectId(id),
      status: '완료',
      textbook: { $regex: MOCK_TEXTBOOK_RE.source },
      type: { $in: PRACTICE_KINDS.flatMap((k) => [k, `${k}-고난도`]) },
    },
    { projection: { 'question_data.CorrectAnswer': 1, 'question_data.Explanation': 1 } },
  );
  if (!doc) return null;
  const qd = (doc.question_data ?? {}) as Record<string, unknown>;
  const correctAnswer = String(qd.CorrectAnswer ?? '').trim();
  return {
    correct: answer.trim() === correctAnswer,
    correctAnswer,
    explanation: String(qd.Explanation ?? '').trim(),
  };
}
