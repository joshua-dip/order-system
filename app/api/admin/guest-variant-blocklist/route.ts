import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  addBlocklistEntry,
  listBlocklist,
  type BlocklistKind,
} from '@/lib/guest-variant-blocklist';

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  try {
    const items = await listBlocklist();
    return NextResponse.json({
      items: items.map((r) => ({
        _id: String(r._id),
        kind: r.kind,
        value: r.value,
        reason: r.reason || '',
        created_at:
          r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        created_by: r.created_by || '',
      })),
    });
  } catch (e) {
    console.error('blocklist GET:', e);
    return NextResponse.json({ error: '조회 실패' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON 본문 필요' }, { status: 400 });
  }

  const kindRaw = typeof body.kind === 'string' ? body.kind.trim() : '';
  if (kindRaw !== 'ip_hash' && kindRaw !== 'api_key_hint') {
    return NextResponse.json(
      { error: 'kind는 ip_hash 또는 api_key_hint 여야 합니다.' },
      { status: 400 },
    );
  }
  const kind: BlocklistKind = kindRaw;
  const value = typeof body.value === 'string' ? body.value.trim() : '';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  const r = await addBlocklistEntry({
    kind,
    value,
    reason,
    created_by: payload?.loginId,
  });
  if (!r.ok) return NextResponse.json({ error: r.error || '등록 실패' }, { status: 400 });
  return NextResponse.json({ ok: true, _id: r._id });
}
