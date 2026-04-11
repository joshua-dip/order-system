import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

const MAX_RESULTS = 500;

/** Explanation 필드가 문자열이 아니거나, 비어 있거나, 공백만 있거나, 'nan' 토큰이 포함된 경우 */
function classifyExplanationIssue(raw: unknown): {
  ok: boolean;
  reason: string;
  preview: string;
} {
  if (raw === undefined) {
    return { ok: false, reason: '필드 없음', preview: '' };
  }
  if (raw === null) {
    return { ok: false, reason: 'null', preview: '' };
  }
  if (typeof raw === 'number' && Number.isNaN(raw)) {
    return { ok: false, reason: '숫자 NaN (BSON)', preview: 'NaN' };
  }
  if (typeof raw !== 'string') {
    const preview =
      typeof raw === 'object'
        ? JSON.stringify(raw).slice(0, 120)
        : String(raw).slice(0, 120);
    return { ok: false, reason: `비문자 타입 (${typeof raw})`, preview };
  }
  const s = raw;
  if (!s.trim()) {
    return {
      ok: false,
      reason: s.length === 0 ? '빈 문자열' : '공백만',
      preview: s.length === 0 ? '(길이 0)' : '(공백·개행만)',
    };
  }
  if (/\bnan\b/i.test(s)) {
    const cleaned = s.replace(/\bNan\s+[A-Z][a-z]+/g, '');
    if (/\bnan\b/i.test(cleaned)) {
      return { ok: false, reason: "문자열에 'nan' 포함", preview: s.slice(0, 200) };
    }
  }
  return { ok: true, reason: '', preview: s.slice(0, 100) };
}

/**
 * Explanation: 해설 없음(필드 없음·null·빈칸) 또는 문자열/숫자 NaN 등 이상 값·'nan' 토큰 포함 문항 검증.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';
  const type = request.nextUrl.searchParams.get('type')?.trim() || '';

  const base: Record<string, unknown> = {};
  if (textbook) base.textbook = textbook;
  if (type) base.type = type;

  const explProblems: Record<string, unknown> = {
    $or: [
      { 'question_data.Explanation': { $exists: false } },
      { 'question_data.Explanation': null },
      { 'question_data.Explanation': '' },
      { 'question_data.Explanation': { $regex: '\\bnan\\b', $options: 'i' } },
      { 'question_data.Explanation': { $regex: '^\\s+$' } },
      { 'question_data.Explanation': { $type: 'double' } },
      { 'question_data.Explanation': { $type: 'int' } },
      { 'question_data.Explanation': { $type: 'long' } },
      { 'question_data.Explanation': { $type: 'bool' } },
      { 'question_data.Explanation': { $type: 'array' } },
      { 'question_data.Explanation': { $type: 'object' } },
    ],
  };

  const match =
    Object.keys(base).length > 0 ? { $and: [base, explProblems] } : explProblems;

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    const totalMatched = await col.countDocuments(match);
    const cursor = col
      .find(match)
      .project({
        _id: 1,
        textbook: 1,
        source: 1,
        type: 1,
        'question_data.Explanation': 1,
      })
      .sort({ textbook: 1, source: 1, type: 1 })
      .limit(MAX_RESULTS);

    const docs = await cursor.toArray();

    const items = docs.map((d) => {
      const expl = (d.question_data as Record<string, unknown> | undefined)?.Explanation;
      const c = classifyExplanationIssue(expl);
      const str =
        typeof expl === 'string'
          ? expl
          : expl === undefined || expl === null
            ? ''
            : typeof expl === 'number' && Number.isNaN(expl)
              ? 'NaN'
              : String(expl);
      return {
        id: String(d._id),
        textbook: String(d.textbook ?? ''),
        source: String(d.source ?? ''),
        type: String(d.type ?? ''),
        reason: c.reason || '이상',
        snippet: c.preview.slice(0, 120) || '(표시 없음)',
        full: str,
        _ok: c.ok,
      };
    }).filter((item) => !item._ok);

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null, type: type || null },
      totalMatched: items.length,
      items,
      truncated: totalMatched > MAX_RESULTS,
      note:
        '해설이 없으면 Explanation 필드가 없거나 null·빈 문자열일 수 있습니다. 화면/엑셀에서 nan으로 보이는 경우는 DB에 문자열 "nan"이 들어갔거나, 드물게 BSON 숫자 NaN으로 저장된 경우일 수 있습니다. 목록의 「사유」로 구분해 확인하세요.',
    });
  } catch (e) {
    console.error('validate/explanation-nan:', e);
    return NextResponse.json(
      { error: 'Explanation nan/누락 검증 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
