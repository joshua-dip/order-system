import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireVipMenu } from '@/lib/vip-menu-guard';
import { getDb } from '@/lib/mongodb';
import { formatGeneratedSerial } from '@/lib/generated-question-serial';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Options 문자열/배열 → 원형숫자 프리픽스 제거한 텍스트 5개 */
function normalizeOptions(raw: unknown): string[] {
  let parts: string[] = [];
  if (Array.isArray(raw)) parts = raw.map((x) => String(x ?? ''));
  else if (typeof raw === 'string') {
    const s = raw.trim();
    parts = s.includes('###') ? s.split('###') : s.split(/\n/);
  }
  return parts
    .map((p) => p.replace(/^[\s]*[①②③④⑤]\s*/, '').trim())
    .filter((_, i) => i < 5);
}

/** GET ?ids=a,b,c — 편집기 삽입용 문제 전체 스냅샷 (본문·보기·정답·해설) */
export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'materials');
  if (auth instanceof NextResponse) return auth;
  const ids = (request.nextUrl.searchParams.get('ids') || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => ObjectId.isValid(x))
    .slice(0, 50);
  if (ids.length === 0) return NextResponse.json({ error: 'ids 필요' }, { status: 400 });

  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('generated_questions')
    .find({ _id: { $in: ids.map((x) => new ObjectId(x)) }, status: '완료' })
    .project({ serialNo: 1, type: 1, textbook: 1, source: 1, question_data: 1 })
    .toArray();

  const order = new Map(ids.map((x, i) => [x, i]));
  const items = docs
    .sort((a, b) => (order.get(String(a._id)) ?? 0) - (order.get(String(b._id)) ?? 0))
    .map((d) => {
      const qd = (d.question_data ?? {}) as Record<string, unknown>;
      return {
        qid: String(d._id),
        serial: typeof d.serialNo === 'number' ? formatGeneratedSerial(d.serialNo) : '',
        type: String(d.type ?? ''),
        textbook: String(d.textbook ?? ''),
        source: String(d.source ?? ''),
        question: String(qd.Question ?? ''),
        paragraph: String(qd.Paragraph ?? ''),
        options: normalizeOptions(qd.Options),
        answer: String(qd.CorrectAnswer ?? qd.Answer ?? ''),
        explanation: String(qd.Explanation ?? ''),
      };
    });
  return NextResponse.json({ ok: true, items });
}
