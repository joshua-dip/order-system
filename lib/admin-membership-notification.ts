/**
 * 멤버십 신청이 들어오면 관리자에게 이메일 알림 발송 (Resend).
 *
 * 환경변수:
 *   - RESEND_API_KEY (필수 — 미설정이면 silent skip + console.warn)
 *   - RESEND_FROM_EMAIL (선택 — 없으면 'noreply@resend.dev')
 *   - ADMIN_NOTIFICATION_EMAIL (선택 — 콤마 구분 다중 가능. 없으면 fallback 'payperic@naver.com')
 *   - NEXT_PUBLIC_SITE_URL (선택 — 관리자 페이지 절대 URL 생성용)
 */

import {
  APPLICANT_TYPE_LABELS,
  type MembershipApplicationRow,
} from './membership-applications-store';
import { getPublicSiteUrl } from './site-branding';

const FALLBACK_ADMIN_EMAIL = 'payperic@naver.com';
const FALLBACK_FROM = 'noreply@resend.dev';

/** ADMIN_NOTIFICATION_EMAIL 을 콤마/세미콜론/공백 구분으로 파싱. 비어 있으면 fallback. */
function resolveRecipients(): string[] {
  const raw = process.env.ADMIN_NOTIFICATION_EMAIL?.trim() ?? '';
  if (!raw) return [FALLBACK_ADMIN_EMAIL];
  const parts = raw
    .split(/[,;\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [FALLBACK_ADMIN_EMAIL];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatKoreanDate(d: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

function buildHtml(row: MembershipApplicationRow): string {
  const typeLabel = APPLICANT_TYPE_LABELS[row.applicantType] ?? row.applicantType;
  const appliedAt =
    row.appliedAt instanceof Date
      ? formatKoreanDate(row.appliedAt)
      : String(row.appliedAt ?? '');
  const origin = getPublicSiteUrl();
  const adminUrl = origin
    ? `${origin}/admin/membership-applications`
    : '/admin/membership-applications';
  const ipLine = row.ip ? `<tr><td style="padding:6px 12px;color:#6b7280;font-size:12px;">IP</td><td style="padding:6px 12px;font-size:13px;">${escapeHtml(row.ip)}</td></tr>` : '';

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','맑은 고딕','Malgun Gothic',sans-serif;color:#111827;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <div style="background:#111827;color:#fff;padding:14px 20px;font-weight:700;font-size:15px;">
      🆕 신규 멤버십 가입 신청
    </div>
    <div style="padding:18px 20px;">
      <p style="margin:0 0 14px;font-size:14px;color:#374151;line-height:1.6;">
        새 가입 신청이 들어왔습니다. 아래 정보를 확인하고 「관리자 페이지」 에서 처리해 주세요.
      </p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:16px;">
        <tbody>
          <tr><td style="padding:6px 12px;color:#6b7280;font-size:12px;width:80px;background:#f9fafb;">유형</td><td style="padding:6px 12px;font-size:13px;font-weight:600;">${escapeHtml(typeLabel)}</td></tr>
          <tr><td style="padding:6px 12px;color:#6b7280;font-size:12px;background:#f9fafb;">이름</td><td style="padding:6px 12px;font-size:13px;font-weight:600;">${escapeHtml(row.name)}</td></tr>
          <tr><td style="padding:6px 12px;color:#6b7280;font-size:12px;background:#f9fafb;">전화</td><td style="padding:6px 12px;font-size:13px;"><a href="tel:${escapeHtml(row.phone)}" style="color:#1d4ed8;text-decoration:none;">${escapeHtml(row.phone)}</a></td></tr>
          <tr><td style="padding:6px 12px;color:#6b7280;font-size:12px;background:#f9fafb;">신청 시각</td><td style="padding:6px 12px;font-size:13px;">${escapeHtml(appliedAt)} (KST)</td></tr>
          ${ipLine}
        </tbody>
      </table>
      <a href="${escapeHtml(adminUrl)}"
         style="display:inline-block;background:#059669;color:#fff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:6px;font-size:13px;">
        🔗 관리자 페이지에서 보기
      </a>
      <p style="margin:18px 0 0;font-size:11px;color:#9ca3af;line-height:1.6;">
        이 메일은 자동 발송됨 — 회신 불필요. 알림 끄려면 서버의 ADMIN_NOTIFICATION_EMAIL 환경변수를 비우거나 RESEND_API_KEY 를 제거.
      </p>
    </div>
  </div>
</body></html>`;
}

/**
 * 멤버십 신청 알림 이메일 발송. 실패해도 throw 하지 않고 console.error 로 남김 —
 * 신청 INSERT 트랜잭션을 망치지 않기 위함. 호출부에서 await 해도 안전.
 */
export async function sendMembershipApplicationNotification(
  row: MembershipApplicationRow,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      console.warn('[admin-membership-notification] RESEND_API_KEY 미설정 — 알림 건너뜀');
      return { ok: false, reason: 'no-api-key' };
    }
    const recipients = resolveRecipients();
    if (recipients.length === 0) {
      return { ok: false, reason: 'no-recipient' };
    }
    const from = process.env.RESEND_FROM_EMAIL?.trim() || FALLBACK_FROM;
    const typeLabel = APPLICANT_TYPE_LABELS[row.applicantType] ?? row.applicantType;
    const subject = `[가입 신청] ${typeLabel} · ${row.name} (${row.phone})`;
    const html = buildHtml(row);

    const { Resend } = await import('resend');
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({ from, to: recipients, subject, html });
    if (result.error) {
      console.error('[admin-membership-notification] Resend error:', result.error);
      return { ok: false, reason: result.error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error('[admin-membership-notification] unexpected error:', e);
    return { ok: false, reason: (e as Error).message ?? 'error' };
  }
}
