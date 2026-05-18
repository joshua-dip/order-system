import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

const DIFFICULTIES = ['기본난도', '중난도', '고난도', '최고난도'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

interface PassageRow {
  passage_id: string;
  source_key: string;
  chapter: string;
  number: string;
  total: number;
  by_difficulty: Record<Difficulty, number>;
  priority: number;
}

/**
 * GET ?textbook=xxx
 * 해당 교재에서 서술형 출제기로 만들어진 문제 수 + 난이도 breakdown + 우선순위.
 *
 * 응답:
 * - counts: sourceKey → 총 개수 (이전 버전 호환)
 * - passages: 지문별 상세 (난이도 breakdown + priority)
 * - difficulties: 난이도 라벨 순서
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim();
  if (!textbook) return NextResponse.json({ counts: {}, passages: [], difficulties: DIFFICULTIES });

  try {
    const db = await getDb('gomijoshua');

    const passages = await db
      .collection('passages')
      .find({ textbook })
      .project({ _id: 1, source_key: 1, chapter: 1, number: 1, essayPriority: 1 })
      .toArray();

    const exams = await db
      .collection('essay_exams')
      .aggregate([
        { $match: { textbook, isPlaceholder: { $ne: true } } },
        {
          $group: {
            _id: { passageId: '$passageId', sourceKey: '$sourceKey', difficulty: '$difficulty' },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    /* sourceKey → 총 개수 (호환용) */
    const counts: Record<string, number> = {};
    /* passageId 또는 sourceKey → 난이도 breakdown */
    const byPid = new Map<string, Record<Difficulty, number>>();
    const bySk = new Map<string, Record<Difficulty, number>>();

    const emptyBreakdown = (): Record<Difficulty, number> => ({
      기본난도: 0, 중난도: 0, 고난도: 0, 최고난도: 0,
    });

    for (const row of exams) {
      const pid = row._id?.passageId ? String(row._id.passageId) : '';
      const sk = row._id?.sourceKey ? String(row._id.sourceKey) : '';
      const diff = String(row._id?.difficulty ?? '') as Difficulty;
      const c = Number(row.count ?? 0);

      if (sk) counts[sk] = (counts[sk] ?? 0) + c;

      const target = pid ? byPid : bySk;
      const key = pid || sk;
      if (!key) continue;
      let bd = target.get(key);
      if (!bd) {
        bd = emptyBreakdown();
        target.set(key, bd);
      }
      if (DIFFICULTIES.includes(diff)) bd[diff] = (bd[diff] ?? 0) + c;
    }

    const passageRows: PassageRow[] = passages.map(p => {
      const pid = String(p._id);
      const sk = String(p.source_key ?? '');
      const bdPid = byPid.get(pid);
      const bdSk = bySk.get(sk);
      const merged = emptyBreakdown();
      if (bdPid) for (const d of DIFFICULTIES) merged[d] += bdPid[d] ?? 0;
      if (bdSk) for (const d of DIFFICULTIES) merged[d] += bdSk[d] ?? 0;
      const total = DIFFICULTIES.reduce((a, d) => a + merged[d], 0);
      return {
        passage_id: pid,
        source_key: sk,
        chapter: String(p.chapter ?? ''),
        number: p.number != null ? String(p.number) : '',
        total,
        by_difficulty: merged,
        priority: Number((p as { essayPriority?: number }).essayPriority ?? 0),
      };
    });

    passageRows.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.chapter !== b.chapter) return a.chapter.localeCompare(b.chapter, 'ko');
      return a.source_key.localeCompare(b.source_key, 'ko');
    });

    return NextResponse.json({ counts, passages: passageRows, difficulties: DIFFICULTIES });
  } catch (e) {
    console.error('[passage-exam-counts]', e);
    return NextResponse.json({ counts: {}, passages: [], difficulties: DIFFICULTIES });
  }
}
