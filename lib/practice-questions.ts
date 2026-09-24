/**
 * 학습실 — 순서·삽입 온라인 연습.
 *
 * 문항은 판매 재고인 `generated_questions` 에서 **모의고사 완료 문항만** 꺼낸다(교과서·부교재는 쏠북 판매와
 * 겹치므로 제외). 풀이 화면에는 정답·해설을 싣지 않고, 한 문항씩 채점 요청(`checkPracticeAnswer`) 때만 돌려준다.
 */
import { ObjectId, type Db } from 'mongodb';
import { computeReadingOrderKey, findPositionInOriginal } from '@/lib/order-variant-validation';

export const PRACTICE_KINDS = ['순서', '삽입'] as const;
export type PracticeKind = (typeof PRACTICE_KINDS)[number];

/** 한 세트에 담는 최대 문항 수 — 한 회차 순서·삽입 전부(지문 25~30개 × 2)가 들어가게 */
export const PRACTICE_MAX_SET = 80;

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
    .map((s) => s.replace(/^[①②③④⑤]\s*/, '').replace(/\s*-\s*/g, ' - ').trim());
  return segs.length === 5 ? segs : null;
}

const normText = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”"]/g, '').replace(/\s+/g, ' ').trim();

/**
 * 저장 정답이 원문과 어긋나는지 — 어긋나면 true(연습에서 뺀다). 원문과 대조할 수 없으면 false(그대로 둔다).
 * 순서: (A)(B)(C) 덩이의 원문 위치로 읽기 순서를 구해 정답 선지와 비교.
 * 삽입: 원문에서 주어진 문장 바로 뒤에 오는 글이 몇 번 마커 뒤에 있는지 비교(새로 쓴 브릿지 문장은 원문에 없어 건너뜀).
 */
function contradictsOriginal(q: PracticeQuestion, correctAnswer: string, original: string): boolean {
  if (!original) return false;
  if (q.layout.kind === '순서') {
    const truth = computeReadingOrderKey({
      A: findPositionInOriginal(original, q.layout.A),
      B: findPositionInOriginal(original, q.layout.B),
      C: findPositionInOriginal(original, q.layout.C),
    });
    if (!truth) return false;
    const picked = q.layout.options[CIRCLED.indexOf(correctAnswer as (typeof CIRCLED)[number])] ?? '';
    return picked.replace(/[^ABC]/g, '') !== truth;
  }
  const orig = normText(original);
  const given = normText(q.layout.given);
  const at = orig.indexOf(given.slice(0, 60));
  if (given.length < 20 || at < 0) return false;
  const after = orig.slice(at + given.length).trim().slice(0, 25);
  const segs = q.layout.passage.split(/[①②③④⑤]/);
  if (segs.length !== 6) return false;
  const matches = CIRCLED.filter((_, i) => {
    const next = normText(segs.slice(i + 1).join(' ')).slice(0, 25);
    return after ? next.startsWith(after.slice(0, 20)) : next === '';
  });
  return matches.length === 1 && matches[0] !== correctAnswer;
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
  const out = await pickPracticeSetDetailed(db, opts);
  return out.questions;
}

/** pickPracticeSet + 원문과 어긋나 뺀 문항 수(점검용) */
export async function pickPracticeSetDetailed(
  db: Db,
  opts: { textbook: string; kinds: PracticeKind[]; hard: boolean; limit?: number },
): Promise<{ questions: PracticeQuestion[]; excluded: number }> {
  if (!MOCK_TEXTBOOK_RE.test(opts.textbook)) return { questions: [], excluded: 0 };
  const types = opts.kinds.map((k) => typeName(k, opts.hard));
  const docs = await db
    .collection('generated_questions')
    .find(
      { textbook: opts.textbook, status: '완료', type: { $in: types } },
      { projection: { type: 1, source: 1, passage_id: 1, 'question_data.Question': 1, 'question_data.Paragraph': 1, 'question_data.Options': 1, 'question_data.CorrectAnswer': 1 } },
    )
    .toArray();

  /* 저장 정답이 원문과 어긋난 문항(순서 off-by-one 등)은 연습에 내지 않는다 */
  const pids = [...new Set(docs.map((d) => String(d.passage_id ?? '')).filter((x) => ObjectId.isValid(x)))];
  const originals = new Map<string, string>();
  if (pids.length) {
    const ps = await db
      .collection('passages')
      .find({ _id: { $in: pids.map((x) => new ObjectId(x)) } }, { projection: { 'content.original': 1 } })
      .toArray();
    for (const p of ps) originals.set(String(p._id), String((p.content as { original?: string } | undefined)?.original ?? ''));
  }
  let excluded = 0;

  /* 번호·유형별로 묶어 무작위 하나 */
  const groups = new Map<string, PracticeQuestion[]>();
  for (const d of docs) {
    const q = toPracticeQuestion(d as Record<string, unknown>);
    if (!q) continue;
    const ca = String((d.question_data as { CorrectAnswer?: string } | undefined)?.CorrectAnswer ?? '').trim();
    if (contradictsOriginal(q, ca, originals.get(String(d.passage_id ?? '')) ?? '')) {
      excluded++;
      continue;
    }
    const key = `${q.number}|${q.kind}`;
    const list = groups.get(key) ?? [];
    list.push(q);
    groups.set(key, list);
  }
  let picked = [...groups.values()].map((list) => list[Math.floor(Math.random() * list.length)]);
  /* 문항 수를 고르면 무작위로 그만큼만 — 앞 번호만 잘리지 않게 뽑은 뒤 정렬한다 */
  const limit = Math.min(opts.limit ?? PRACTICE_MAX_SET, PRACTICE_MAX_SET);
  if (picked.length > limit) {
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }
    picked = picked.slice(0, limit);
  }
  /* 순서를 먼저 모두, 그다음 삽입 — 같은 지문의 삽입을 먼저 풀면 원문 흐름이 드러나 순서가 쉬워진다 */
  picked.sort(
    (a, b) =>
      PRACTICE_KINDS.indexOf(a.kind) - PRACTICE_KINDS.indexOf(b.kind) || numberSortKey(a.number) - numberSortKey(b.number),
  );
  return { questions: picked, excluded };
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
