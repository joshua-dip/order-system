import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/** 텍스트 정규화: 공백·줄바꿈 압축, 소문자, 특수문자 제거 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/["""'']/g, "'")
    .trim();
}

/**
 * source_key 연도 형식 정규화
 * "2023년 9월..." → "23년 9월..."
 * "2011년..."    → "11년..."
 */
function normalizeYearInSource(text: string): string {
  // 20XX년 또는 19XX년 → XX년
  return text.replace(/\b(19|20)(\d{2})년/g, '$2년');
}

/**
 * POST /api/admin/passages/auto-match-source
 * body: { textbook: string, dryRun?: boolean }
 *
 * 기출기반 교재 지문의 content.original을 다른 교재 지문과 비교해
 * 일치하는 것이 있으면 passage_source를 자동 설정합니다.
 * passage_source가 이미 설정된 지문은 건너뜁니다.
 */
export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const textbook = typeof body?.textbook === 'string' ? body.textbook.trim() : '';
    const dryRun = body?.dryRun === true;
    const overwrite = body?.overwrite === true; // 이미 설정된 것도 덮어쓸지

    if (!textbook) {
      return NextResponse.json({ error: 'textbook은 필수입니다.' }, { status: 400 });
    }

    const db = await getDb('gomijoshua');
    const col = db.collection('passages');

    // 1. 대상 교재 지문 로드
    const targetPassages = await col
      .find({ textbook })
      .project({ _id: 1, source_key: 1, number: 1, passage_source: 1, 'content.original': 1 })
      .toArray();

    if (targetPassages.length === 0) {
      return NextResponse.json({ error: '해당 교재에 지문이 없습니다.', textbook }, { status: 404 });
    }

    // 2. 다른 교재 지문 전체 로드 (source_key 있는 것만)
    const otherPassages = await col
      .find({ textbook: { $ne: textbook }, 'content.original': { $exists: true, $ne: '' }, source_key: { $exists: true, $ne: '' } })
      .project({ _id: 1, textbook: 1, source_key: 1, 'content.original': 1 })
      .toArray();

    // 3. 정규화 맵 구성: normalizedText → { textbook, source_key, _id }
    const normalizedMap = new Map<string, { textbook: string; source_key: string; _id: ObjectId }>();
    for (const p of otherPassages) {
      const orig = typeof (p as { content?: { original?: string } }).content?.original === 'string'
        ? (p as { content: { original: string } }).content.original
        : '';
      if (!orig) continue;
      const key = normalize(orig);
      if (key.length < 20) continue; // 너무 짧은 텍스트는 제외
      if (!normalizedMap.has(key)) {
        normalizedMap.set(key, {
          textbook: String(p.textbook ?? ''),
          source_key: String(p.source_key ?? ''),
          _id: p._id as ObjectId,
        });
      }
    }

    // 4. 대상 지문별 매칭
    const results: {
      passageId: string;
      source_key: string;
      matched: string | null;
      alreadySet: boolean;
      updated: boolean;
    }[] = [];

    const bulkOps: import('mongodb').AnyBulkWriteOperation[] = [];

    for (const p of targetPassages) {
      const orig = typeof (p as { content?: { original?: string } }).content?.original === 'string'
        ? (p as { content: { original: string } }).content.original
        : '';
      const alreadySet = typeof p.passage_source === 'string' && p.passage_source.trim().length > 0;

      if (alreadySet && !overwrite) {
        results.push({ passageId: String(p._id), source_key: String(p.source_key ?? p.number ?? ''), matched: p.passage_source as string, alreadySet: true, updated: false });
        continue;
      }

      const normalizedOrig = normalize(orig);
      const match = normalizedOrig.length >= 20 ? normalizedMap.get(normalizedOrig) : null;

      if (match) {
        const passageSourceValue = normalizeYearInSource(match.source_key);
        results.push({ passageId: String(p._id), source_key: String(p.source_key ?? p.number ?? ''), matched: passageSourceValue, alreadySet, updated: !dryRun });
        if (!dryRun) {
          bulkOps.push({
            updateOne: {
              filter: { _id: p._id },
              update: {
                $set: {
                  passage_source: passageSourceValue,
                  /** 원본 출처 passage의 ObjectId — generated_questions 조회 시 사용 */
                  original_passage_id: match._id,
                  updated_at: new Date(),
                },
              },
            },
          });
        }
      } else {
        results.push({ passageId: String(p._id), source_key: String(p.source_key ?? p.number ?? ''), matched: null, alreadySet, updated: false });
      }
    }

    if (bulkOps.length > 0) {
      await col.bulkWrite(bulkOps);
    }

    const stats = {
      total: targetPassages.length,
      alreadySet: results.filter((r) => r.alreadySet && !r.updated).length,
      matched: results.filter((r) => r.matched !== null && !r.alreadySet).length,
      updated: results.filter((r) => r.updated).length,
      unmatched: results.filter((r) => r.matched === null).length,
    };

    return NextResponse.json({ ok: true, dryRun, textbook, stats, results });
  } catch (e) {
    console.error('auto-match-source POST:', e);
    return NextResponse.json({ error: '자동 매칭 실패' }, { status: 500 });
  }
}
