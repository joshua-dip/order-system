/**
 * 단어장 등: 병합 converted 에 강·번호 트리가 없는 모의고사 교재를
 * mock-exams.json 카탈로그 + passages 교재명과 합쳐, passages 기준으로 채웁니다.
 * (읽기 전용 — 호출부에서 복사본에 반영)
 */

import fs from 'fs/promises';
import path from 'path';
import { getDb } from '@/lib/mongodb';
import { isMockExamTextbookKey } from '@/lib/mock-exam-key';
import {
  buildMergedTextbookBranchFromPassages,
  convertedMergedHasTextbookLessonIndex,
  type PassageRow,
} from '@/lib/build-converted-branch-from-passages';

const MOCK_BUCKETS = ['고1모의고사', '고2모의고사', '고3모의고사'] as const;
const CHUNK = 40;

async function readMockExamCatalogKeysFlat(): Promise<string[]> {
  try {
    const filePath = path.join(process.cwd(), 'app', 'data', 'mock-exams.json');
    const raw = await fs.readFile(filePath, 'utf-8');
    const j = JSON.parse(raw) as Record<string, unknown>;
    const keys = new Set<string>();
    for (const bucket of MOCK_BUCKETS) {
      const arr = j[bucket];
      if (!Array.isArray(arr)) continue;
      for (const k of arr) {
        if (typeof k === 'string' && k.trim()) keys.add(k.trim());
      }
    }
    return [...keys];
  } catch {
    return [];
  }
}

/**
 * merged 복사본에, 카탈로그·passages 모의고사 중 트리가 비어 있는 교재만 passages 기반 브랜치를 붙입니다.
 */
export async function enrichTextbooksForVocabularyList(
  merged: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...merged };

  const catalog = await readMockExamCatalogKeysFlat();
  const db = await getDb('gomijoshua');
  const passageTextbooks = (await db.collection('passages').distinct('textbook')) as string[];
  const mockFromPassages = passageTextbooks.filter((t) => t && isMockExamTextbookKey(t));

  const keySet = new Set<string>([...catalog, ...mockFromPassages]);

  const toHydrate = [...keySet].filter((k) => !convertedMergedHasTextbookLessonIndex(out, k));

  for (let i = 0; i < toHydrate.length; i += CHUNK) {
    const slice = toHydrate.slice(i, i + CHUNK);
    const docs = (await db
      .collection('passages')
      .find({ textbook: { $in: slice } })
      .project({ textbook: 1, chapter: 1, number: 1, order: 1 })
      .toArray()) as { textbook?: string; chapter?: unknown; number?: unknown; order?: unknown }[];

    const byTb = new Map<string, PassageRow[]>();
    for (const d of docs) {
      const tb = String(d.textbook ?? '').trim();
      if (!tb) continue;
      if (!byTb.has(tb)) byTb.set(tb, []);
      byTb.get(tb)!.push({ chapter: d.chapter, number: d.number, order: d.order });
    }

    for (const tb of slice) {
      const rows = byTb.get(tb) ?? [];
      const built = buildMergedTextbookBranchFromPassages(tb, rows);
      if (built) out[tb] = built.branch;
    }
  }

  /** 카탈로그에만 있고 병합·passages 모두 없으면 빈 트리(목록 노출용, 강·번호는 이후 등록) */
  for (const k of catalog) {
    if (!out[k]) {
      out[k] = { Sheet1: { 부교재: { [k]: {} } } };
    }
  }

  return out;
}
