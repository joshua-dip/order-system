import { ObjectId, type Db } from 'mongodb';

/**
 * 출제 스튜디오 — VIP(교사)가 한 지문에 집중해 ① 출제 포인트(marks)를 짚고 ② 변형문제를 직접 작성.
 * 지문(passageId)당 회원 1문서. AI 없음(수동). 기존 변형 DB(generated_questions)와 별개의 '내 출제' 공간.
 */
export const VIP_STUDIO_COLLECTION = 'vip_studio';

export const STUDIO_STATUSES = ['제작완료', '검수완료'] as const;
export type StudioStatus = (typeof STUDIO_STATUSES)[number];

export const STUDIO_MARK_SCOPES = ['word', 'phrase', 'sentence'] as const;
export type StudioMarkScope = (typeof STUDIO_MARK_SCOPES)[number];
/** 변형문제 유형(직접 작성·출제 포인트 공통). 자유 입력도 허용. */
export const STUDIO_QTYPES = ['빈칸', '어법', '어휘', '순서', '삽입', '요약', '무관한문장', '함의', '주제', '제목', '주장', '일치', '불일치', '영작', '기타'] as const;

export interface StudioMark {
  scope: StudioMarkScope;
  target: string;
  qTypes: string[];   // 예상 유형(복수) — 한 출제 포인트가 여러 유형으로 출제될 수 있음(예: 역접 But → 순서·삽입)
  note: string;
  start?: number;     // 원문 내 문자 오프셋(선택 위치 고정 — 같은 단어가 여러 곳 나와도 그 위치만 잡음)
  end?: number;
}
export interface StudioProblem {
  id: string;
  type: string;
  question: string;     // 발문(선택)
  paragraph: string;    // 문제 본문(원문 변형)
  options: string;      // 보기(### 또는 줄바꿈)
  answer: string;       // 정답
  explanation: string;  // 해설
  status: StudioStatus;
  createdAt: string;    // ISO
}
export interface VipStudioDoc {
  _id?: ObjectId;
  userId: ObjectId;
  userName?: string;  // 사용자 이름(식별용 — 본인이 쓰는 문제)
  loginId?: string;
  passageId: string;
  textbook: string;
  sourceKey: string;
  source: string;     // 표시용 출처(교재 · 번호)
  examType?: string;
  marks: StudioMark[];
  problems: StudioProblem[];
  createdAt: Date;
  updatedAt: Date;
}

let _indexed = false;
export async function ensureStudioIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await db.collection(VIP_STUDIO_COLLECTION).createIndex({ userId: 1, passageId: 1 }, { unique: true });
}

export function normalizeStudioMarks(raw: unknown): StudioMark[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 60).map((m) => {
    const o = m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
    const scope = (STUDIO_MARK_SCOPES as readonly string[]).includes(String(o.scope)) ? (o.scope as StudioMarkScope) : 'word';
    const rawTypes = Array.isArray(o.qTypes) ? o.qTypes : (o.qType ? [o.qType] : []);  // 레거시 단일 qType 흡수
    const qTypes = [...new Set(rawTypes.map((x) => String(x).trim()).filter(Boolean))].slice(0, 6).map((x) => x.slice(0, 20));
    const startN = Number(o.start); const endN = Number(o.end);
    const start = Number.isFinite(startN) && startN >= 0 ? Math.floor(startN) : undefined;
    const end = start !== undefined && Number.isFinite(endN) && endN > start ? Math.floor(endN) : undefined;
    return {
      scope,
      target: String(o.target ?? '').trim().slice(0, 300),
      qTypes,
      note: String(o.note ?? '').slice(0, 600),
      ...(start !== undefined ? { start } : {}),
      ...(end !== undefined ? { end } : {}),
    };
  }).filter((m) => m.target || m.qTypes.length || m.note);
}

export function normalizeStudioProblems(raw: unknown): StudioProblem[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).map((p, i) => {
    const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
    const status = (STUDIO_STATUSES as readonly string[]).includes(String(o.status)) ? (o.status as StudioStatus) : '제작완료';
    return {
      id: String(o.id ?? '') || `p_${Date.now()}_${i}`,
      type: String(o.type ?? '').trim().slice(0, 24),
      question: String(o.question ?? '').slice(0, 600),
      paragraph: String(o.paragraph ?? '').slice(0, 6000),
      options: String(o.options ?? '').slice(0, 2000),
      answer: String(o.answer ?? '').trim().slice(0, 200),
      explanation: String(o.explanation ?? '').slice(0, 3000),
      status,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
    };
  }).filter((p) => p.type || p.paragraph || p.options || p.answer);
}

export function studioView(d: VipStudioDoc | null) {
  if (!d) return { marks: [], problems: [] };
  return {
    passageId: d.passageId,
    textbook: d.textbook,
    sourceKey: d.sourceKey,
    source: d.source,
    examType: d.examType ?? '',
    marks: normalizeStudioMarks(d.marks),       // 읽을 때도 정규화 — 레거시 qType→qTypes, 누락 필드 보강
    problems: normalizeStudioProblems(d.problems),
  };
}
