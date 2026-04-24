import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

const MAX_RESULTS = 2000;

/**
 * 순서 유형 문항의 CorrectAnswer 검증 · 일괄 자동수정.
 *
 * 올바른 CorrectAnswer: ① ~ ⑤ 중 하나 (단일 동그라미 번호)
 * 잘못된 예: "(B) - (A) - (C)", "② (B)-(A)-(C)" 등
 *
 * 자동수정 매핑 (Options 기준):
 *   (A)-(C)-(B) → ①
 *   (B)-(A)-(C) → ②
 *   (B)-(C)-(A) → ③
 *   (C)-(A)-(B) → ④
 *   (C)-(B)-(A) → ⑤
 */

const CORRECT_ORDER_OPTIONS = ['(A)-(C)-(B)', '(B)-(A)-(C)', '(B)-(C)-(A)', '(C)-(A)-(B)', '(C)-(B)-(A)'];
const CIRCLED = ['①', '②', '③', '④', '⑤'];
const VALID_ANSWERS = new Set(CIRCLED);

/** CorrectAnswer를 정규화해서 동그라미 번호로 변환. 변환 불가능하면 null. */
function toCircled(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();

  // 단순 숫자 문자열 "1"~"5" 처리
  if (/^[1-5]$/.test(s)) return CIRCLED[parseInt(s, 10) - 1]!;

  const stripped = s
    .replace(/^[①②③④⑤]\s*/, '')  // 앞 번호 제거
    .replace(/\s*-\s*/g, '-')        // " - " → "-"
    .trim();
  const idx = CORRECT_ORDER_OPTIONS.indexOf(stripped);
  return idx >= 0 ? CIRCLED[idx]! : null;
}

function isValidAnswer(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return VALID_ANSWERS.has(raw.trim());
}

/** GET: 순서 유형 중 CorrectAnswer가 올바른 동그라미 번호가 아닌 문항 조회 */
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
      .project({ _id: 1, textbook: 1, source: 1, 'question_data.CorrectAnswer': 1, 'question_data.Options': 1 })
      .sort({ textbook: 1, source: 1 });

    const docs = await cursor.toArray();

    const invalid: {
      id: string;
      textbook: string;
      source: string;
      currentAnswer: string;
      suggestedAnswer: string | null;
      canAutoFix: boolean;
    }[] = [];

    for (const d of docs) {
      const qd = d.question_data as Record<string, unknown> | undefined;
      const ca = qd?.CorrectAnswer;
      if (!isValidAnswer(ca)) {
        const suggested = toCircled(ca);
        invalid.push({
          id: String(d._id),
          textbook: String(d.textbook ?? ''),
          source: String(d.source ?? ''),
          currentAnswer: typeof ca === 'string' ? ca : String(ca ?? '(없음)'),
          suggestedAnswer: suggested,
          canAutoFix: suggested !== null,
        });
        if (invalid.length >= MAX_RESULTS) break;
      }
    }

    const autoFixable = invalid.filter((i) => i.canAutoFix).length;

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null },
      totalScanned,
      totalMatched: invalid.length,
      truncated: invalid.length >= MAX_RESULTS,
      autoFixable,
      items: invalid,
    });
  } catch (e) {
    console.error('validate/order-correct-answer GET:', e);
    return NextResponse.json({ error: '검증 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** POST: 자동수정 가능한 문항 일괄 업데이트 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((v: unknown) => typeof v === 'string' && ObjectId.isValid(v)) : [];
  const answerMap: Record<string, string> = body?.answerMap && typeof body.answerMap === 'object' ? body.answerMap : {};

  if (ids.length === 0 || Object.keys(answerMap).length === 0) {
    return NextResponse.json({ error: 'ids와 answerMap이 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    // 배치: answerMap에서 같은 값끼리 묶어 update-many
    const byAnswer = new Map<string, ObjectId[]>();
    for (const id of ids) {
      const ans = answerMap[id];
      if (!ans || !VALID_ANSWERS.has(ans)) continue;
      if (!byAnswer.has(ans)) byAnswer.set(ans, []);
      byAnswer.get(ans)!.push(new ObjectId(id));
    }

    let modifiedTotal = 0;
    for (const [ans, oids] of byAnswer) {
      const res = await col.updateMany(
        { _id: { $in: oids } },
        { $set: { 'question_data.CorrectAnswer': ans } },
      );
      modifiedTotal += res.modifiedCount;
    }

    return NextResponse.json({ ok: true, modifiedCount: modifiedTotal });
  } catch (e) {
    console.error('validate/order-correct-answer POST:', e);
    return NextResponse.json({ error: '자동수정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
