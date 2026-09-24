/**
 * 학습실 — 순서·삽입 온라인 연습. 풀기는 누구나, 해설·기록·오답 분석은 회원만.
 *
 * 문항은 판매 재고(generated_questions)를 쓰지 않고, 모의고사 **지문 원문**에서 `practice-generator` 로
 * 즉석 생성한다 — 무한 연습, 판매 자료 노출 없음, 해설 없음.
 * 문항 id 는 (지문·유형·seed) 를 담은 토큰이라 채점·복습 때 똑같이 다시 만든다.
 * 채점할 때마다 `practice_attempts` 에 남겨 내정보에서 유형·번호별 오답을 분석·복습한다.
 */
import { ObjectId, type Db } from 'mongodb';
import {
  CIRCLED,
  generatePractice,
  randomSeed,
  splitPassageSentences,
  type GeneratedPractice,
  type PracticeGenKind,
} from '@/lib/practice-generator';

export const PRACTICE_KINDS = ['순서', '삽입'] as const;
export type PracticeKind = PracticeGenKind;
export const PRACTICE_ATTEMPTS_COLLECTION = 'practice_attempts';
export const PRACTICE_MAX_SET = 50;

const MOCK_TEXTBOOK_RE = /영어모의고사$/;
/** 도표·안내문(25~28)·무관한 문장(35, 원문에 끼어 있음)·46번 이후는 뺀다 */
const ELIGIBLE_NUMBERS = new Set([
  '18', '19', '20', '21', '22', '23', '24', '29', '30', '31', '32', '33', '34',
  '36', '37', '38', '39', '40', '41', '42', '41~42', '43~45',
]);
const MAX_SENTENCES = 16;

export interface PracticeExam {
  textbook: string;
  year: number;
  month: number;
  grade: number;
  /** 연습에 쓸 수 있는 지문 수 */
  passages: number;
}

export type PracticeLayout =
  | { kind: '순서'; intro: string; A: string; B: string; C: string; options: string[] }
  | { kind: '삽입'; given: string; passage: string };

export interface PracticeQuestion {
  /** (지문·유형·seed) 토큰 */
  id: string;
  kind: PracticeKind;
  number: string;
  textbook: string;
  question: string;
  layout: PracticeLayout;
}

export type PracticeReveal =
  | { kind: '순서'; ordered: string[]; order: string }
  | { kind: '삽입'; before: string; given: string; after: string };

type Token = { p: string; k: PracticeKind; s: number };

export function encodeToken(t: Token): string {
  return Buffer.from(JSON.stringify({ p: t.p, k: t.k === '순서' ? 'o' : 'i', s: t.s })).toString('base64url');
}
export function decodeToken(id: string): Token | null {
  try {
    const o = JSON.parse(Buffer.from(id, 'base64url').toString('utf8')) as { p?: string; k?: string; s?: number };
    if (!o.p || !ObjectId.isValid(o.p) || !Number.isInteger(o.s)) return null;
    return { p: o.p, k: o.k === 'o' ? '순서' : '삽입', s: o.s as number };
  } catch {
    return null;
  }
}

function parseExamName(textbook: string): { year: number; month: number; grade: number } {
  const m = textbook.match(/(\d{2})년\s*(\d{1,2})월\s*고(\d)/);
  return m ? { year: 2000 + Number(m[1]), month: Number(m[2]), grade: Number(m[3]) } : { year: 0, month: 0, grade: 0 };
}
function numberKey(raw: unknown): string {
  return String(raw ?? '').replace(/번\s*$/, '').replace(/\s+/g, '');
}
function numberLabel(raw: unknown): string {
  const k = numberKey(raw);
  return k ? `${k}번` : '';
}
function numberSort(n: string): number {
  return Number(n.match(/\d+/)?.[0] ?? 999);
}

type PassageRow = { _id: ObjectId; textbook: string; number: string; sentences: string[] };

/** 지문 캐시 — 원문 분할은 요청마다 할 필요가 없다 */
let passageCache: { at: number; rows: PassageRow[] } | null = null;
async function eligiblePassages(db: Db): Promise<PassageRow[]> {
  if (passageCache && Date.now() - passageCache.at < 10 * 60_000) return passageCache.rows;
  const docs = await db
    .collection('passages')
    .find({ textbook: { $regex: MOCK_TEXTBOOK_RE.source } }, { projection: { textbook: 1, number: 1, 'content.original': 1 } })
    .toArray();
  const rows: PassageRow[] = [];
  for (const d of docs) {
    if (!ELIGIBLE_NUMBERS.has(numberKey(d.number))) continue;
    const sentences = splitPassageSentences(String((d.content as { original?: string } | undefined)?.original ?? ''));
    if (sentences.length < 5 || sentences.length > MAX_SENTENCES) continue;
    rows.push({ _id: d._id as ObjectId, textbook: String(d.textbook), number: numberLabel(d.number), sentences });
  }
  passageCache = { at: Date.now(), rows };
  return rows;
}

