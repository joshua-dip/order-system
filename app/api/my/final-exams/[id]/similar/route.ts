import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';
import { recordPointLedger } from '@/lib/point-ledger';
import { variantUnitPrice, isOrderInsertType } from '@/lib/variant-pricing';
import {
  getFinalExamJob,
  selectQuestionsForScope,
  insertFinalExamJob,
  generateGradeToken,
  createFinalExamShortageOrder,
  type FinalExamJobDoc,
} from '@/lib/final-exam-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 유사문항 — 원본 시험과 같은 범위(교재·지문·유형·문항수)로, 기존 문제와 겹치지 않는 새 문항을 뽑아
 * 새 시험을 발급. 포인트 차감 + UV 주문번호 항상 발급(주문내역 기록). 부족분은 관리자 제작 요청으로 채워짐.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  try {
    const db = await getDb('gomijoshua');
    const users = db.collection('users');
    const me = await users.findOne({ _id: auth.userId }, { projection: { loginId: 1, name: 1, points: 1 } });
    const loginId = typeof me?.loginId === 'string' ? me.loginId : '';
    if (!loginId) return NextResponse.json({ error: '사용자 정보를 찾을 수 없습니다.' }, { status: 404 });

    const origin = await getFinalExamJob(db, id, loginId);
    if (!origin) return NextResponse.json({ error: '원본 시험을 찾을 수 없습니다.' }, { status: 404 });

    // 범위 재구성 — 원본 잡에서 지문/유형/문항수 그대로
    const sourceKeys = [...new Set(origin.items.map((it) => it.sourceKey).filter(Boolean))];
    const selectedTypes = origin.selectedTypes ?? [];
    const countsMap = origin.questionsPerTypeMap ?? {};
    const school = (origin.school ?? '').trim();
    if (sourceKeys.length === 0 || selectedTypes.length === 0) {
      return NextResponse.json({ error: '원본 시험의 범위를 복원할 수 없습니다.' }, { status: 400 });
    }

    // 가격(서버 재계산) — 잡에 해설 포함여부 미저장이라 기본(포함)으로 산정
    const explain = { 순서: true, 삽입: true };
    const price = selectedTypes.reduce((sum, t) => {
      const withExplanation = isOrderInsertType(t) ? (t === '순서' ? explain.순서 : explain.삽입) : true;
      return sum + variantUnitPrice(t, { withExplanation }) * (countsMap[t] ?? 0) * sourceKeys.length;
    }, 0);

    // 겹치지 않는 새 문항 선택 (avoidDuplicates = 회원 기존 출제분 전체 제외 → 원본과 무겹침)
    const sel = await selectQuestionsForScope(db, {
      sourceKeys,
      selectedTypes,
      questionsPerTypeMap: countsMap,
      loginId,
      school,
      avoidDuplicates: true,
    });
    if (sel.missingSources.length === sourceKeys.length) {
      return NextResponse.json({ error: '선택한 지문을 DB에서 찾지 못했습니다.' }, { status: 400 });
    }

    // 포인트 원자 차감
    const deduct = await users.updateOne(
      { _id: auth.userId, points: { $gte: price } },
      { $inc: { points: -price } },
    );
    if (deduct.modifiedCount !== 1) {
      const cur = typeof me?.points === 'number' ? me.points : 0;
      return NextResponse.json(
        { error: `포인트가 부족합니다. 필요한 포인트: ${price.toLocaleString()}P / 보유: ${cur.toLocaleString()}P` },
        { status: 400 },
      );
    }
    const after = await users.findOne({ _id: auth.userId }, { projection: { points: 1 } });
    const balanceAfter = typeof after?.points === 'number' ? after.points : 0;

    const now = new Date();
    const status: FinalExamJobDoc['status'] = sel.totalShort > 0 ? 'awaiting_admin' : 'ready';
    const dateStamp = now.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\s/g, '');
    const title = `파이널 예비 모의고사 · 유사문항 (${school ? `${school} · ` : ''}${dateStamp} · ${sel.totalRequested}문항)`;
    const jobDoc: Omit<FinalExamJobDoc, '_id'> = {
      loginId,
      userId: auth.userId,
      title,
      ...(school ? { school } : {}),
      avoidDuplicates: true,
      similarOfJobId: String(origin._id),
      scopeSummary: origin.scopeSummary,
      selectedTypes,
      questionsPerTypeMap: countsMap,
      items: sel.items,
      totalRequested: sel.totalRequested,
      totalAssigned: sel.totalAssigned,
      pointsCharged: price,
      status,
      gradeToken: generateGradeToken(),
      createdAt: now,
      updatedAt: now,
      ...(status === 'ready' ? { readyAt: now } : {}),
    };
    const jobId = await insertFinalExamJob(db, jobDoc);

    await recordPointLedger(db, {
      userId: auth.userId,
      delta: -price,
      balanceAfter,
      kind: 'order_spend',
      meta: { finalExamJobId: jobId, kind: 'final_exam_similar', similarOfJobId: String(origin._id), totalRequested: sel.totalRequested },
    }).catch((e) => console.error('[final-exams similar] ledger 실패:', e));

    // 주문번호 항상 발급 (force) — 부족분이 있으면 제작요청, 없으면 기록용
    const orderNumber = await createFinalExamShortageOrder(db, {
      jobId,
      loginId,
      userName: typeof me?.name === 'string' ? me.name : undefined,
      items: sel.items,
      selectedTypes,
      questionsPerTypeMap: countsMap,
      contextLabel: '파이널 예비 모의고사 (유사문항)',
      force: true,
      autoCreated: 'final_exam_similar',
    });

    return NextResponse.json({
      ok: true,
      id: jobId,
      status,
      totalRequested: sel.totalRequested,
      totalAssigned: sel.totalAssigned,
      totalShort: sel.totalShort,
      pointsCharged: price,
      balanceAfter,
      orderNumber,
    });
  } catch (e) {
    console.error('[final-exams similar]', e);
    return NextResponse.json({ error: '유사문항 발급 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
