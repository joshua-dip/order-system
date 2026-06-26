'use client';

import { use, useEffect, useState } from 'react';

const CIRCLED = ['①', '②', '③', '④', '⑤'];

interface PaperMeta {
  title: string;
  schoolName: string;
  grade: number | null;
  objectiveCount: number;
  subjectiveCount: number;
  maxObjectiveScore: number;
  questions: { num: number; type: string }[];
}

interface GradeResult {
  studentName: string;
  correctCount: number;
  objectiveCount: number;
  earnedScore: number;
  maxObjectiveScore: number;
  weakTypes: string[];
  wrongNums: number[];
  /** 재응시 결과 — 방금 고쳐 푼 점수를 보여줌. 공식(첫 제출) 점수는 official 로 유지. */
  isRetake?: boolean;
  official?: { correctCount: number; objectiveCount: number; earnedScore: number; maxObjectiveScore: number };
}

export default function ExamGradePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [meta, setMeta] = useState<PaperMeta | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [phone, setPhone] = useState('');
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState<GradeResult | null>(null);

  useEffect(() => {
    fetch(`/api/exam-grade/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setMeta(d);
        else setLoadErr(d.error || '시험을 불러올 수 없습니다.');
      })
      .catch(() => setLoadErr('네트워크 오류가 발생했습니다.'));
  }, [token]);

  const toggle = (num: number, c: string) => {
    setAnswers((prev) => {
      const cur = prev[num] ?? [];
      const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
      return { ...prev, [num]: next };
    });
  };

  const answeredCount = meta ? meta.questions.filter((q) => (answers[q.num] ?? []).length > 0).length : 0;

  const submit = async () => {
    setErr('');
    if (phone.replace(/[^0-9]/g, '').length < 8) { setErr('전화번호를 정확히 입력해주세요.'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/exam-grade/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          answers: Object.entries(answers).map(([num, arr]) => ({ num: Number(num), chosen: arr.join('') })),
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { setErr(d.error || '채점에 실패했습니다.'); setSubmitting(false); return; }
      setResult(d);
    } catch {
      setErr('네트워크 오류가 발생했습니다.');
    }
    setSubmitting(false);
  };

  /* ── 로딩/에러 ── */
  if (loadErr) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-slate-600">{loadErr}</p>
        </div>
      </div>
    );
  }
  if (!meta) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  /* ── 결과 화면 ── */
  if (result) {
    const pct = result.objectiveCount > 0 ? Math.round((result.correctCount / result.objectiveCount) * 100) : 0;
    return (
      <div className="min-h-screen bg-slate-50 px-5 py-8">
        <div className="max-w-md mx-auto space-y-5">
          <div className="text-center">
            <div className="text-sm text-slate-500">{result.studentName} 학생</div>
            <h1 className="text-lg font-bold text-slate-800 mt-1">채점 결과</h1>
          </div>

          {result.isRetake && (
            <div className="rounded-xl bg-sky-50 border border-sky-200 px-4 py-3 text-[13px] text-sky-800 text-center">
              ✏️ <b>재응시 결과</b>예요 — 방금 고쳐 푼 점수입니다.
              {result.official && (
                <> 공식 점수(처음 제출)는 <b>{result.official.earnedScore}점 ({result.official.correctCount}/{result.official.objectiveCount})</b> 로 유지돼요.</>
              )}
            </div>
          )}

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 text-center">
            <div className="text-5xl font-bold text-indigo-600">{result.earnedScore}<span className="text-2xl text-slate-400">/{result.maxObjectiveScore}</span></div>
            <div className="text-sm text-slate-500 mt-2">객관식 {result.correctCount} / {result.objectiveCount}문항 정답 · {pct}%</div>
            <div className="mt-4 h-3 rounded-full bg-slate-100 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>

          {result.weakTypes.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
              <div className="text-sm font-semibold text-slate-700 mb-2">📚 복습이 필요한 유형</div>
              <div className="flex flex-wrap gap-2">
                {result.weakTypes.map((t) => (
                  <span key={t} className="px-3 py-1 rounded-full bg-rose-50 text-rose-600 text-xs font-medium border border-rose-100">{t}</span>
                ))}
              </div>
            </div>
          )}

          {result.wrongNums.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
              <div className="text-sm font-semibold text-slate-700 mb-2">틀린 문항</div>
              <div className="flex flex-wrap gap-1.5">
                {result.wrongNums.map((n) => (
                  <span key={n} className="w-8 h-8 flex items-center justify-center rounded-lg bg-rose-50 text-rose-600 text-sm font-semibold border border-rose-100">{n}</span>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => { setResult(null); setErr(''); }}
            className="w-full py-3.5 rounded-2xl bg-white border border-indigo-200 text-indigo-600 font-bold text-sm hover:bg-indigo-50 active:scale-[0.99] transition-all"
          >
            ✏️ 다시 풀기 (재응시)
          </button>
          <p className="text-center text-xs text-slate-400">
            틀린 문항을 고쳐 다시 풀어볼 수 있어요. 선생님이 결과를 확인하실 수 있어요.<br />
            <span className="text-slate-300">공식 점수는 처음 제출한 결과로 유지됩니다.</span>
          </p>
        </div>
      </div>
    );
  }

  /* ── OMR 입력 화면 ── */
  return (
    <div className="min-h-screen bg-slate-50 px-5 py-8">
      <div className="max-w-md mx-auto space-y-5">
        <div className="text-center">
          <h1 className="text-lg font-bold text-slate-800">{meta.title}</h1>
          <div className="text-sm text-slate-500 mt-1">
            {[meta.schoolName, meta.grade ? `${meta.grade}학년` : ''].filter(Boolean).join(' · ')}
            {meta.schoolName || meta.grade ? ' · ' : ''}객관식 {meta.objectiveCount}문항
          </div>
        </div>

        {/* 전화번호 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <label className="block text-sm font-semibold text-slate-700 mb-2">본인 전화번호</label>
          <input
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="01012345678"
            className="w-full px-4 py-3 rounded-xl border border-slate-200 text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <p className="text-xs text-slate-400 mt-1.5">등록된 학생 전화번호로 본인 확인합니다.</p>
        </div>

        {/* OMR */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700">답안 입력</span>
            <span className="text-xs text-slate-400">{answeredCount}/{meta.objectiveCount}</span>
          </div>
          <div className="space-y-1">
            {meta.questions.map((q) => (
              <div key={q.num} className="flex items-center gap-2 py-1.5 border-b border-slate-50 last:border-0">
                <span className="w-7 text-right text-sm font-semibold text-slate-600">{q.num}</span>
                <div className="flex gap-1.5 flex-1 justify-end">
                  {CIRCLED.map((c) => {
                    const on = (answers[q.num] ?? []).includes(c);
                    return (
                      <button
                        key={c}
                        onClick={() => toggle(q.num, c)}
                        className={`w-9 h-9 rounded-full text-base font-medium transition-all ${on ? 'bg-indigo-600 text-white shadow' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {err && <p className="text-sm text-rose-500 text-center">{err}</p>}

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-bold text-base shadow-sm hover:bg-indigo-700 active:scale-[0.99] transition-all disabled:opacity-50"
        >
          {submitting ? '채점 중…' : '제출하고 채점하기'}
        </button>
        <p className="text-center text-xs text-slate-400">복수 정답 문항은 해당 번호를 모두 선택하세요.</p>
      </div>
    </div>
  );
}