const QUESTION_TEXT: Record<PracticeKind, string> = {
  순서: '주어진 글 다음에 이어질 글의 순서로 가장 적절한 것을 고르시오.',
  삽입: '글의 흐름으로 보아, 주어진 문장이 들어가기에 가장 적절한 곳을 고르시오.',
};

function toQuestion(row: PassageRow, kind: PracticeKind, seed: number): { q: PracticeQuestion; g: GeneratedPractice } | null {
  const g = generatePractice(kind, row.sentences, seed);
  if (!g) return null;
  const layout: PracticeLayout =
    g.kind === '순서'
      ? { kind: '순서', intro: g.intro, A: g.A, B: g.B, C: g.C, options: [...g.options] }
      : { kind: '삽입', given: g.given, passage: g.passage };
  return {
    q: { id: encodeToken({ p: String(row._id), k: kind, s: seed }), kind, number: row.number, textbook: row.textbook, question: QUESTION_TEXT[kind], layout },
    g,
  };
}

/** 연습 가능한 모의고사 회차 */
export async function listPracticeExams(db: Db): Promise<PracticeExam[]> {
  const rows = await eligiblePassages(db);
  const by = new Map<string, PracticeExam>();
  for (const r of rows) {
    const e = by.get(r.textbook) ?? { textbook: r.textbook, ...parseExamName(r.textbook), passages: 0 };
    e.passages++;
    by.set(r.textbook, e);
  }
  return [...by.values()].sort((a, b) => b.year - a.year || b.month - a.month || a.grade - b.grade);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 새 세트 — textbook 이 없으면 grade 학년 전체 회차에서 섞는다.
 * 지문마다 한 문항, 「순서+삽입」이면 지문을 반씩 나눠 순서 → 삽입 순으로 낸다.
 */
export async function pickPracticeSet(
  db: Db,
  opts: { textbook?: string; grade?: number; kinds: PracticeKind[]; count: number },
): Promise<PracticeQuestion[]> {
  const all = await eligiblePassages(db);
  const pool = all.filter((r) =>
    opts.textbook ? r.textbook === opts.textbook : !opts.grade || parseExamName(r.textbook).grade === opts.grade,
  );
  const count = Math.max(1, Math.min(opts.count, PRACTICE_MAX_SET));
  const out: PracticeQuestion[] = [];
  let i = 0;
  for (const row of shuffle(pool)) {
    if (out.length >= count) break;
    const kind = opts.kinds.length === 1 ? opts.kinds[0] : opts.kinds[i % opts.kinds.length];
    const made = toQuestion(row, kind, randomSeed());
    if (!made) continue;
    out.push(made.q);
    i++;
  }
  return out.sort(
    (a, b) =>
      PRACTICE_KINDS.indexOf(a.kind) - PRACTICE_KINDS.indexOf(b.kind) ||
      (opts.textbook ? numberSort(a.number) - numberSort(b.number) : 0),
  );
}

async function rowById(db: Db, pid: string): Promise<PassageRow | null> {
  const cached = passageCache?.rows.find((r) => String(r._id) === pid);
  if (cached) return cached;
  const d = await db.collection('passages').findOne({ _id: new ObjectId(pid) }, { projection: { textbook: 1, number: 1, 'content.original': 1 } });
  if (!d || !MOCK_TEXTBOOK_RE.test(String(d.textbook))) return null;
  return {
    _id: d._id,
    textbook: String(d.textbook),
    number: numberLabel(d.number),
    sentences: splitPassageSentences(String((d.content as { original?: string } | undefined)?.original ?? '')),
  };
}

/** 토큰들로 문항을 다시 만든다(복습) */
export async function questionsFromTokens(db: Db, ids: string[]): Promise<PracticeQuestion[]> {
  const out: PracticeQuestion[] = [];
  for (const id of ids) {
    const t = decodeToken(id);
    if (!t) continue;
    const row = await rowById(db, t.p);
    const made = row ? toQuestion(row, t.k, t.s) : null;
    if (made) out.push(made.q);
  }
  return out;
}

let attemptIndexReady = false;
async function ensureAttemptIndex(db: Db) {
  if (attemptIndexReady) return;
  attemptIndexReady = true;
  await db.collection(PRACTICE_ATTEMPTS_COLLECTION).createIndex({ loginId: 1, createdAt: -1 }).catch(() => { attemptIndexReady = false; });
}

/** 채점 + 기록. 정답과 원래 흐름(reveal)을 돌려준다 — 해설은 없다. */
export async function checkPracticeAnswer(
  db: Db,
  /** 회원이면 기록한다. 비회원(null)은 기록하지 않는다 */
  loginId: string | null,
  id: string,
  answer: string,
): Promise<{ correct: boolean; correctAnswer: string; reveal: PracticeReveal } | null> {
  const t = decodeToken(id);
  if (!t) return null;
  const row = await rowById(db, t.p);
  const made = row ? toQuestion(row, t.k, t.s) : null;
  if (!row || !made) return null;
  const correctAnswer = CIRCLED[made.g.answerIndex];
  const correct = answer.trim() === correctAnswer;
  const reveal: PracticeReveal =
    made.g.kind === '순서'
      ? { kind: '순서', ordered: made.g.ordered, order: made.g.options[made.g.answerIndex] }
      : { kind: '삽입', ...made.g.restored };
  if (loginId) await ensureAttemptIndex(db);
  if (loginId) await db.collection(PRACTICE_ATTEMPTS_COLLECTION).insertOne({
    loginId,
    token: id,
    passageId: t.p,
    textbook: row.textbook,
    number: row.number,
    kind: t.k,
    picked: answer.trim(),
    correctAnswer,
    correct,
    createdAt: new Date(),
  });
  return { correct, correctAnswer, reveal };
}

export interface PracticeStats {
  total: number;
  correct: number;
  byKind: { kind: PracticeKind; total: number; correct: number }[];
  byNumber: { number: string; total: number; correct: number; kinds: Record<string, { total: number; correct: number }> }[];
  byExam: { textbook: string; total: number; correct: number }[];
  /** 마지막 시도가 오답인 문항(최근순) */
  wrong: { id: string; kind: PracticeKind; textbook: string; number: string; picked: string; correctAnswer: string; at: string }[];
  days: number;
}

/** 내 학습 기록 분석 */
export async function practiceStats(db: Db, loginId: string): Promise<PracticeStats> {
  const col = db.collection(PRACTICE_ATTEMPTS_COLLECTION);
  const docs = await col
    .find({ loginId }, { projection: { token: 1, textbook: 1, number: 1, kind: 1, picked: 1, correctAnswer: 1, correct: 1, createdAt: 1 } })
    .sort({ createdAt: -1 })
    .limit(5000)
    .toArray();
  const byKind = new Map<string, { total: number; correct: number }>();
  const byNumber = new Map<string, { total: number; correct: number; kinds: Record<string, { total: number; correct: number }> }>();
  const byExam = new Map<string, { total: number; correct: number }>();
  const lastByToken = new Map<string, (typeof docs)[number]>();
  const days = new Set<string>();
  for (const d of docs) {
    const ok = d.correct === true ? 1 : 0;
    const k = byKind.get(d.kind) ?? { total: 0, correct: 0 };
    k.total++; k.correct += ok; byKind.set(d.kind, k);
    const n = byNumber.get(d.number) ?? { total: 0, correct: 0, kinds: {} };
    n.total++; n.correct += ok;
    n.kinds[d.kind] = { total: (n.kinds[d.kind]?.total ?? 0) + 1, correct: (n.kinds[d.kind]?.correct ?? 0) + ok };
    byNumber.set(d.number, n);
    const e = byExam.get(d.textbook) ?? { total: 0, correct: 0 };
    e.total++; e.correct += ok; byExam.set(d.textbook, e);
    if (!lastByToken.has(d.token)) lastByToken.set(d.token, d);
    days.add(new Date(d.createdAt).toISOString().slice(0, 10));
  }
  const wrong = [...lastByToken.values()]
    .filter((d) => d.correct !== true)
    .slice(0, 100)
    .map((d) => ({
      id: String(d.token),
      kind: d.kind as PracticeKind,
      textbook: String(d.textbook),
      number: String(d.number),
      picked: String(d.picked),
      correctAnswer: String(d.correctAnswer),
      at: new Date(d.createdAt).toISOString(),
    }));
  return {
    total: docs.length,
    correct: docs.filter((d) => d.correct === true).length,
    byKind: PRACTICE_KINDS.map((k) => ({ kind: k, ...(byKind.get(k) ?? { total: 0, correct: 0 }) })),
    byNumber: [...byNumber.entries()].map(([number, v]) => ({ number, ...v })).sort((a, b) => numberSort(a.number) - numberSort(b.number)),
    byExam: [...byExam.entries()].map(([textbook, v]) => ({ textbook, ...v })).sort((a, b) => b.total - a.total),
    wrong,
    days: days.size,
  };
}

/** 마지막 시도가 오답인 문항 토큰(최근순) — 복습 세트용 */
export async function wrongTokens(db: Db, loginId: string, limit: number): Promise<string[]> {
  const s = await practiceStats(db, loginId);
  return s.wrong.slice(0, limit).map((w) => w.id);
}
