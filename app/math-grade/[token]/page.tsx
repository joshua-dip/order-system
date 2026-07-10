'use client';

import { use, useEffect, useMemo, useState } from 'react';

const CIRCLED = ['①', '②', '③', '④', '⑤'];

interface MetaQuestion { num: number; type: string; difficulty: string; question: string; choices?: string[] }
interface PaperMeta {
  title: string; 교과: string; 학습주제: string;
  objectiveCount: number; subjectiveCount: number; maxScore: number;
  questions: MetaQuestion[];
}
interface ResultAnswer { num: number; type: string; chosen: string; correct: string; isCorrect: boolean; needsSelfCheck: boolean; score: number }
interface GradeResult {
  studentName: string;
  correctCount: number; totalCount: number; earnedScore: number; maxScore: number;
  weakTopics: string[]; wrongNums: number[];
  answers: ResultAnswer[];
  isRetake?: boolean;
  official?: { correctCount: number; totalCount: number; earnedScore: number; maxScore: number };
}

export default function MathGradePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [meta, setMeta] = useState<PaperMeta | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [phone, setPhone] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<GradeResult | null>(null);
  const [selfMarks, setSelfMarks] = useState<Record<number, boolean>>({});
  const [selfScore, setSelfScore] = useState<{ selfCorrectCount: number; selfEarnedScore: number } | null>(null);

  useEffect(() => {
    fetch(`/api/math-grade/${token}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setMeta(d); else setLoadErr(d.error || '채점지를 불러올 수 없습니다.'); })
      .catch(() => setLoadErr('네트워크 오류가 발생했습니다.'));
  }, [token]);

  const setChoice = (num: number, c: string) => setAnswers((p) => ({ ...p, [num]: p[num] === c ? '' : c }));
  const setText = (num: number, v: string) => setAnswers((p) => ({ ...p, [num]: v }));

  const answeredCount = meta ? meta.questions.filter((q) => (answers[q.num] ?? '').trim().length > 0).length : 0;

  const submit = async () => {
    setErr('');
    if (phone.replace(/[^0-9]/g, '').length < 8) { setErr('전화번호를 정확히 입력해주세요.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/math-grade/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, answers: Object.entries(answers).map(([num, chosen]) => ({ num: Number(num), chosen })) }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { setErr(d.error || '채점에 실패했습니다.'); setSubmitting(false); return; }
      setResult(d);
      setSelfMarks({});
      setSelfScore(null);
    } catch { setErr('네트워크 오류가 발생했습니다.'); }
    setSubmitting(false);
  };

  const toggleSelf = async (num: number, val: boolean) => {
    if (!result) return;
    const next = { ...selfMarks, [num]: val };
    setSelfMarks(next);
    try {
      const res = await fetch(`/api/math-grade/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, selfMarks: next }),
      });
      const d = await res.json();
      if (res.ok && d.ok) setSelfScore({ selfCorrectCount: d.selfCorrectCount, selfEarnedScore: d.selfEarnedScore });
    } catch { /* 무시 — 로컬 표시만 */ }
  };

  const selfCheckItems = useMemo(() => (result?.answers ?? []).filter((a) => a.needsSelfCheck), [result]);

  /* ── 로딩/에러 ── */
  if (loadErr) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="text-center"><div className="text-4xl mb-3">⚠️</div><p className="text-slate-600">{loadErr}</p></div>
    </div>
  );
  if (!meta) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
    </div>
  );

  /* ── 결과 화면 ── */
  if (result) {
    const pct = result.totalCount > 0 ? Math.round((result.correctCount / result.totalCount) * 100) : 0;
    const shownCorrect = selfScore ? selfScore.selfCorrectCount : result.correctCount;
    const shownScore = selfScore ? selfScore.selfEarnedScore : result.earnedScore;
    return (
      <div className="min-h-screen bg-slate-50 px-5 py-8">
        <div className="max-w-md mx-auto space-y-5">
          <div className="text-center">
            <div className="text-sm text-slate-500">{result.studentName} 학생</div>
            <h1 className="text-lg font-bold text-slate-800 mt-1">{meta.학습주제} 채점 결과</h1>
          </div>

          {result.isRetake && (
            <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 text-[13px] text-sky-800 text-center">
              ✏️ <b>재응시 결과</b>예요 — 방금 고쳐 푼 점수입니다.
              {result.official && (<> 공식 점수(처음 제출)는 <b>{result.official.earnedScore}점 ({result.official.correctCount}/{result.official.totalCount})</b> 로 유지돼요.</>)}
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-center">
            <div className="text-5xl font-bold text-indigo-600">{shownScore}<span className="text-2xl text-slate-400">/{result.maxScore}</span></div>
            <div className="text-sm text-slate-500 mt-2">
              {shownCorrect} / {result.totalCount}문항 정답 · {result.totalCount > 0 ? Math.round((shownCorrect / result.totalCount) * 100) : 0}%
              {selfScore && <span className="text-slate-400"> (자가채점 반영)</span>}
            </div>
            <div className="mt-4 h-3 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${result.totalCount > 0 ? Math.round((shownCorrect / result.totalCount) * 100) : 0}%` }} />
            </div>
          </div>

          {/* 주관식 자가채점 */}
          {selfCheckItems.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
              <div className="text-sm font-semibold text-slate-700 mb-1">✍️ 주관식 자가채점</div>
              <p className="text-xs text-slate-400 mb-3">자동 채점이 애매한 문항이에요. 정답과 비교해 <b>맞았으면 O</b>를 눌러주세요.</p>
              <div className="space-y-3">
                {selfCheckItems.map((a) => (
                  <div key={a.num} className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="text-[13px] text-slate-700"><b>{a.num}번</b></div>
                    <div className="mt-1 text-[13px] text-slate-500">내 답: <span className="text-slate-800">{a.chosen || '(무응답)'}</span></div>
                    <div className="text-[13px] text-emerald-700">정답: <b>{a.correct}</b></div>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => toggleSelf(a.num, true)}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition ${selfMarks[a.num] === true ? 'bg-emerald-500 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}>O 맞음</button>
                      <button onClick={() => toggleSelf(a.num, false)}
                        className={`flex-1 py-2 rounded-lg text-sm font-bold transition ${selfMarks[a.num] === false ? 'bg-rose-500 text-white' : 'bg-white border border-slate-200 text-slate-500'}`}>X 틀림</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 문항별 채점 */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <div className="text-sm font-semibold text-slate-700 mb-2">문항별 정답</div>
            <div className="space-y-1.5">
              {result.answers.map((a) => (
                <div key={a.num} className="flex items-center gap-2 text-[13px] py-1 border-b border-slate-50 last:border-0">
                  <span className="w-6 text-right font-semibold text-slate-500">{a.num}</span>
                  <span className={a.isCorrect ? 'text-emerald-600' : 'text-rose-500'}>{a.isCorrect ? '○' : '✕'}</span>
                  <span className="text-slate-400 truncate flex-1">내 답 {a.chosen || '—'}</span>
                  <span className="text-emerald-700 font-medium">정답 {a.correct}</span>
                </div>
              ))}
            </div>
          </div>

          <button onClick={() => { setResult(null); setErr(''); }}
            className="w-full py-3.5 rounded-2xl bg-white border border-indigo-200 text-indigo-600 font-bold text-sm hover:bg-indigo-50 active:scale-[0.99] transition-all">
            ✏️ 다시 풀기 (재응시)
          </button>
          <p className="text-center text-xs text-slate-400">공식 점수는 처음 제출한 결과로 유지됩니다.</p>
        </div>
      </div>
    );
  }

  /* ── 입력 화면 ── */
  return (
    <div className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="max-w-md mx-auto space-y-5">
        <div className="text-center">
          <h1 className="text-lg font-bold text-slate-800">{meta.title}</h1>
          <div className="text-sm text-slate-500 mt-1">
            {[meta.교과, meta.학습주제].filter(Boolean).join(' · ')} · {meta.questions.length}문항
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <label className="block text-sm font-semibold text-slate-700 mb-2">본인 전화번호</label>
          <input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01012345678"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          <p className="text-xs text-slate-400 mt-1.5">등록된 학생 전화번호로 본인 확인합니다.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700">답안 입력</span>
            <span className="text-xs text-slate-400">{answeredCount}/{meta.questions.length}</span>
          </div>
          <div className="space-y-4">
            {meta.questions.map((q) => (
              <div key={q.num} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                <div className="flex gap-2 text-[13.5px] text-slate-700 leading-relaxed">
                  <span className="font-bold text-slate-600">{q.num}.</span>
                  <span className="whitespace-pre-wrap flex-1">{q.question}</span>
                </div>
                {q.type === '객관식' && q.choices && q.choices.length > 0 ? (
                  <div className="mt-2 ml-5 space-y-1.5">
                    {q.choices.map((opt, ci) => {
                      const c = CIRCLED[ci];
                      const on = answers[q.num] === c;
                      return (
                        <button key={ci} onClick={() => setChoice(q.num, c)}
                          className={`w-full text-left px-3 py-2 rounded-xl text-[13px] transition-all ${on ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                          {c} {opt}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <input value={answers[q.num] ?? ''} onChange={(e) => setText(q.num, e.target.value)} placeholder="정답 입력 (예: √3, x=-2±√10)"
                    className="mt-2 ml-5 w-[calc(100%-1.25rem)] px-3 py-2 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400 text-[13px]" />
                )}
              </div>
            ))}
          </div>
        </div>

        {err && <p className="text-sm text-rose-500 text-center">{err}</p>}
        <button onClick={submit} disabled={submitting}
          className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-bold text-base shadow-sm hover:bg-indigo-700 active:scale-[0.99] transition-all disabled:opacity-50">
          {submitting ? '채점 중…' : '제출하고 채점하기'}
        </button>
        <p className="text-center text-xs text-slate-400">주관식은 정답과 자동 비교하며, 애매하면 결과 화면에서 자가채점할 수 있어요.</p>
      </div>
    </div>
  );
}
