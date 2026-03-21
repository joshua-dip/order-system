import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

/**
 * 디버깅용: orderNumber로 주문서 찾아서 문제수 검증 데이터 상세 조회
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const orderNumber = request.nextUrl.searchParams.get('orderNumber')?.trim() || '';
  if (!orderNumber) {
    return NextResponse.json({ error: 'orderNumber 파라미터가 필요합니다.' }, { status: 400 });
  }

  try {
    const db = await getDb('gomijoshua');
    const ordersCol = db.collection('orders');
    const passagesCol = db.collection('passages');
    const gqCol = db.collection('generated_questions');

    const order = await ordersCol.findOne({ orderNumber });
    if (!order) {
      return NextResponse.json({ error: `주문번호 "${orderNumber}"를 찾을 수 없습니다.` }, { status: 404 });
    }

    const meta = order.orderMeta;
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
      return NextResponse.json({
        error: 'orderMeta가 없습니다.',
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
      });
    }

    const m = meta as Record<string, unknown>;
    const flow = typeof m.flow === 'string' ? m.flow : '';
    if (flow !== 'bookVariant') {
      return NextResponse.json({
        error: `flow가 "bookVariant"가 아닙니다: ${flow}`,
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        flow,
      });
    }

    const textbook = typeof m.selectedTextbook === 'string' ? m.selectedTextbook.trim() : '';
    const selectedLessons = Array.isArray(m.selectedLessons)
      ? m.selectedLessons.filter((x): x is string => typeof x === 'string').map((l) => l.trim()).filter(Boolean)
      : [];
    const selectedTypes = Array.isArray(m.selectedTypes)
      ? m.selectedTypes.filter((x): x is string => typeof x === 'string').map((t) => t.trim()).filter(Boolean)
      : [];
    const qpt =
      typeof m.questionsPerType === 'number' && Number.isFinite(m.questionsPerType) && m.questionsPerType > 0
        ? Math.min(20, Math.floor(m.questionsPerType))
        : 3;

    const passages = await passagesCol
      .find({ textbook, source_key: { $in: selectedLessons } })
      .project({ _id: 1, textbook: 1, chapter: 1, number: 1, source_key: 1 })
      .toArray();

    const matchedKeys = new Set(
      passages.map((p) => (typeof p.source_key === 'string' ? p.source_key.trim() : ''))
    );
    const lessonsWithoutPassage = selectedLessons.filter((l) => !matchedKeys.has(l));

    const passageIds = passages.map((p) => p._id as ObjectId);
    const passageIdStrings = passageIds.map((id) => id.toString());
    const passageIdMatch = {
      $or: [
        { passage_id: { $in: passageIds } },
        { passage_id: { $in: passageIdStrings } },
      ],
    };
    const gqCount = await gqCol.countDocuments(passageIdMatch);
    const gqByPassageType = await gqCol
      .aggregate([
        { $match: passageIdMatch },
        { $addFields: { pidStr: { $toString: '$passage_id' } } },
        {
          $group: {
            _id: { pid: '$pidStr', typ: '$type' },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    const samplePassages = passages.slice(0, 5).map((p) => ({
      _id: p._id.toString(),
      textbook: String(p.textbook ?? ''),
      chapter: String(p.chapter ?? ''),
      number: String(p.number ?? ''),
      source_key: String(p.source_key ?? ''),
    }));

    const samplePassageIds = passageIds.slice(0, 3);
    const samplePassageIdStrings = samplePassageIds.map((id) => id.toString());
    const sampleGq = await gqCol
      .find({
        $or: [
          { passage_id: { $in: samplePassageIds } },
          { passage_id: { $in: samplePassageIdStrings } },
        ],
      })
      .project({ _id: 1, passage_id: 1, type: 1, source: 1, textbook: 1 })
      .limit(10)
      .toArray();

    return NextResponse.json({
      order: {
        _id: order._id.toString(),
        orderNumber: order.orderNumber,
        flow,
      },
      orderMeta: {
        selectedTextbook: textbook,
        selectedLessons,
        selectedTypes,
        questionsPerType: qpt,
      },
      passages: {
        total: passages.length,
        requestedLessons: selectedLessons.length,
        matchedLessons: matchedKeys.size,
        lessonsWithoutPassage,
        sample: samplePassages,
      },
      generatedQuestions: {
        total: gqCount,
        byPassageType: gqByPassageType.map((r) => ({
          passageId: String((r._id as { pid?: unknown }).pid ?? ''),
          type: String((r._id as { typ?: unknown }).typ ?? ''),
          count: Number(r.count) || 0,
        })),
        sample: sampleGq.map((g) => ({
          _id: g._id.toString(),
          passage_id: String(g.passage_id ?? ''),
          type: String(g.type ?? ''),
          source: String(g.source ?? ''),
          textbook: String(g.textbook ?? ''),
        })),
      },
      analysis: {
        issue: gqCount === 0
          ? 'generated_questions에 해당 passages의 문제가 전혀 없습니다.'
          : lessonsWithoutPassage.length > 0
            ? `주문서의 ${lessonsWithoutPassage.length}개 지문 라벨이 passages에 없습니다: ${lessonsWithoutPassage.slice(0, 5).join(', ')}${lessonsWithoutPassage.length > 5 ? '...' : ''}`
            : '데이터는 정상적으로 매칭되었습니다.',
      },
    });
  } catch (e) {
    console.error('debug question-count-order:', e);
    return NextResponse.json({ error: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
