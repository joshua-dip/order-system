import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 문제수 시각화 — 교재별 목표 문항수 설정.
 *   - defaultTarget: 교재 기본 목표(소스×유형당)
 *   - perSource: 소스(문제번호)별 override (예: 시험범위 소스는 더 높게)
 * 컬렉션: question_target_config (한 교재당 1 문서, _id 는 자동)
 */

const DEFAULT_TARGET = 7;
const COLLECTION = 'question_target_config';

function clampTarget(v: unknown): number | null {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0 || n > 99) return null;
  return n;
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = (request.nextUrl.searchParams.get('textbook') || '').trim();
  if (!textbook) {
    return NextResponse.json({ ok: false, error: 'textbook 파라미터가 필요합니다.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const doc = await db.collection(COLLECTION).findOne({ textbook });
  const defaultTarget = clampTarget((doc as Record<string, unknown> | null)?.defaultTarget) ?? DEFAULT_TARGET;
  const rawPer = (doc as Record<string, unknown> | null)?.perSource;
  const perSource: Record<string, number> = {};
  if (rawPer && typeof rawPer === 'object' && !Array.isArray(rawPer)) {
    for (const [k, v] of Object.entries(rawPer as Record<string, unknown>)) {
      const t = clampTarget(v);
      if (t != null) perSource[k] = t;
    }
  }
  return NextResponse.json({ ok: true, textbook, defaultTarget, perSource });
}

export async function PUT(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
  if (!textbook) {
    return NextResponse.json({ ok: false, error: 'textbook 이 필요합니다.' }, { status: 400 });
  }

  const defaultTarget = clampTarget(body.defaultTarget) ?? DEFAULT_TARGET;

  // perSource: 기본값과 같거나 유효하지 않은 항목은 제거(깔끔하게 override 만 보관)
  const perSource: Record<string, number> = {};
  const rawPer = body.perSource;
  if (rawPer && typeof rawPer === 'object' && !Array.isArray(rawPer)) {
    for (const [k, v] of Object.entries(rawPer as Record<string, unknown>)) {
      const key = String(k).trim();
      if (!key) continue;
      const t = clampTarget(v);
      if (t != null && t !== defaultTarget) perSource[key] = t;
    }
  }

  const db = await getDb('gomijoshua');
  await db.collection(COLLECTION).updateOne(
    { textbook },
    { $set: { textbook, defaultTarget, perSource, updatedAt: new Date() } },
    { upsert: true },
  );

  return NextResponse.json({ ok: true, textbook, defaultTarget, perSource });
}
