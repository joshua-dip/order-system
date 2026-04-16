import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { hasAnnualMemberMenuAccess } from '@/lib/premium-member';

const COLLECTION = 'annualSharedFiles';

/**
 * 유효 연회원 또는 가입 7일 프리미엄 체험 중 — 무료공유자료 목록(다운로드 URL 없이 id만)
 */
export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  try {
    const db = await getDb('gomijoshua');
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(payload.sub) },
      { projection: { annualMemberSince: 1, signupPremiumTrialUntil: 1 } }
    );
    const since = (user as { annualMemberSince?: Date } | null)?.annualMemberSince;
    const trialUntil = (user as { signupPremiumTrialUntil?: Date } | null)?.signupPremiumTrialUntil;
    if (!hasAnnualMemberMenuAccess({ annualSince: since ?? null, signupPremiumTrialUntil: trialUntil ?? null })) {
      return NextResponse.json({ error: '연회원 전용 메뉴입니다.' }, { status: 403 });
    }

    const rows = await db
      .collection(COLLECTION)
      .find({})
      .project({
        title: 1,
        description: 1,
        originalName: 1,
        contentType: 1,
        size: 1,
        sortOrder: 1,
        uploadedAt: 1,
      })
      .sort({ sortOrder: 1, uploadedAt: -1 })
      .toArray();

    const items = rows.map((d) => ({
      id: String(d._id),
      title: typeof d.title === 'string' ? d.title : '',
      description: typeof d.description === 'string' ? d.description : '',
      originalName: typeof d.originalName === 'string' ? d.originalName : '',
      contentType: typeof d.contentType === 'string' ? d.contentType : 'application/octet-stream',
      size: typeof d.size === 'number' ? d.size : 0,
      uploadedAt: d.uploadedAt instanceof Date ? d.uploadedAt.toISOString() : null,
    }));

    return NextResponse.json({ items });
  } catch (e) {
    console.error('annual-shared-files GET:', e);
    return NextResponse.json({ error: '목록을 불러오지 못했습니다.' }, { status: 500 });
  }
}
