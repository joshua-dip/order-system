import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import {
  runQuestionCountValidation,
  sliceQuestionCountPayloadForApi,
  QUESTION_COUNT_DEFAULT_LIST_ROWS,
  QUESTION_COUNT_LIST_CAP,
} from '@/lib/question-count-validation';

/**
 * passages(원문) 기준 변형문 집계.
 * - textbook: 해당 교재 전체 지문
 * - orderId: 주문서 orderMeta(bookVariant)의 선택 지문·유형·문항수 기준
 * - questionStatus (선택): all(기본) | 대기 | 완료 — 해당 status 변형문만 passage별로 집계
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const orderIdRaw = request.nextUrl.searchParams.get('orderId')?.trim() || '';
  const textbookParam = request.nextUrl.searchParams.get('textbook')?.trim() || '';
  const requiredPerTypeRaw = request.nextUrl.searchParams.get('requiredPerType');
  const questionStatusRaw = request.nextUrl.searchParams.get('questionStatus')?.trim() || '';
  const maxListRaw = parseInt(request.nextUrl.searchParams.get('maxListRows') || '', 10);
  const maxListRows = Number.isFinite(maxListRaw)
    ? Math.min(QUESTION_COUNT_LIST_CAP, Math.max(400, maxListRaw))
    : QUESTION_COUNT_DEFAULT_LIST_ROWS;

  const result = await runQuestionCountValidation({
    textbookParam,
    orderIdRaw,
    requiredPerTypeRaw,
    questionStatusRaw: questionStatusRaw || null,
  });

  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return NextResponse.json(sliceQuestionCountPayloadForApi(result, maxListRows));
}
