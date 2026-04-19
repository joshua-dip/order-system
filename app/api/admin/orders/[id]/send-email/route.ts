import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export const maxDuration = 30;

/** 주문 상태 한글 */
const STATUS_LABELS: Record<string, string> = {
  pending: '주문 접수',
  accepted: '제작 수락',
  payment_confirmed: '입금 확인',
  in_progress: '제작 중',
  completed: '완료',
  cancelled: '취소됨',
};

/** 주문 이메일 HTML 생성 */
function buildOrderEmailHtml({
  orderNumber,
  createdAt,
  status,
  orderText,
  fileUrl,
  recipientName,
}: {
  orderNumber: string;
  createdAt: string;
  status: string;
  orderText: string;
  fileUrl: string | null;
  recipientName?: string;
}): string {
  const statusLabel = STATUS_LABELS[status] || status;
  const dateStr = createdAt
    ? new Date(createdAt).toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const greeting = recipientName ? `안녕하세요, ${recipientName}님.` : '안녕하세요.';

  const fileSection = fileUrl
    ? `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
          <strong style="color:#374151;">완료 파일</strong>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
          <a href="${fileUrl}" style="color:#4f46e5;text-decoration:none;">파일 받기 →</a>
        </td>
      </tr>`
    : '';

  const orderTextSection = orderText
    ? `<div style="margin-top:24px;">
        <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#374151;">주문 내용</p>
        <pre style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px;font-size:12px;color:#4b5563;white-space:pre-wrap;word-break:break-word;margin:0;">${orderText.slice(0, 2000)}${orderText.length > 2000 ? '\n…(생략)' : ''}</pre>
      </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:580px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
    <!-- 헤더 -->
    <div style="background:#4f46e5;padding:28px 32px;">
      <p style="margin:0;color:#c7d2fe;font-size:13px;">주문 내역 안내</p>
      <h1 style="margin:6px 0 0;color:#fff;font-size:22px;font-weight:700;">${orderNumber}</h1>
    </div>
    <!-- 본문 -->
    <div style="padding:28px 32px;">
      <p style="margin:0 0 20px;color:#374151;font-size:15px;">${greeting}</p>
      <p style="margin:0 0 24px;color:#6b7280;font-size:14px;">주문 내역을 안내드립니다.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151;">
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;width:120px;">
            <strong>주문번호</strong>
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-family:monospace;">${orderNumber}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;"><strong>주문 일시</strong></td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">${dateStr}</td>
        </tr>
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;"><strong>상태</strong></td>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;">
            <span style="display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;background:${status === 'completed' ? '#d1fae5' : '#e0e7ff'};color:${status === 'completed' ? '#065f46' : '#3730a3'};">${statusLabel}</span>
          </td>
        </tr>
        ${fileSection}
      </table>
      ${orderTextSection}
      <p style="margin:28px 0 0;color:#9ca3af;font-size:12px;border-top:1px solid #f3f4f6;padding-top:20px;">
        문의 사항이 있으시면 답장으로 연락해 주세요.
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 });
  }

  const to = typeof body.to === 'string' ? body.to.trim() : '';
  const subjectOverride = typeof body.subject === 'string' ? body.subject.trim() : '';
  const extraMessage = typeof body.message === 'string' ? body.message.trim() : '';

  // 첨부파일: [{ filename, content(base64), contentType }]
  type AttachmentInput = { filename?: string; content?: string; contentType?: string };
  const rawAttachments = Array.isArray(body.attachments)
    ? (body.attachments as unknown[]).filter(
        (a): a is AttachmentInput =>
          typeof a === 'object' && a !== null && typeof (a as AttachmentInput).content === 'string',
      )
    : [];

  if (!to) {
    return NextResponse.json({ error: '받는 사람 이메일이 필요합니다.' }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: 'RESEND_API_KEY가 설정되지 않았습니다. .env.local에 추가해 주세요.' },
      { status: 503 },
    );
  }

  // 주문 조회
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '잘못된 주문 ID입니다.' }, { status: 400 });
  }
  const db = await getDb('gomijoshua');
  const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
  if (!order) {
    return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
  }

  // 회원 이름 조회 (있으면)
  let recipientName: string | undefined;
  if (order.loginId) {
    const user = await db
      .collection('users')
      .findOne({ loginId: order.loginId }, { projection: { name: 1 } });
    if (user?.name && typeof user.name === 'string') recipientName = user.name;
  }

  const orderNumber = (order.orderNumber as string | null) ?? `주문 ${id.slice(-6)}`;
  const status = (order.status as string | null) ?? 'pending';
  const orderText = typeof order.orderText === 'string' ? order.orderText : '';
  const fileUrl = typeof order.fileUrl === 'string' && order.fileUrl ? order.fileUrl : null;
  const createdAt =
    order.createdAt instanceof Date
      ? order.createdAt.toISOString()
      : typeof order.createdAt === 'string'
        ? order.createdAt
        : '';

  const subject = subjectOverride || `[주문서] ${orderNumber} 주문 내역 안내`;
  let html = buildOrderEmailHtml({ orderNumber, createdAt, status, orderText, fileUrl, recipientName });
  if (extraMessage) {
    html = html.replace(
      '<p style="margin:0 0 20px;color:#374151;font-size:15px;">',
      `<div style="background:#f0f9ff;border-left:4px solid #4f46e5;padding:12px 16px;border-radius:0 6px 6px 0;margin-bottom:20px;font-size:14px;color:#374151;">${extraMessage.replace(/\n/g, '<br>')}</div><p style="margin:0 0 20px;color:#374151;font-size:15px;">`,
    );
  }

  const from =
    process.env.RESEND_FROM_EMAIL?.trim() ||
    'noreply@resend.dev';

  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);

  const attachments = rawAttachments.map((a) => ({
    filename: a.filename || '첨부파일',
    content: Buffer.from(a.content!, 'base64'),
    content_type: a.contentType || 'application/octet-stream',
  }));

  const result = await resend.emails.send({
    from,
    to,
    subject,
    html,
    attachments: attachments.length > 0 ? attachments : undefined,
  });

  if (result.error) {
    console.error('send-email resend error:', result.error);
    return NextResponse.json({ error: result.error.message }, { status: 502 });
  }

  return NextResponse.json({ ok: true, emailId: result.data?.id });
}
