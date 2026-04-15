import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_SHORTAGE_PREVIEW = 40;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 목록 응답용: order_data에서 이메일 등 민감 필드 제거 */
function sanitizeOrderDataForList(raw: unknown): Record<string, unknown> | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = { ...(raw as Record<string, unknown>) };
  delete o.email;
  delete o.phone;
  return o;
}

/**
 * GET /api/admin/order-processing-logs
 * 일괄 처리·HWP 큐 등 order_processing_logs 조회 (관리자 전용).
 *
 * Query:
 * - limit: 기본 50, 최대 200
 * - skip: 페이지네이션 (기본 0)
 * - status: 정확 일치 (예: queued, completed)
 * - batch_id: 정확 일치
 * - order_number: 부분 일치 (대소문자 무시)
 * - order_id: 주문 MongoDB _id 24hex 정확 일치
 *
 * 배치 워커가 문서를 쓸 때 선택 필드를 넣으면 목록에서 스냅샷 vs 라이브 검증을 구분하기 좋습니다:
 * needCreateGrandTotal, pendingReviewTotal, questionStatusScope, validationEngineVersion
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { searchParams } = request.nextUrl;
  const limitRaw = parseInt(searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(MAX_LIMIT, Math.max(1, limitRaw))
    : DEFAULT_LIMIT;
  const skipRaw = parseInt(searchParams.get('skip') || '', 10);
  const skip = Number.isFinite(skipRaw) && skipRaw >= 0 ? skipRaw : 0;

  const status = searchParams.get('status')?.trim() || '';
  const batchId = searchParams.get('batch_id')?.trim() || '';
  const orderNumber = searchParams.get('order_number')?.trim() || '';
  const orderIdHex = searchParams.get('order_id')?.trim() || '';

  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;
  if (batchId) filter.batch_id = batchId;
  if (orderNumber) {
    filter.order_number = { $regex: escapeRegex(orderNumber), $options: 'i' };
  }
  if (orderIdHex && /^[a-f0-9]{24}$/i.test(orderIdHex) && ObjectId.isValid(orderIdHex)) {
    const oid = new ObjectId(orderIdHex);
    filter.$or = [{ order_id: orderIdHex }, { order_id: oid }];
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('order_processing_logs');

    const total = await col.countDocuments(filter);
    const docs = await col
      .find(filter)
      .sort({ processed_at: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    const items = docs.map((doc) => {
      const shortage = Array.isArray(doc.shortage_details) ? doc.shortage_details : [];
      const shortagePreview = shortage.slice(0, MAX_SHORTAGE_PREVIEW);
      const oid = doc.order_id;
      let orderIdStr = '';
      if (typeof oid === 'string' && /^[a-f0-9]{24}$/i.test(oid)) orderIdStr = oid;
      else if (oid && typeof oid === 'object' && '$oid' in oid && typeof (oid as { $oid: string }).$oid === 'string') {
        orderIdStr = (oid as { $oid: string }).$oid;
      } else if (oid instanceof ObjectId) {
        orderIdStr = oid.toHexString();
      }

      const processedAt =
        doc.processed_at instanceof Date
          ? doc.processed_at.toISOString()
          : doc.processed_at && typeof doc.processed_at === 'object' && '$date' in doc.processed_at
            ? new Date((doc.processed_at as { $date: string }).$date).toISOString()
            : null;

      return {
        id: doc._id instanceof ObjectId ? doc._id.toHexString() : String(doc._id),
        batch_id: doc.batch_id != null ? String(doc.batch_id) : '',
        order_id: orderIdStr,
        order_number: doc.order_number != null ? String(doc.order_number) : '',
        textbook: doc.textbook != null ? String(doc.textbook) : '',
        status: doc.status != null ? String(doc.status) : '',
        reason: doc.reason != null ? String(doc.reason) : '',
        processed_at: processedAt,
        shortage_count: shortage.length,
        shortage_preview: shortagePreview,
        /** 배치가 넣는 경우에만 존재 — 스냅샷 vs 라이브 검증 구분용 */
        needCreateGrandTotal:
          typeof doc.needCreateGrandTotal === 'number' && Number.isFinite(doc.needCreateGrandTotal)
            ? doc.needCreateGrandTotal
            : null,
        pendingReviewTotal:
          typeof doc.pendingReviewTotal === 'number' && Number.isFinite(doc.pendingReviewTotal)
            ? doc.pendingReviewTotal
            : null,
        questionStatusScope:
          typeof doc.questionStatusScope === 'string' ? doc.questionStatusScope : null,
        validationEngineVersion:
          typeof doc.validationEngineVersion === 'string' ? doc.validationEngineVersion : null,
        order_data: sanitizeOrderDataForList(doc.order_data),
      };
    });

    return NextResponse.json({
      ok: true,
      total,
      skip,
      limit,
      items,
    });
  } catch (e) {
    console.error('order-processing-logs:', e);
    return NextResponse.json({ error: 'order_processing_logs 조회에 실패했습니다.' }, { status: 500 });
  }
}
