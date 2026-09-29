/**
 * 문항 이력(provenance) — generated_questions 문서의 provenance 필드에 「누가·언제·무엇으로 만들고, 누가·언제·어떻게 검수했나」를 남긴다.
 * 데이터 분석용(모델·어댑터·유형·시간·판정별 집계). 기존 필드는 건드리지 않고 provenance.* 만 $set 한다.
 *   provenance.generation — 로컬 워커 생성: 워커·엔진·기본 모델·어댑터·추론 모델·파이프라인·작업/묶음·시각·소요·시도
 *   provenance.saved      — 대기 저장: 언제·누가(자동 공급기/수동)·사전 검증 통과
 *   provenance.review     — 검수: 누가(claude-code)·모델·방법(블라인드 풀이 → 키 대조)·판정 O/P/X·결함 태그·메모·블라인드 답·시각
 */
import type { Db } from 'mongodb';
import { ObjectId } from 'mongodb';

type AnyDoc = Record<string, any>;
const date = (v: unknown) => (v ? new Date(String((v as any)?.$date ?? v)) : undefined);

export interface GenerationProvenance {
  by: 'local-worker';
  worker?: string;
  backend?: string;
  base_model?: string;
  adapter?: string | null;
  reasoner?: string;
  pipeline?: string;
  code_commit?: string;
  job_id: string;
  batch_id?: string;
  job_created_at?: Date;
  started_at?: Date;
  finished_at?: Date;
  seconds?: number;
  attempts?: number;
  warnings?: number;
}

/** 작업 문서(+워커 스냅샷·묶음 manifest)에서 생성 이력 */
export function generationProvenance(job: AnyDoc, worker?: AnyDoc | null, manifest?: AnyDoc | null): GenerationProvenance {
  const r = job.result ?? {};
  const ad = r.adapter ?? {};
  const ms = Number(r.elapsed_ms);
  return {
    by: 'local-worker',
    worker: job.claimed_by ?? worker?._id,
    backend: worker?.backend,
    base_model: ad.base_model ?? worker?.base_model,
    adapter: ad.main ? `${ad.main}-lora` : null,
    reasoner: worker?.reasoner,
    pipeline: ad.main ?? (r.pipeline && typeof r.pipeline === 'object' ? Object.keys(r.pipeline)[0] : undefined),
    code_commit: manifest?.code_commit,
    job_id: String(job._id),
    batch_id: manifest?.batch_id ?? (typeof job.requested_by === 'string' ? job.requested_by.split(':')[1] : undefined),
    job_created_at: date(job.created_at),
    started_at: date(job.claimed_at),
    finished_at: date(job.finished_at),
    seconds: Number.isFinite(ms) ? Math.round(ms / 100) / 10 : undefined,
    attempts: Number(job.attempts) || undefined,
    warnings: Array.isArray(r.warnings) ? r.warnings.length : undefined,
  };
}

export async function setGenerationProvenance(db: Db, questionId: string | ObjectId, gen: GenerationProvenance, saved: { at?: Date; by: string; prevalidated: boolean }) {
  const clean = Object.fromEntries(Object.entries(gen).filter(([, v]) => v !== undefined));
  return db.collection('generated_questions').updateOne({ _id: new ObjectId(String(questionId)) },
    { $set: { 'provenance.generation': clean, 'provenance.saved': { ...saved, at: saved.at ?? new Date() } } });
}

export interface ReviewProvenance {
  by: 'claude-code';
  model: string;
  method: 'blind-solve+key-check';
  verdict: 'O' | 'P' | 'X';
  tags: string[];
  note?: string;
  blind_answer?: string;
  at: Date;
  shard?: string;
  outcome?: string;
  /** 검수 토큰 — 에이전트는 묶음 단위로 풀어 문항별 정확값은 없다: 묶음 합계 ÷ 문항 수 */
  usage?: { shard_tokens: number | null; shard_questions: number; tokens_per_question: number | null; duration_ms: number | null; model?: string };
}
export async function setReviewProvenance(db: Db, questionId: string | ObjectId, review: ReviewProvenance) {
  return db.collection('generated_questions').updateOne({ _id: new ObjectId(String(questionId)) }, { $set: { 'provenance.review': review } });
}
