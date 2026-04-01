'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function ProblemCreationInner() {
  const sp = useSearchParams();
  const fileName = sp.get('fileName');
  const [sentences, setSentences] = useState<string[]>([]);
  const [koreanSentences, setKoreanSentences] = useState<string[]>([]);
  const [questions, setQuestions] = useState<unknown[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!fileName) return;
    (async () => {
      try {
        const res = await fetch('/api/admin/passage-analyzer/load-analysis', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: decodeURIComponent(fileName) }),
        });
        const d = await res.json();
        if (!res.ok) return;
        const main = d.data?.passageStates?.main;
        if (main?.sentences) {
          setSentences(main.sentences);
          setKoreanSentences(main.koreanSentences || main.sentences.map(() => ''));
        }
      } catch {
        /* ignore */
      }
    })();
  }, [fileName]);

  async function generate() {
    if (sentences.length === 0) {
      setErr('문장이 없습니다. fileName 쿼리로 불러오거나 아래에 직접 입력하세요.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/admin/passage-analyzer/generate-questions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentences,
          koreanSentences,
          questionTypes: ['grammar', 'context', 'reading'],
          questionCount: 8,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || '실패');
      setQuestions(d.questions || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : '실패');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <h1 className="text-xl font-bold">문제 출제</h1>
      <p className="text-slate-400 text-sm">
        분석 작업대에서 저장한 파일명으로 열 수 있습니다:{' '}
        <code className="text-amber-200/90">?fileName=passage:xxx</code>
      </p>
      {err && <p className="text-red-400 text-sm">{err}</p>}
      <div>
        <label className="text-xs text-slate-400">영문 문장 (줄바꿈으로 구분)</label>
        <textarea
          value={sentences.join('\n')}
          onChange={(e) =>
            setSentences(
              e.target.value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
            )
          }
          rows={10}
          className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono"
        />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={generate}
        className="px-4 py-2 rounded-lg bg-violet-700 disabled:opacity-40"
      >
        {busy ? '생성 중…' : 'AI 문제 생성'}
      </button>
      <ul className="space-y-4">
        {questions.map((q, i) => (
          <li key={i} className="border border-slate-700 rounded-lg p-3 text-sm bg-slate-800/50">
            <pre className="whitespace-pre-wrap text-slate-200 overflow-x-auto">
              {JSON.stringify(q, null, 2)}
            </pre>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ProblemCreationPage() {
  return (
    <Suspense fallback={<div className="p-8 text-slate-400">로딩…</div>}>
      <ProblemCreationInner />
    </Suspense>
  );
}
