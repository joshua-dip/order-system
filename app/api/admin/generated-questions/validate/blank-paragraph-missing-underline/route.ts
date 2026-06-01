import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

const MAX_RESULTS = 500;

/**
 * 빈칸 문항 Paragraph 안에 빈칸 표시(`<u>`, 4개 이상의 `_`, 4개 이상의 `—`, 6개 이상의 `-`)가
 * 하나도 없는 경우 = 원문이 그대로 들어가 빈칸 처리 자체가 누락된 케이스.
 */
function hasBlankMarker(para: string): boolean {
  if (/<u[^>]*>/i.test(para)) return true;
  if (/_{4,}/.test(para)) return true;
  if (/—{4,}/.test(para)) return true;
  if (/-{6,}/.test(para)) return true;
  return false;
}

export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';

  const base: Record<string, unknown> = { type: '빈칸' };
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
        'question_data.CorrectAnswer': 1,
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
    let noParagraph = 0;

    for (const d of docs) {
      totalScanned += 1;
      const qd = (d.question_data ?? {}) as Record<string, unknown>;
      const para = typeof qd.Paragraph === 'string' ? qd.Paragraph : '';
      if (!para.trim()) {
        noParagraph += 1;
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
        continue;
      }
      if (!hasBlankMarker(para)) {
        items.push({
          id: String(d._id),
          textbook: String(d.textbook ?? ''),
          source: String(d.source ?? ''),
          type: String(d.type ?? ''),
          status: String(d.status ?? ''),
          difficulty: String(d.difficulty ?? ''),
          reason: '빈칸 표시 없음',
          snippet: para.slice(0, 160).replace(/\s+/g, ' '),
          full: para,
        });
      }
      if (items.length >= MAX_RESULTS) break;
    }

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null, type: '빈칸' },
      totalScanned,
      totalMatched: items.length,
      noParagraph,
      items,
      truncated: items.length >= MAX_RESULTS,
      note:
        '빈칸 문항 Paragraph 안에 `<u>…</u>` 태그나 충분히 긴 밑줄(`____` 4개 이상 / `————` 4개 이상 / `------` 6개 이상)이 모두 없는 경우입니다. 원문이 그대로 들어가 빈칸 처리가 누락된 상태일 가능성이 큽니다. 수정 버튼으로 정답 구절 위치에 `<u>______</u>` 를 직접 넣어 주세요.',
    });
  } catch (e) {
    console.error('validate/blank-paragraph-missing-underline:', e);
    return NextResponse.json(
      { error: '빈칸 Paragraph 검증 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
