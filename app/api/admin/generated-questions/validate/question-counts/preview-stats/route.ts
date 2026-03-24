import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { BOOK_VARIANT_QUESTION_TYPES } from '@/lib/book-variant-types';
import { parseQuestionStatusScope } from '@/lib/question-count-validation';

/**
 * 문제수 검증 실행 전 — 교재/주문 기준 DB 규모만 빠르게 조회 (countDocuments).
 * 화면에서「최대 행 수」선택 가이드용.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbookParam = request.nextUrl.searchParams.get('textbook')?.trim() || '';
  const orderIdRaw = request.nextUrl.searchParams.get('orderId')?.trim() || '';
  const questionStatusScope = parseQuestionStatusScope(
    request.nextUrl.searchParams.get('questionStatus')
  );
  const typeCount = BOOK_VARIANT_QUESTION_TYPES.length;

  const gqCountFilter = (textbook: string) =>
    questionStatusScope === 'all'
      ? { textbook }
      : { textbook, status: questionStatusScope };

  try {
    const db = await getDb('gomijoshua');
    const passagesCol = db.collection('passages');
    const gqCol = db.collection('generated_questions');

    if (orderIdRaw) {
      if (!ObjectId.isValid(orderIdRaw)) {
        return NextResponse.json({ error: '유효한 orderId가 아닙니다.' }, { status: 400 });
      }
      const order = await db.collection('orders').findOne({ _id: new ObjectId(orderIdRaw) });
      if (!order) {
        return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });
      }
      const meta = order.orderMeta;
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        return NextResponse.json({
          ok: true,
          scope: 'order' as const,
          questionStatusScope,
          orderMetaMissing: true,
          message: '주문에 orderMeta가 없습니다.',
        });
      }
      const m = meta as Record<string, unknown>;
      const flow = typeof m.flow === 'string' ? m.flow : '';
      if (flow !== 'bookVariant') {
        return NextResponse.json({
          ok: true,
          scope: 'order' as const,
          questionStatusScope,
          orderNotBookVariant: true,
          flow: flow || null,
          message: '부교재 변형(bookVariant) 주문만 미리보기 집계를 지원합니다.',
        });
      }
      const textbook = typeof m.selectedTextbook === 'string' ? m.selectedTextbook.trim() : '';
      const selectedLessons = Array.isArray(m.selectedLessons)
        ? m.selectedLessons.filter((x): x is string => typeof x === 'string')
        : [];
      const normalized = [...new Set(selectedLessons.map((l) => l.trim()).filter(Boolean))];
      if (!textbook || normalized.length === 0) {
        return NextResponse.json({
          ok: true,
          scope: 'order' as const,
          questionStatusScope,
          textbook: textbook || null,
          orderLessonsRequested: normalized.length,
          passageCount: 0,
          generatedQuestionsCount: 0,
          standardTypeCount: typeCount,
          underfilledRowsWorstCase: 0,
          noQuestionsRowsWorstCase: 0,
          message: '교재명 또는 선택 지문이 비어 있습니다.',
        });
      }

      const [passageCount, generatedQuestionsCount] = await Promise.all([
        passagesCol.countDocuments({ textbook, source_key: { $in: normalized } }),
        gqCol.countDocuments(gqCountFilter(textbook)),
      ]);

      return NextResponse.json({
        ok: true,
        scope: 'order' as const,
        questionStatusScope,
        textbook,
        orderLessonsRequested: normalized.length,
        passageCount,
        generatedQuestionsCount,
        standardTypeCount: typeCount,
        underfilledRowsWorstCase: passageCount * typeCount,
        noQuestionsRowsWorstCase: passageCount,
      });
    }

    if (!textbookParam) {
      return NextResponse.json({ error: '교재(textbook) 또는 주문(orderId)을 지정해 주세요.' }, { status: 400 });
    }

    const [passageCount, generatedQuestionsCount] = await Promise.all([
      passagesCol.countDocuments({ textbook: textbookParam }),
      gqCol.countDocuments(gqCountFilter(textbookParam)),
    ]);

    return NextResponse.json({
      ok: true,
      scope: 'textbook' as const,
      questionStatusScope,
      textbook: textbookParam,
      passageCount,
      generatedQuestionsCount,
      standardTypeCount: typeCount,
      underfilledRowsWorstCase: passageCount * typeCount,
      noQuestionsRowsWorstCase: passageCount,
    });
  } catch (e) {
    console.error('question-counts preview-stats:', e);
    return NextResponse.json({ error: '미리보기 집계에 실패했습니다.' }, { status: 500 });
  }
}
