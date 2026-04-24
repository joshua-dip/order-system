import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { DRAFTS_COLLECTION, type EmailDraftDoc as _EmailDraftDoc } from '@/lib/email-drafts-store';

type EmailDraftDoc = _EmailDraftDoc & { _id: ObjectId };

/** GET /api/admin/email-drafts — 초안 목록 (최신순 50개) */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const db = await getDb('gomijoshua');
  const col = db.collection<EmailDraftDoc>(DRAFTS_COLLECTION);

  const sp = request.nextUrl.searchParams;
  const statusFilter = sp.get('status') || 'draft';

  const validStatus = statusFilter === 'sent' ? 'sent' : 'draft';
  const items = await col
    .find({ status: validStatus })
    .sort({ updatedAt: -1 })
    .limit(50)
    .toArray();

  return NextResponse.json({
    items: items.map((d) => ({
      id: String(d._id),
      orderId: d.orderId ? String(d.orderId) : null,
      orderNumber: d.orderNumber,
      loginId: d.loginId,
      to: d.to,
      subject: d.subject,
      message: d.message,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      sentAt: d.sentAt?.toISOString() ?? null,
    })),
  });
}

/** POST /api/admin/email-drafts — 초안 생성 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const to = typeof body.to === 'string' ? body.to.trim() : '';
  const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const orderNumber = typeof body.orderNumber === 'string' ? body.orderNumber.trim() : '';
  const loginId = typeof body.loginId === 'string' ? body.loginId.trim() : null;
  const orderIdRaw = typeof body.orderId === 'string' ? body.orderId.trim() : '';

  if (!to || !subject) {
    return NextResponse.json({ error: '받는 사람과 제목이 필요합니다.' }, { status: 400 });
  }

  const now = new Date();
  const doc: Omit<EmailDraftDoc, '_id'> = {
    orderId: orderIdRaw && ObjectId.isValid(orderIdRaw) ? new ObjectId(orderIdRaw) : null,
    orderNumber,
    loginId: loginId || null,
    to,
    subject,
    message,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };

  const db = await getDb('gomijoshua');
  const col = db.collection<EmailDraftDoc>(DRAFTS_COLLECTION);
  const r = await col.insertOne(doc as EmailDraftDoc);

  return NextResponse.json({ ok: true, id: String(r.insertedId) });
}
