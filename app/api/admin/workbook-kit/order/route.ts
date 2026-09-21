import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';
import { loadKitPassagesBySourceKeys } from '@/lib/workbook-kit/load-passages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * BW-/MW- 워크북 주문 → 교재·선택 지문·패키지.
 * GET ?orderNumber=BW-20260921-001
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const orderNumber = (request.nextUrl.searchParams.get('orderNumber') ?? '').trim();
  if (!/^[A-Z]{2}-\d{8}-\d{3,}$/.test(orderNumber)) {
    return NextResponse.json({ error: '주문번호 형식이 올바르지 않습니다.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const order = await db.collection('orders').findOne({ orderNumber });
  if (!order) return NextResponse.json({ error: '주문을 찾을 수 없습니다.' }, { status: 404 });

  const m = (order.orderMeta ?? {}) as Record<string, unknown>;
  if (m.flow !== 'workbook') {
    return NextResponse.json({ error: '워크북 주문(BW/MW)이 아닙니다.' }, { status: 422 });
  }

  const textbook = String(m.selectedTextbook ?? '').trim();
  const selectedLessons = Array.isArray(m.selectedLessons)
    ? m.selectedLessons.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
    : [];
  const selectedPackages = Array.isArray(m.selectedPackages)
    ? m.selectedPackages.filter((x): x is string => typeof x === 'string')
    : [];

  const passages = textbook && selectedLessons.length
    ? await loadKitPassagesBySourceKeys(textbook, selectedLessons)
    : [];

  /* 주문 패키지 → 키트 유형 기본 선택 */
  const suggestedTypes: string[] = [];
  if (selectedPackages.includes('blank_package') || selectedPackages.includes('keyword_blank')) {
    if (selectedPackages.includes('blank_package')) {
      suggestedTypes.push('blank_adj', 'blank_keyword', 'blank_noun', 'blank_prep', 'blank_verb');
    } else {
      suggestedTypes.push('blank_keyword');
    }
  }
  if (selectedPackages.includes('word_arrangement')) suggestedTypes.push('word_arrange');
  if (selectedPackages.includes('workbook_grammar_either_or')) suggestedTypes.push('grammar_either_or');
  if (selectedPackages.includes('workbook_grammar_error_correction')) suggestedTypes.push('grammar_correction');

  return NextResponse.json({
    ok: true,
    orderNumber,
    textbook,
    selectedLessons,
    selectedPackages,
    suggestedTypes,
    passages: passages.map((p) => ({
      _id: p.id,
      textbook: p.textbook,
      chapter: p.chapter,
      number: p.number,
      source_key: p.sourceKey,
    })),
    missingLessons: selectedLessons.filter((k) => !passages.some((p) => p.sourceKey === k)),
  });
}
