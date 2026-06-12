import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import {
  ORDER_CIRCLED,
  computeReadingOrderKey,
  correctAnswerFromOwnOptions,
  findPositionInOriginal,
  parseOrderParagraph,
  readingKeyToPerm,
} from '@/lib/order-variant-validation';

export const dynamic = 'force-dynamic';

/**
 * 순서 유형 문항의 정답을 원문(passages.content.original) 대조 검증.
 *
 * 로직:
 * 1. question_data.Paragraph 에서 (A)(B)(C) 텍스트 추출
 * 2. passage_id 로 원문 가져오기
 * 3. 원문에서 각 (A)(B)(C) 텍스트의 위치를 찾아 읽기 순서 결정
 * 4. 읽기 순서 순열을 문항 자신의 Options 에서 찾아 정답 번호(①~⑤) 결정
 *    — 보기 배열이 고정 5세트가 아닌 문항도 자기 배열 기준으로 정확히 대조되고,
 *      보기에 해당 순열이 없으면 unverifiable 로 분류해 자동수정에서 제외
 * 5. 저장된 CorrectAnswer 와 비교 → 불일치 문항 반환
 *
 * GET ?textbook=...
 */

const MAX_ITEMS = 3000;

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';

  const match: Record<string, unknown> = {
    type: '순서',
    deleted_at: null,
    'question_data.Paragraph': { $exists: true },
  };
  if (textbook) match.textbook = textbook;

  try {
    const db = await getDb('gomijoshua');
    const qCol = db.collection('generated_questions');
    const pCol = db.collection('passages');

    const docs = await qCol
      .find(match)
      .project({
        _id: 1, source: 1, textbook: 1, passage_id: 1,
        'question_data.Paragraph': 1,
        'question_data.CorrectAnswer': 1,
        'question_data.Options': 1,
        'question_data.순서': 1,
      })
      .sort({ textbook: 1, source: 1, 'question_data.순서': 1 })
      .limit(5000)
      .toArray();

    // 배치로 passage 원문 가져오기
    const passageIds = [...new Set(docs.map(d => String(d.passage_id)).filter(Boolean))];
    const passageMap = new Map<string, string>();

    if (passageIds.length > 0) {
      const passages = await pCol
        .find({ _id: { $in: passageIds.map(id => new ObjectId(id)) } })
        .project({ _id: 1, 'content.original': 1 })
        .toArray();
      for (const p of passages) {
        const orig = (p.content as Record<string, unknown>)?.original;
        if (typeof orig === 'string') {
          passageMap.set(String(p._id), orig);
        }
      }
    }

    const mismatched: {
      id: string;
      textbook: string;
      source: string;
      seq: number;
      currentAnswer: string;
      correctAnswer: string;
      positions: { A: number; B: number; C: number };
      readingOrder: string;
      status: 'mismatch' | 'unverifiable' | 'unshuffled';
    }[] = [];

    let verified = 0;
    let unverifiableNoPush = 0;

    for (const doc of docs) {
      const qd = doc.question_data as Record<string, unknown>;
      const paragraph = String(qd?.Paragraph ?? '');
      const currentAnswer = String(qd?.CorrectAnswer ?? '').trim();
      const seq = Number(qd?.순서 ?? 0);

      const parsed = parseOrderParagraph(paragraph);
      if (!parsed) { unverifiableNoPush++; continue; }

      const original = passageMap.get(String(doc.passage_id));
      if (!original) { unverifiableNoPush++; continue; }

      const positions = {
        A: findPositionInOriginal(original, parsed.A),
        B: findPositionInOriginal(original, parsed.B),
        C: findPositionInOriginal(original, parsed.C),
      };

      const sortedKey = computeReadingOrderKey(positions);

      if (!sortedKey || sortedKey === 'ABC') {
        const isUnshuffled = sortedKey === 'ABC';
        if (mismatched.length < MAX_ITEMS) {
          mismatched.push({
            id: String(doc._id),
            textbook: String(doc.textbook ?? ''),
            source: String(doc.source ?? ''),
            seq,
            currentAnswer,
            correctAnswer: '?',
            positions,
            readingOrder: isUnshuffled ? '(A)-(B)-(C)' : '?',
            status: isUnshuffled ? 'unshuffled' : 'unverifiable',
          });
        }
        continue;
      }

      const readingOrder = readingKeyToPerm(sortedKey);
      const correctAnswer = correctAnswerFromOwnOptions(qd?.Options, readingOrder);

      if (!correctAnswer) {
        // 읽기 순서 순열이 이 문항의 보기에 없음 — 비표준 세트라 정답을 보기로
        // 표현할 수 없는 문항. 자동수정하면 안 되므로 unverifiable 로 분류.
        if (mismatched.length < MAX_ITEMS) {
          mismatched.push({
            id: String(doc._id),
            textbook: String(doc.textbook ?? ''),
            source: String(doc.source ?? ''),
            seq,
            currentAnswer,
            correctAnswer: '?',
            positions,
            readingOrder,
            status: 'unverifiable',
          });
        }
        continue;
      }

      verified++;

      if (correctAnswer !== currentAnswer) {
        if (mismatched.length < MAX_ITEMS) {
          mismatched.push({
            id: String(doc._id),
            textbook: String(doc.textbook ?? ''),
            source: String(doc.source ?? ''),
            seq,
            currentAnswer,
            correctAnswer,
            positions,
            readingOrder,
            status: 'mismatch',
          });
        }
      }
    }

    const totalMismatched = mismatched.filter(m => m.status === 'mismatch').length;
    const totalUnshuffled = mismatched.filter(m => m.status === 'unshuffled').length;
    const totalUnverifiable = mismatched.filter(m => m.status === 'unverifiable').length + unverifiableNoPush;

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null },
      totalScanned: docs.length,
      totalVerified: verified,
      totalMismatched,
      totalUnshuffled,
      totalUnverifiable,
      totalCorrect: verified - totalMismatched,
      truncated: mismatched.length >= MAX_ITEMS,
      items: mismatched,
    });
  } catch (e) {
    console.error('validate/order-answer-verify GET:', e);
    return NextResponse.json({ error: '검증 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** POST: 불일치 문항 일괄 자동수정 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const fixes: { id: string; answer: string }[] = Array.isArray(body?.fixes) ? body.fixes : [];

  if (fixes.length === 0) {
    return NextResponse.json({ error: 'fixes 배열이 필요합니다.' }, { status: 400 });
  }

  const validAnswers = new Set(ORDER_CIRCLED);

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    let modifiedCount = 0;
    for (const fix of fixes) {
      if (!ObjectId.isValid(fix.id) || !validAnswers.has(fix.answer as typeof ORDER_CIRCLED[number])) continue;
      const res = await col.updateOne(
        { _id: new ObjectId(fix.id) },
        { $set: { 'question_data.CorrectAnswer': fix.answer, updated_at: new Date() } },
      );
      modifiedCount += res.modifiedCount;
    }

    return NextResponse.json({ ok: true, modifiedCount });
  } catch (e) {
    console.error('validate/order-answer-verify POST:', e);
    return NextResponse.json({ error: '수정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** DELETE: 미셔플 등 불량 문항 일괄 하드 삭제 (body: { ids: string[] }) */
export async function DELETE(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids 배열이 필요합니다.' }, { status: 400 });
  }

  const validIds = ids.filter(id => typeof id === 'string' && ObjectId.isValid(id)).map(id => new ObjectId(id));
  if (validIds.length === 0) {
    return NextResponse.json({ error: '유효한 ObjectId가 없습니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const r = await db.collection('generated_questions').deleteMany({ _id: { $in: validIds } });
    return NextResponse.json({ ok: true, deletedCount: r.deletedCount });
  } catch (e) {
    console.error('validate/order-answer-verify DELETE:', e);
    return NextResponse.json({ error: '삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
