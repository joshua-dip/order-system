'use client';

import { useCallback, useEffect, useState } from 'react';
import { getCurrentSubject, DEFAULT_VIP_SUBJECT } from '@/lib/vip-subject';
import { downloadBlob } from '@/lib/download-blob';

interface StudentRow { resultId: string; studentName: string; correctCount: number; objectiveCount: number; earnedScore: number; maxObjectiveScore: number; weakTypes: string[]; createdAt: string }
interface PaperRow { paperId: string; title: string; schoolName: string; grade: number | null; objectiveCount: number; studentCount: number; avgPct: number; createdAt: string; students: StudentRow[] }
interface WrongQ { num: number; type: string; sourceKey: string; textbook: string; score: number; chosen: string; correct: string; questionId: string; question: string; paragraph: string; explanation: string }
interface WeakType { type: string; correct: number; total: number; pct: number }
interface RetestQ { questionId: string; type: string; textbook: string; sourceKey: string }
interface Detail { student: { name: string; correctCount: number; objectiveCount: number; earnedScore: number; maxObjectiveScore: number }; paperTitle: string; wrong: WrongQ[]; weakTypes: WeakType[]; retest: RetestQ[] }

export default function ReviewPage() {
  const [subject, setSubject] = useState(DEFAULT_VIP_SUBJECT);
  useEffect(() => { setSubject(getCurrentSubject()); }, []);

  const [papers, setPapers] = useState<PaperRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [paperId, setPaperId] = useState('');
  const [resultId, setResultId] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pdfBusy, setPdfBusy] = useState<'wrong' | 'retest' | null>(null);

  const load = useCallback(async () => {
    const d = await fetch('/api/my/vip/exam-grade-results', { credentials: 'include' }).then((r) => r.json());
    if (d.ok) setPapers((d.papers as PaperRow[]).filter((p) => p.studentCount > 0));
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const paper = papers.find((p) => p.paperId === paperId) ?? null;

  const openStudent = async (pid: string, rid: string) => {
    setPaperId(pid); setResultId(rid); setDetail(null); setDetailLoading(true);
    const d = await fetch(`/api/my/vip/review?paperId=${pid}&resultId=${rid}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) setDetail(d); else alert(d.error || '불러오기 실패');
    setDetailLoading(false);
  };

  const downloadPdf = async (kind: 'wrong' | 'retest') => {
    if (!detail) return;
    const ids = (kind === 'wrong' ? detail.wrong.map((w) => w.questionId) : detail.retest.map((r) => r.questionId)).filter(Boolean);
    if (ids.length === 0) { alert(kind === 'wrong' ? '본문이 남아있는 오답 문항이 없습니다.' : '추출된 약점 재시험 문항이 없습니다.'); return; }
    setPdfBusy(kind);
    try {
      const title = kind === 'wrong' ? `${detail.student.name} 오답노트` : `${detail.student.name} 약점 재시험`;
      const res = await fetch('/api/my/vip/generate/download', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ids: ids.join(','), title, answerSheet: true, subject }),
      });
      if (!res.ok) { alert('PDF 생성에 실패했습니다.'); setPdfBusy(null); return; }
      downloadBlob(await res.blob(), `${title}.pdf`);
    } catch { alert('PDF 다운로드 중 오류가 발생했습니다.'); }
    setPdfBusy(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-sm border border-[#c9a44e]/25">{subject}</span>
          오답노트
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">QR 자가채점 결과에서 학생별 틀린 문항을 모아 <b className="text-zinc-300">오답노트</b>·<b className="text-zinc-300">약점 재시험</b>을 PDF로 만듭니다.</p>
      </div>

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : papers.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">
          QR 자가채점 결과가 없습니다.<br />
          「문제 생성」에서 <span className="text-zinc-400">QR 시험지</span>를 배포하고 학생이 채점하면 여기에 나타납니다.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-5">
          {/* 시험지 + 학생 목록 */}
          <div className="space-y-3">
            <div className="text-xs text-zinc-500">QR 채점 시험지</div>
            <div className="space-y-2">
              {papers.map((p) => (
                <div key={p.paperId} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden">
                  <button
                    onClick={() => setPaperId(paperId === p.paperId ? '' : p.paperId)}
                    className="w-full text-left px-3.5 py-2.5 hover:bg-zinc-800/40 transition-colors"
                  >
                    <div className="text-sm text-zinc-200 font-medium truncate">{p.title}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">{p.schoolName || '—'} · 응시 {p.studentCount}명 · 평균 {p.avgPct}%</div>
                  </button>
                  {paperId === p.paperId && (
                    <div className="border-t border-zinc-800/70 divide-y divide-zinc-800/50">
                      {p.students.map((s) => (
                        <button
                          key={s.resultId}
                          onClick={() => openStudent(p.paperId, s.resultId)}
                          className={`w-full text-left px-3.5 py-2 transition-colors ${resultId === s.resultId ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30'}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] text-zinc-200">{s.studentName}</span>
                            <span className="text-[11px] text-zinc-500">{s.correctCount}/{s.objectiveCount}</span>
                          </div>
                          {s.weakTypes.length > 0 && (
                            <div className="text-[10px] text-amber-300/70 mt-0.5 truncate">약점: {s.weakTypes.slice(0, 4).join(' · ')}</div>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 상세 */}
          <div>
            {detailLoading ? (
              <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
            ) : !detail ? (
              <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">왼쪽에서 시험지 → 학생을 선택하면 오답을 분석합니다.</div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-base font-semibold text-zinc-100">{detail.student.name}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">{detail.paperTitle} · 정답 {detail.student.correctCount}/{detail.student.objectiveCount} · 획득 {detail.student.earnedScore}/{detail.student.maxObjectiveScore}점</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => downloadPdf('wrong')} disabled={pdfBusy !== null}
                        className="px-3 py-2 rounded-lg bg-amber-500/20 text-amber-200 text-sm font-medium hover:bg-amber-500/30 transition-colors disabled:opacity-40">
                        {pdfBusy === 'wrong' ? '생성 중…' : `오답노트 PDF (${detail.wrong.length})`}
                      </button>
                      <button onClick={() => downloadPdf('retest')} disabled={pdfBusy !== null || detail.retest.length === 0}
                        className="px-3 py-2 rounded-lg bg-indigo-500/25 text-indigo-200 text-sm font-medium hover:bg-indigo-500/35 transition-colors disabled:opacity-40">
                        {pdfBusy === 'retest' ? '생성 중…' : `약점 재시험 PDF (${detail.retest.length})`}
                      </button>
                    </div>
                  </div>
                  {detail.weakTypes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {detail.weakTypes.map((w) => (
                        <span key={w.type} className="px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 text-[11px]">{w.type} {w.correct}/{w.total}</span>
                      ))}
                    </div>
                  )}
                </div>

                {detail.wrong.length === 0 ? (
                  <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-10 text-center text-sm text-emerald-300/80">틀린 문항이 없습니다. 🎉</div>
                ) : (
                  <div className="space-y-2.5">
                    <div className="text-xs text-zinc-500">틀린 문항 {detail.wrong.length}개</div>
                    {detail.wrong.map((w) => (
                      <div key={w.num} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className="font-bold text-zinc-200 text-sm">{w.num}번</span>
                          <span className="px-1.5 py-0.5 rounded text-[11px] bg-violet-500/15 text-violet-300">{w.type}</span>
                          <span className="text-[11px] text-zinc-600 truncate max-w-[280px]">{w.textbook ? `${w.textbook} · ` : ''}{w.sourceKey}</span>
                          <span className="ml-auto text-[12px]"><span className="text-rose-400">내 답 {w.chosen || '—'}</span> <span className="text-zinc-600">/</span> <span className="text-emerald-400">정답 {w.correct}</span></span>
                        </div>
                        {w.question && <div className="text-[13px] text-zinc-300 mb-1">{w.question}</div>}
                        {w.paragraph && <div className="text-[12px] text-zinc-500 leading-relaxed line-clamp-2">{w.paragraph}</div>}
                        {w.explanation && <div className="text-[12px] text-zinc-400 mt-2 pt-2 border-t border-zinc-800/60"><span className="text-zinc-500">해설 </span>{w.explanation}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
