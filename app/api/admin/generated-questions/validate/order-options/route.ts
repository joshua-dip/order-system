import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import {
  ORDER_CIRCLED,
  ORDER_FIXED_OPTIONS,
  isStandardOrderOptions,
  parseOrderOptions,
} from '@/lib/order-variant-validation';

const MAX_RESULTS = 500;

/**
 * 글의 순서(순서) 유형 문항의 Options 검증.
 *
 * 올바른 Options(5개):
 *   ① (A)-(C)-(B)
 *   ② (B)-(A)-(C)
 *   ③ (B)-(C)-(A)
 *   ④ (C)-(A)-(B)
 *   ⑤ (C)-(B)-(A)
 *
 * 교재 필터 적용. 보기 분리는 splitQuestionOptionSegments 기준(### 우선, 줄바꿈 호환).
 */

function describeOptions(raw: unknown): string {
  const parts = parseOrderOptions(raw);
  if (parts.length === 0) return '(없음)';
  return parts
    .map((p, i) => (p.startsWith(ORDER_CIRCLED[i] ?? '') ? p : `${ORDER_CIRCLED[i] ?? `${i + 1}.`} ${p}`))
    .join('\n');
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';

  const match: Record<string, unknown> = { type: '순서' };
  if (textbook) match.textbook = textbook;

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    const totalScanned = await col.countDocuments(match);

    const cursor = col
      .find(match)
      .project({ _id: 1, textbook: 1, source: 1, type: 1, 'question_data.Options': 1 })
      .sort({ textbook: 1, source: 1 })
      .limit(totalScanned);   // 전체 스캔 (검증 정확도 우선)

    const docs = await cursor.toArray();

    const invalid: {
      id: string;
      textbook: string;
      source: string;
      type: string;
      optionCount: number;
      optionsPreview: string;
      optionsFull: string;
    }[] = [];

    for (const d of docs) {
      const raw = (d.question_data as Record<string, unknown>)?.Options;
      if (!isStandardOrderOptions(raw)) {
        const full = describeOptions(raw);
        invalid.push({
          id: String(d._id),
          textbook: String(d.textbook ?? ''),
          source: String(d.source ?? ''),
          type: String(d.type ?? ''),
          optionCount: parseOrderOptions(raw).length,
          optionsPreview: full.length > 200 ? full.slice(0, 200) + '…' : full,
          optionsFull: full,
        });
        if (invalid.length >= MAX_RESULTS) break;
      }
    }

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null },
      totalScanned,
      totalMatched: invalid.length,
      truncated: invalid.length >= MAX_RESULTS,
      correctExample: ORDER_FIXED_OPTIONS.map((o, i) => `${ORDER_CIRCLED[i]} ${o}`).join('\n'),
      items: invalid,
    });
  } catch (e) {
    console.error('validate/order-options:', e);
    return NextResponse.json(
      { error: '순서 Options 검증 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
