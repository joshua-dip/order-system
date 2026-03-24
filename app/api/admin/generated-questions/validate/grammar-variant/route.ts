import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { getPassageTextForVariantCompare, passageIdToValidHex } from '@/lib/passage-variant-text';
import { validateGrammarVariantQuestion } from '@/lib/grammar-variant-validation';

const MAX_SCAN = 1200;

/**
 * 어법 유형만 스캔: ①~⑤·<u> 구조, Options(①###②###③###④###⑤ 번호만이면 보기문 비교 생략), 원문 대비
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');

    const match: Record<string, unknown> = { type: '어법' };
    if (textbook) match.textbook = textbook;

    const totalScanned = await col.countDocuments(match);

    const docs = await col
      .find(match)
      .project({
        _id: 1,
        textbook: 1,
        source: 1,
        type: 1,
        passage_id: 1,
        question_data: 1,
      })
      .sort({ textbook: 1, source: 1, _id: 1 })
      .limit(MAX_SCAN)
      .toArray();

    const idHexSet = new Set<string>();
    for (const d of docs) {
      const h = passageIdToValidHex(d.passage_id);
      if (h) idHexSet.add(h);
    }
    const passageOids = [...idHexSet].map((h) => new ObjectId(h));
    const passageMap = new Map<string, string>();
    if (passageOids.length > 0) {
      const passagesCol = db.collection('passages');
      const passages = await passagesCol
        .find({ _id: { $in: passageOids } })
        .project({ _id: 1, content: 1 })
        .toArray();
      for (const p of passages) {
        passageMap.set(String(p._id), getPassageTextForVariantCompare((p as { content?: unknown }).content));
      }
    }

    type Item = {
      id: string;
      textbook: string;
      source: string;
      passageId: string | null;
      errors: { code: string; message: string }[];
      warnings: { code: string; message: string }[];
      snippet: string;
    };

    const items: Item[] = [];
    let withErrors = 0;
    let withWarningsOnly = 0;

    for (const d of docs) {
      const qd = (d.question_data as Record<string, unknown>) || {};
      const pid = passageIdToValidHex(d.passage_id);
      const original = pid ? (passageMap.get(pid) ?? '').trim() || null : null;

      const { errors, warnings } = validateGrammarVariantQuestion(qd, original);

      if (errors.length === 0 && warnings.length === 0) continue;

      const first = errors[0]?.message ?? warnings[0]?.message ?? '';
      if (errors.length > 0) withErrors += 1;
      else if (warnings.length > 0) withWarningsOnly += 1;

      items.push({
        id: String(d._id),
        textbook: String(d.textbook ?? ''),
        source: String(d.source ?? ''),
        passageId: pid || null,
        errors,
        warnings,
        snippet: first.slice(0, 140) + (first.length > 140 ? '…' : ''),
      });
    }

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null, type: '어법' },
      totalScanned,
      scanned: docs.length,
      truncated: totalScanned > MAX_SCAN,
      maxScan: MAX_SCAN,
      withErrors,
      withWarningsOnly,
      items,
    });
  } catch (e) {
    console.error('validate/grammar-variant:', e);
    return NextResponse.json(
      { error: '어법 변형 검증 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
