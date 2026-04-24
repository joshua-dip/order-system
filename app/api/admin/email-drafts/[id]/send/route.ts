import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { DRAFTS_COLLECTION, type EmailDraftDoc as _EmailDraftDoc } from '@/lib/email-drafts-store';
import { buildOrderEmailHtml } from '@/lib/email-order-template';

type EmailDraftDoc = _EmailDraftDoc & { _id: ObjectId };

export const maxDuration = 30;

/** POST /api/admin/email-drafts/[id]/send — 초안 발송 (첨부 포함) */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: '잘못된 ID' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  // 최신 to/subject/message 는 body 에서 덮어쓸 수 있음
  const toOverride = typeof body.to === 'string' ? body.to.trim() : '';
  const subjectOverride = typeof body.subject === 'string' ? body.subject.trim() : '';
  const messageOverride = typeof body.message === 'string' ? body.message.trim() : '';

  // 첨부파일
  type AttachmentInput = { filename?: string; content?: string; contentType?: string };
  const rawAttachments = Array.isArray(body.attachments)
    ? (body.attachments as unknown[]).filter(
        (a): a is AttachmentInput =>
          typeof a === 'object' && a !== null && typeof (a as AttachmentInput).content === 'string',
      )
    : [];

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'RESEND_API_KEY가 설정되지 않았습니다.' },
      { status: 503 },
    );
  }

  const db = await getDb('gomijoshua');
  const col = db.collection<EmailDraftDoc>(DRAFTS_COLLECTION);
  const draft = await col.findOne({ _id: new ObjectId(id) });
  if (!draft) return NextResponse.json({ error: '초안을 찾을 수 없습니다.' }, { status: 404 });
  if (draft.status === 'sent') {
    return NextResponse.json({ error: '이미 발송된 초안입니다.' }, { status: 409 });
  }

  const to = toOverride || draft.to;
  const subject = subjectOverride || draft.subject;
  const message = messageOverride || draft.message;

  if (!to) return NextResponse.json({ error: '받는 사람 이메일이 필요합니다.' }, { status: 400 });

  // 주문 정보 조회 (있으면)
  let orderNumber = draft.orderNumber;
  let createdAt = '';
  let status = '';
  let orderText = '';
  let fileUrl: string | null = null;
  let recipientName: string | undefined;

  if (draft.orderId) {
    const order = await db.collection('orders').findOne({ _id: draft.orderId });
    if (order) {
      orderNumber = (order.orderNumber as string | null) ?? orderNumber;
      createdAt =
        order.createdAt instanceof Date
          ? order.createdAt.toISOString()
          : typeof order.createdAt === 'string'
            ? order.createdAt
            : '';
      status = (order.status as string | null) ?? '';
      orderText = typeof order.orderText === 'string' ? order.orderText : '';
      fileUrl = typeof order.fileUrl === 'string' && order.fileUrl ? order.fileUrl : null;
    }
  }

  if (draft.loginId) {
    const user = await db
      .collection('users')
      .findOne({ loginId: draft.loginId }, { projection: { name: 1 } });
    if (user?.name && typeof user.name === 'string') recipientName = user.name;
  }

  let html = buildOrderEmailHtml({ orderNumber, createdAt, status, orderText, fileUrl, recipientName });
  if (message) {
    html = html.replace(
      '<p style="margin:0 0 20px;color:#374151;font-size:15px;">',
      `<div style="background:#f0f9ff;border-left:4px solid #4f46e5;padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:20px;font-size:14px;color:#374151;">${message.replace(/\n/g, '<br>')}</div><p style="margin:0 0 20px;color:#374151;font-size:15px;">`,
    );
  }

  const from = process.env.RESEND_FROM_EMAIL?.trim() || 'noreply@resend.dev';

  const attachments = rawAttachments.map((a) => ({
    filename: a.filename || '첨부파일',
    content: Buffer.from(a.content!, 'base64'),
    content_type: a.contentType || 'application/octet-stream',
  }));

  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);

  const result = await resend.emails.send({
    from,
    to,
    subject,
    html,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  if (result.error) {
    console.error('email-drafts send error:', result.error);
    return NextResponse.json({ error: result.error.message }, { status: 502 });
  }

  // 발송 완료 → 상태 업데이트 (to/subject/message 도 최신화)
  await col.updateOne(
    { _id: new ObjectId(id) },
    {
      $set: {
        status: 'sent',
        sentAt: new Date(),
        updatedAt: new Date(),
        to,
        subject,
        message,
      },
    },
  );

  return NextResponse.json({ ok: true, emailId: result.data?.id });
}
