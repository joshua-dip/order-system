import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import {
  coerceNumQuestionForPrompt,
  generateVariantDraftQuestionDataWithClaude,
} from '@/lib/admin-variant-draft-claude';

/** 어법 Paragraph 밑줄 형식 오류 등 일괄 재생성 — 한 요청에 여러 Claude 호출 */
export const maxDuration = 300;

const MAX_IDS = 100;

type Body = {
  ids?: unknown;
  userHint?: unknown;
  typePrompt?: unknown;
};

/**
 * POST { ids: string[], userHint?: string, typePrompt?: string }
 * type=어법·passage 연결된 문항만 처리. 기존 NumQuestion·Source·UniqueID·Category·순서 보존.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = (await request.json()) as Body;
    const rawIds = Array.isArray(body.ids) ? body.ids : [];
    const ids = rawIds
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter((x) => x && ObjectId.isValid(x));
    const userHint =
      typeof body.userHint === 'string' ? body.userHint.trim().slice(0, 2000) : '';
    const typePrompt =
      typeof body.typePrompt === 'string' ? body.typePrompt.trim().slice(0, 12000) : '';

    if (ids.length === 0) {
      return NextResponse.json({ error: '재생성할 유효한 ids 배열이 필요합니다.' }, { status: 400 });
    }
    if (ids.length > MAX_IDS) {
      return NextResponse.json(
        { error: `한 번에 최대 ${MAX_IDS}건까지 재생성할 수 있습니다. 나누어 실행해 주세요.` },
        { status: 400 }
      );
    }

    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const passagesCol = db.collection('passages');

    const results: Array<{
      id: string;
      ok: boolean;
      error?: string;
    }> = [];

    for (const id of ids) {
      try {
        const doc = await col.findOne({ _id: new ObjectId(id) });
        if (!doc) {
          results.push({ id, ok: false, error: '문서 없음' });
          continue;
        }
        const type = String(doc.type ?? '').trim();
        if (type !== '어법') {
          results.push({ id, ok: false, error: 'type이 어법이 아님' });
          continue;
        }
        const pid = doc.passage_id;
        if (!pid || !(pid instanceof ObjectId)) {
          results.push({ id, ok: false, error: 'passage_id 없음' });
          continue;
        }

        const textbook = String(doc.textbook ?? '').trim();
        const source = String(doc.source ?? '').trim();
        if (!textbook || !source) {
          results.push({ id, ok: false, error: '교재·출처 없음' });
          continue;
        }

        const passage = await passagesCol.findOne({ _id: pid });
        if (!passage) {
          results.push({ id, ok: false, error: 'passage 없음' });
          continue;
        }
        const pTextbook = String(passage.textbook ?? '').trim();
        if (pTextbook !== textbook) {
          results.push({ id, ok: false, error: '교재명 불일치' });
          continue;
        }

        const content =
          passage.content && typeof passage.content === 'object' && !Array.isArray(passage.content)
            ? (passage.content as Record<string, unknown>)
            : {};
        const paragraph =
          (typeof content.original === 'string' && content.original.trim()) ||
          (typeof content.mixed === 'string' && content.mixed.trim()) ||
          (typeof content.translation === 'string' && content.translation.trim()) ||
          '';

        if (!paragraph.trim()) {
          results.push({ id, ok: false, error: '원문 지문 없음' });
          continue;
        }

        const oldQd =
          doc.question_data && typeof doc.question_data === 'object' && !Array.isArray(doc.question_data)
            ? (doc.question_data as Record<string, unknown>)
            : {};
        const nextNum = coerceNumQuestionForPrompt(oldQd);

        const ai = await generateVariantDraftQuestionDataWithClaude({
          paragraph,
          type: '어법',
          nextNum,
          userHint,
          typePrompt,
        });

        if (!ai.ok) {
          results.push({ id, ok: false, error: ai.error });
          continue;
        }

        const merged: Record<string, unknown> = {
          ...ai.question_data,
          NumQuestion: oldQd.NumQuestion ?? ai.question_data.NumQuestion,
          순서: oldQd.순서 ?? oldQd.NumQuestion ?? ai.question_data.순서,
          Source: oldQd.Source ?? ai.question_data.Source,
          UniqueID: oldQd.UniqueID ?? ai.question_data.UniqueID,
          Category: oldQd.Category ?? ai.question_data.Category ?? '어법',
        };

        await col.updateOne(
          { _id: new ObjectId(id) },
          { $set: { question_data: merged, updated_at: new Date() } }
        );
        results.push({ id, ok: true });
      } catch (e) {
        results.push({
          id,
          ok: false,
          error: e instanceof Error ? e.message : '처리 오류',
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;

    return NextResponse.json({
      ok: true,
      total: results.length,
      succeeded: okCount,
      failed: failCount,
      results,
    });
  } catch (e) {
    console.error('bulk-regenerate-grammar-blocks:', e);
    return NextResponse.json({ error: '일괄 재생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
