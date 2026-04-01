import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { runQuestionCountValidation } from '@/lib/question-count-validation';
import {
  getQuestionCountSnapshotsCollection,
  questionCountPayloadToStored,
} from '@/lib/question-count-snapshot-db';

/**
 * 현재 조건으로 문제수 검증을 다시 실행한 뒤, 결과 전체를
 * `question_count_validation_snapshots` 컬렉션에 저장합니다.
 */
export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const textbookParam = typeof body.textbook === 'string' ? body.textbook.trim() : '';
  const orderIdRaw = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  const orderNumberRaw = typeof body.orderNumber === 'string' ? body.orderNumber.trim() : '';
  const requiredPerTypeRaw =
    body.requiredPerType != null && body.requiredPerType !== ''
      ? String(body.requiredPerType)
      : null;
  const questionStatusRaw =
    typeof body.questionStatus === 'string' ? body.questionStatus.trim() : '';

  const result = await runQuestionCountValidation({
    textbookParam,
    orderIdRaw,
    orderNumberRaw: orderNumberRaw || null,
    requiredPerTypeRaw,
    questionStatusRaw: questionStatusRaw || null,
  });

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  const report = questionCountPayloadToStored(result);
  const col = await getQuestionCountSnapshotsCollection();
  const doc = {
    saved_at: new Date(),
    saved_by_login_id: payload?.loginId ?? null,
    note: note || null,
    query: {
      scope: report.scope,
      textbook: report.textbook,
      order_id: report.order?.id ?? null,
      required_per_type: report.requiredPerType,
      question_status: report.questionStatusScope,
    },
    report,
  };

  const r = await col.insertOne(doc);
  return NextResponse.json({
    ok: true,
    id: String(r.insertedId),
    collection: 'question_count_validation_snapshots',
  });
}
