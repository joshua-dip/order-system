import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { CONTENT_ERROR_REPORTS_COLLECTION, type ErrorReportStatus } from '@/lib/content-error-reports';

export const dynamic = 'force-dynamic';

const STATUSES: ErrorReportStatus[] = ['open', 'fixed', 'dismissed'];

/** GET ?status=open|fixed|dismissed|all — 최근 100건 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const status = request.nextUrl.searchParams.get('status') ?? 'open';
  const db = await getDb('gomijoshua');
  const col = db.collection(CONTENT_ERROR_REPORTS_COLLECTION);
  const filter = STATUSES.includes(status as ErrorReportStatus) ? { status } : {};
  const [docs, openCount] = await Promise.all([
    col.find(filter).sort({ createdAt: -1 }).limit(100).toArray(),
    col.countDocuments({ status: 'open' }),
  ]);
  return NextResponse.json({
    openCount,
    items: docs.map((d) => ({
      id: String(d._id),
      passageId: String(d.passageId),
      textbook: d.textbook,
      sourceKey: d.sourceKey,
      sentenceIndex: d.sentenceIndex,
      questionId: d.questionId ? String(d.questionId) : null,
      kind: d.kind,
      message: d.message,
      reporter: d.reporter?.loginId ?? '비회원',
      status: d.status,
      createdAt: d.createdAt,
    })),
  });
}

/** PATCH { id, status } */
export async function PATCH(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const body = (await request.json().catch(() => ({}))) as { id?: string; status?: string };
  if (!body.id || !ObjectId.isValid(body.id) || !STATUSES.includes(body.status as ErrorReportStatus)) {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }
  const db = await getDb('gomijoshua');
  const r = await db
    .collection(CONTENT_ERROR_REPORTS_COLLECTION)
    .updateOne({ _id: new ObjectId(body.id) }, { $set: { status: body.status, updatedAt: new Date() } });
  return NextResponse.json({ ok: r.matchedCount === 1 });
}
