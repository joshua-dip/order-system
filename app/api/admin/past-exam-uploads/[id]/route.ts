import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { ObjectId } from 'mongodb';
import { recordPointLedger } from '@/lib/point-ledger';

// Next.js route 파일은 핸들러·라우트설정 외 export 를 허용하지 않으므로 모듈 로컬 상수로 둔다.
/** 기출 시험지 업로드 1건 보상 포인트 (문제만) — 관리자 승인 시 지급 */
const PAST_EXAM_REWARD_POINTS = 50000;
/** 문제 + 답지(정답·해설)까지 업로드 시 보상 — 문제만 + 1만 */
const PAST_EXAM_REWARD_POINTS_WITH_ANSWERS = 60000;

/** 지급 금액 정규화: 답지 포함(60,000) / 문제만(50,000). 기본 50,000. */
function normalizeAwardAmount(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  return n === PAST_EXAM_REWARD_POINTS_WITH_ANSWERS ? PAST_EXAM_REWARD_POINTS_WITH_ANSWERS : PAST_EXAM_REWARD_POINTS;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload || payload.role !== 'admin') {
    return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
  }

  const { id } = await params;
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 ID입니다.' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const db = await getDb('gomijoshua');
    const uploads = db.collection('pastExamUploads');

    // ── 포인트 지급 승인 (전체 문제 포함 확인 후) ──
    // body.awardAmount 로 문제만(50,000) / 문제+답지(60,000) 선택. 기본 50,000.
    if (body.awardPoints === true) {
      const amount = normalizeAwardAmount(body.awardAmount);
      const withAnswers = amount === PAST_EXAM_REWARD_POINTS_WITH_ANSWERS;
      const doc = await uploads.findOne({ _id: new ObjectId(id) });
      if (!doc) return NextResponse.json({ error: '해당 업로드를 찾을 수 없습니다.' }, { status: 404 });
      if (doc.pointAwarded === true) {
        const prev = typeof doc.pointAwardAmount === 'number' ? doc.pointAwardAmount : PAST_EXAM_REWARD_POINTS;
        return NextResponse.json({ ok: true, already: true, points: prev });
      }
      const loginId = typeof doc.loginId === 'string' ? doc.loginId : '';
      if (!loginId) return NextResponse.json({ error: '업로드한 회원 정보가 없습니다.' }, { status: 400 });
      const users = db.collection('users');
      const user = await users.findOne({ loginId });
      if (!user) return NextResponse.json({ error: '회원을 찾을 수 없습니다.' }, { status: 404 });

      // 중복 지급 방지 — pointAwarded 플래그를 원자적으로 먼저 선점
      const claim = await uploads.updateOne(
        { _id: new ObjectId(id), pointAwarded: { $ne: true } },
        { $set: { pointAwarded: true, pointAwardedAt: new Date(), pointAwardAmount: amount, pointAwardWithAnswers: withAnswers, pointAwardedBy: payload.loginId ?? 'admin' } },
      );
      if (claim.matchedCount === 0) {
        return NextResponse.json({ ok: true, already: true, points: amount });
      }
      await users.updateOne({ _id: user._id }, { $inc: { points: amount } });
      const after = await users.findOne({ _id: user._id }, { projection: { points: 1 } });
      const rawPts = (after as { points?: unknown } | null)?.points;
      const balanceAfter = typeof rawPts === 'number' && rawPts >= 0 ? rawPts : amount;
      await recordPointLedger(db, {
        userId: user._id as ObjectId,
        delta: amount,
        balanceAfter,
        kind: 'past_exam_reward',
        meta: { uploadId: id, school: doc.school ?? '', examYear: doc.examYear ?? '', examType: doc.examType ?? '', withAnswers },
      }).catch((e) => console.error('past_exam_reward ledger:', e));
      return NextResponse.json({ ok: true, awarded: true, points: amount, withAnswers, balanceAfter });
    }

    // ── 보상 회수(취소) — 잘못 지급한 경우 ──
    if (body.awardPoints === false) {
      const doc = await uploads.findOne({ _id: new ObjectId(id) });
      if (!doc) return NextResponse.json({ error: '해당 업로드를 찾을 수 없습니다.' }, { status: 404 });
      if (doc.pointAwarded !== true) return NextResponse.json({ ok: true, already: true });
      const loginId = typeof doc.loginId === 'string' ? doc.loginId : '';
      const users = db.collection('users');
      const user = loginId ? await users.findOne({ loginId }) : null;
      const amount = typeof doc.pointAwardAmount === 'number' ? doc.pointAwardAmount : PAST_EXAM_REWARD_POINTS;
      await uploads.updateOne({ _id: new ObjectId(id) }, { $set: { pointAwarded: false }, $unset: { pointAwardedAt: '', pointAwardAmount: '' } });
      if (user) {
        await users.updateOne({ _id: user._id }, { $inc: { points: -amount } });
        const after = await users.findOne({ _id: user._id }, { projection: { points: 1 } });
        const rawPts = (after as { points?: unknown } | null)?.points;
        const balanceAfter = typeof rawPts === 'number' ? rawPts : 0;
        await recordPointLedger(db, {
          userId: user._id as ObjectId,
          delta: -amount,
          balanceAfter,
          kind: 'past_exam_reward',
          meta: { uploadId: id, revoked: true },
        }).catch((e) => console.error('past_exam_reward revoke ledger:', e));
      }
      return NextResponse.json({ ok: true, revoked: true });
    }

    // ── 유형 분류 저장 (기존 동작) ──
    const adminCategories = Array.isArray(body.adminCategories)
      ? body.adminCategories.filter((c: unknown) => typeof c === 'string').slice(0, 50)
      : [];
    const result = await uploads.updateOne(
      { _id: new ObjectId(id) },
      { $set: { adminCategories, adminClassifiedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return NextResponse.json({ error: '해당 업로드를 찾을 수 없습니다.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('기출문제 PATCH 실패:', err);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}
