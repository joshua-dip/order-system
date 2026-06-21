import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { validateNarrativeQuestion } from '@/lib/narrative-question-validator';

const MAX_RESULTS = 500;
const SCAN_LIMIT = 20000;

/**
 * 서술형 변형(narrative_questions) 전용 검증 — 객관식 validate/* 의 서술형판.
 * lib/narrative-question-validator.ts 의 규칙 적용:
 *  - 빈칸재배열형: 키워드(<보기>)↔모범답안 단어 멀티셋 일치, (A) 빈칸 표식, 키워드개수/답안단어수
 *  - 이중요지영작형: <u>과제</u> 2개, 답안 단어수 범위
 *  - 공통: 점수, 문제유형 일치, 필수 키, 해설/모범답안 'API'·'nan' 누출
 *
 * GET ?textbook=...&type=...
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';
  const type = request.nextUrl.searchParams.get('type')?.trim() || '';

  const match: Record<string, unknown> = {};
  if (textbook) match.textbook = textbook;
  if (type) match.narrative_subtype = type;

  try {
    const db = await getDb('gomijoshua');
    const docs = await db
      .collection('narrative_questions')
      .find(match)
      .project({ _id: 1, textbook: 1, narrative_subtype: 1, number: 1, source_file: 1, question_data: 1 })
      .sort({ textbook: 1, number: 1 })
      .limit(SCAN_LIMIT)
      .toArray();

    type Item = {
      id: string;
      textbook: string;
      subtype: string;
      number: string;
      source: string;
      severity: 'error' | 'warning';
      message: string;
    };

    const items: Item[] = [];
    const breakdown: Record<string, number> = {};
    let totalFlagged = 0;

    for (const d of docs) {
      const subtype = String(d.narrative_subtype ?? '');
      const qd = (d.question_data ?? {}) as Record<string, unknown>;
      const r = validateNarrativeQuestion(subtype, qd);
      const issues: Array<{ sev: 'error' | 'warning'; m: string }> = [
        ...r.errors.map((m) => ({ sev: 'error' as const, m })),
        ...r.warnings.map((m) => ({ sev: 'warning' as const, m })),
      ];
      if (issues.length === 0) continue;
      totalFlagged += 1;
      for (const is of issues) {
        breakdown[is.sev] = (breakdown[is.sev] ?? 0) + 1;
        if (items.length < MAX_RESULTS) {
          items.push({
            id: String(d._id),
            textbook: String(d.textbook ?? ''),
            subtype,
            number: String(d.number ?? ''),
            source: String(d.source_file ?? ''),
            severity: is.sev,
            message: is.m,
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null, type: type || null },
      totalScanned: docs.length,
      totalFlagged,
      breakdown,
      items,
      truncated: items.length >= MAX_RESULTS,
      note:
        '서술형(narrative_questions) 검증 — 키워드↔모범답안 멀티셋 · (A)빈칸/<보기> · 답안단어수 · <u>과제</u>수 · 점수 · 문제유형 일치 · 해설/모범답안 API·nan 누출. 교재 필터를 지정하면 해당 교재만 검사.',
    });
  } catch (e) {
    console.error('validate/narrative:', e);
    return NextResponse.json({ error: '서술형 검증 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
