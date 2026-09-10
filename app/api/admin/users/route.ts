import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, hashPassword, COOKIE_NAME, DEFAULT_MEMBER_INITIAL_PASSWORD } from '@/lib/auth';
import { SIGNUP_PREMIUM_TRIAL_DAYS, isPremiumMember, isMonthlyMemberActive } from '@/lib/premium-member';
import { isAnnualMemberActive } from '@/lib/annual-member';
import { baseFreeQuotaFor, kstMonthRange, paidBaseCountOfOrder } from '@/lib/variant-member-quota';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 });
    }

    const db = await getDb('gomijoshua');
    const list = await db
      .collection('users')
      .find({ role: 'user' }, { projection: { passwordHash: 0 } })
      .sort({ createdAt: -1 })
      .toArray();

    /* 멤버십 회원의 이번 달 무료 문항 잔량 — 회원 화면(/api/my/variant-base-quota)과
       같은 계산을 쓴다. 장부가 없으므로 이번 달 주문에서 되센다. 취소분은 제외.
       목록마다 회원 수만큼 조회하면 느리므로 이번 달 주문을 한 번에 읽어 loginId 로 묶는다. */
    const { start, end } = kstMonthRange();
    const monthOrders = await db
      .collection('orders')
      .find({
        orderNumber: { $regex: '^(BV|MV|UV)-' },
        createdAt: { $gte: start, $lt: end },
        status: { $ne: 'cancelled' },
      })
      .project({ loginId: 1, orderMeta: 1, delivery: 1 })
      .toArray();
    const usedByLoginId = new Map<string, number>();
    for (const o of monthOrders) {
      const lid = typeof o.loginId === 'string' ? o.loginId : '';
      if (!lid) continue;
      const n = paidBaseCountOfOrder(
        (o as Record<string, unknown>).orderMeta as Record<string, unknown>,
        (o as Record<string, unknown>).delivery as Record<string, unknown> | null,
      );
      if (n > 0) usedByLoginId.set(lid, (usedByLoginId.get(lid) ?? 0) + n);
    }

    const users = list.map((u) => ({
      id: u._id.toString(),
      loginId: u.loginId,
      name: u.name ?? u.loginId,
      email: u.email ?? '',
      phone: u.phone ?? '',
      dropboxFolderPath: u.dropboxFolderPath ?? '',
      dropboxSharedLink: u.dropboxSharedLink ?? '',
      canAccessAnalysis: !!u.canAccessAnalysis,
      canAccessEssay: !!u.canAccessEssay,
      myFormatApproved: !!(u as { myFormatApproved?: boolean }).myFormatApproved,
      allowedTextbooks: Array.isArray(u.allowedTextbooks) ? u.allowedTextbooks : [],
      allowedTextbooksAnalysis: Array.isArray(u.allowedTextbooksAnalysis) ? u.allowedTextbooksAnalysis : (Array.isArray(u.allowedTextbooks) ? u.allowedTextbooks : []),
      allowedTextbooksEssay: Array.isArray(u.allowedTextbooksEssay) ? u.allowedTextbooksEssay : (Array.isArray(u.allowedTextbooks) ? u.allowedTextbooks : []),
      allowedTextbooksWorkbook: (() => {
        const wb = (u as Record<string, unknown>).allowedTextbooksWorkbook;
        return Array.isArray(wb) ? wb.filter((x): x is string => typeof x === 'string') : undefined;
      })(),
      allowedTextbooksVariant: (() => {
        const vb = (u as Record<string, unknown>).allowedTextbooksVariant;
        return Array.isArray(vb) ? vb.filter((x): x is string => typeof x === 'string') : undefined;
      })(),
      allowedEssayTypeIds: Array.isArray(u.allowedEssayTypeIds) ? u.allowedEssayTypeIds : [],
      points: (() => { const p = (u as { points?: number }).points; return typeof p === 'number' && p >= 0 ? p : 0; })(),
      supplementaryNote: (() => { const s = (u as { supplementaryNote?: string }).supplementaryNote; return typeof s === 'string' ? s : ''; })(),
      memberType: (() => { const m = (u as { memberType?: string }).memberType; return typeof m === 'string' ? m : ''; })(),
      annualMemberSince: (() => {
        const d = (u as { annualMemberSince?: Date }).annualMemberSince;
        if (!d) return null;
        const date = d instanceof Date ? d : new Date(d);
        return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
      })(),
      monthlyMemberSince: (() => {
        const d = (u as { monthlyMemberSince?: Date }).monthlyMemberSince;
        if (!d) return null;
        const date = d instanceof Date ? d : new Date(d);
        return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
      })(),
      monthlyMemberUntil: (() => {
        const d = (u as { monthlyMemberUntil?: Date }).monthlyMemberUntil;
        if (!d) return null;
        const date = d instanceof Date ? d : new Date(d);
        return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
      })(),
      isVip: !!(u as { isVip?: boolean }).isVip,
      vipSince: (() => {
        const d = (u as { vipSince?: Date }).vipSince;
        if (!d) return null;
        const date = d instanceof Date ? d : new Date(d as string);
        return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
      })(),
      signupPremiumTrialUntil: (() => {
        const d = (u as { signupPremiumTrialUntil?: Date }).signupPremiumTrialUntil;
        if (!d) return null;
        const date = d instanceof Date ? d : new Date(d);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
      })(),
      createdAt: u.createdAt,
      /* 월·연회원(및 가입 체험)만 한도가 있다. 일반 회원은 null 로 내려 화면에서 감춘다. */
      baseFreeQuota: (() => {
        const annualSince = (u as { annualMemberSince?: Date }).annualMemberSince ?? null;
        const monthlyUntil = (u as { monthlyMemberUntil?: Date }).monthlyMemberUntil ?? null;
        const trialUntil = (u as { signupPremiumTrialUntil?: Date }).signupPremiumTrialUntil ?? null;
        const member = isPremiumMember({
          role: u.role as string | undefined,
          annualSince,
          monthlyUntil,
          signupPremiumTrialUntil: trialUntil,
        });
        if (!member) return null;
        const paidMember = isAnnualMemberActive(annualSince) || isMonthlyMemberActive(monthlyUntil);
        const limit = baseFreeQuotaFor({ paidMember });
        const used = usedByLoginId.get(String(u.loginId ?? '')) ?? 0;
        return { limit, used, remaining: Math.max(0, limit - used), trial: !paidMember };
      })(),
    }));

    return NextResponse.json({ users });
  } catch (err) {
    console.error('관리자 계정 목록 조회 실패:', err);
    return NextResponse.json(
      { error: '목록 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(COOKIE_NAME)?.value;
    if (!token) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    const payload = await verifyToken(token);
    if (!payload || payload.role !== 'admin') {
      return NextResponse.json({ error: '관리자만 이용할 수 있습니다.' }, { status: 403 });
    }

    const body = await request.json();
    const loginId = typeof body?.loginId === 'string' ? body.loginId.trim() : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
    const dropboxFolderPath = typeof body?.dropboxFolderPath === 'string' ? body.dropboxFolderPath.trim() : '';

    if (!loginId) {
      return NextResponse.json(
        { error: '아이디를 입력해주세요.' },
        { status: 400 }
      );
    }

    if (loginId.length < 2) {
      return NextResponse.json(
        { error: '아이디는 2자 이상으로 입력해주세요.' },
        { status: 400 }
      );
    }

    const db = await getDb('gomijoshua');
    const users = db.collection('users');

    const existing = await users.findOne({ loginId });
    if (existing) {
      return NextResponse.json(
        { error: '이미 사용 중인 아이디입니다.' },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(DEFAULT_MEMBER_INITIAL_PASSWORD);
    const now = new Date();
    const signupPremiumTrialUntil = new Date(
      now.getTime() + SIGNUP_PREMIUM_TRIAL_DAYS * 24 * 60 * 60 * 1000,
    );
    await users.createIndex({ loginId: 1 }, { unique: true }).catch(() => {});
    await users.insertOne({
      loginId,
      passwordHash,
      name: name || loginId,
      email: email || '',
      phone: phone || '',
      dropboxFolderPath: dropboxFolderPath || '',
      role: 'user',
      canAccessAnalysis: false,
      canAccessEssay: false,
      allowedTextbooks: [],
      allowedTextbooksAnalysis: [],
      allowedTextbooksEssay: [],
      points: 0,
      supplementaryNote: '',
      createdAt: now,
      signupPremiumTrialUntil,
    });

    return NextResponse.json({
      ok: true,
      message: `일반 계정이 생성되었습니다. (초기 비밀번호: ${DEFAULT_MEMBER_INITIAL_PASSWORD})`,
      loginId,
      name: name || loginId,
      email: email || '',
    });
  } catch (err) {
    console.error('관리자 계정 생성 실패:', err);
    return NextResponse.json(
      { error: '계정 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
