import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { requireVip } from '@/lib/vip-auth';

function stripHtml(text: string) {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractPhrases(text: string): string[] {
  const clean = stripHtml(text);
  const len = clean.length;
  if (len < 10) return [];
  const phrases: string[] = [];
  const size = Math.min(50, Math.floor(len * 0.3));
  const offsets = [
    Math.floor(len * 0.05),
    Math.floor(len * 0.25),
    Math.floor(len * 0.5),
    Math.floor(len * 0.7),
  ];
  for (const off of offsets) {
    const s = clean.slice(off, off + size).trim();
    if (s.length >= 15) phrases.push(s);
  }
  return phrases;
}

// Jaccard similarity on word sets
function wordSimilarity(a: string, b: string): number {
  const wordsA = new Set(stripHtml(a).toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(stripHtml(b).toLowerCase().split(/\s+/).filter(Boolean));
  let intersection = 0;
  for (const w of wordsA) { if (wordsB.has(w)) intersection++; }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

type ScopeFilter = Record<string, unknown>;

function buildScopeFilter(textbooks?: string[], passageIds?: string[]): ScopeFilter | null {
  const ids = (passageIds ?? []).filter(Boolean);
  if (ids.length > 0) {
    const objectIds: ObjectId[] = [];
    for (const id of ids) {
      try { objectIds.push(new ObjectId(id)); } catch { /* skip invalid */ }
    }
    if (objectIds.length > 0) return { _id: { $in: objectIds } };
  }
  const tbs = (textbooks ?? []).filter((t): t is string => !!t && typeof t === 'string');
  if (tbs.length > 0) return { textbook: { $in: tbs } };
  return null;
}

const PASSAGE_PROJECTION = {
  textbook: 1, chapter: 1, number: 1, source_key: 1, passage_source: 1, 'content.original': 1,
} as const;

type PassageDoc = {
  textbook?: string;
  chapter?: string | number;
  number?: string | number;
  source_key?: string;
  passage_source?: string;
  content?: { original?: string };
};

async function findBestMatch(
  db: Awaited<ReturnType<typeof getDb>>,
  text: string,
  scope: ScopeFilter | null,
): Promise<{ best: PassageDoc; score: number } | null> {
  const phrases = extractPhrases(text);
  // 1단계: 문장 일부 정규식 검색
  for (const phrase of phrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter: ScopeFilter = { 'content.original': { $regex: escaped, $options: 'i' }, ...(scope ?? {}) };
    const candidates = await db.collection('passages')
      .find(filter, { projection: PASSAGE_PROJECTION })
      .limit(5)
      .toArray() as unknown as PassageDoc[];
    if (candidates.length > 0) {
      let best = candidates[0];
      let bestScore = wordSimilarity(text, best.content?.original ?? '');
      for (const c of candidates.slice(1)) {
        const s = wordSimilarity(text, c.content?.original ?? '');
        if (s > bestScore) { bestScore = s; best = c; }
      }
      return { best, score: bestScore };
    }
  }
  // 2단계: 첫 단어 기반 fallback
  const words = stripHtml(text).split(/\s+/).filter((w) => w.length > 4);
  const sampleWord = words[0];
  if (sampleWord) {
    const filter: ScopeFilter = { 'content.original': { $regex: sampleWord, $options: 'i' }, ...(scope ?? {}) };
    const candidates = await db.collection('passages')
      .find(filter, { projection: PASSAGE_PROJECTION })
      .limit(20)
      .toArray() as unknown as PassageDoc[];
    if (candidates.length > 0) {
      let best = candidates[0];
      let bestScore = wordSimilarity(text, best.content?.original ?? '');
      for (const c of candidates.slice(1)) {
        const s = wordSimilarity(text, c.content?.original ?? '');
        if (s > bestScore) { bestScore = s; best = c; }
      }
      if (bestScore > 0.3) return { best, score: bestScore };
    }
  }
  return null;
}

function shapeMatch(best: PassageDoc, score: number, inScope: boolean) {
  return {
    textbook: best.textbook ?? '',
    sourceKey: best.source_key ?? `${best.chapter ?? ''} ${best.number ?? ''}`.trim(),
    chapter: best.chapter ?? '',
    number: best.number ?? '',
    similarity: Math.round(score * 100),
    passageSource: best.passage_source ?? '',
    inScope,
  };
}

export async function POST(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const { text, textbooks, passageIds } = (await request.json()) as {
    text?: string; textbooks?: string[]; passageIds?: string[];
  };
  if (!text || text.trim().length < 15) {
    return NextResponse.json({ error: '지문을 더 입력해주세요.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const scope = buildScopeFilter(textbooks, passageIds);

  // 시험범위가 있으면 그 안에서 먼저 찾고, 없으면 전체 fallback.
  if (scope) {
    const inScope = await findBestMatch(db, text, scope);
    if (inScope) return NextResponse.json({ match: shapeMatch(inScope.best, inScope.score, true) });
  }
  const global = await findBestMatch(db, text, null);
  if (global) return NextResponse.json({ match: shapeMatch(global.best, global.score, false) });

  return NextResponse.json({ match: null, message: '일치하는 지문을 찾지 못했습니다.' });
}
