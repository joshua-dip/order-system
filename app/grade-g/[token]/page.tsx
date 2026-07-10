'use client';

import { use, useEffect, useState } from 'react';

const CIRCLED = ['①', '②', '③', '④'];

interface Q { num: number; question: string; options: string[] }
interface ResultItem { num: number; chosen: string; correct: string; isCorrect: boolean; question?: string; options?: string[]; explanation?: string }

export default function GrammarGradePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [meta, setMeta] = useState<{ title: string; questions: Q[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; total: number; results: ResultItem[] } | null>(null);

  useEffect(() => {
    fetch(`/api/grade-g/${token}`)
      .then((r) => r.json())
      .then((d) => { if (d?.ok) setMeta({ title: d.title, questions: d.questions }); else setError(d?.error ?? '불러오기 실패'); })
      .catch(() => setError('불러오기 실패'));
  }, [token]);

  const submit = async () => {
    if (submitting || !meta) return;
    const unanswered = meta.questions.filter((q) => !answers[q.num]).length;
    if (unanswered > 0 && !confirm(`${unanswered}문항이 비어있어요. 그래도 제출할까요?`)) return;
    setSubmitting(true);
    try {
      const r = await fetch(`/api/grade-g/${token}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentName: name, answers }),
      });
      const d = await r.json();
      if (d?.ok) setResult({ score: d.score, total: d.total, results: d.results });
      else alert(d?.error ?? '제출 실패');
    } catch { alert('제출 실패'); }
    finally { setSubmitting(false); }
  };

  if (error) return <div className="mx-auto max-w-md p-8 text-center text-rose-600">{error}</div>;
  if (!meta) return <div className="mx-auto max-w-md p-8 text-center text-zinc-500">불러오는 중…</div>;

  // 결과 화면
  if (result) {
    const pct = result.total ? Math.round((result.score / result.total) * 100) : 0;
    return (
      <div className="mx-auto max-w-md p-4">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 text-center shadow-sm">
          <p className="text-sm text-zinc-500">{meta.title}</p>
          <p className="mt-2 text-4xl font-extrabold text-zinc-900">{result.score}<span className="text-xl text-zinc-400"> / {result.total}</span></p>
          <p className={`mt-1 text-sm font-bold ${pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-rose-600'}`}>{pct}점</p>
        </div>
        <div className="mt-4 space-y-2">
          {result.results.map((r) => (
            <div key={r.num} className={`rounded-xl border p-3 ${r.isCorrect ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/50'}`}>
              <div className="flex items-center gap-2 text-[13px]">
                <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${r.isCorrect ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'}`}>{r.num}</span>
                <span className="text-zinc-800">{r.isCorrect ? '정답' : '오답'}</span>
                {!r.isCorrect && <span className="ml-auto text-[12px] text-zinc-500">내 답 {r.chosen || '—'} · 정답 <b className="text-rose-600">{r.correct}</b></span>}
              </div>
              {r.question && <p className="mt-1.5 text-[13px] text-zinc-700">{r.question}</p>}
              {r.options && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-zinc-500">
                  {r.options.map((o, i) => <span key={i} className={CIRCLED[i] === r.correct ? 'font-bold text-emerald-700' : ''}>{CIRCLED[i]} {o}</span>)}
                </div>
              )}
              {!r.isCorrect && r.explanation && <p className="mt-1 text-[12px] text-zinc-500">💡 {r.explanation}</p>}
            </div>
          ))}
        </div>
        <button onClick={() => { setResult(null); setAnswers({}); }} className="mt-4 w-full rounded-xl border border-zinc-300 py-2.5 text-sm font-semibold text-zinc-600">다시 풀기</button>
      </div>
    );
  }

  // OMR 입력 화면
  return (
    <div className="mx-auto max-w-md p-4">
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <p className="text-[11px] font-semibold text-[#c9a44e]">문법 학습지 자가채점</p>
        <h1 className="mt-0.5 text-lg font-bold text-zinc-900">{meta.title}</h1>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름을 입력하세요"
          className="mt-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm focus:border-[#c9a44e] focus:outline-none" />
      </div>

      <div className="mt-3 space-y-2">
        {meta.questions.map((q) => (
          <div key={q.num} className="rounded-xl border border-zinc-200 bg-white p-3">
            <div className="flex gap-2 text-[13px]">
              <span className="font-bold text-zinc-900">{q.num}.</span>
              <span className="text-zinc-800 [&_u]:underline [&_u]:decoration-dotted" dangerouslySetInnerHTML={{ __html: q.question.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/&lt;u&gt;/g,'<u>').replace(/&lt;\/u&gt;/g,'</u>') }} />
            </div>
            <div className="mt-2 flex gap-1.5">
              {q.options.map((o, i) => {
                const mark = CIRCLED[i];
                const on = answers[q.num] === mark;
                return (
                  <button key={i} onClick={() => setAnswers((a) => ({ ...a, [q.num]: mark }))}
                    className={`flex-1 rounded-lg border px-1 py-2 text-[13px] ${on ? 'border-[#c9a44e] bg-[#c9a44e]/15 font-bold text-[#8a6d1f]' : 'border-zinc-200 text-zinc-600'}`}>
                    {mark} {o}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <button onClick={submit} disabled={submitting}
        className="sticky bottom-3 mt-4 w-full rounded-xl bg-zinc-900 py-3 text-sm font-bold text-white shadow-lg disabled:opacity-60">
        {submitting ? '채점 중…' : '제출하고 채점하기'}
      </button>
    </div>
  );
}
