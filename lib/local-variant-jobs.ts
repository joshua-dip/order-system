/**
 * 로컬 LoRA 작업 큐(local_variant_jobs)와 GPU PC 워커 하트비트(local_variant_workers).
 * 웹앱은 작업을 넣고 상태를 읽기만 한다 — 처리는 GPU PC 의 ml/worker/local_variant_worker.py.
 * 두 쪽이 지키는 필드·상태 규약: docs/handoff/2026-09-23-로컬-LoRA-작업큐.md
 */
import { ObjectId, type Db } from 'mongodb';
import type {
  LocalVariantJobStatus,
  LocalVariantType,
  LocalWorkerTypeInfo,
  LocalWorkerView,
} from '@/lib/local-variant-types';

export const LOCAL_VARIANT_JOBS_COLLECTION = 'local_variant_jobs';
export const LOCAL_VARIANT_WORKERS_COLLECTION = 'local_variant_workers';

/** 워커는 15초마다 하트비트를 남긴다 — 이보다 오래되면 오프라인으로 본다. */
export const LOCAL_WORKER_ONLINE_MS = 45_000;
const FINISHED_JOB_RETENTION_DAYS = 30;

export type LocalVariantJobDoc = {
  _id: ObjectId;
  type: LocalVariantType;
  passage_id: ObjectId;
  textbook: string;
  source: string;
  /** 등록 시 웹앱이 확정한 지문 — 워커는 passages 를 다시 읽지 않는다 */
  paragraph: string;
  status: LocalVariantJobStatus;
  requested_by: string;
  attempts: number;
  claimed_by: string | null;
  claimed_at: Date | null;
  lease_until: Date | null;
  result: {
    question_data: Record<string, unknown>;
    elapsed_ms?: number;
    fake?: boolean;
    adapter?: Record<string, unknown>;
  } | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
};

type LocalWorkerDoc = {
  _id: string;
  last_seen?: Date;
  state?: string;
  model_loaded?: boolean;
  fake?: boolean;
  gpu?: { name?: string } | null;
  current_job?: string | null;
  types?: Partial<Record<LocalVariantType, LocalWorkerTypeInfo>>;
};

let indexesEnsured = false;
async function ensureIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return;
  const jobs = db.collection(LOCAL_VARIANT_JOBS_COLLECTION);
  await Promise.allSettled([
    // 워커가 가장 오래된 대기 작업부터 집는다
    jobs.createIndex({ status: 1, created_at: 1 }, { name: 'status_created_at' }),
    // 끝난 작업은 30일 뒤 자동 삭제 — finished_at 이 없는 대기·진행 작업은 대상이 아니다
    jobs.createIndex(
      { finished_at: 1 },
      { name: 'finished_at_ttl_30d', expireAfterSeconds: FINISHED_JOB_RETENTION_DAYS * 24 * 60 * 60 }
    ),
  ]);
  indexesEnsured = true;
}

export async function enqueueLocalVariantJob(
  db: Db,
  input: {
    type: LocalVariantType;
    passageId: ObjectId;
    textbook: string;
    source: string;
    paragraph: string;
    requestedBy: string;
  }
): Promise<LocalVariantJobDoc> {
  await ensureIndexes(db);
  const now = new Date();
  const doc: LocalVariantJobDoc = {
    _id: new ObjectId(),
    type: input.type,
    passage_id: input.passageId,
    textbook: input.textbook,
    source: input.source,
    paragraph: input.paragraph,
    status: 'queued',
    requested_by: input.requestedBy,
    attempts: 0,
    claimed_by: null,
    claimed_at: null,
    lease_until: null,
    result: null,
    error: null,
    created_at: now,
    updated_at: now,
    finished_at: null,
  };
  await db.collection<LocalVariantJobDoc>(LOCAL_VARIANT_JOBS_COLLECTION).insertOne(doc);
  return doc;
}

export async function getLocalVariantJob(db: Db, id: ObjectId): Promise<LocalVariantJobDoc | null> {
  return db.collection<LocalVariantJobDoc>(LOCAL_VARIANT_JOBS_COLLECTION).findOne({ _id: id });
}

/** 이 작업보다 먼저 들어와 아직 대기 중인 작업 수 */
export async function countQueuedAhead(db: Db, job: LocalVariantJobDoc): Promise<number> {
  return db
    .collection(LOCAL_VARIANT_JOBS_COLLECTION)
    .countDocuments({ status: 'queued', created_at: { $lt: job.created_at } });
}

/**
 * 대기·진행 중인 작업만 취소한다. 진행 중이면 워커가 끝낸 뒤 결과를 버린다
 * (워커의 완료 기록은 status 가 running 일 때만 적용된다).
 */
export async function cancelLocalVariantJob(db: Db, id: ObjectId): Promise<boolean> {
  const now = new Date();
  const r = await db
    .collection<LocalVariantJobDoc>(LOCAL_VARIANT_JOBS_COLLECTION)
    .updateOne(
      { _id: id, status: { $in: ['queued', 'running'] } },
      { $set: { status: 'cancelled', finished_at: now, updated_at: now } }
    );
  return r.modifiedCount === 1;
}

export async function getLocalWorkerStatus(db: Db): Promise<{ online: boolean; workers: LocalWorkerView[] }> {
  const docs = await db
    .collection<LocalWorkerDoc>(LOCAL_VARIANT_WORKERS_COLLECTION)
    .find({})
    .sort({ last_seen: -1 })
    .limit(10)
    .toArray();
  const now = Date.now();
  const workers: LocalWorkerView[] = docs.map((d) => {
    const lastSeen = d.last_seen instanceof Date ? d.last_seen : null;
    const state = typeof d.state === 'string' ? d.state : 'unknown';
    return {
      id: String(d._id),
      // 정상 종료한 워커는 마지막 신호가 최근이어도 오프라인
      online: state !== 'stopped' && lastSeen !== null && now - lastSeen.getTime() < LOCAL_WORKER_ONLINE_MS,
      last_seen: lastSeen ? lastSeen.toISOString() : null,
      state,
      model_loaded: d.model_loaded === true,
      fake: d.fake === true,
      gpu: typeof d.gpu?.name === 'string' ? d.gpu.name : null,
      current_job: typeof d.current_job === 'string' ? d.current_job : null,
      types: d.types && typeof d.types === 'object' ? d.types : {},
    };
  });
  return { online: workers.some((w) => w.online), workers };
}
