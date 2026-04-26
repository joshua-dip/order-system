import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import {
  getEssayExam,
  updateEssayExam,
  deleteEssayExam,
  moveExamOrder,
  type EssayExamDoc,
} from '@/lib/essay-exams-store';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  const doc = await getEssayExam(id);
  if (!doc) return NextResponse.json({ error: '없음' }, { status: 404 });

  return NextResponse.json({ item: doc });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  let body: { html?: string; data?: object; folder?: string; move?: 'up' | 'down' };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: '형식 오류' }, { status: 400 });
  }

  if (body.move === 'up' || body.move === 'down') {
    const ok = await moveExamOrder(id, body.move);
    return NextResponse.json({ ok });
  }

  const patch: Record<string, unknown> = {};
  if (body.html !== undefined) patch.html = body.html;
  if (body.data !== undefined) patch.data = body.data;
  if (body.folder !== undefined) {
    const nextFolder = (body.folder as string).trim() || '기본';
    patch.folder = nextFolder;
    const doc = await getEssayExam(id);
    if (doc) {
      const prev = (String(doc.folder ?? '').trim() || '기본');
      if (prev !== nextFolder) {
        const db = await getDb('gomijoshua');
        const last = await db
          .collection('essay_exams')
          .findOne({ folder: nextFolder }, { sort: { order: -1 } });
        patch.order = last ? Number((last as { order?: number }).order ?? 0) + 1 : 0;
      }
    }
  }
  const ok = await updateEssayExam(id, patch as Partial<Omit<EssayExamDoc, '_id' | 'createdAt'>>);
  if (!ok) return NextResponse.json({ error: '없음' }, { status: 404 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { id } = await params;
  const ok = await deleteEssayExam(id);
  if (!ok) return NextResponse.json({ error: '없음' }, { status: 404 });

  return NextResponse.json({ ok: true });
}
