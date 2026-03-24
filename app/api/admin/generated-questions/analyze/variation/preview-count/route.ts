import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { buildVariationAnalysisFilter } from '@/lib/variation-analysis-filter';
import { parseVariationScanCap } from '@/lib/admin-variation-aggregate';

/**
 * 변형도 분석과 동일한 필터로 `generated_questions` 건수만 조회 (최대 스캔 설정 가이드).
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';
  const typeFilter = request.nextUrl.searchParams.get('type')?.trim() || '';

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const filter = buildVariationAnalysisFilter(textbook, typeFilter);
    const matchingCount = await col.countDocuments(filter);
    const scanCap = parseVariationScanCap();

    return NextResponse.json({
      ok: true,
      matchingCount,
      scanCap,
      filters: { textbook: textbook || null, type: typeFilter || null },
    });
  } catch (e) {
    console.error('variation preview-count:', e);
    return NextResponse.json({ error: '건수 조회에 실패했습니다.' }, { status: 500 });
  }
}
