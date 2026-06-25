import { NextRequest, NextResponse } from 'next/server';
import type { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requirePremiumMemberVariant } from '@/lib/member-variant-premium-auth';
import { recordPointLedger } from '@/lib/point-ledger';
import { variantUnitPrice, isOrderInsertType } from '@/lib/variant-pricing';
import { BOOK_VARIANT_OBJECTIVE_TYPES } from '@/lib/book-variant-types';
import {
  createFinalExamShortageOrder,
  ensureGradeToken,
  generateGradeToken,
  insertFinalExamJob,
  listFinalExamJobs,
  refillJobShortages,
  selectQuestionsForScope,
  type FinalExamJobDoc,
} from '@/lib/final-exam-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DbEntryInput = {
  displayName?: unknown;
  selectedSources?: unknown;
  textbookCategory?: unknown;
};

type CreateBody = {
  dbEntries?: DbEntryInput[];
  selectedTypes?: unknown;
  questionsPerTypeMap?: Record<string, unknown>;
  orderInsertExplanation?: { 순서?: unknown; 삽입?: unknown };
  /** 시험지 대상 학교명 */
  school?: unknown;
  /** 이전(같은 학교) 출제분과 겹치지 않게 */
  avoidDuplicates?: unknown;
};

const MAX_PER_TYPE = 10;
const MAX_TOTAL_QUESTIONS = 600;

function jobSummary(job: FinalExamJobDoc & { _id?: ObjectId }) {
  // 지문(출처)별 다운로드용 — 출처별 문항 수 (items 등장 순서 유지)
  const sourceCount = new Map<string, number>();
  for (const it of job.items ?? []) {
    sourceCount.set(it.sourceKey, (sourceCount.get(it.sourceKey) ?? 0) + (it.questionIds?.length ?? 0));
  }
  return {
    id: String(job._id ?? ''),
    title: job.title,
    folder: job.folder ?? '',
    school: job.school ?? '',
    avoidDuplicates: !!job.avoidDuplicates,
    orderMode: job.orderMode ?? 'default',
    scopeSummary: job.scopeSummary,
    sources: [...sourceCount.entries()].map(([sourceKey, count]) => ({ sourceKey, count })),
    status: job.status,
    totalRequested: job.totalRequested,
    totalAssigned: job.totalAssigned,
    totalShort: job.totalRequested - job.totalAssigned,
    pointsCharged: job.pointsCharged,
    shortageOrderNumber: job.shortageOrderNumber ?? null,
    gradeToken: job.gradeToken ?? null,
    retryIndex: typeof job.retryIndex === 'number' ? job.retryIndex : null,
    parentJobId: typeof job.parentJobId === 'string' && job.parentJobId ? job.parentJobId : null,
    createdAt: job.createdAt instanceof Date ? job.createdAt.toISOString() : String(job.createdAt),
    readyAt: job.readyAt instanceof Date ? job.readyAt.toISOString() : null,
  };
}

