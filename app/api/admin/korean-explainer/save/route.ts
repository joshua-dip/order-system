import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  saveKoreanExplanation,
  updateKoreanExplanation,
} from '@/lib/korean-explanations-store';
import { validateKoreanExplanation } from '@/lib/korean-explainer/validator';
import type { Block } from '@/lib/korean-explainer/types';

interface SavePayload {
  /** 있으면 update, 없으면 insert */
  id?: string;
  passageId?: string;
  textbook: string;
  sourceKey: string;
  setRange: string;
  genre: string;
  workTitle: string;
  examTitle: string;
  showSubtitle?: boolean;
  blocks: Block[];
  status?: '대기' | '검수완료' | '검수불일치';
  folder?: string;
  createdBy?: string;
}

export async function POST(request: NextRequest) {
  const { error, payload: auth } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = (await request.json()) as Partial<SavePayload>;
    const id = typeof body.id === 'string' ? body.id.trim() : '';

    const textbook = trim(body.textbook);
    const sourceKey = trim(body.sourceKey);
    const setRange = trim(body.setRange);
    const genre = trim(body.genre);
    const workTitle = trim(body.workTitle);
    const examTitle = trim(body.examTitle);
    const folder = body.folder?.trim() || '기본';
    const status = body.status ?? '검수완료';

    if (!textbook || !sourceKey || !setRange || !genre || !workTitle || !examTitle) {
      return NextResponse.json(
        { error: 'textbook, sourceKey, setRange, genre, workTitle, examTitle 모두 필요합니다.' },
        { status: 400 },
      );
    }

    // 블록 자체는 validator 가 검사
    const v = validateKoreanExplanation({
      exam_title: examTitle,
      set_range: setRange,
      genre,
      work_title: workTitle,
      show_subtitle: body.showSubtitle,
      blocks: body.blocks ?? [],
    });
    if (!v.ok) {
      return NextResponse.json({ error: '블록 검증 실패', details: v.errors }, { status: 400 });
    }

    const docPayload = {
      passageId: body.passageId?.trim() || undefined,
      textbook,
      sourceKey,
      setRange,
      genre,
      workTitle,
      examTitle,
      showSubtitle: body.showSubtitle ?? false,
      blocks: body.blocks as Block[],
      status,
      folder,
      createdBy: body.createdBy || `admin:${auth?.loginId ?? 'unknown'}`,
    };

    if (id) {
      const ok = await updateKoreanExplanation(id, docPayload);
      if (!ok) return NextResponse.json({ error: '해당 ID 가 없습니다.' }, { status: 404 });
      return NextResponse.json({ ok: true, id });
    }
    const newId = await saveKoreanExplanation(docPayload);
    return NextResponse.json({ ok: true, id: newId });
  } catch (e) {
    console.error('korean-explainer/save POST:', e);
    return NextResponse.json({ error: '저장에 실패했습니다.' }, { status: 500 });
  }
}

function trim(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
