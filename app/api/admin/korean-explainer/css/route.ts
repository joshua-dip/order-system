import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getKoreanExplainerCss } from '@/lib/korean-explainer/css';

/** 편집기 미리보기·새 창 인쇄에서 인라인으로 받을 결합 CSS. */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const { combined } = getKoreanExplainerCss();
  return new NextResponse(combined, {
    status: 200,
    headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
}
