import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { verifyToken, hashPassword, COOKIE_NAME, DEFAULT_MEMBER_INITIAL_PASSWORD } from '@/lib/auth';

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
      createdAt: u.createdAt,
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
      createdAt: new Date(),
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
