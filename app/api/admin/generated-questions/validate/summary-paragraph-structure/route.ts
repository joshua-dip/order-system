import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

const MAX_RESULTS = 500;

/**
 * 요약 문항 Paragraph 구조 검증.
 *
 * 표준: 원문 본문 → 빈 줄 → 요약문 `(A) ____ ... (B) ____` (요약문이 하단)
 *
 * 이상 케이스:
 *   - 'Paragraph 없음'
 *   - '요약문 누락(Paragraph)' : Paragraph에 `(A)·(B)` 둘 다 없음
 *     · 그 중 Question 필드에 (A)/(B) 가 들어 있으면 사유에 [Question에 위치] 표기
 *   - '요약문이 본문 위' : Paragraph 안에 `(A)/(B)`가 있지만 첫 등장이 Paragraph 전반 30% 안
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';

  const base: Record<string, unknown> = { type: '요약' };
  if (textbook) base.textbook = textbook;

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    const docs = await col
      .find(base)
      .project({
        _id: 1,
        textbook: 1,
        source: 1,
        type: 1,
        status: 1,
        difficulty: 1,
        'question_data.Paragraph': 1,
        'question_data.Question': 1,
      })
      .toArray();

    type Item = {
      id: string;
      textbook: string;
      source: string;
      type: string;
      status: string;
      difficulty: string;
      reason: string;
      snippet: string;
      full: string;
    };

    const items: Item[] = [];
    let totalScanned = 0;
    let above = 0;
    let missing = 0;
    let missingInQuestion = 0;

    for (const d of docs) {
      totalScanned += 1;
      const qd = (d.question_data ?? {}) as Record<string, unknown>;
      const para = typeof qd.Paragraph === 'string' ? qd.Paragraph : '';
      const question = typeof qd.Question === 'string' ? qd.Question : '';

      if (!para.trim()) {
        items.push({
          id: String(d._id),
          textbook: String(d.textbook ?? ''),
          source: String(d.source ?? ''),
          type: String(d.type ?? ''),
          status: String(d.status ?? ''),
          difficulty: String(d.difficulty ?? ''),
          reason: 'Paragraph 없음',
          snippet: '(빈 값)',
          full: '',
        });
        if (items.length >= MAX_RESULTS) break;
        continue;
      }

      const idxA = para.indexOf('(A)');
      const idxB = para.indexOf('(B)');

      if (idxA < 0 && idxB < 0) {
        // (A)·(B) 둘 다 Paragraph 안에 없음
        const inQ = question.includes('(A)') || question.includes('(B)');
        if (inQ) missingInQuestion += 1;
        missing += 1;
        items.push({
          id: String(d._id),
          textbook: String(d.textbook ?? ''),
          source: String(d.source ?? ''),
          type: String(d.type ?? ''),
          status: String(d.status ?? ''),
          difficulty: String(d.difficulty ?? ''),
          reason: inQ ? '요약문 누락 [Question에 위치]' : '요약문 누락',
          snippet: para.slice(0, 160).replace(/\s+/g, ' '),
          full: para,
        });
      } else {
        const first = Math.min(
          idxA >= 0 ? idxA : Number.POSITIVE_INFINITY,
          idxB >= 0 ? idxB : Number.POSITIVE_INFINITY,
        );
        const ratio = first / para.length;
        if (ratio < 0.3) {
          above += 1;
          items.push({
            id: String(d._id),
            textbook: String(d.textbook ?? ''),
            source: String(d.source ?? ''),
            type: String(d.type ?? ''),
            status: String(d.status ?? ''),
            difficulty: String(d.difficulty ?? ''),
            reason: '요약문이 본문 위',
            snippet: para.slice(0, 160).replace(/\s+/g, ' '),
            full: para,
          });
        }
      }

      if (items.length >= MAX_RESULTS) break;
    }

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null, type: '요약' },
      totalScanned,
      totalMatched: items.length,
      breakdown: {
        '요약문 누락(Paragraph)': missing,
        '└ 그중 Question 필드에 위치': missingInQuestion,
        '요약문이 본문 위': above,
      },
      items,
      truncated: items.length >= MAX_RESULTS,
      note:
        '표준 요약 포맷은 「본문 → 빈 줄 → 요약문 (A)/(B)」 구조입니다. (1) Paragraph에 (A)·(B) 둘 다 없으면 요약문이 누락되었거나 Question 필드에 들어 있어 화면에서 본문 위에 표시될 수 있습니다. (2) Paragraph 안의 (A)/(B) 첫 등장이 전반 30% 안이면 요약문이 본문 위에 들어 있는 비정상 구조입니다.',
    });
  } catch (e) {
    console.error('validate/summary-paragraph-structure:', e);
    return NextResponse.json(
      { error: '요약 Paragraph 검증 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
