import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { checkContentIntegrity } from '@/lib/content-integrity-validation';
import { runPerQuestionValidations } from '@/lib/variant-review-validators';
import {
  cancelLocalVariantJob,
  countQueuedAhead,
  getLocalVariantJob,
  getLocalWorkerStatus,
} from '@/lib/local-variant-jobs';
import type { LocalVariantJobView } from '@/lib/local-variant-types';

/** 로컬 LoRA 작업 상태 — 완료되면 결과와 함께 기존 검증(정합·문항별)을 돌려 보여 준다. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const job = await getLocalVariantJob(db, new ObjectId(id));
    if (!job) return NextResponse.json({ error: '작업을 찾을 수 없습니다.' }, { status: 404 });

    let validation: LocalVariantJobView['validation'] = null;
    const qd = job.status === 'done' ? job.result?.question_data : undefined;
    if (qd) {
      const doc = { type: job.type, option_type: 'English', passage_id: job.passage_id, question_data: qd };
      const issues = [...checkContentIntegrity(doc), ...(await runPerQuestionValidations(db, doc))];
      const pipelineWarnings = Array.isArray(job.result?.warnings)
        ? job.result.warnings.filter((w): w is string => typeof w === 'string' && w.trim() !== '')
        : [];
      validation = {
        errors: issues.filter((i) => i.severity === 'error').map((i) => i.message),
        // 워커가 못 고친 오답(정답으로도 읽힘 등)을 앞에 — 저장 전에 가장 먼저 봐야 할 것
        warnings: [...pipelineWarnings, ...issues.filter((i) => i.severity === 'warning').map((i) => i.message)],
      };
    }

    const item: LocalVariantJobView = {
      _id: String(job._id),
      type: job.type,
      status: job.status,
      attempts: job.attempts ?? 0,
      claimed_by: job.claimed_by ?? null,
      error: job.error ?? null,
      queued_ahead: job.status === 'queued' ? await countQueuedAhead(db, job) : 0,
      created_at: job.created_at ? job.created_at.toISOString() : null,
      finished_at: job.finished_at ? job.finished_at.toISOString() : null,
      result: qd
        ? {
            question_data: qd,
            elapsed_ms: typeof job.result?.elapsed_ms === 'number' ? job.result.elapsed_ms : null,
            fake: job.result?.fake === true,
          }
        : null,
      validation,
    };
    // 기다리는 동안 화면이 「워커 오프라인」「GPU 사용 중」을 보여 줄 수 있게 워커 상태도 함께
    const worker =
      job.status === 'queued' || job.status === 'running' ? await getLocalWorkerStatus(db) : undefined;
    return NextResponse.json({ ok: true, item, ...(worker ? { worker } : {}) });
  } catch (e) {
    console.error('local-jobs GET id:', e);
    return NextResponse.json({ error: '작업 조회에 실패했습니다.' }, { status: 500 });
  }
}

/** 대기·진행 중인 작업 취소 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 ID입니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const cancelled = await cancelLocalVariantJob(db, new ObjectId(id));
    return NextResponse.json({ ok: true, cancelled });
  } catch (e) {
    console.error('local-jobs DELETE:', e);
    return NextResponse.json({ error: '작업 취소에 실패했습니다.' }, { status: 500 });
  }
}
