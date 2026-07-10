'use client';

import { useEffect, useState } from 'react';

interface ResultRow {
  studentName: string;
  studentPhone: string;
  correctCount: number;
  totalCount: number;
  earnedScore: number;
  maxScore: number;
  selfCorrectCount: number;
  selfEarnedScore: number;
  wrongNums: number[];
  retake: { correctCount: number; totalCount: number; earnedScore: number; attemptCount: number } | null;
  createdAt: string;
}
interface PaperRow {
  id: string;
  token: string;
  title: string;
  교과: string;
  학습주제: string;
  topicKey: string;
  questionCount: number;
  objectiveCount: number;
  subjectiveCount: number;
  maxScore: number;
  createdAt: string;
  resultCount: number;
  results: ResultRow[];
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}
function fmtDate(s: string): string {
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function MathResultsPage() {
  const [papers, setPapers] = useState<PaperRow[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState('');

  const load = () => {
    fetch('/api/my/vip/math-problems/gradings', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (d?.ok) setPapers(d.papers as PaperRow[]); else setErr(d?.error || '불러오지 못했습니다.'); })
      .catch(() => setErr('네트워크 오류'));
  };
  useEffect(load, []);

  const del = async (id: string) => {
    if (!confirm('이 채점지와 학생 제출 기록을 삭제할까요?')) return;
    const res = await fetch(`/api/my/vip/math-problems/gradings?paperId=${id}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) setPapers((ps) => (ps ?? []).filter((p) => p.id !== id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-sm border border-[#c9a44e]/25">수학</span>
            QR 채점 결과
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">학생이 QR로 제출한 채점 결과입니다 (정답률·자가채점·재응시)</p>
        </div>
        <a href="/my/vip/math-problems" className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm font-semibold text-zinc-300 hover:border-[#c9a44e]/50 hover:text-[#e8d48b] transition-colors">← 문제관리</a>
      </div>

      {err && <p className="text-sm text-rose-400">{err}</p>}

      {!papers ? (
        <div className="py-10 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : papers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-700 p-8 text-center text-sm text-zinc-500">
          아직 생성된 QR 채점지가 없습니다. 문제관리 → 문제지 인쇄 → <b className="text-zinc-300">🔗 QR 채점지 만들기</b>로 시작하세요.
        </div>
      ) : (
        <div className="space-y-3">
          {papers.map((p) => {
            const isOpen = !!open[p.id];
            const avg = p.results.length > 0 ? Math.round(p.results.reduce((s, r) => s + pct(r.correctCount, r.totalCount), 0) / p.results.length) : 0;
            return (
              <div key={p.id} className="rounded-xl border border-zinc-800/80 bg-zinc-900/40">
                <button type="button" onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <span className={`text-[#c9a44e] transition-transform ${isOpen ? 'rotate-90' : ''}`}>▸</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-zinc-100">{p.학습주제 || p.title}</p>
                    <p className="truncate text-[11px] text-zinc-500">{p.교과} · {p.questionCount}문항(객{p.objectiveCount}/주{p.subjectiveCount}) · {fmtDate(p.createdAt)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-bold text-[#e8d48b]">{p.resultCount}명</p>
                    {p.resultCount > 0 && <p className="text-[11px] text-zinc-500">평균 {avg}%</p>}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-zinc-800/70 px-4 py-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <a href={`/math-grade/${p.token}`} target="_blank" className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300 hover:text-zinc-100">채점 페이지 열기 ↗</a>
                      <a href={`/my/vip/math-problems/print?topicKey=${encodeURIComponent(p.topicKey)}`} target="_blank" className="rounded-md border border-zinc-700 px-2 py-1 text-zinc-300 hover:text-zinc-100">🖨 문제지</a>
                      <button onClick={() => del(p.id)} className="ml-auto rounded-md border border-rose-500/40 px-2 py-1 text-rose-400 hover:bg-rose-500/10">삭제</button>
                    </div>
                    {p.results.length === 0 ? (
                      <p className="py-3 text-center text-[12px] text-zinc-500">아직 제출한 학생이 없습니다.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="text-zinc-500 text-left border-b border-zinc-800">
                              <th className="py-1.5 pr-2 font-medium">학생</th>
                              <th className="py-1.5 px-2 font-medium">점수</th>
                              <th className="py-1.5 px-2 font-medium">정답률</th>
                              <th className="py-1.5 px-2 font-medium">자가채점</th>
                              <th className="py-1.5 px-2 font-medium">틀린 문항</th>
                              <th className="py-1.5 px-2 font-medium">재응시</th>
                              <th className="py-1.5 pl-2 font-medium">제출</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.results.map((r, i) => {
                              const rate = pct(r.correctCount, r.totalCount);
                              return (
                                <tr key={i} className="border-b border-zinc-900/70">
                                  <td className="py-1.5 pr-2 font-semibold text-zinc-200">{r.studentName}</td>
                                  <td className="py-1.5 px-2 text-zinc-300">{r.earnedScore}/{r.maxScore}</td>
                                  <td className="py-1.5 px-2">
                                    <span className={rate >= 80 ? 'text-emerald-400' : rate >= 50 ? 'text-amber-400' : 'text-rose-400'}>{r.correctCount}/{r.totalCount} · {rate}%</span>
                                  </td>
                                  <td className="py-1.5 px-2 text-zinc-400">
                                    {r.selfCorrectCount !== r.correctCount ? `${r.selfCorrectCount}/${r.totalCount}` : '—'}
                                  </td>
                                  <td className="py-1.5 px-2 text-zinc-500">{r.wrongNums.length > 0 ? r.wrongNums.join(', ') : '—'}</td>
                                  <td className="py-1.5 px-2 text-zinc-400">{r.retake ? `${r.retake.earnedScore}점 (${r.retake.attemptCount}회)` : '—'}</td>
                                  <td className="py-1.5 pl-2 text-zinc-500">{fmtDate(r.createdAt)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
