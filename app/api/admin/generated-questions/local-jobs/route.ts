import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageTextForVariantCompare } from '@/lib/passage-variant-text';
import { resolveLocalVariantType } from '@/lib/local-variant-types';
import { countQueuedAhead, enqueueLocalVariantJob } from '@/lib/local-variant-jobs';

/**
 * 로컬 LoRA 초안 작업을 큐에 넣는다 — 생성은 GPU PC 워커가 한다(웹 서버에는 GPU·모델이 없다).
 * 즉시 job_id 를 돌려주고, 화면은 GET …/local-jobs/[id] 로 상태를 폴링한다. Anthropic 호출 없음.
 */
export async function POST(request: NextRequest) {
  const { error, payload } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const passageIdStr = typeof body.passage_id === 'string' ? body.passage_id.trim() : '';
    const textbook = typeof body.textbook === 'string' ? body.textbook.trim() : '';
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    const type = resolveLocalVariantType(typeof body.type === 'string' ? body.type : '');

    if (!type) {
      return NextResponse.json({ error: '로컬 LoRA는 주제·제목·주장·일치·불일치 유형만 지원합니다.' }, { status: 400 });
    }
    if (!passageIdStr || !ObjectId.isValid(passageIdStr)) {
      return NextResponse.json({ error: '유효한 passage_id(ObjectId)가 필요합니다.' }, { status: 400 });
    }
    if (!textbook || !source) {
      return NextResponse.json({ error: '교재명(textbook)과 출처(source)는 필수입니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const passageId = new ObjectId(passageIdStr);
    const passage = await db.collection('passages').findOne({ _id: passageId });
    if (!passage) {
      return NextResponse.json({ error: '원문 passage를 찾을 수 없습니다.' }, { status: 404 });
    }
    const pTextbook = String(passage.textbook ?? '').trim();
    if (pTextbook !== textbook) {
      return NextResponse.json(
        { error: `원문의 교재명("${pTextbook || '—'}")과 입력 교재명이 일치하지 않습니다.` },
        { status: 400 }
      );
    }
    const content =
      passage.content && typeof passage.content === 'object' && !Array.isArray(passage.content)
        ? (passage.content as Record<string, unknown>)
        : {};
    // 주제·제목·주장은 영어 원문이 그대로 Paragraph 가 된다 — 해석·혼합본으로 대신 만들지 않는다
    if (typeof content.original !== 'string' || !content.original.trim()) {
      return NextResponse.json(
        { error: '영어 원문(content.original)이 없는 지문은 로컬 LoRA로 만들 수 없습니다.' },
        { status: 400 }
      );
    }

    const job = await enqueueLocalVariantJob(db, {
      type,
      passageId,
      textbook,
      source,
      paragraph: getPassageTextForVariantCompare(passage.content),
      requestedBy: payload?.loginId ?? '',
    });
    return NextResponse.json({
      ok: true,
      job_id: String(job._id),
      queued_ahead: await countQueuedAhead(db, job),
    });
  } catch (e) {
    console.error('local-jobs POST:', e);
    return NextResponse.json({ error: '로컬 작업 등록에 실패했습니다.' }, { status: 500 });
  }
}
