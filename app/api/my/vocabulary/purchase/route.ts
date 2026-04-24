import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { ORDER_PREFIX } from '@/lib/orderPrefix';
import { purchaseVocabularies, getOwnedPassageIds, type PurchaseItem } from '@/lib/vocabulary-library-store';
import { VOCABULARY_POINTS_PER_PASSAGE, type VocabularyPackageType } from '@/lib/vocabulary-library-types';
import { isFreeVocabularyMockExamTextbook } from '@/lib/mock-exam-key';
import { lessonLabelFromPassageRow } from '@/lib/vocabulary-lesson-label';

/**
 * 요청 본문 형식 (두 가지 방식 지원):
 * 1. passage_id 직접: { items: [{ passage_id: string, package_type }] }
 * 2. 레슨 레이블: { textbook: string, items: [{ lesson_label: string, package_type }] }
 */

const ORDERS_COLLECTION = 'orders';

type OrderNumberCounterDoc = { _id: string; n: number };

async function generateOrderNumber(db: Awaited<ReturnType<typeof getDb>>): Promise<string> {
  const prefix = ORDER_PREFIX.BOOK_VOCABULARY;
  const now = new Date();
  const pad = (n: number, d = 2) => String(n).padStart(d, '0');
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const counterKey = `${prefix}_${datePart}`;
  const counterColl = db.collection<OrderNumberCounterDoc>('orderNumberCounters');
  const ordersColl = db.collection(ORDERS_COLLECTION);

  for (let attempt = 0; attempt < 200; attempt++) {
    const updated = await counterColl.findOneAndUpdate(
      { _id: counterKey },
      { $inc: { n: 1 } },
      { upsert: true, returnDocument: 'after' },
    );
    const n = updated && typeof updated.n === 'number' ? updated.n : attempt + 1;
    const candidate = `${prefix}-${datePart}-${pad(n, 3)}`;
    const clash = await ordersColl.findOne({ orderNumber: candidate }, { projection: { _id: 1 } });
    if (!clash) return candidate;
  }
  throw new Error('주문번호를 할당하지 못했습니다.');
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: '인증이 만료되었습니다.' }, { status: 401 });

  try {
    const body = await request.json();
    const rawItems: unknown[] = Array.isArray(body?.items) ? body.items : [];
    if (rawItems.length === 0) {
      return NextResponse.json({ error: '구매할 지문을 선택해주세요.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');

    // 레슨 레이블 방식 처리: lesson_label + textbook → passage_id 조회
    const textbook: string = typeof body?.textbook === 'string' ? body.textbook.trim() : '';
    const needsLookup = rawItems.some(
      (i) => typeof (i as Record<string, unknown>)?.lesson_label === 'string',
    );

    let passageIdItems: PurchaseItem[] = [];

    if (needsLookup && textbook) {
      type LabelItem = { lesson_label: string; package_type: VocabularyPackageType };
      const labelItems = rawItems.filter(
        (i): i is LabelItem => typeof (i as Record<string, unknown>)?.lesson_label === 'string',
      ).map((i) => {
        const o = i as Record<string, unknown>;
        const pt = o.package_type;
        const package_type: VocabularyPackageType =
          pt === 'detailed' || pt === 'basic' ? pt : 'basic';
        return { lesson_label: String(o.lesson_label), package_type };
      });

      // chapter 에 공백이 포함될 수 있어(예: "3월 고1 영어모의고사 18번") 첫 공백 split 으로는 조회 불가 →
      // 해당 교재 passages 전부 로드 후 레이블 정확 일치로 매핑
      type PRow = { _id: ObjectId; chapter?: string; number?: string };
      const passages = (await db
        .collection('passages')
        .find({ textbook })
        .project({ _id: 1, chapter: 1, number: 1 })
        .limit(8000)
        .toArray()) as PRow[];

      const byLabel = new Map<string, string>();
      for (const p of passages) {
        const label = lessonLabelFromPassageRow(p);
        if (label) byLabel.set(label, p._id.toHexString());
      }

      for (const li of labelItems) {
        const key = li.lesson_label.trim();
        const pid = byLabel.get(key);
        if (pid) passageIdItems.push({ passage_id: pid, package_type: li.package_type });
      }
    } else {
      // passage_id 직접 방식
      const items: PurchaseItem[] = [];
      for (const item of rawItems) {
        if (
          typeof item === 'object' &&
          item !== null &&
          typeof (item as Record<string, unknown>).passage_id === 'string'
        ) {
          const o = item as Record<string, unknown>;
          const pt = o.package_type;
          const package_type: VocabularyPackageType =
            pt === 'detailed' || pt === 'basic' ? pt : 'basic';
          items.push({
            passage_id: o.passage_id as string,
            package_type,
          });
        }
      }
      passageIdItems = items;
    }

    const items = passageIdItems.map((i) => ({ ...i, package_type: 'basic' as const }));
    if (items.length === 0) {
      return NextResponse.json({ error: '유효한 지문을 찾을 수 없습니다.' }, { status: 400 });
    }

    const userId = new ObjectId(payload.sub);
    const loginId = payload.loginId;

    // 지문별 포인트: 고1·2·3 영어모의고사(passages.textbook 기준)는 0P
    const itemOids = items.map((i) => new ObjectId(i.passage_id));
    type PTb = { _id: ObjectId; textbook?: string };
    const passageRows = (await db
      .collection('passages')
      .find({ _id: { $in: itemOids } })
      .project({ _id: 1, textbook: 1 })
      .toArray()) as PTb[];
    const tbByPassageHex = new Map<string, string>();
    for (const row of passageRows) {
      tbByPassageHex.set(row._id.toHexString(), String(row.textbook ?? '').trim());
    }
    const pointsForPassage = (hex: string): number => {
      const tb = tbByPassageHex.get(hex) || textbook;
      return isFreeVocabularyMockExamTextbook(tb) ? 0 : VOCABULARY_POINTS_PER_PASSAGE;
    };
    const totalPoints = items.reduce((sum, i) => sum + pointsForPassage(i.passage_id), 0);

    // 이미 보유한 지문 중복 확인
    const ownedSet = await getOwnedPassageIds(userId, db);
    const duplicateIds = items.filter((i) => ownedSet.has(i.passage_id)).map((i) => i.passage_id);
    if (duplicateIds.length > 0) {
      return NextResponse.json(
        { error: `이미 보유한 지문이 ${duplicateIds.length}개 포함되어 있습니다. 다시 선택해 주세요.` },
        { status: 422 },
      );
    }

    // 포인트 잔액 확인
    const userDoc = await db
      .collection('users')
      .findOne({ _id: userId }, { projection: { points: 1, name: 1 } });
    const docPoints = (userDoc as unknown as { points?: number } | null)?.points;
    const currentPoints = typeof docPoints === 'number' ? docPoints : 0;
    if (currentPoints < totalPoints) {
      return NextResponse.json(
        {
          error: `포인트가 부족합니다. 보유: ${currentPoints}P, 필요: ${totalPoints}P`,
          currentPoints,
          totalPoints,
        },
        { status: 400 },
      );
    }

    // 포인트 차감 (0P인 경우 생략과 동일)
    if (totalPoints > 0) {
      await db.collection('users').updateOne({ _id: userId }, { $inc: { points: -totalPoints } });
    }

    // 주문번호 생성
    const orderNumber = await generateOrderNumber(db);

    // 주문 문서 저장
    const now = new Date();
    const orderText = [
      `단어장 구매 주문`,
      ``,
      `주문번호: ${orderNumber}`,
      `구매자: ${(userDoc as { name?: string })?.name ?? loginId}`,
      `지문 수: ${items.length}개`,
      `사용 포인트: ${totalPoints}P`,
    ].join('\n');

    const orderDoc = {
      orderNumber,
      orderText,
      loginId,
      createdAt: now,
      pointsUsed: totalPoints,
      orderMeta: {
        flow: 'vocabulary',
        version: 2,
        items: items.map((i) => ({ passage_id: i.passage_id, package_type: i.package_type })),
        totalPoints,
      },
    };

    const insertResult = await db.collection(ORDERS_COLLECTION).insertOne(orderDoc);
    const orderId = insertResult.insertedId;

    // 사본 생성
    const result = await purchaseVocabularies(userId, loginId, items, orderNumber, orderId);
    if (!result.ok) {
      // 실패 시 포인트 환급
      if (totalPoints > 0) {
        await db.collection('users').updateOne({ _id: userId }, { $inc: { points: totalPoints } });
      }
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      orderNumber,
      first_id: result.first_id,
      inserted_count: result.inserted_count,
      points_used: totalPoints,
    });
  } catch (e) {
    console.error('vocabulary/purchase:', e);
    return NextResponse.json({ error: '구매 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
