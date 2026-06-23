'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface DictDefinition { definition: string; example?: string; synonyms?: string[] }
interface DictMeaning { partOfSpeech: string; definitions: DictDefinition[]; synonyms?: string[] }
interface DictResult {
  ok: boolean;
  word: string;
  phonetic: string;
  audio: string;
  korean: string;
  meanings: DictMeaning[];
  sourceUrls: string[];
  error?: string;
}

const POS_KO: Record<string, string> = {
  noun: '명사', verb: '동사', adjective: '형용사', adverb: '부사', pronoun: '대명사',
  preposition: '전치사', conjunction: '접속사', interjection: '감탄사', determiner: '한정사', numeral: '수사',
};
const RECENT_KEY = 'vipDictRecent';

export default function VipDictionaryPage() {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DictResult | null>(null);
  const [error, setError] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); if (Array.isArray(r)) setRecent(r.slice(0, 12)); } catch { /* ignore */ }
  }, []);

  const pushRecent = (w: string) => {
    setRecent((prev) => {
      const next = [w, ...prev.filter((x) => x !== w)].slice(0, 12);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const lookup = useCallback(async (raw: string) => {
    const word = raw.trim().toLowerCase();
    if (!word) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const d: DictResult = await fetch(`/api/my/vip/dictionary?word=${encodeURIComponent(word)}`, { credentials: 'include' }).then((r) => r.json());
      if (d.ok) { setResult(d); pushRecent(d.word || word); }
      else setError(d.error || '뜻을 찾지 못했습니다.');
    } catch {
      setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    }
    setLoading(false);
  }, []);

  const playAudio = () => {
    if (!result?.audio) return;
    try {
      if (!audioRef.current) audioRef.current = new Audio(result.audio);
      else audioRef.current.src = result.audio;
      audioRef.current.play().catch(() => {});
    } catch { /* ignore */ }
  };

  const clearRecent = () => { setRecent([]); try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } };

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">전자사전</h1>
        <p className="text-sm text-zinc-500 mt-0.5">영단어를 검색해 뜻·발음·예문을 확인하세요</p>
      </div>

      {/* 검색 바 — 모바일에서 상단 고정 */}
      <div className="sticky top-0 z-10 -mx-1 px-1 py-2 bg-gradient-to-b from-zinc-950 via-zinc-950/95 to-transparent backdrop-blur-sm">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') lookup(q); }}
            inputMode="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder="영단어 검색 (예: improve)"
            className="flex-1 min-w-0 px-4 py-3.5 rounded-2xl bg-zinc-900/70 border border-zinc-800 text-base text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
          />
          <button
            onClick={() => lookup(q)}
            disabled={loading || !q.trim()}
            className="flex-shrink-0 px-5 py-3.5 rounded-2xl bg-zinc-100 text-zinc-900 text-base font-semibold hover:bg-white disabled:opacity-40 active:scale-95 transition-transform"
          >
            {loading ? '…' : '검색'}
          </button>
        </div>
      </div>

      {/* 최근 검색 */}
      {recent.length > 0 && !result && !loading && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-500">최근 검색</span>
            <button onClick={clearRecent} className="text-xs text-zinc-600 hover:text-zinc-400">지우기</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recent.map((w) => (
              <button key={w} onClick={() => { setQ(w); lookup(w); }} className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800 text-sm text-zinc-300 hover:border-zinc-600 active:scale-95 transition-transform">
                {w}
              </button>
            ))}
          </div>
        </div>
      )}

      {loading && (
        <div className="py-16 text-center"><div className="w-7 h-7 mx-auto border-2 border-zinc-700 border-t-zinc-300 rounded-full animate-spin" /></div>
      )}

      {error && !loading && (
        <div className="rounded-2xl bg-zinc-900/50 border border-zinc-800 p-8 text-center">
          <p className="text-3xl mb-2">🔍</p>
          <p className="text-sm text-zinc-400">{error}</p>
        </div>
      )}

      {/* 결과 */}
      {result && !loading && (
        <div className="space-y-4">
          {/* 표제어 카드 */}
          <div className="rounded-2xl bg-zinc-900/60 border border-zinc-800 p-5">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-2xl font-bold text-zinc-50">{result.word}</h2>
              {result.phonetic && <span className="text-base text-zinc-500 font-mono">{result.phonetic}</span>}
              {result.audio && (
                <button onClick={playAudio} aria-label="발음 듣기" className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-800 text-zinc-200 text-sm hover:bg-zinc-700 active:scale-95 transition-transform">
                  <span className="text-base">🔊</span> 발음
                </button>
              )}
            </div>
            {result.korean && (
              <div className="mt-3 pt-3 border-t border-zinc-800">
                <span className="text-[11px] text-emerald-400/80 mr-2">뜻</span>
                <span className="text-lg text-emerald-100 font-medium">{result.korean}</span>
              </div>
            )}
          </div>

          {/* 영영 정의 */}
          {result.meanings.map((m, i) => (
            <div key={i} className="rounded-2xl bg-zinc-900/40 border border-zinc-800 p-5">
              <div className="flex items-baseline gap-2 mb-3">
                <span className="px-2 py-0.5 rounded-md bg-violet-500/20 text-violet-300 text-xs font-medium">{m.partOfSpeech}</span>
                {POS_KO[m.partOfSpeech] && <span className="text-xs text-zinc-500">{POS_KO[m.partOfSpeech]}</span>}
              </div>
              <ol className="space-y-3">
                {m.definitions.map((d, j) => (
                  <li key={j} className="flex gap-2.5">
                    <span className="flex-shrink-0 text-zinc-600 text-sm tabular-nums">{j + 1}.</span>
                    <div className="min-w-0">
                      <p className="text-[15px] text-zinc-200 leading-relaxed">{d.definition}</p>
                      {d.example && <p className="mt-1 text-sm text-zinc-500 italic leading-relaxed">“{d.example}”</p>}
                      {d.synonyms && d.synonyms.length > 0 && (
                        <p className="mt-1.5 text-xs text-zinc-500">유의어: <span className="text-zinc-400">{d.synonyms.join(', ')}</span></p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}

          <p className="text-[11px] text-zinc-600 text-center pt-1">정의·발음 © Free Dictionary API · 한글 뜻 © MyMemory (무료 공개 사전)</p>
        </div>
      )}
    </div>
  );
}
