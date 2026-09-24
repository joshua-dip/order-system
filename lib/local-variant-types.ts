/**
 * 로컬 LoRA(GPU PC) 변형문제 유형 표 — 관리자 화면·API·CLI 가 이 표 하나를 쓴다.
 * 클라이언트 컴포넌트에서도 import 하므로 서버 전용 모듈(mongodb 등)을 가져오지 않는다.
 */
export const LOCAL_VARIANT_TYPES = {
  주제: { en: 'topic', aiSource: 'local-topic-lora' },
  제목: { en: 'title', aiSource: 'local-title-lora' },
  주장: { en: 'claim', aiSource: 'local-claim-lora' },
  // 일치·불일치는 LoRA 하나(ml/fact)를 같이 쓴다 — 워커가 한글 유형명으로 어느 쪽인지 파이프라인에 넘긴다
  일치: { en: 'match', aiSource: 'local-fact-lora' },
  불일치: { en: 'mismatch', aiSource: 'local-fact-lora' },
} as const;

export type LocalVariantType = keyof typeof LOCAL_VARIANT_TYPES;

export const LOCAL_VARIANT_TYPE_NAMES = Object.keys(LOCAL_VARIANT_TYPES) as LocalVariantType[];

export function isLocalVariantType(t: string): t is LocalVariantType {
  return Object.prototype.hasOwnProperty.call(LOCAL_VARIANT_TYPES, t);
}

/** 한글(주제) 또는 영문(topic) 표기를 받아 한글 유형명으로. 모르면 null. */
export function resolveLocalVariantType(raw: string): LocalVariantType | null {
  const t = raw.trim();
  if (isLocalVariantType(t)) return t;
  const lower = t.toLowerCase();
  return LOCAL_VARIANT_TYPE_NAMES.find((k) => LOCAL_VARIANT_TYPES[k].en === lower) ?? null;
}

const LOCAL_VARIANT_AI_SOURCES: ReadonlySet<string> = new Set(
  LOCAL_VARIANT_TYPE_NAMES.map((k) => LOCAL_VARIANT_TYPES[k].aiSource)
);

/** 저장 요청의 ai_source — 로컬 LoRA 값만 받는다(임의 문자열이 기록되지 않게). */
export function acceptedLocalAiSource(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return LOCAL_VARIANT_AI_SOURCES.has(v) ? v : null;
}

export type LocalVariantJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** GET …/local-jobs/[id] 응답의 item */
export type LocalVariantJobView = {
  _id: string;
  type: LocalVariantType;
  status: LocalVariantJobStatus;
  attempts: number;
  claimed_by: string | null;
  error: string | null;
  queued_ahead: number;
  created_at: string | null;
  finished_at: string | null;
  result: {
    question_data: Record<string, unknown>;
    elapsed_ms: number | null;
    fake: boolean;
  } | null;
  validation: { errors: string[]; warnings: string[] } | null;
};

export type LocalWorkerTypeInfo = { trained: boolean; explain: boolean; base_model: string | null };

/** GET …/local-worker 응답의 workers[] */
export type LocalWorkerView = {
  id: string;
  online: boolean;
  last_seen: string | null;
  state: string;
  model_loaded: boolean;
  fake: boolean;
  gpu: string | null;
  current_job: string | null;
  types: Partial<Record<LocalVariantType, LocalWorkerTypeInfo>>;
};
