import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import {
  getGrammarWorkbook,
  deleteGrammarWorkbook,
} from '@/lib/grammar-workbooks-store';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await ctx.params;
  const doc = await getGrammarWorkbook(id);
  if (!doc) return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
  return NextResponse.json({ ok: true, item: doc });
}

/**
 * PATCH: 한 워크북의 일부 메타만 갱신 (현재는 folder 만 지원).
 * body: { folder?: string }
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await ctx.params;
  if (!ObjectId.isValid(id)) {
    return NextResponse.json({ error: '유효하지 않은 id' }, { status: 400 });
  }
  let body: { folder?: unknown };
  try {
    body = (await request.json()) as { folder?: unknown };
  } catch {
    return NextResponse.json({ error: 'JSON 파싱 실패' }, { status: 400 });
  }
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.folder === 'string' && body.folder.trim()) {
    set.folder = body.folder.trim();
  }
  if (Object.keys(set).length === 1) {
    return NextResponse.json({ error: '변경할 필드가 없습니다.' }, { status: 400 });
  }
  const db = await getDb('gomijoshua');
  const r = await db
    .collection('grammar_workbooks')
    .updateOne({ _id: new ObjectId(id) }, { $set: set });
  if (r.matchedCount === 0) {
    return NextResponse.json({ error: '문서를 찾을 수 없습니다.' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, modified: r.modifiedCount });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { error } = await requireAdmin(request);
  if (error) return error;
  const { id } = await ctx.params;
  const ok = await deleteGrammarWorkbook(id);
  if (!ok) return NextResponse.json({ error: '삭제 실패' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
