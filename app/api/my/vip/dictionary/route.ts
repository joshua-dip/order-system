import { NextRequest, NextResponse } from 'next/server';
import { requireVipMenu } from '@/lib/vip-menu-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 전자사전 — 무료 공개 API 프록시 (API 키 불필요).
 *  · 영영 정의/발음/오디오/예문: dictionaryapi.dev (Free Dictionary API)
 *  · 영한 뜻: MyMemory Translation API
 * 서버에서 호출해 CORS·레이트리밋을 흡수하고, 자주 찾는 단어는 메모리 캐시.
 */

interface DictDefinition { definition: string; example?: string; synonyms?: string[] }
interface DictMeaning { partOfSpeech: string; definitions: DictDefinition[]; synonyms?: string[] }
interface DictResult {
  ok: true;
  word: string;
  phonetic: string;
  audio: string;
  korean: string;
  meanings: DictMeaning[];
  sourceUrls: string[];
}

const CACHE = new Map<string, DictResult>();
const CACHE_MAX = 500;

function cacheGet(word: string): DictResult | undefined {
  const v = CACHE.get(word);
  if (v) { CACHE.delete(word); CACHE.set(word, v); } // LRU bump
  return v;
}
function cacheSet(word: string, v: DictResult) {
  CACHE.set(word, v);
  if (CACHE.size > CACHE_MAX) { const first = CACHE.keys().next().value; if (first) CACHE.delete(first); }
}

async function fetchJson(url: string, ms: number): Promise<unknown | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'next-order-dictionary' } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** dictionaryapi.dev 응답 → 정규화 */
function parseFreeDict(raw: unknown): Pick<DictResult, 'phonetic' | 'audio' | 'meanings' | 'sourceUrls'> {
  const out = { phonetic: '', audio: '', meanings: [] as DictMeaning[], sourceUrls: [] as string[] };
  if (!Array.isArray(raw) || raw.length === 0) return out;
  for (const entry of raw as Record<string, unknown>[]) {
    if (!out.phonetic && typeof entry.phonetic === 'string') out.phonetic = entry.phonetic;
    const phonetics = Array.isArray(entry.phonetics) ? (entry.phonetics as Record<string, unknown>[]) : [];
    if (!out.phonetic) { const p = phonetics.find((p) => typeof p.text === 'string' && p.text); if (p) out.phonetic = String(p.text); }
    if (!out.audio) { const a = phonetics.find((p) => typeof p.audio === 'string' && p.audio); if (a) out.audio = String(a.audio).startsWith('//') ? 'https:' + String(a.audio) : String(a.audio); }
    const meanings = Array.isArray(entry.meanings) ? (entry.meanings as Record<string, unknown>[]) : [];
    for (const m of meanings) {
      const defs = Array.isArray(m.definitions) ? (m.definitions as Record<string, unknown>[]) : [];
      out.meanings.push({
        partOfSpeech: String(m.partOfSpeech ?? ''),
        synonyms: Array.isArray(m.synonyms) ? (m.synonyms as unknown[]).map(String).slice(0, 8) : [],
        definitions: defs.slice(0, 5).map((d) => ({
          definition: String(d.definition ?? ''),
          example: typeof d.example === 'string' ? d.example : undefined,
          synonyms: Array.isArray(d.synonyms) ? (d.synonyms as unknown[]).map(String).slice(0, 6) : [],
        })).filter((d) => d.definition),
      });
    }
    const urls = Array.isArray(entry.sourceUrls) ? (entry.sourceUrls as unknown[]).map(String) : [];
    for (const u of urls) if (!out.sourceUrls.includes(u)) out.sourceUrls.push(u);
  }
  out.meanings = out.meanings.filter((m) => m.definitions.length > 0).slice(0, 6);
  return out;
}

/** MyMemory 응답 → 한국어 번역 텍스트 */
function parseKorean(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const rd = (raw as { responseData?: { translatedText?: unknown } }).responseData;
  const t = rd && typeof rd.translatedText === 'string' ? rd.translatedText : '';
  // MyMemory 가 실패 시 영어 원문/경고 문자열을 그대로 돌려주기도 함 → 한글 없으면 버림
  if (!t || !/[가-힣]/.test(t)) return '';
  return t.trim().slice(0, 200);
}

export async function GET(request: NextRequest) {
  const auth = await requireVipMenu(request, 'dictionary');
  if (auth instanceof NextResponse) return auth;

  const raw = (request.nextUrl.searchParams.get('word') || '').trim().toLowerCase();
  // 영단어/구 (알파벳·하이픈·아포스트로피·공백)만 허용
  const word = raw.replace(/[^a-z'’\- ]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!word) return NextResponse.json({ error: '영단어를 입력해 주세요.' }, { status: 400 });

  const cached = cacheGet(word);
  if (cached) return NextResponse.json(cached);

  const [enRaw, koRaw] = await Promise.all([
    fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, 7000),
    fetchJson(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en|ko`, 6000),
  ]);

  const en = parseFreeDict(enRaw);
  const korean = parseKorean(koRaw);

  if (en.meanings.length === 0 && !korean) {
    return NextResponse.json({ ok: false, error: `'${word}' 의 뜻을 찾지 못했습니다. 철자를 확인해 주세요.` }, { status: 404 });
  }

  const result: DictResult = { ok: true, word, phonetic: en.phonetic, audio: en.audio, korean, meanings: en.meanings, sourceUrls: en.sourceUrls };
  cacheSet(word, result);
  return NextResponse.json(result);
}
