import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { requireAdmin } from '@/lib/admin-auth';
import { splitQuestionOptionSegments } from '@/lib/question-options-segments';

const MAX_ITEMS_PER_GROUP = 100;
const MAX_GROUPS = 200;

/**
 * Options 문자열을 보기 단위로 분리 후, 앞의 동그라미/번호만 제거한 본문 배열.
 * `###` 구분 우선, 없으면 줄바꿈(기존 데이터).
 */
function parseChoices(optionsStr: string): string[] {
  const segs = splitQuestionOptionSegments(optionsStr || '');
  return segs
    .map((p) => p.replace(/^[①②③④⑤]\s*/, '').replace(/^\d+[\).:．]\s*/u, '').trim())
    .filter(Boolean)
    .slice(0, 10);
}

/**
 * 두 선택지 텍스트가 동일한지 (정규화: trim, 공백 정규화).
 */
function choiceMatch(a: string, b: string): boolean {
  const na = a.trim().replace(/\s+/g, ' ');
  const nb = b.trim().replace(/\s+/g, ' ');
  return na === nb;
}

/**
 * A 선택지들 중 B 선택지와 일치하는 개수.
 */
function countOverlap(choicesA: string[], choicesB: string[]): number {
  let n = 0;
  for (const a of choicesA) {
    if (choicesB.some((b) => choiceMatch(a, b))) n += 1;
  }
  return n;
}

/**
 * 두 문항 간 상호 일치도 0~100.
 * (A→B 일치 개수 + B→A 일치 개수) / (선택지 수 * 2) * 100. 선택지 5개면 최대 10, 100% = 완전 동일.
 */
function pairwiseOverlapPct(choicesA: string[], choicesB: string[]): number {
  if (choicesA.length === 0 && choicesB.length === 0) return 0;
  const total = choicesA.length + choicesB.length;
  const overlap = countOverlap(choicesA, choicesB) + countOverlap(choicesB, choicesA);
  return Math.round((overlap / total) * 100);
}

/**
 * 교재 + 강 번호(출처 첫 토큰) + category 로 그룹화 후, 그룹 내 문항들의 Options 상호 일치도 분석.
 * 변형문제 내보낼 때 선택지가 덜 겹치는 문항을 우선 선택할 수 있도록.
 */
export async function GET(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  const textbook = request.nextUrl.searchParams.get('textbook')?.trim() || '';
  const category = request.nextUrl.searchParams.get('category')?.trim() || '';

  const match: Record<string, unknown> = {
    'question_data.Options': { $exists: true, $type: 'string' },
    'question_data.Category': { $exists: true },
  };
  if (textbook) match.textbook = textbook;

  try {
    const db = await getDb('gomijoshua');
    const col = db.collection('generated_questions');
    const docs = await col
      .find(match)
      .project({
        _id: 1,
        textbook: 1,
        source: 1,
        type: 1,
        'question_data.Options': 1,
        'question_data.Category': 1,
      })
      .toArray();

    type Item = {
      id: string;
      textbook: string;
      source: string;
      type: string;
      category: string;
      optionsText: string;
      choices: string[];
    };

    /** 그룹 키: textbook | lessonKey | category */
    const groupKey = (d: Record<string, unknown>) => {
      const tb = String(d.textbook ?? '').trim();
      const src = String(d.source ?? '').trim();
      const lessonKey = src ? src.split(/\s+/)[0] ?? '' : '';
      const cat = String((d.question_data as Record<string, unknown>)?.Category ?? '').trim() || '—';
      return `${tb}\n${lessonKey}\n${cat}`;
    };

    const groupMap = new Map<string, Item[]>();

    for (const d of docs as Record<string, unknown>[]) {
      const opts = typeof (d.question_data as Record<string, unknown>)?.Options === 'string'
        ? ((d.question_data as Record<string, unknown>).Options as string)
        : '';
      const cat = String((d.question_data as Record<string, unknown>)?.Category ?? '').trim() || '—';
      if (category && cat !== category) continue;

      const key = groupKey(d);
      const item: Item = {
        id: String(d._id),
        textbook: String(d.textbook ?? ''),
        source: String(d.source ?? ''),
        type: String(d.type ?? ''),
        category: cat,
        optionsText: opts,
        choices: parseChoices(opts),
      };
      const list = groupMap.get(key) ?? [];
      list.push(item);
      groupMap.set(key, list);
    }

    type GroupResult = {
      textbook: string;
      lessonKey: string;
      category: string;
      items: Item[];
      pairwiseOverlaps: { i: number; j: number; overlapPct: number }[];
      avgOverlapByIndex: number[];
    };

    const groups: GroupResult[] = [];
    for (const [key, items] of groupMap.entries()) {
      if (items.length < 2) continue;
      const [tb, lessonKey, cat] = key.split('\n');
      const slice = items.slice(0, MAX_ITEMS_PER_GROUP);
      const pairwiseOverlaps: { i: number; j: number; overlapPct: number }[] = [];
      for (let i = 0; i < slice.length; i++) {
        for (let j = i + 1; j < slice.length; j++) {
          const pct = pairwiseOverlapPct(slice[i].choices, slice[j].choices);
          pairwiseOverlaps.push({ i, j, overlapPct: pct });
        }
      }
      const avgOverlapByIndex = slice.map((_, i) => {
        const others = pairwiseOverlaps.filter((p) => p.i === i || p.j === i);
        if (others.length === 0) return 0;
        const sum = others.reduce((a, p) => a + p.overlapPct, 0);
        return Math.round((sum / others.length) * 10) / 10;
      });
      groups.push({
        textbook: tb,
        lessonKey,
        category: cat,
        items: slice,
        pairwiseOverlaps,
        avgOverlapByIndex,
      });
    }

    // 그룹 수 제한, 상호 일치가 높은 그룹 우선
    groups.sort((a, b) => {
      const avgA = a.avgOverlapByIndex.length ? a.avgOverlapByIndex.reduce((x, y) => x + y, 0) / a.avgOverlapByIndex.length : 0;
      const avgB = b.avgOverlapByIndex.length ? b.avgOverlapByIndex.reduce((x, y) => x + y, 0) / b.avgOverlapByIndex.length : 0;
      return avgB - avgA;
    });

    const trimmed = groups.slice(0, MAX_GROUPS);

    return NextResponse.json({
      ok: true,
      filters: { textbook: textbook || null, category: category || null },
      totalGroups: trimmed.length,
      totalScanned: docs.length,
      groups: trimmed.map((g) => ({
        textbook: g.textbook,
        lessonKey: g.lessonKey,
        category: g.category,
        itemCount: g.items.length,
        items: g.items.map((it, idx) => ({
          ...it,
          avgOverlapWithOthers: g.avgOverlapByIndex[idx],
        })),
        pairwiseOverlaps: g.pairwiseOverlaps,
        avgOverlapByIndex: g.avgOverlapByIndex,
      })),
    });
  } catch (e) {
    console.error('options-overlap validate:', e);
    return NextResponse.json({ error: '선택지 데이터 검증에 실패했습니다.' }, { status: 500 });
  }
}
