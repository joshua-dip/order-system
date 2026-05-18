import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

const MAX_RESULTS = 500;

/** Question 필드가 없거나, 빈 문자열·공백, 또는 비정상 타입인 경우 분류 */
function classifyQuestionIssue(raw: unknown): {
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
  return { ok: true, reason: '', preview: s.slice(0, 100) };
}

/**
 * Question 필드 누락·이상 검증.
 * - question_data.Question 이 없거나, null, 빈 문자열·공백만, 비문자 타입.
 * - 상단 textbook / type 필터 동일 적용.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';
  const type = request.nextUrl.searchParams.get('type')?.trim() || '';

  const base: Record<string, unknown> = {};
  if (textbook) base.textbook = textbook;
  if (type) base.type = type;

  const questionProblems: Record<string, unknown> = {
    $or: [
      { 'question_data.Question': { $exists: false } },
      { 'question_data.Question': null },
      { 'question_data.Question': '' },
      { 'question_data.Question': { $regex: '^\\s+$' } },
      { 'question_data.Question': { $type: 'double' } },
      { 'question_data.Question': { $type: 'int' } },
      { 'question_data.Question': { $type: 'long' } },
      { 'question_data.Question': { $type: 'bool' } },
      { 'question_data.Question': { $type: 'array' } },
      { 'question_data.Question': { $type: 'object' } },
    ],
  };

  const match =
    Object.keys(base).length > 0 ? { $and: [base, questionProblems] } : questionProblems;

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
        status: 1,
        'question_data.Question': 1,
      })
      .sort({ textbook: 1, source: 1, type: 1 })
      .limit(MAX_RESULTS);

    const docs = await cursor.toArray();

    const items = docs
      .map((d) => {
        const q = (d.question_data as Record<string, unknown> | undefined)?.Question;
        const c = classifyQuestionIssue(q);
        const str =
          typeof q === 'string'
            ? q
            : q === undefined || q === null
              ? ''
              : typeof q === 'number' && Number.isNaN(q)
                ? 'NaN'
                : String(q);
        return {
          id: String(d._id),
          textbook: String(d.textbook ?? ''),
          source: String(d.source ?? ''),
          type: String(d.type ?? ''),
          status: String(d.status ?? ''),
          reason: c.reason || '이상',
          snippet: c.preview.slice(0, 120) || '(표시 없음)',
          full: str,
          _ok: c.ok,
        };
      })
      .filter((item) => !item._ok);

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null, type: type || null },
      totalMatched: items.length,
      items,
      truncated: totalMatched > MAX_RESULTS,
      note:
        '문항 발문(question_data.Question)이 없거나 빈칸·공백·비정상 타입인 경우입니다. 「수정」으로 편집 모달을 열어 발문을 채워 넣으세요.',
    });
  } catch (e) {
    console.error('validate/question-missing:', e);
    return NextResponse.json(
      { error: 'Question 누락 검증 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
