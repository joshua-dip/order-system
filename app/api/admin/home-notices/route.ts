import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import {
  HOME_NOTICE_COLLECTION,
  ensureHomeNoticeIndexes,
  isSafeNoticeLink,
  normalizeNoticeInput,
} from '@/lib/home-notices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 관리자 — 홈 공지 전체 목록 (비활성·기간 지난 것도 함께) */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const db = await getDb('gomijoshua');
  await ensureHomeNoticeIndexes(db);
  const docs = await db
    .collection(HOME_NOTICE_COLLECTION)
    .find({})
    .sort({ pinned: -1, order: 1, createdAt: -1 })
    .limit(200)
    .toArray();

  return NextResponse.json({
    ok: true,
    items: docs.map((d) => ({ ...d, _id: undefined, id: String(d._id) })),
  });
}

/** 관리자 — 홈 공지 새로 작성 */
export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const input = normalizeNoticeInput(raw);

  if (!input.title) {
    return NextResponse.json({ ok: false, error: '한 줄 문구(제목)를 입력해 주세요.' }, { status: 400 });
  }
  if (!isSafeNoticeLink(input.linkUrl)) {
    return NextResponse.json(
      { ok: false, error: '링크는 내부 경로(/…) 또는 http(s) 주소만 넣을 수 있습니다.' },
      { status: 400 },
    );
  }

  const db = await getDb('gomijoshua');
  await ensureHomeNoticeIndexes(db);
  const now = new Date();
  const res = await db.collection(HOME_NOTICE_COLLECTION).insertOne({
    ...input,
    createdAt: now,
    updatedAt: now,
    createdBy: payload?.loginId ?? 'admin',
  });

  return NextResponse.json({ ok: true, id: String(res.insertedId) });
}
