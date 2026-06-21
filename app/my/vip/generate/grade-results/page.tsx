'use client';

import { useCallback, useEffect, useState } from 'react';

/* ── QR 자가채점 결과 (시험지별 응시 현황 + 유형·지문별 복습 분석) ── */
interface QrAggItem { type?: string; sourceKey?: string; correct: number; total: number; pct: number }
interface QrStudent { resultId: string; studentName: string; correctCount: number; objectiveCount: number; earnedScore: number; maxObjectiveScore: number; weakTypes: string[]; createdAt: string }
interface QrPaper {
  paperId: string; title: string; schoolName: string; grade: number | null;
  objectiveCount: number; subjectiveCount: number; maxObjectiveScore: number; totalScore: number;
  token: string; createdAt: string; studentCount: number; avgPct: number;
  byType: QrAggItem[]; bySource: QrAggItem[]; students: QrStudent[];
}

export default function QrGradeResultsPage() {
  const [papers, setPapers] = useState<QrPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<QrPaper | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (keepPaperId?: string) => {
    const d = await fetch('/api/my/vip/exam-grade-results', { credentials: 'include' }).then((r) => r.json());
    const list: QrPaper[] = d.ok ? d.papers : [];
    setPapers(list);
    setSel((prev) => (keepPaperId ? (list.find((p) => p.paperId === keepPaperId) ?? null) : prev));
    return list;
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const pctColor = (pct: number) => pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500';

  const deletePaper = async (p: QrPaper) => {
    if (!confirm(`"${p.title}" QR 시험지와 응시 기록 ${p.studentCount}건을 삭제할까요?\n이미 배포된 시험지의 QR 채점은 더 이상 동작하지 않습니다.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/my/vip/exam-grade-results?paperId=${p.paperId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error();
      setSel(null);
      await load();
    } catch { alert('삭제에 실패했습니다.'); }
    setBusy(false);
  };

  const deleteResult = async (p: QrPaper, st: QrStudent) => {
    if (!confirm(`${st.studentName} 학생의 응시 기록을 삭제할까요?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/my/vip/exam-grade-results?resultId=${st.resultId}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) throw new Error();
      await load(p.paperId);
    } catch { alert('삭제에 실패했습니다.'); }
    setBusy(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">QR 자가채점 결과</h1>
        <p className="text-sm text-zinc-500 mt-0.5">학생이 시험지 QR 로 채점한 결과와 유형·지문별 복습 분석을 확인합니다</p>
      </div>

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : papers.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">QR 채점본이 없습니다. 「시험지 만들기」 → <span className="text-zinc-400">📱 QR 채점본</span> 으로 시험지를 만들면 학생 응시 결과가 여기에 모입니다.</div>
      ) : !sel ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {papers.map((p) => (
            <div key={p.paperId} onClick={() => setSel(p)} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 hover:bg-zinc-800/40 hover:border-white/20 transition-all cursor-pointer">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="text-sm font-medium text-zinc-100 line-clamp-2">{p.title}</div>
                <button onClick={(e) => { e.stopPropagation(); deletePaper(p); }} disabled={busy} title="시험지 삭제" className="flex-shrink-0 -mr-1 -mt-0.5 p-1 rounded-lg text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-40">
                  <TrashIcon />
                </button>
              </div>
              <div className="text-[11px] text-zinc-500 mb-3">{[p.schoolName, p.grade ? `${p.grade}학년` : ''].filter(Boolean).join(' · ')} · 객관식 {p.objectiveCount}문항</div>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div><div className="text-lg font-bold text-zinc-100">{p.studentCount}</div><div className="text-[10px] text-zinc-500">응시</div></div>
                <div><div className={`text-lg font-bold ${p.avgPct >= 80 ? 'text-emerald-400' : p.avgPct >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>{p.avgPct}%</div><div className="text-[10px] text-zinc-500">평균 정답률</div></div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <button onClick={() => setSel(null)} className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors">← QR 시험지 목록으로</button>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-zinc-100">{sel.title}</div>
              <div className="text-xs text-zinc-500 mt-0.5">응시 {sel.studentCount}명 · 평균 정답률 {sel.avgPct}% · 객관식 {sel.objectiveCount}문항</div>
            </div>
            <button onClick={() => deletePaper(sel)} disabled={busy} className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-rose-400/90 border border-rose-500/30 hover:bg-rose-500/10 transition-colors disabled:opacity-40">
              <TrashIcon /> 시험지 삭제
            </button>
          </div>

          {sel.studentCount === 0 ? (
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-10 text-center text-sm text-zinc-600">아직 응시한 학생이 없습니다. 시험지 표지의 QR 로 학생이 채점하면 결과가 표시됩니다.</div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* 유형별 복습 분석 */}
                <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5">
                  <h3 className="text-sm font-medium text-zinc-300 mb-1">유형별 정답률 <span className="text-rose-400/80">(복습 우선순)</span></h3>
                  <p className="text-[11px] text-zinc-600 mb-3">정답률이 낮은 유형부터 — 다음 시험 복습 추천</p>
                  <div className="space-y-2">
                    {sel.byType.map((t) => (
                      <div key={t.type}>
                        <div className="flex justify-between text-xs mb-1"><span className="text-zinc-400">{t.type}</span><span className="text-zinc-500">{t.correct}/{t.total} · {t.pct}%</span></div>
                        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden"><div className={`h-full rounded-full ${pctColor(t.pct)} transition-all`} style={{ width: `${t.pct}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
                {/* 지문별 복습 분석 */}
                <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5">
                  <h3 className="text-sm font-medium text-zinc-300 mb-1">지문(출처)별 정답률 <span className="text-rose-400/80">(복습 우선순)</span></h3>
                  <p className="text-[11px] text-zinc-600 mb-3">정답률이 낮은 지문부터 — 다시 봐야 할 지문</p>
                  <div className="space-y-2">
                    {sel.bySource.map((s) => (
                      <div key={s.sourceKey}>
                        <div className="flex justify-between text-xs mb-1"><span className="text-zinc-400 truncate max-w-[220px]">{s.sourceKey || '(출처 없음)'}</span><span className="text-zinc-500 flex-shrink-0 ml-2">{s.correct}/{s.total} · {s.pct}%</span></div>
                        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden"><div className={`h-full rounded-full ${pctColor(s.pct)} transition-all`} style={{ width: `${s.pct}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 학생별 결과 */}
              <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden">
                <div className="px-5 py-3 border-b border-zinc-800/80"><h3 className="text-sm font-medium text-zinc-300">학생별 결과</h3></div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800/80 text-zinc-500 text-xs">
                      <th className="text-left px-5 py-2">이름</th>
                      <th className="text-right px-5 py-2">정답</th>
                      <th className="text-right px-5 py-2">점수</th>
                      <th className="text-left px-5 py-2">복습 유형</th>
                      <th className="px-3 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...sel.students].sort((a, b) => b.earnedScore - a.earnedScore).map((st, i) => (
                      <tr key={st.resultId || st.studentName + i} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                        <td className="px-5 py-2 text-zinc-300 font-medium">{st.studentName}</td>
                        <td className="px-5 py-2 text-right text-zinc-400">{st.correctCount}/{st.objectiveCount}</td>
                        <td className="px-5 py-2 text-right text-zinc-100 font-semibold">{st.earnedScore}<span className="text-xs text-zinc-600">/{st.maxObjectiveScore}</span></td>
                        <td className="px-5 py-2">
                          <div className="flex flex-wrap gap-1">
                            {st.weakTypes.length === 0 ? <span className="text-emerald-400/80 text-xs">완벽</span> : st.weakTypes.slice(0, 4).map((t) => <span key={t} className="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400/90 text-[11px] border border-rose-500/20">{t}</span>)}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button onClick={() => deleteResult(sel, st)} disabled={busy} title="응시 기록 삭제" className="p-1 rounded text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-40">
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.7} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.16-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.04-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  );
}
