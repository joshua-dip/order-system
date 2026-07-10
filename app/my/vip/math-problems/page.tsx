'use client';

import { useEffect, useMemo, useState } from 'react';
import { MATH_CURRICULA, SCHOOL_LEVELS, mathTopicKey, countTopics, countSubunitTopics, type MathCurriculum } from '@/lib/math-curriculum';
import { CIRCLED_NUMS, answerLabel, mathTextHtml, difficultyBadge, type MathBankProblem } from './shared';

interface Selected {
  교과: string;
  대단원: string;
  중단원: string;
  소단원: string;
  그룹명?: string; // 중등만 (고등은 없음)
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

  // 문제은행: topicKey별 문제 수 + 선택 진도의 문제 목록. 출처(source) 필터는 배지·목록·인쇄에 공통 적용
  const [bankCounts, setBankCounts] = useState<Record<string, number>>({});
  const [sources, setSources] = useState<string[]>([]);
  const [source, setSource] = useState(''); // '' = 전체
  const [problems, setProblems] = useState<MathBankProblem[] | null>(null);
  const [bankLoading, setBankLoading] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);

  useEffect(() => {
    fetch(`/api/my/vip/math-problems${source ? `?source=${encodeURIComponent(source)}` : ''}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.counts) setBankCounts(d.counts as Record<string, number>);
        if (d?.ok && Array.isArray(d.sources)) setSources(d.sources as string[]);
      })
      .catch(() => { /* 배지 없이 동작 */ });
  }, [source]);

  const totalTopics = useMemo(() => countTopics(curriculum), [curriculum]);
  const q = query.trim();

  const toggleBig = (k: string) => setOpenBig((s) => ({ ...s, [k]: !s[k] }));
  const toggleMid = (k: string) => setOpenMid((s) => ({ ...s, [k]: !s[k] }));

  const selectedKey = selected
    ? mathTopicKey(selected.교과, selected.대단원, selected.중단원, selected.소단원, selected.그룹명 ?? '', selected.학습주제)
    : '';

  // 진도 선택 시 해당 문제 목록 로드
  useEffect(() => {
    if (!selectedKey) { setProblems(null); return; }
    let alive = true;
    setBankLoading(true);
    setShowAnswers(false);
    fetch(`/api/my/vip/math-problems?topicKey=${encodeURIComponent(selectedKey)}${source ? `&source=${encodeURIComponent(source)}` : ''}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (alive) setProblems(d?.ok && Array.isArray(d.problems) ? (d.problems as MathBankProblem[]) : []); })
      .catch(() => { if (alive) setProblems([]); })
      .finally(() => { if (alive) setBankLoading(false); });
    return () => { alive = false; };
  }, [selectedKey, source]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-sm border border-[#c9a44e]/25">수학</span>
            문제관리
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">진도(교육과정)에서 학습주제를 고르면, 해당 진도의 문제를 확인·인쇄·QR 채점합니다</p>
        </div>
        <a
          href="/my/vip/math-problems/results"
          className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-300 hover:border-[#c9a44e]/50 hover:text-[#e8d48b] transition-colors"
        >
          📊 QR 채점 결과
        </a>
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
          {SCHOOL_LEVELS.map((lv) => {
            const items = MATH_CURRICULA.filter((c) => c.학교급 === lv);
            if (items.length === 0) return null;
            return (
              <optgroup key={lv} label={lv}>
                {items.map((c) => (
                  <option key={c.교과} value={c.교과}>{c.교과}</option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <span className="text-xs text-zinc-500">학습주제 <strong className="text-zinc-300">{totalTopics}</strong>개</span>
        {sources.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-zinc-500">
            📚
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="rounded-lg bg-zinc-900/60 border border-zinc-800 px-2.5 py-2 text-sm text-zinc-200 focus:outline-none focus:border-[#c9a44e]/50 max-w-[260px]"
            >
              <option value="">전체 출처</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
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
            const bigTopicCount = big.중단원.reduce((s, m) => s + m.소단원.reduce((t, u) => t + countSubunitTopics(u), 0), 0);
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
                                const match = (t: string) => !q || t.toLowerCase().includes(q.toLowerCase());
                                // 고등: 소단원 바로 아래 주제 / 중등: 그룹 > 주제
                                const flatTopics = (sub.학습주제 ?? []).filter(match);
                                const groups = (sub.학습주제그룹 ?? [])
                                  .map((g) => ({ 그룹명: g.그룹명, 주제: g.주제.filter(match) }))
                                  .filter((g) => g.주제.length > 0);
                                if (flatTopics.length === 0 && groups.length === 0) return null;

                                const chip = (topic: string, 그룹명?: string) => {
                                  const key = mathTopicKey(curriculum.교과, big.대단원명, mid.중단원명, sub.소단원명, 그룹명 ?? '', topic);
                                  const active = key === selectedKey;
                                  const cnt = bankCounts[key] ?? 0;
                                  return (
                                    <button
                                      key={(그룹명 ?? '') + '␟' + topic}
                                      type="button"
                                      onClick={() => setSelected({
                                        교과: curriculum.교과,
                                        대단원: big.대단원명,
                                        중단원: mid.중단원명,
                                        소단원: sub.소단원명,
                                        ...(그룹명 ? { 그룹명 } : {}),
                                        학습주제: topic,
                                      })}
                                      className={`rounded-md border px-2 py-1 text-[12px] transition-colors ${
                                        active
                                          ? 'border-[#c9a44e]/60 bg-[#c9a44e]/15 text-[#e8d48b]'
                                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100'
                                      }`}
                                    >
                                      {topic}
                                      {cnt > 0 && <span className={`ml-1 text-[10px] font-semibold ${active ? 'text-[#e8d48b]' : 'text-emerald-400/90'}`}>{cnt}</span>}
                                    </button>
                                  );
                                };

                                return (
                                  <div key={sub.소단원명}>
                                    <p className="px-1.5 py-0.5 text-[11px] font-semibold text-zinc-400">{sub.소단원명}</p>
                                    {flatTopics.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5">{flatTopics.map((t) => chip(t))}</div>
                                    )}
                                    {groups.map((g) => (
                                      <div key={g.그룹명} className="mt-1 ml-1.5 border-l border-zinc-800/70 pl-2">
                                        <p className="px-0.5 py-0.5 text-[11px] text-zinc-500">{g.그룹명}</p>
                                        <div className="flex flex-wrap gap-1.5">{g.주제.map((t) => chip(t, g.그룹명))}</div>
                                      </div>
                                    ))}
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
                  {selected.그룹명 && (
                    <>
                      <span className="text-zinc-600">›</span>
                      <span>{selected.그룹명}</span>
                    </>
                  )}
                </nav>
                <h2 className="mt-1.5 text-lg font-bold text-[#e8d48b]">{selected.학습주제}</h2>
              </div>

              {/* ── 이 진도의 문제은행 ── */}
              {bankLoading ? (
                <div className="py-6 text-center"><div className="w-5 h-5 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
              ) : !problems || problems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-700 p-4 text-center text-[12px] text-zinc-500">
                  이 진도의 문제가 아직 없습니다.
                  <span className="mt-1 block text-[11px] text-zinc-600 break-all font-mono">{selectedKey}</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-zinc-200">문제 <span className="text-[#e8d48b]">{problems.length}</span>개</p>
                    <button
                      type="button"
                      onClick={() => setShowAnswers((v) => !v)}
                      className={`ml-auto rounded-md border px-2 py-1 text-[11px] transition-colors ${showAnswers ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}
                    >
                      {showAnswers ? '정답 숨기기' : '정답 보기'}
                    </button>
                    <a
                      href={`/my/vip/math-problems/print?topicKey=${encodeURIComponent(selectedKey)}${source ? `&source=${encodeURIComponent(source)}` : ''}`}
                      target="_blank"
                      className="rounded-md bg-gradient-to-r from-[#c9a44e] to-amber-600 px-3 py-1 text-[11px] font-bold text-zinc-950 hover:opacity-90"
                    >
                      🖨 문제지 인쇄
                    </a>
                  </div>
                  <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                    {problems.map((p, i) => (
                      <div key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
                        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                          <span className="font-bold text-zinc-300">{i + 1}.</span>
                          <span className={`rounded border px-1 py-0.5 ${difficultyBadge(p.difficulty)}`}>{p.difficulty}</span>
                          <span className="rounded bg-zinc-800 px-1 py-0.5">{p.type}</span>
                          <span className="ml-auto font-mono text-zinc-400">{p.serial}</span>
                        </div>
                        <p className="mt-1 text-[13px] leading-relaxed text-zinc-200"
                          dangerouslySetInnerHTML={{ __html: mathTextHtml(p.question) }} />
                        {p.choices && p.choices.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-zinc-400">
                            {p.choices.map((o, ci) => <span key={ci}>{CIRCLED_NUMS[ci]} {o}</span>)}
                          </div>
                        )}
                        {showAnswers && (
                          <div className="mt-1.5 border-t border-zinc-800/70 pt-1.5 text-[12px]">
                            <p className="text-emerald-300">정답: {answerLabel(p)}</p>
                            {p.solution && (
                              <p className="mt-0.5 text-zinc-500 leading-relaxed" dangerouslySetInnerHTML={{ __html: mathTextHtml(p.solution) }} />
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
