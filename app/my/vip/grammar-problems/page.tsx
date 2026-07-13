'use client';

import { useEffect, useMemo, useState } from 'react';
import { GRAMMAR_CURRICULA, GRAMMAR_LEVELS, grammarTopicKey, countTopics, countBigunitTopics, type GrammarCurriculum } from '@/lib/grammar-curriculum';
import { questionHtml, answerLabel, problemView, CIRCLED_NUMS, categoryBadgeClass, type BankProblem, type BankFormat } from './shared';
import { PrintWorksheet } from './print-worksheet';
import { ConceptEditor } from './concept-editor';
import { WorksheetManager } from './worksheet-manager';
import { SubunitMap } from './subunit-map';
import { PROBLEM_CATEGORIES } from '@/lib/vip-problem-category';

const CONCEPT_BASE = '/api/my/vip/grammar-problems/concept';

interface SelectedTopic { key: string; 대단원: string; 학습주제: string; }

export default function GrammarProblemsPage() {
  const [courseName, setCourseName] = useState(GRAMMAR_CURRICULA[0]?.과정 ?? '');
  const curriculum: GrammarCurriculum = useMemo(
    () => GRAMMAR_CURRICULA.find((c) => c.과정 === courseName) ?? GRAMMAR_CURRICULA[0],
    [courseName],
  );

  // 펼침 상태 (대단원·중단원 아코디언). 기본: 첫 대단원 열림.
  const [openBig, setOpenBig] = useState<Record<string, boolean>>({ [curriculum.대단원[0]?.대단원명 ?? '']: true });
  const [openMid, setOpenMid] = useState<Record<string, boolean>>({});
  const [selectedTopics, setSelectedTopics] = useState<SelectedTopic[]>([]);
  const [query, setQuery] = useState('');

  // 문제은행: topicKey별 문제 수 + 선택 진도의 문제 목록. 출처(source) 필터는 배지·목록·인쇄에 공통 적용
  const [bankCounts, setBankCounts] = useState<Record<string, number>>({});
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number>>({});
  const [sources, setSources] = useState<string[]>([]);
  const [source, setSource] = useState(''); // '' = 전체
  const [category, setCategory] = useState(''); // '' = 전체 카테고리
  const [groups, setGroups] = useState<{ key: string; 대단원: string; 학습주제: string; problems: BankProblem[] }[] | null>(null);
  const [bankLoading, setBankLoading] = useState(false);
  const [showAnswers, setShowAnswers] = useState(false);
  const [fmt, setFmt] = useState<BankFormat>('mc'); // 객관식 | 주관식 원형
  const [showPrint, setShowPrint] = useState(false);
  const [conceptTopics, setConceptTopics] = useState<Set<string>>(new Set()); // 개념 보유 topicKey
  const [editConcept, setEditConcept] = useState<{ topicKey: string; label: string } | null>(null);
  const [showWorksheets, setShowWorksheets] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [savingWs, setSavingWs] = useState(false);

  const saveWorksheet = async () => {
    if (savingWs || selectedTopics.length === 0) return;
    const defTitle = selectedTopics.length === 1
      ? selectedTopics[0].학습주제
      : `${selectedTopics[0].학습주제} 외 ${selectedTopics.length - 1}개`;
    const title = window.prompt('학습지 이름을 입력하세요', defTitle);
    if (title === null) return;
    setSavingWs(true);
    try {
      const r = await fetch('/api/my/vip/grammar-problems/worksheets', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || defTitle, topicKeys: selectedTopics.map((t) => t.key), category, source, fmt, includeConcepts: false, withAnswers: true }),
      });
      const d = await r.json();
      if (r.ok && d?.ok) { setShowWorksheets(true); }
      else alert(d?.error ?? '저장 실패');
    } catch { alert('저장 실패'); } finally { setSavingWs(false); }
  };

  // 개념 보유 진도 목록 (배지·인쇄 안내용)
  useEffect(() => {
    fetch(`${CONCEPT_BASE}?list=1`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (d?.ok && Array.isArray(d.topicKeys)) setConceptTopics(new Set(d.topicKeys as string[])); })
      .catch(() => { /* 배지 없이 동작 */ });
  }, []);

  useEffect(() => {
    const qs = [source && `source=${encodeURIComponent(source)}`, category && `category=${encodeURIComponent(category)}`].filter(Boolean).join('&');
    fetch(`/api/my/vip/grammar-problems/bank${qs ? `?${qs}` : ''}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && d.counts) setBankCounts(d.counts as Record<string, number>);
        if (d?.ok && d.categoryCounts) setCategoryCounts(d.categoryCounts as Record<string, number>);
        if (d?.ok && Array.isArray(d.sources)) setSources(d.sources as string[]);
      })
      .catch(() => { /* 배지 없이 동작 */ });
  }, [source, category]);

  const totalTopics = useMemo(() => countTopics(curriculum), [curriculum]);
  const q = query.trim();

  const toggleBig = (k: string) => setOpenBig((s) => ({ ...s, [k]: !s[k] }));
  const toggleMid = (k: string) => setOpenMid((s) => ({ ...s, [k]: !s[k] }));

  // 전체 펼치기 / 접기 — 모든 대단원(+중단원) 열고 닫기
  const allBigNames = useMemo(() => curriculum.대단원.map((b) => b.대단원명), [curriculum]);
  const allExpanded = allBigNames.length > 0 && allBigNames.every((n) => openBig[n]);
  const expandAll = () => {
    const nb: Record<string, boolean> = {};
    allBigNames.forEach((n) => { nb[n] = true; });
    const nm: Record<string, boolean> = {};
    curriculum.대단원.forEach((b) => (b.중단원 ?? []).forEach((m) => { nm[`${b.대단원명}/${m.중단원명}`] = true; }));
    setOpenBig(nb);
    setOpenMid(nm);
  };
  const collapseAll = () => { setOpenBig({}); setOpenMid({}); };

  // 다중 선택 — 학습주제를 클릭하면 선택 범위에 추가/제거
  const isSelected = (key: string) => selectedTopics.some((t) => t.key === key);
  const toggleTopic = (t: SelectedTopic) =>
    setSelectedTopics((cur) => (cur.some((x) => x.key === t.key) ? cur.filter((x) => x.key !== t.key) : [...cur, t]));

  const selKey = selectedTopics.map((t) => t.key).join('|');

  // 선택 진도들의 문제 목록 로드 (범위별)
  useEffect(() => {
    if (selectedTopics.length === 0) { setGroups(null); return; }
    let alive = true;
    setBankLoading(true);
    setShowAnswers(false);
    Promise.all(
      selectedTopics.map((t) =>
        fetch(`/api/my/vip/grammar-problems/bank?topicKey=${encodeURIComponent(t.key)}${source ? `&source=${encodeURIComponent(source)}` : ''}${category ? `&category=${encodeURIComponent(category)}` : ''}`, { credentials: 'include' })
          .then((r) => r.json())
          .then((d) => ({ ...t, problems: d?.ok && Array.isArray(d.problems) ? (d.problems as BankProblem[]) : [] }))
          .catch(() => ({ ...t, problems: [] as BankProblem[] })),
      ),
    )
      .then((gs) => { if (alive) setGroups(gs); })
      .finally(() => { if (alive) setBankLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, source, category]);

  const totalProblems = groups
    ? groups.reduce((s, g) => s + g.problems.length, 0)
    : selectedTopics.reduce((s, t) => s + (bankCounts[t.key] ?? 0), 0);
  const anySubjective = !!groups?.some((g) => g.problems.some((p) => p.subjective));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-sm border border-[#c9a44e]/25">영어</span>
            문법 문제관리
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">문법 진도(레벨·목차)에서 학습주제를 고르면, 해당 진도의 문제를 생성·관리합니다</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowMap(true)}
            className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-300 hover:border-[#c9a44e]/50 hover:text-[#e8d48b] transition-colors"
          >
            🗺 소단원 지도
          </button>
          <button
            type="button"
            onClick={() => setShowWorksheets(true)}
            className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-300 hover:border-[#c9a44e]/50 hover:text-[#e8d48b] transition-colors"
          >
            📂 저장된 학습지
          </button>
          <a
            href="/my/vip/grammar-problems/api-docs"
            className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-300 hover:border-[#c9a44e]/50 hover:text-[#e8d48b] transition-colors"
          >
            🔌 API 문서
          </a>
        </div>
      </div>

      {/* 과정 선택 + 검색 */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={courseName}
          onChange={(e) => {
            const name = e.target.value;
            setCourseName(name);
            setSelectedTopics([]);
            const first = GRAMMAR_CURRICULA.find((c) => c.과정 === name)?.대단원[0]?.대단원명 ?? '';
            setOpenBig(first ? { [first]: true } : {});
            setOpenMid({});
          }}
          className="rounded-lg bg-zinc-900/60 border border-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-[#c9a44e]/50"
        >
          {GRAMMAR_LEVELS.map((lv) => {
            const items = GRAMMAR_CURRICULA.filter((c) => c.레벨 === lv);
            if (items.length === 0) return null;
            return (
              <optgroup key={lv} label={lv}>
                {items.map((c) => (
                  <option key={c.과정} value={c.과정}>{c.과정}</option>
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
        {Object.keys(categoryCounts).length > 0 && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCategory('')}
              className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${category === '' ? 'border-[#c9a44e]/60 bg-[#c9a44e]/15 text-[#e8d48b]' : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'}`}
            >
              전체
            </button>
            {PROBLEM_CATEGORIES.filter((c) => categoryCounts[c]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(category === c ? '' : c)}
                className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${category === c ? categoryBadgeClass(c) : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200'}`}
              >
                {c} <span className="opacity-70">{categoryCounts[c]}</span>
              </button>
            ))}
          </div>
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
          {/* 트리 도구: 전체 펼치기/접기 + 다중선택 안내 */}
          <div className="mb-2 flex items-center gap-2 px-0.5">
            <button
              type="button"
              onClick={allExpanded ? collapseAll : expandAll}
              className="rounded-md border border-zinc-700 bg-zinc-900/60 px-2.5 py-1 text-[11px] font-semibold text-zinc-300 hover:border-[#c9a44e]/50 hover:text-[#e8d48b] transition-colors"
            >
              {allExpanded ? '▾ 전체 접기' : '▸ 전체 펼치기'}
            </button>
            <span className="text-[11px] text-zinc-600">학습주제를 여러 개 눌러 범위를 모을 수 있어요</span>
            {selectedTopics.length > 0 && (
              <span className="ml-auto text-[11px] text-zinc-500">선택 <strong className="text-[#e8d48b]">{selectedTopics.length}</strong></span>
            )}
          </div>

          {curriculum.대단원.map((big) => {
            const bigOpen = !!openBig[big.대단원명] || !!q;
            const bigTopicCount = countBigunitTopics(big);
            const matchTopic = (t: string) => !q || t.toLowerCase().includes(q.toLowerCase());
            const directTopics = (big.학습주제 ?? []).filter(matchTopic);
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
                    {/* 2단 목차(챕터>유닛): 대단원 직속 주제 칩 */}
                    {directTopics.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 py-1">
                        {directTopics.map((topic) => {
                          const key = grammarTopicKey(curriculum.과정, big.대단원명, '', '', '', topic);
                          const active = isSelected(key);
                          const cnt = bankCounts[key] ?? 0;
                          return (
                            <button
                              key={topic}
                              type="button"
                              onClick={() => toggleTopic({ key, 대단원: big.대단원명, 학습주제: topic })}
                              className={`rounded-md border px-2 py-1 text-[12px] transition-colors ${
                                active
                                  ? 'border-[#c9a44e]/60 bg-[#c9a44e]/15 text-[#e8d48b]'
                                  : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100'
                              }`}
                            >
                              {active && <span className="mr-0.5 text-[#e8d48b]">✓</span>}
                              {topic}
                              {cnt > 0 && <span className={`ml-1 text-[10px] font-semibold ${active ? 'text-[#e8d48b]' : 'text-emerald-400/90'}`}>{cnt}</span>}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    {(big.중단원 ?? []).map((mid) => {
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
                                const flatTopics = (sub.학습주제 ?? []).filter(match);
                                const topicGroups = (sub.학습주제그룹 ?? [])
                                  .map((g) => ({ 그룹명: g.그룹명, 주제: g.주제.filter(match) }))
                                  .filter((g) => g.주제.length > 0);
                                if (flatTopics.length === 0 && topicGroups.length === 0) return null;

                                const chip = (topic: string, 그룹명?: string) => {
                                  const key = grammarTopicKey(curriculum.과정, big.대단원명, mid.중단원명, sub.소단원명, 그룹명 ?? '', topic);
                                  const active = isSelected(key);
                                  return (
                                    <button
                                      key={(그룹명 ?? '') + '␟' + topic}
                                      type="button"
                                      onClick={() => toggleTopic({ key, 대단원: big.대단원명, 학습주제: topic })}
                                      className={`rounded-md border px-2 py-1 text-[12px] transition-colors ${
                                        active
                                          ? 'border-[#c9a44e]/60 bg-[#c9a44e]/15 text-[#e8d48b]'
                                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-300 hover:border-zinc-600 hover:text-zinc-100'
                                      }`}
                                    >
                                      {active && <span className="mr-0.5 text-[#e8d48b]">✓</span>}
                                      {topic}
                                    </button>
                                  );
                                };

                                return (
                                  <div key={sub.소단원명}>
                                    <p className="px-1.5 py-0.5 text-[11px] font-semibold text-zinc-400">{sub.소단원명}</p>
                                    {flatTopics.length > 0 && (
                                      <div className="flex flex-wrap gap-1.5">{flatTopics.map((t) => chip(t))}</div>
                                    )}
                                    {topicGroups.map((g) => (
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

        {/* ── 우: 선택한 범위 ── */}
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 lg:sticky lg:top-4 self-start">
          {selectedTopics.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center text-center text-zinc-500">
              <span className="text-3xl mb-2">✍️</span>
              <p className="text-sm">왼쪽 진도에서 <b className="text-zinc-300">학습주제</b>를 선택하세요</p>
              <p className="mt-1 text-[12px] text-zinc-600">여러 개를 누르면 한 장의 문제지로 묶여요</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 선택한 범위 칩 */}
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium text-zinc-500">선택한 범위 <span className="text-zinc-300">{selectedTopics.length}</span>개</p>
                  <button type="button" onClick={() => setSelectedTopics([])} className="text-[11px] text-zinc-500 hover:text-zinc-300">전체 해제</button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {selectedTopics.map((t) => (
                    <span key={t.key} className="inline-flex items-center gap-1 rounded-md border border-[#c9a44e]/40 bg-[#c9a44e]/10 px-2 py-1 text-[12px] text-[#e8d48b]">
                      <span className="text-[10px] text-zinc-500">{t.대단원} ›</span>
                      {t.학습주제}
                      <button
                        type="button"
                        onClick={() => setEditConcept({ topicKey: t.key, label: t.학습주제 })}
                        title={conceptTopics.has(t.key) ? '문법 개념 편집 (작성됨)' : '문법 개념 추가'}
                        className={`ml-0.5 rounded px-0.5 ${conceptTopics.has(t.key) ? 'text-emerald-300' : 'text-zinc-500 hover:text-zinc-200'}`}
                      >
                        📘
                      </button>
                      <button type="button" onClick={() => toggleTopic(t)} className="text-zinc-400 hover:text-rose-300" aria-label="제거">×</button>
                    </span>
                  ))}
                </div>
              </div>

              {/* 도구 막대 */}
              <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
                <p className="text-sm font-bold text-zinc-200">문제 <span className="text-[#e8d48b]">{totalProblems}</span>개</p>
                {anySubjective && (
                  <div className="flex rounded-md border border-zinc-700 overflow-hidden text-[11px]">
                    <button type="button" onClick={() => setFmt('mc')}
                      className={`px-2 py-1 ${fmt === 'mc' ? 'bg-[#c9a44e]/20 text-[#e8d48b]' : 'text-zinc-500 hover:text-zinc-300'}`}>객관식</button>
                    <button type="button" onClick={() => setFmt('subjective')}
                      className={`px-2 py-1 border-l border-zinc-700 ${fmt === 'subjective' ? 'bg-[#c9a44e]/20 text-[#e8d48b]' : 'text-zinc-500 hover:text-zinc-300'}`}>주관식 원형</button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setShowAnswers((v) => !v)}
                  className={`ml-auto rounded-md border px-2 py-1 text-[11px] transition-colors ${showAnswers ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}
                >
                  {showAnswers ? '정답 숨기기' : '정답 보기'}
                </button>
                {totalProblems > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={saveWorksheet}
                      disabled={savingWs}
                      className="rounded-md border border-[#c9a44e]/50 bg-[#c9a44e]/10 px-3 py-1 text-[11px] font-bold text-[#e8d48b] hover:bg-[#c9a44e]/20 disabled:opacity-60"
                    >
                      {savingWs ? '저장 중…' : '💾 저장'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPrint(true)}
                      className="rounded-md bg-gradient-to-r from-[#c9a44e] to-amber-600 px-3 py-1 text-[11px] font-bold text-zinc-950 hover:opacity-90"
                    >
                      🖨 문제지 인쇄
                    </button>
                  </>
                )}
              </div>

              {/* 미리보기 — 범위별 그룹 */}
              {bankLoading ? (
                <div className="py-6 text-center"><div className="w-5 h-5 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
              ) : !groups || totalProblems === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-700 p-4 text-center text-[12px] text-zinc-500">
                  선택한 범위에 문제가 아직 없습니다.
                </div>
              ) : (
                <div className="max-h-[56vh] space-y-4 overflow-y-auto pr-1">
                  {groups.map((g) => (
                    <div key={g.key}>
                      {selectedTopics.length > 1 && (
                        <p className="sticky top-0 z-10 -mx-1 mb-1.5 bg-zinc-900/95 px-1 py-1 text-[12px] font-bold text-[#e8d48b] backdrop-blur">
                          {g.대단원} › {g.학습주제}
                          <span className="ml-1 font-medium text-zinc-500">({g.problems.length})</span>
                        </p>
                      )}
                      {g.problems.length === 0 ? (
                        <p className="px-1 py-2 text-[12px] text-zinc-600">이 범위의 문제가 아직 없습니다.</p>
                      ) : (
                        <div className="space-y-2">
                          {g.problems.map((p) => {
                            const v = problemView(p, fmt);
                            return (
                              <div key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2.5">
                                <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                                  <span className="font-mono text-zinc-400">{p.serial}</span>
                                  {p.category && <span className={`rounded px-1 py-0.5 ${categoryBadgeClass(p.category)}`}>{p.category}</span>}
                                  <span className="rounded bg-zinc-800 px-1 py-0.5">{v.type}</span>
                                  <span>{p.section}-{p.no}</span>
                                </div>
                                {v.choices && v.choices.length > 0 && (
                                  <p className="mt-1 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-[11px] text-zinc-400">|보기| {v.choices.join(' · ')}</p>
                                )}
                                <p className="mt-1 text-[13px] leading-relaxed text-zinc-200 [&_u]:underline [&_u]:decoration-dotted"
                                  dangerouslySetInnerHTML={{ __html: questionHtml(p.question) }} />
                                {v.options && v.options.length > 0 && (
                                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-zinc-400">
                                    {v.options.map((o, i) => <span key={i}>{CIRCLED_NUMS[i]} {o}</span>)}
                                  </div>
                                )}
                                {showAnswers && (
                                  <p className="mt-1.5 border-t border-zinc-800/70 pt-1.5 text-[12px] text-emerald-300">
                                    정답: {fmt === 'subjective' && p.subjective ? v.answer : answerLabel(p)}
                                    {p.explanation && <span className="text-zinc-500"> — {p.explanation}</span>}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 문제지 인쇄 — 새 탭 대신 전체화면 오버레이(닫기가 웹뷰 포함 어디서나 확실히 동작) */}
      {showPrint && (
        <PrintWorksheet
          keys={selectedTopics.map((t) => t.key)}
          source={source}
          category={category}
          bankBase="/api/my/vip/grammar-problems/bank"
          conceptBase={CONCEPT_BASE}
          conceptTopics={conceptTopics}
          initialFmt={fmt}
          onClose={() => setShowPrint(false)}
        />
      )}

      {editConcept && (
        <ConceptEditor
          topicKey={editConcept.topicKey}
          topicLabel={editConcept.label}
          conceptBase={CONCEPT_BASE}
          onClose={() => setEditConcept(null)}
          onSaved={(has) => setConceptTopics((prev) => {
            const next = new Set(prev);
            if (has) next.add(editConcept.topicKey); else next.delete(editConcept.topicKey);
            return next;
          })}
        />
      )}

      {showWorksheets && <WorksheetManager onClose={() => setShowWorksheets(false)} />}

      {showMap && <SubunitMap onClose={() => setShowMap(false)} />}
    </div>
  );
}
