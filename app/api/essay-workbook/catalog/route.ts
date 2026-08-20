import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { isMockExamTextbookKey } from '@/lib/mock-exam-key';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 서술형 워크북 — 주문 가능한 교재 목록.
 *
 * 부교재만 취급한다(모의고사 서술형은 payperic.com 에서 판매).
 * 그중에서도 **관리자가 그 회원에게 열어 준 교재**만 보여 준다 —
 * 다른 변형·워크북 주문 화면과 같은 규칙(allowedTextbooks*).
 */
export async function GET(request: NextRequest) {
  try {
    const db = await getDb('gomijoshua');
    const rows = await db
      .collection('essay_exams')
      .aggregate([
        { $match: { isPlaceholder: { $ne: true }, textbook: { $nin: ['', null] } } },
        { $group: { _id: { textbook: '$textbook', sourceKey: '$sourceKey' } } },
        { $group: { _id: '$_id.textbook', sourceCount: { $sum: 1 } } },
        { $match: { sourceCount: { $gt: 0 } } },
        { $sort: { _id: 1 } },
      ])
      .toArray();

    // 모의고사 서술형 워크북은 payperic.com 에서 판매한다. 여기서는 부교재만 노출.
    const all = rows.map((r) => ({ textbook: String(r._id), sourceCount: r.sourceCount as number }));
    const supplementary = all.filter((t) => !isMockExamTextbookKey(t.textbook));

    // 관리자가 열어 준 교재만 — 비로그인이면 목록이 비고, 로그인 안내를 띄운다.
    const token = request.cookies.get(COOKIE_NAME)?.value;
    const payload = token ? await verifyToken(token).catch(() => null) : null;
    if (!payload?.loginId) {
      return NextResponse.json({ ok: true, textbooks: [], needLogin: true });
    }

    const user = await db.collection('users').findOne(
      { loginId: payload.loginId },
      { projection: { allowedTextbooks: 1, allowedTextbooksEssay: 1, allowedTextbooksWorkbook: 1, allowedTextbooksVariant: 1 } },
    );
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    const allowed = new Set([
      ...arr(user?.allowedTextbooks),
      ...arr(user?.allowedTextbooksEssay),
      ...arr(user?.allowedTextbooksWorkbook),
      ...arr(user?.allowedTextbooksVariant),
    ]);
    // 관리자는 전부 볼 수 있게 둔다(자료 확인·상담용)
    const isAdmin = payload.role === 'admin';
    const textbooks = isAdmin ? supplementary : supplementary.filter((t) => allowed.has(t.textbook));

    return NextResponse.json({ ok: true, textbooks, allowedOnly: !isAdmin });
  } catch (e) {
    console.error('[essay-workbook catalog]', e);
    return NextResponse.json({ ok: true, textbooks: [] });
  }
}
