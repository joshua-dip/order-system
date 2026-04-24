import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireVip } from '@/lib/vip-auth';

export async function GET(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const textbooksParam = request.nextUrl.searchParams.get('textbooks');
  if (!textbooksParam?.trim()) {
    return NextResponse.json({ ok: true, passages: [] });
  }

  const textbooks = textbooksParam.split(',').map((t) => t.trim()).filter(Boolean);
  if (textbooks.length === 0) return NextResponse.json({ ok: true, passages: [] });

  try {
    const db = await getDb('gomijoshua');

    // 기출기반 교재 목록 조회
    const examLinkDocs = await db.collection('textbook_links')
      .find({ isExamBased: true, textbookKey: { $in: textbooks } })
      .project({ _id: 0, textbookKey: 1 })
      .toArray();
    const examBasedSet = new Set<string>(examLinkDocs.map((d) => String(d.textbookKey)));

    // passages 조회 (passage_source, original_passage_id 포함)
    const passageDocs = await db.collection('passages')
      .find(
        { textbook: { $in: textbooks } },
        { projection: { _id: 1, textbook: 1, source_key: 1, chapter: 1, number: 1, original_passage_id: 1, passage_source: 1 } },
      )
      .toArray();

    // 중복 제거: textbook + source_key 기준으로 묶고 passageId 정보 보관
    const seenKeys = new Set<string>();
    // 기출기반: examPassageId → originalPassageId 맵
    const examToOrigMap = new Map<string, string>();
    // sourceKey → passage hex ID (기출기반용)
    const sourceKeyToExamPassageId = new Map<string, string>();
    // passage_source 필드 보유 문서: compositeKey → passage_source 값
    const passageSourceMap = new Map<string, string>();

    const uniquePassages: { textbook: string; sourceKey: string; passageSource?: string }[] = [];

    for (const p of passageDocs) {
      const tb = String(p.textbook ?? '').trim();
      const sk = String(p.source_key ?? `${p.chapter ?? ''} ${p.number ?? ''}`.trim()).trim();
      if (!tb || !sk) continue;
      const key = `${tb}::${sk}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const ps = String(p.passage_source ?? '').trim();
      uniquePassages.push({ textbook: tb, sourceKey: sk, ...(ps ? { passageSource: ps } : {}) });

      // passage_source 가 있으면 별도 처리 (올림포스 기출 등)
      if (ps) {
        passageSourceMap.set(key, ps);
      }

      if (examBasedSet.has(tb)) {
        const examHex = (p._id as ObjectId).toHexString();
        sourceKeyToExamPassageId.set(key, examHex);
        if (p.original_passage_id) {
          try {
            const origId = p.original_passage_id instanceof ObjectId
              ? p.original_passage_id
              : new ObjectId(String(p.original_passage_id));
            examToOrigMap.set(examHex, origId.toHexString());
          } catch { /* 무시 */ }
        }
      }
    }

    const variantSet = new Set<string>();

    // 1) 일반 교재: generated_questions.textbook + question_data.Source 로 확인
    const normalTextbooks = textbooks.filter((tb) => !examBasedSet.has(tb));
    if (normalTextbooks.length > 0) {
      const gqDocs = await db.collection('generated_questions')
        .find(
          { textbook: { $in: normalTextbooks } },
          { projection: { _id: 0, textbook: 1, 'question_data.Source': 1 } },
        )
        .toArray();
      for (const q of gqDocs) {
        const tb = String(q.textbook ?? '').trim();
        const src = String((q.question_data as Record<string, unknown>)?.Source ?? '').trim();
        if (tb && src) variantSet.add(`${tb}::${src}`);
      }
    }

    // 2) 기출기반 교재(textbook_links.isExamBased): original_passage_id → generated_questions.passage_id 로 확인
    if (examBasedSet.size > 0) {
      // 유효한 original passage ID 수집
      const origIds = [...new Set([...examToOrigMap.values()])];
      // original_passage_id 없는 기출 지문은 self ID도 포함
      for (const [examHex] of sourceKeyToExamPassageId) {
        if (!examToOrigMap.has(sourceKeyToExamPassageId.get(examHex)!)) {
          origIds.push(sourceKeyToExamPassageId.get(examHex)!);
        }
      }
      const origObjectIds = origIds.map((h) => { try { return new ObjectId(h); } catch { return null; } }).filter(Boolean) as ObjectId[];

      if (origObjectIds.length > 0) {
        const gqByPassage = await db.collection('generated_questions')
          .find(
            { passage_id: { $in: origObjectIds } },
            { projection: { _id: 0, passage_id: 1 } },
          )
          .toArray();
        const origWithVariant = new Set<string>(
          gqByPassage.map((q) => (q.passage_id instanceof ObjectId ? q.passage_id.toHexString() : String(q.passage_id)))
        );

        // examPassageId → sourceKey 역맵으로 variantSet에 추가
        for (const [compositeKey, examHex] of sourceKeyToExamPassageId) {
          const lookupHex = examToOrigMap.get(examHex) ?? examHex;
          if (origWithVariant.has(lookupHex)) {
            variantSet.add(compositeKey);
          }
        }
      }
    }

    // 3) passage_source 필드 보유 지문: source_key로 원본 passage 조회 후 passage_id로 변형문제 확인
    //    (올림포스 기출문제집 등, isExamBased 미등록이지만 passage_source로 원본 연결)
    if (passageSourceMap.size > 0) {
      const sourceValues = [...new Set([...passageSourceMap.values()])];
      const origPassageDocs = await db.collection('passages')
        .find({ source_key: { $in: sourceValues } }, { projection: { _id: 1, source_key: 1 } })
        .toArray();
      const sourceKeyToOrigId = new Map<string, string>();
      for (const op of origPassageDocs) {
        sourceKeyToOrigId.set(String(op.source_key), (op._id as ObjectId).toHexString());
      }

      const origHexIds = [...new Set([...sourceKeyToOrigId.values()])];
      if (origHexIds.length > 0) {
        const origObjectIds = origHexIds.map((h) => { try { return new ObjectId(h); } catch { return null; } }).filter(Boolean) as ObjectId[];
        const gqByPassage = await db.collection('generated_questions')
          .find({ passage_id: { $in: origObjectIds } }, { projection: { _id: 0, passage_id: 1 } })
          .toArray();
        const origWithVariant = new Set<string>(
          gqByPassage.map((q) => (q.passage_id instanceof ObjectId ? q.passage_id.toHexString() : String(q.passage_id)))
        );

        for (const [compositeKey, ps] of passageSourceMap) {
          const origId = sourceKeyToOrigId.get(ps);
          if (origId && origWithVariant.has(origId)) {
            variantSet.add(compositeKey);
          }
        }
      }
    }

    const passages = uniquePassages.map((p) => ({
      ...p,
      hasVariant: variantSet.has(`${p.textbook}::${p.sourceKey}`),
    }));

    return NextResponse.json({ ok: true, passages });
  } catch (e) {
    console.error('passages-by-textbooks:', e);
    return NextResponse.json({ ok: false, error: '소스 목록을 불러올 수 없습니다.' }, { status: 500 });
  }
}
