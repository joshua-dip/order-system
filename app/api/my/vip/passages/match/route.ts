import { NextRequest, NextResponse } from 'next/server';
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

export async function POST(request: NextRequest) {
  const auth = await requireVip(request);
  if (auth instanceof NextResponse) return auth;

  const { text } = (await request.json()) as { text?: string };
  if (!text || text.trim().length < 15) {
    return NextResponse.json({ error: '지문을 더 입력해주세요.' }, { status: 400 });
  }

  const db = await getDb('gomijoshua');
  const phrases = extractPhrases(text);

  // 1단계: 문장 일부로 정규식 검색
  for (const phrase of phrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const candidates = await db.collection('passages').find(
      { 'content.original': { $regex: escaped, $options: 'i' } },
      { projection: { textbook: 1, chapter: 1, number: 1, source_key: 1, 'content.original': 1 } },
    ).limit(5).toArray();

    if (candidates.length > 0) {
      // 여러 후보 중 유사도 최고 선택
      let best = candidates[0];
      let bestScore = wordSimilarity(text, best.content?.original ?? '');
      for (const c of candidates.slice(1)) {
        const s = wordSimilarity(text, c.content?.original ?? '');
        if (s > bestScore) { bestScore = s; best = c; }
      }
      return NextResponse.json({
        match: {
          textbook: best.textbook ?? '',
          sourceKey: best.source_key ?? `${best.chapter ?? ''} ${best.number ?? ''}`.trim(),
          chapter: best.chapter ?? '',
          number: best.number ?? '',
          similarity: Math.round(bestScore * 100),
        },
      });
    }
  }

  // 2단계: 단어 집합 기반 텍스트 서치 (fallback)
  const words = stripHtml(text).split(/\s+/).filter((w) => w.length > 4);
  const sampleWords = words.slice(0, 5).join(' ');
  if (sampleWords) {
    const candidates = await db.collection('passages').find(
      { 'content.original': { $regex: sampleWords.split(' ')[0], $options: 'i' } },
      { projection: { textbook: 1, chapter: 1, number: 1, source_key: 1, 'content.original': 1 } },
    ).limit(20).toArray();

    if (candidates.length > 0) {
      let best = candidates[0];
      let bestScore = wordSimilarity(text, best.content?.original ?? '');
      for (const c of candidates.slice(1)) {
        const s = wordSimilarity(text, c.content?.original ?? '');
        if (s > bestScore) { bestScore = s; best = c; }
      }
      if (bestScore > 0.3) {
        return NextResponse.json({
          match: {
            textbook: best.textbook ?? '',
            sourceKey: best.source_key ?? `${best.chapter ?? ''} ${best.number ?? ''}`.trim(),
            chapter: best.chapter ?? '',
            number: best.number ?? '',
            similarity: Math.round(bestScore * 100),
          },
        });
      }
    }
  }

  return NextResponse.json({ match: null, message: '일치하는 지문을 찾지 못했습니다.' });
}
