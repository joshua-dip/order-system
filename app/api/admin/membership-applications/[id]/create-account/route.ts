import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { hashPassword, DEFAULT_MEMBER_INITIAL_PASSWORD } from '@/lib/auth';
import { SIGNUP_PREMIUM_TRIAL_DAYS } from '@/lib/premium-member';
import {
  getApplication,
  updateApplicationStatus,
} from '@/lib/membership-applications-store';

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  const app = await getApplication(id);
  if (!app) {
    return NextResponse.json({ error: '신청서를 찾을 수 없습니다.' }, { status: 404 });
  }

  const phoneDigits = (app.phone || '').replace(/\D/g, '');
  if (!phoneDigits) {
    return NextResponse.json(
      { error: '신청서의 전화번호가 비어 있습니다.' },
      { status: 400 }
    );
  }

  const db = await getDb('gomijoshua');
  const users = db.collection('users');

  const existing = await users.findOne({ loginId: phoneDigits });
  if (existing) {
    return NextResponse.json(
      {
        error: '이미 같은 전화번호로 등록된 계정이 있습니다.',
        loginId: phoneDigits,
      },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(DEFAULT_MEMBER_INITIAL_PASSWORD);
  const now = new Date();
  const signupPremiumTrialUntil = new Date(
    now.getTime() + SIGNUP_PREMIUM_TRIAL_DAYS * 24 * 60 * 60 * 1000
  );

  await users.createIndex({ loginId: 1 }, { unique: true }).catch(() => {});
  await users.insertOne({
    loginId: phoneDigits,
    passwordHash,
    name: app.name || phoneDigits,
    email: '',
    phone: app.phone,
    dropboxFolderPath: '',
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
    createdFromApplicationId: id,
  });

  await updateApplicationStatus(id, 'completed').catch(() => {});

  return NextResponse.json({
    ok: true,
    loginId: phoneDigits,
    name: app.name || phoneDigits,
    initialPassword: DEFAULT_MEMBER_INITIAL_PASSWORD,
  });
}
