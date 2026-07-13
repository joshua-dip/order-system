'use client';

import { useEffect, useMemo, useState } from 'react';
import { GRAMMAR_CURRICULA, type GrammarCurriculum } from '@/lib/grammar-curriculum';

/** 레벨별 색 (다크 테마). 과정 순서대로 배정, 4개 이상이면 순환. */
const LEVEL_STYLES = [
  { dot: 'bg-blue-400', head: 'text-blue-300', chip: 'border-blue-500/40 bg-blue-500/15 text-blue-200', tint: 'bg-blue-500/10', ring: 'border-blue-500/25' },
  { dot: 'bg-emerald-400', head: 'text-emerald-300', chip: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200', tint: 'bg-emerald-500/10', ring: 'border-emerald-500/25' },
  { dot: 'bg-violet-400', head: 'text-violet-300', chip: 'border-violet-500/40 bg-violet-500/15 text-violet-200', tint: 'bg-violet-500/10', ring: 'border-violet-500/25' },
  { dot: 'bg-amber-400', head: 'text-amber-300', chip: 'border-amber-500/40 bg-amber-500/15 text-amber-200', tint: 'bg-amber-500/10', ring: 'border-amber-500/25' },
  { dot: 'bg-rose-400', head: 'text-rose-300', chip: 'border-rose-500/40 bg-rose-500/15 text-rose-200', tint: 'bg-rose-500/10', ring: 'border-rose-500/25' },
];

/** 한 과정의 모든 학습주제(소단원) 평탄화 — 얕은형(대단원>주제) + 깊은형(중단원>소단원>주제/그룹) */
function flattenTopics(cur: GrammarCurriculum): string[] {
  const out: string[] = [];
  for (const big of cur.대단원) {
    for (const t of big.학습주제 ?? []) out.push(t);
    for (const mid of big.중단원 ?? []) for (const sub of mid.소단원 ?? []) {
      for (const t of sub.학습주제 ?? []) out.push(t);
      for (const g of sub.학습주제그룹 ?? []) for (const t of g.주제) out.push(t);
    }
  }
  return out;
}

function shortName(과정: string): string {
  return 과정.replace('중등 영문법 ', '').replace('고등 영문법 ', '');
}

export function SubunitMap({ onClose }: { onClose: () => void }) {
  const [merge, setMerge] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const levels = useMemo(
    () => GRAMMAR_CURRICULA.map((c, i) => ({
      과정: c.과정, name: shortName(c.과정), topics: flattenTopics(c), s: LEVEL_STYLES[i % LEVEL_STYLES.length], idx: i,
    })),
    [],
  );

  // topic → 속한 레벨 인덱스[]
  const membership = useMemo(() => {
    const m = new Map<string, number[]>();
    levels.forEach((lv, i) => lv.topics.forEach((t) => {
      const key = t.trim();
      const arr = m.get(key) ?? [];
      if (!arr.includes(i)) arr.push(i);
      m.set(key, arr);
    }));
    return m;
  }, [levels]);

  const overlaps = useMemo(
    () => [...membership.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length),
    [membership],
  );
  const total = levels.reduce((s, l) => s + l.topics.length, 0);
  const uniqueCount = membership.size;

  const chip = (lvIdx: number) => (
    <span key={lvIdx} className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-semibold ${levels[lvIdx].s.chip}`}>
      {levels[lvIdx].name.replace('LEVEL ', 'L')}
    </span>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 className="text-base font-bold text-zinc-100">전체 소단원 지도</h2>
            <p className="mt-0.5 text-[12px] text-zinc-500">레벨별 소단원을 한눈에 — 겹치는 소단원은 「합침」으로 공통 묶음</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto rounded-md border border-zinc-700 px-2 py-1 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            ✕
          </button>
        </div>

        {/* 도구 막대: 범례 + 토글 + 통계 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-800 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3 text-[12px] text-zinc-400">
            {levels.map((lv) => (
              <span key={lv.과정} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-sm ${lv.s.dot}`} />{lv.name}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 text-zinc-500">
              <span className="text-[13px]">🔗</span>겹치는 소단원
            </span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-[12px] tabular-nums text-zinc-500">
              소단원 <strong className="text-zinc-300">{total}</strong> · 고유 <strong className="text-zinc-300">{uniqueCount}</strong> · 겹침 <strong className="text-[#e8d48b]">{overlaps.length}</strong>
            </span>
            <div className="flex overflow-hidden rounded-lg border border-zinc-700 text-[12px]">
              <button
                type="button"
                onClick={() => setMerge(false)}
                className={`px-3 py-1.5 font-semibold transition-colors ${!merge ? 'bg-[#c9a44e]/20 text-[#e8d48b]' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                레벨별 보기
              </button>
              <button
                type="button"
                onClick={() => setMerge(true)}
                className={`border-l border-zinc-700 px-3 py-1.5 font-semibold transition-colors ${merge ? 'bg-[#c9a44e]/20 text-[#e8d48b]' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                합침
              </button>
            </div>
          </div>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto p-4">
          {!merge ? (
            /* ── 레벨별: 3열, 겹치는 소단원은 색 tint + 다른 레벨 칩 ── */
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {levels.map((lv) => (
                <div key={lv.과정} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-2">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <span className={`text-sm font-bold ${lv.s.head}`}>{lv.name}</span>
                    <span className="text-[11px] text-zinc-500">{lv.topics.length}</span>
                  </div>
                  <ol className="space-y-0.5">
                    {lv.topics.map((t, k) => {
                      const inLevels = membership.get(t.trim()) ?? [lv.idx];
                      const others = inLevels.filter((i) => i !== lv.idx);
                      const ov = others.length > 0;
                      return (
                        <li
                          key={`${t}-${k}`}
                          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-zinc-200 ${ov ? `${lv.s.tint}` : ''}`}
                        >
                          <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-zinc-600">{k + 1}</span>
                          <span className="min-w-0 flex-1 truncate" title={t}>{t}</span>
                          {ov && others.map(chip)}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          ) : (
            /* ── 합침: 공통 소단원 묶음 + 레벨별 단독 ── */
            <div className="space-y-3">
              <div className="rounded-xl border border-[#c9a44e]/30 bg-[#c9a44e]/[0.06] p-3">
                <div className="mb-2 flex items-center gap-2 px-1 text-[13px] font-bold text-[#e8d48b]">
                  <span>🔗 공통 소단원</span>
                  <span className="rounded bg-[#c9a44e]/20 px-1.5 text-[11px]">{overlaps.length}</span>
                  <span className="text-[11px] font-medium text-zinc-500">여러 레벨에서 반복되는 소단원</span>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {overlaps.map(([t, inLevels]) => (
                    <div key={t} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/50 px-2.5 py-1.5 text-[12.5px] text-zinc-100">
                      <span className="min-w-0 flex-1 truncate" title={t}>{t}</span>
                      {inLevels.slice().sort((a, b) => a - b).map(chip)}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {levels.map((lv) => {
                  const exclusive = lv.topics.filter((t) => (membership.get(t.trim()) ?? []).length === 1);
                  return (
                    <div key={lv.과정} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-2">
                      <div className="flex items-center justify-between px-2 py-1.5">
                        <span className={`text-sm font-bold ${lv.s.head}`}>{lv.name} <span className="font-medium text-zinc-500">단독</span></span>
                        <span className="text-[11px] text-zinc-500">{exclusive.length}</span>
                      </div>
                      <ol className="space-y-0.5">
                        {exclusive.map((t, k) => (
                          <li key={`${t}-${k}`} className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] text-zinc-300">
                            <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-zinc-600">{k + 1}</span>
                            <span className="min-w-0 flex-1 truncate" title={t}>{t}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
