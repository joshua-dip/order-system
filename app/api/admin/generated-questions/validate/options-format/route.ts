import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import {
  OPTIONS_FORMAT_ISSUE_LABEL,
  checkOptionsFormat,
  isOptionsFormatCheckTarget,
} from '@/lib/options-format-validation';

const MAX_RESULTS = 500;

/**
 * Options 저장 형식 검증.
 *
 * 표준: `① … ### ② … ### ⑤ …` 문자열 (보기 5개, ①~⑤ 접두사).
 * 검출:
 *   - 데이터 없음: Options 필드 없음·null·빈 문자열·비문자
 *   - 배열 저장: string[] — 회원 내보내기에서 선택지가 통째로 누락됨
 *   - 번호 없음 / 번호 일부만: ①~⑤ 접두사 누락
 *   - 보기 수 ≠ 5
 * 워크북 계열 유형(워크북어법 등)은 Options 열을 쓰지 않으므로 제외.
 *
 * GET ?textbook=...&type=...
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';
  const typeFilter = request.nextUrl.searchParams.get('type')?.trim() || '';

  const match: Record<string, unknown> = { deleted_at: null };
  if (textbook) match.textbook = textbook;
  if (typeFilter) match.type = typeFilter;

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    const docs = await col
      .find(match)
      .project({
        _id: 1,
        textbook: 1,
        source: 1,
        type: 1,
        status: 1,
        'question_data.Options': 1,
      })
      .sort({ textbook: 1, source: 1 })
      .toArray();

    type Item = {
      id: string;
      textbook: string;
      source: string;
      type: string;
      status: string;
      reason: string;
      snippet: string;
      full: string;
    };

    const items: Item[] = [];
    const breakdown: Record<string, number> = {};
    let totalScanned = 0;
    let totalMatched = 0;
    let skippedWorkbook = 0;

    for (const d of docs) {
      const type = String(d.type ?? '');
      if (!isOptionsFormatCheckTarget(type)) {
        skippedWorkbook += 1;
        continue;
      }
      totalScanned += 1;
      const raw = (d.question_data as Record<string, unknown> | undefined)?.Options;
      const result = checkOptionsFormat(raw);
      if (result.issues.length === 0) continue;
      totalMatched += 1;
      const labels = result.issues.map((k) => OPTIONS_FORMAT_ISSUE_LABEL[k]);
      for (const label of labels) breakdown[label] = (breakdown[label] ?? 0) + 1;
      if (items.length < MAX_RESULTS) {
        items.push({
          id: String(d._id),
          textbook: String(d.textbook ?? ''),
          source: String(d.source ?? ''),
          type,
          status: String(d.status ?? ''),
          reason: `${labels.join(' · ')}${result.segmentCount ? ` (보기 ${result.segmentCount}개)` : ''}`,
          snippet: result.preview.slice(0, 160).replace(/\s+/g, ' '),
          full: result.preview,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null, type: typeFilter || null },
      totalScanned,
      skippedWorkbook,
      totalMatched,
      breakdown,
      items,
      truncated: items.length >= MAX_RESULTS,
      note:
        '표준 저장 형식은 「① … ### ② … ### ⑤ …」 문자열입니다. 배열 저장은 회원 내보내기에서 선택지가 사라지고, 번호 없는 보기는 번호 없이 그대로 출력됩니다.',
    });
  } catch (e) {
    console.error('validate/options-format:', e);
    return NextResponse.json(
      { error: 'Options 형식 검증 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
