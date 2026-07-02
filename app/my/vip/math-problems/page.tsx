'use client';

import { useMemo, useState } from 'react';
import { MATH_CURRICULA, mathTopicKey, countTopics, type MathCurriculum } from '@/lib/math-curriculum';

interface Selected {
  교과: string;
  대단원: string;
  중단원: string;
  소단원: string;
  학습주제: string;
}

export default function MathProblemsPage() {
  const [curriculumName, setCurriculumName] = useState(MATH_CURRICULA[0]?.교과 ?? '');
  const curriculum: MathCurriculum = useMemo(
    () => MATH_CURRICULA.find((c) => c.교과 === curriculumName) ?? MATH_CURRICULA[0],
    [curriculumName],
  );

  // 펼침 상태 (대단원·중단원 아코디언). 기본: 첫 대단원 열림.
  const [openBig, setOpenBig] = useState<Record<string, boolean>>({ [curriculum.대단원[0]?.대단원명 ?? '']: true });
  const [openMid, setOpenMid] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Selected | null>(null);
  const [query, setQuery] = useState('');

  const totalTopics = useMemo(() => countTopics(curriculum), [curriculum]);
  const q = query.trim();

  const toggleBig = (k: string) => setOpenBig((s) => ({ ...s, [k]: !s[k] }));
  const toggleMid = (k: string) => setOpenMid((s) => ({ ...s, [k]: !s[k] }));

  const selectedKey = selected
    ? mathTopicKey(selected.교과, selected.대단원, selected.중단원, selected.소단원, selected.학습주제)
    : '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-sm border border-[#c9a44e]/25">수학</span>
          문제관리
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">진도(교육과정)에서 학습주제를 고르면, 해당 진도의 문제를 생성·관리합니다</p>
      </div>

      {/* 교과 선택 + 검색 */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={curriculumName}
          onChange={(e) => {
            const name = e.target.value;
            setCurriculumName(name);
            setSelected(null);
            const first = MATH_CURRICULA.find((c) => c.교과 === name)?.대단원[0]?.대단원명 ?? '';
            setOpenBig(first ? { [first]: true } : {});
            setOpenMid({});
          }}
          className="rounded-lg bg-zinc-900/60 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-[#c9a44e]/50"
        >
          {MATH_CURRICULA.map((c) => (
            <option key={c.교과} value={c.교과}>{c.교과}</option>
          ))}
        </select>
        <span className="text-xs text-zinc-500">학습주제 <strong className="text-zinc-300">{totalTopics}</strong>개</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="학습주제 검색…"
          className="ml-auto w-full sm:w-64 rounded-lg bg-zinc-900/60 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
        {/* ── 좌: 진도 트리 ── */}
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3 max-h-[70vh] overflow-y-auto">
          {curriculum.대단원.map((big) => {
            const bigOpen = !!openBig[big.대단원명] || !!q;
            const bigTopicCount = big.중단원.reduce((s, m) => s + m.소단원.reduce((t, u) => t + u.학습주제.length, 0), 0);
            return (
              <div key={big.대단원명} className="mb-1.5">
                <button
                  type="button"
                  onClick={() => toggleBig(big.대단원명)}
                  className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-bold text-zinc-100 bg-zinc-800/50 hover:bg-zinc-800 transition-colors"
                >
                  <span className={`text-[#c9a44e] transition-transform ${bigOpen ? 'rotate-90' : ''}`}>▸</span>
                  {big.대단원명}
                  <span className="ml-auto text-[11px] font-medium text-zinc-500">{bigTopicCount}주제</span>
                </button>

                {bigOpen && (
                  <div className="mt-1 ml-3 border-l border-zinc-800 pl-3">
                    {big.중단원.map((mid) => {
                      const midKey = `${big.대단원명}/${mid.중단원명}`;
                      const midOpen = !!openMid[midKey] || !!q;
                      return (
                        <div key={midKey} className="mb-1">
                          <button
                            type="button"
                            onClick={() => toggleMid(midKey)}
                            className="w-full flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] font-semibold text-zinc-300 hover:bg-zinc-800/60 transition-colors"
                          >
                            <span className={`text-zinc-500 text-[10px] transition-transform ${midOpen ? 'rotate-90' : ''}`}>▸</span>
                            {mid.중단원명}
                          </button>

                          {midOpen && (
                            <div className="mt-0.5 ml-2 space-y-2 pb-1">
                              {mid.소단원.map((sub) => {
                                const topics = q
                                  ? sub.학습주제.filter((t) => t.toLowerCase().includes(q.toLowerCase()))
                                  : sub.학습주제;
                                if (topics.length === 0) return null;
                                return (
                                  <div key={sub.소단원명}>
                                    <p className="px-1.5 py-0.5 text-[11px] font-semibold text-zinc-500">{sub.소단원명}</p>
                                    <div className="flex flex-wrap gap-1.5">
                                      {topics.map((topic) => {
                                        const key = mathTopicKey(curriculum.교과, big.대단원명, mid.중단원명, sub.소단원명, topic);
                                        const active = key === selectedKey;
                                        return (
                                          <button
                                            key={topic}
                                            type="button"
                                            onClick={() => setSelected({
                                              교과: curriculum.교과,
                                              대단원: big.대단원명,
                                              중단원: mid.중단원명,
                                              소단원: sub.소단원명,
                                              학습주제: topic,
                                            })}
                                            className={`rounded-md border px-2 py-1 text-[12px] transition-colors ${
                                              active
                                                ? 'border-[#c9a44e]/60 bg-[#c9a44e]/15 text-[#e8d48b]'
                                                : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100'
                                            }`}
                                          >
                                            {topic}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── 우: 선택한 학습주제 ── */}
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 lg:sticky lg:top-4 self-start">
          {!selected ? (
            <div className="flex h-40 flex-col items-center justify-center text-center text-zinc-500">
              <span className="text-3xl mb-2">🧮</span>
              <p className="text-sm">왼쪽 진도에서 <b className="text-zinc-300">학습주제</b>를 선택하세요</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="text-[11px] font-medium text-zinc-500 mb-1">선택한 진도</p>
                <nav className="flex flex-wrap items-center gap-1 text-[12px] text-zinc-400">
                  <span>{selected.교과}</span>
                  <span className="text-zinc-600">›</span>
                  <span>{selected.대단원}</span>
                  <span className="text-zinc-600">›</span>
                  <span>{selected.중단원}</span>
                  <span className="text-zinc-600">›</span>
                  <span>{selected.소단원}</span>
                </nav>
                <h2 className="mt-1.5 text-lg font-bold text-[#e8d48b]">{selected.학습주제}</h2>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                <p className="text-[11px] text-zinc-500">진도 키</p>
                <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-400">{selectedKey}</p>
              </div>

              <button
                type="button"
                onClick={() => alert('문제 생성 기능은 다음 단계에서 이 진도에 연결됩니다.\n\n' + selectedKey)}
                className="w-full rounded-lg bg-gradient-to-r from-[#c9a44e] to-amber-600 py-2.5 text-sm font-bold text-zinc-950 transition hover:opacity-90"
              >
                ✏️ 이 진도로 문제 생성
              </button>
              <p className="text-center text-[11px] text-zinc-600">문제 생성 방식은 준비 중입니다 (진도 트리 먼저 구축)</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
