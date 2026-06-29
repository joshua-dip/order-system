import { ObjectId, type Db } from 'mongodb';

/**
 * VIP 출제 포인트 — 선생님(VIP)이 영어 지문을 문장별로 분석(해석·구문/어법 메모·단어장·요약)하고
 * 본인용으로 저장. AI 없음(수동 작성). 지문은 직접 붙여넣거나 모의고사 DB 에서 불러올 수 있다.
 */
export const VIP_PASSAGE_ANALYSES_COLLECTION = 'vip_passage_analyses';

/** 출제 포인트 — 문장 내 단어/구/문장을 짚어 "문제로 낼 만한 것"을 구조화 메모.
 *  추후 AI/변형엔진이 (target, scope, qType, note) 를 입력으로 받아 문제를 생성할 수 있게 설계. */
export const MARK_SCOPES = ['word', 'phrase', 'sentence'] as const;
export type MarkScope = (typeof MARK_SCOPES)[number];
/** 예상 문제 유형 — 기존 변형문제 유형과 정렬(추후 자동 생성 매핑). 자유 입력도 허용. */
export const MARK_QTYPES = ['빈칸', '어법', '어휘', '순서', '삽입', '요약', '무관', '함의', '주제', '제목', '주장', '영작', '기타'] as const;

export interface VipAnalysisMark {
  scope: MarkScope;  // 단어/구/문장
  target: string;    // 짚은 대상(단어·구 텍스트). 문장 범위면 비워둘 수 있음
  qType: string;     // 예상 문제 유형
  note: string;      // 출제 메모(왜 낼만한지·함정 등)
}

export interface VipAnalysisSentence {
  en: string;
  ko: string;   // 해석
  note: string; // 구문/어법 메모(문장 전체)
  marks: VipAnalysisMark[]; // 출제 포인트
}
export interface VipAnalysisVocab {
  word: string;
  meaning: string;
}

export interface VipPassageAnalysis {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  title: string;
  source: string;   // 출처/교재 (자유 입력)
  passageId?: string; // DB 지문에서 불러온 경우 원본 passages._id
  sentences: VipAnalysisSentence[];
  vocab: VipAnalysisVocab[];
  grammarNote: string; // 종합 어법/구문 메모
  summary: string;     // 주제·요약
  createdAt: Date;
  updatedAt?: Date;
}

let _indexed = false;
export async function ensurePassageAnalysisIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await db.collection(VIP_PASSAGE_ANALYSES_COLLECTION).createIndex({ userId: 1, updatedAt: -1 });
}

export function normalizeMarks(raw: unknown): VipAnalysisMark[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 30)
    .map((m) => {
      const o = m && typeof m === 'object' ? (m as Record<string, unknown>) : {};
      const scope = (MARK_SCOPES as readonly string[]).includes(String(o.scope)) ? (o.scope as MarkScope) : 'word';
      return {
        scope,
        target: String(o.target ?? '').trim().slice(0, 300),
        qType: String(o.qType ?? '').trim().slice(0, 20),
        note: String(o.note ?? '').slice(0, 600),
      };
    })
    .filter((m) => m.target || m.qType || m.note);
}

export function normalizeSentences(raw: unknown): VipAnalysisSentence[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 300)
    .map((s) => {
      const o = s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
      return {
        en: String(o.en ?? '').slice(0, 2000),
        ko: String(o.ko ?? '').slice(0, 2000),
        note: String(o.note ?? '').slice(0, 1000),
        marks: normalizeMarks(o.marks),
      };
    })
    .filter((s) => s.en || s.ko || s.note || s.marks.length > 0);
}

export function normalizeVocab(raw: unknown): VipAnalysisVocab[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 500)
    .map((v) => {
      const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
      return {
        word: String(o.word ?? '').trim().slice(0, 120),
        meaning: String(o.meaning ?? '').trim().slice(0, 400),
      };
    })
    .filter((v) => v.word || v.meaning);
}

/** 목록용 요약(본문 제외). */
export function analysisListView(a: VipPassageAnalysis) {
  return {
    id: String(a._id),
    title: a.title,
    source: a.source,
    passageId: a.passageId ?? '',
    sentenceCount: a.sentences?.length ?? 0,
    vocabCount: a.vocab?.length ?? 0,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt ?? null,
  };
}

/** 상세(편집)용 전체. */
export function analysisFullView(a: VipPassageAnalysis) {
  return {
    id: String(a._id),
    title: a.title,
    source: a.source,
    passageId: a.passageId ?? '',
    sentences: a.sentences ?? [],
    vocab: a.vocab ?? [],
    grammarNote: a.grammarNote ?? '',
    summary: a.summary ?? '',
    createdAt: a.createdAt,
    updatedAt: a.updatedAt ?? null,
  };
}