/** 내 파이널 모의고사 다운로드 목록 — awaiting_admin 은 조회 시 부족분을 lazy 채움 */
export async function GET(request: NextRequest) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;
  try {
    const db = await getDb('gomijoshua');
    const me = await db
      .collection('users')
      .findOne({ _id: auth.userId }, { projection: { loginId: 1 } });
    const loginId = typeof me?.loginId === 'string' ? me.loginId : '';
    if (!loginId) return NextResponse.json({ error: '사용자 정보를 찾을 수 없습니다.' }, { status: 404 });

    let jobs = await listFinalExamJobs(db, loginId);
    /* 부족분 대기 잡은 재조회로 채움 (관리자가 문항을 완성했으면 ready 로 전환) */
    const refreshed: FinalExamJobDoc[] = [];
    for (const j of jobs) {
      const job = j.status === 'awaiting_admin' ? await refillJobShortages(db, j) : j;
      /* 토큰 없던 기존 잡에 lazy 발급 (QR 채점 진입용) */
      if (!job.gradeToken) await ensureGradeToken(db, job);
      refreshed.push(job);
    }
    jobs = refreshed;
    /* 잡별 채점 기록(학생별 점수) join — 소유자가 보고서로 바로 이동 가능 */
    const jobIds = jobs.map((j) => j._id).filter(Boolean) as ObjectId[];
    const gradings = jobIds.length
      ? await db
          .collection('final_exam_gradings')
          .find({ jobId: { $in: jobIds } })
          .project<{ _id: ObjectId; jobId: ObjectId; studentName?: string; score?: number; total?: number; createdAt?: Date }>({
            jobId: 1, studentName: 1, score: 1, total: 1, createdAt: 1,
          })
          .sort({ createdAt: -1 })
          .limit(500)
          .toArray()
      : [];
    const gradingsByJob = new Map<string, { id: string; studentName: string; score: number; total: number; createdAt: string }[]>();
    for (const g of gradings) {
      const key = String(g.jobId);
      const arr = gradingsByJob.get(key) ?? [];
      if (arr.length < 30) {
        arr.push({
          id: String(g._id),
          studentName: String(g.studentName ?? ''),
          score: typeof g.score === 'number' ? g.score : 0,
          total: typeof g.total === 'number' ? g.total : 0,
          createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : String(g.createdAt ?? ''),
        });
      }
      gradingsByJob.set(key, arr);
    }

    return NextResponse.json({
      items: jobs.map((j) => ({
        ...jobSummary(j),
        gradings: gradingsByJob.get(String(j._id)) ?? [],
      })),
    });
  } catch (e) {
    console.error('[final-exams GET]', e);
    return NextResponse.json({ error: '목록 조회에 실패했습니다.' }, { status: 500 });
  }
}

/** 파이널 예비 모의고사 즉시 발급 — 포인트 차감, 부족분은 UV 주문 자동 생성 */
export async function POST(request: NextRequest) {
  const auth = await requirePremiumMemberVariant(request);
  if (!auth.ok) return auth.response;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 });
  }

  /* ── 입력 검증 ── */
  const entries = Array.isArray(body.dbEntries) ? body.dbEntries : [];
  const sourceKeys: string[] = [];
  const scopeParts: string[] = [];
  let hasSolbook = false;
  for (const e of entries) {
    const srcs = Array.isArray(e?.selectedSources)
      ? e.selectedSources.map((s) => String(s ?? '').trim()).filter(Boolean)
      : [];
    if (srcs.length === 0) continue;
    sourceKeys.push(...srcs);
    const name = typeof e?.displayName === 'string' ? e.displayName : '';
    scopeParts.push(`[${name}] ${srcs.length}개 지문`);
    const cat = typeof e?.textbookCategory === 'string' ? e.textbookCategory : '';
    if (cat === 'solbook-textbook' || cat === 'solbook-suppl') hasSolbook = true;
  }
  if (sourceKeys.length === 0) {
    return NextResponse.json({ error: '지문을 선택해주세요.' }, { status: 400 });
  }
  if (hasSolbook) {
    return NextResponse.json(
      { error: '쏠북 교재가 포함된 범위는 즉시 발급(포인트 차감)을 지원하지 않습니다. 기존 주문 방식을 이용해 주세요.' },
      { status: 400 },
    );
  }

  /* 파이널 시험지는 객관식 변형문제만 — 워크북 계열 유형은 제외(시험지에 부적합) */
  const objectiveTypes = new Set<string>(BOOK_VARIANT_OBJECTIVE_TYPES as readonly string[]);
  const selectedTypes = Array.isArray(body.selectedTypes)
    ? [...new Set(body.selectedTypes.map((t) => String(t ?? '').trim()).filter((t) => objectiveTypes.has(t)))]
    : [];
  if (selectedTypes.length === 0) {
    return NextResponse.json({ error: '유효한 문제 유형을 선택해주세요. (워크북 유형은 파이널 시험지에 포함할 수 없습니다)' }, { status: 400 });
  }
  const countsMap: Record<string, number> = {};
  for (const t of selectedTypes) {
    const raw = body.questionsPerTypeMap?.[t];
    const n = typeof raw === 'number' ? Math.floor(raw) : 3;
    countsMap[t] = Math.min(MAX_PER_TYPE, Math.max(1, n));
  }
  const explain = {
    순서: body.orderInsertExplanation?.순서 !== false,
    삽입: body.orderInsertExplanation?.삽입 !== false,
  };
  const school = typeof body.school === 'string' ? body.school.trim().slice(0, 80) : '';
  const avoidDuplicates = body.avoidDuplicates === true;
  if (avoidDuplicates && !school) {
    return NextResponse.json({ error: '이전 문제와 겹치지 않기를 켜려면 학교명을 입력해주세요.' }, { status: 400 });
  }

  const uniqueSources = [...new Set(sourceKeys)];
  const perSourceCount = selectedTypes.reduce((s, t) => s + countsMap[t], 0);
  const totalRequested = perSourceCount * uniqueSources.length;
  if (totalRequested > MAX_TOTAL_QUESTIONS) {
    return NextResponse.json(
      { error: `한 번에 최대 ${MAX_TOTAL_QUESTIONS}문항까지 발급할 수 있습니다. (현재 ${totalRequested}문항)` },
      { status: 400 },
    );
  }

  /* ── 가격 (서버 재계산) ── */
  const price = selectedTypes.reduce((sum, t) => {
    const withExplanation = isOrderInsertType(t)
      ? (t === '순서' ? explain.순서 : explain.삽입)
      : true;
    return sum + variantUnitPrice(t, { withExplanation }) * countsMap[t] * uniqueSources.length;
  }, 0);

  try {
    const db = await getDb('gomijoshua');
    const users = db.collection('users');
    const me = await users.findOne(
      { _id: auth.userId },
      { projection: { loginId: 1, name: 1, points: 1 } },
    );
    const loginId = typeof me?.loginId === 'string' ? me.loginId : '';
    if (!loginId) return NextResponse.json({ error: '사용자 정보를 찾을 수 없습니다.' }, { status: 404 });

    /* ── 문항 선택 ── */
    const sel = await selectQuestionsForScope(db, {
      sourceKeys: uniqueSources,
      selectedTypes,
      questionsPerTypeMap: countsMap,
      loginId,
      school,
      avoidDuplicates,
    });
    if (sel.missingSources.length === uniqueSources.length) {
      return NextResponse.json(
        { error: '선택한 지문을 DB에서 찾지 못했습니다. 범위를 다시 확인해 주세요.' },
        { status: 400 },
      );
    }

    /* ── 포인트 원자 차감 ── */
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

    /* ── 잡 생성 ── */
    const now = new Date();
    const status = sel.totalShort > 0 ? ('awaiting_admin' as const) : ('ready' as const);
    const dateStamp = now.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\s/g, '');
    const title = `파이널 예비 모의고사 (${school ? `${school} · ` : ''}${dateStamp} · ${totalRequested}문항)`;
    const jobDoc: Omit<FinalExamJobDoc, '_id'> = {
      loginId,
      userId: auth.userId,
      title,
      ...(school ? { school } : {}),
      ...(avoidDuplicates ? { avoidDuplicates: true } : {}),
      scopeSummary: scopeParts.join(' / '),
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
      meta: { finalExamJobId: jobId, kind: 'final_exam_instant', totalRequested },
    }).catch((e) => console.error('[final-exams] ledger 실패:', e));

    /* ── 부족분 → 관리자 요청(UV 주문 자동 생성) ── */
    const shortageOrderNumber = await createFinalExamShortageOrder(db, {
      jobId,
      loginId,
      userName: typeof me?.name === 'string' ? me.name : undefined,
      items: sel.items,
      selectedTypes,
      questionsPerTypeMap: countsMap,
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
      shortageOrderNumber,
    });
  } catch (e) {
    console.error('[final-exams POST]', e);
    return NextResponse.json({ error: '발급 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
