'use client';

/**
 * 수업 화면 아래 「실전 문항」 — 유형 칩으로 고르고, 정답 보기/숨기기로 바로 풀이.
 * 관리자는 판매 재고, 회원은 공개 무료 세트(서버가 정한다).
 */

import { useEffect, useMemo, useState } from 'react';
import type { LiveQuestionsPayload } from '@/lib/passage-live-questions';

const CIRCLED = ['①', '②', '③', '④', '⑤'];

/** 본문 이스케이프 — `<u>` 밑줄만 살린다(인쇄 양식과 같은 규칙) */
function htmlKeepUnderline(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;u&gt;/g, '<u>')
    .replace(/&lt;\/u&gt;/g, '</u>');
}

function Paragraph({ text }: { text: string }) {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !/^#{2,}$/.test(l));
  return (
    <div className="space-y-2 rounded-lg border border-slate-300 px-4 py-3 text-justify leading-[1.9] [&_u]:decoration-2 [&_u]:underline-offset-4">
      {lines.map((l, i) => (
        <p key={i} dangerouslySetInnerHTML={{ __html: htmlKeepUnderline(l) }} />
      ))}
    </div>
  );
}

export function LiveQuestionsSection({ apiUrl, showAnswerDefault = false }: { apiUrl: string; showAnswerDefault?: boolean }) {
  const [data, setData] = useState<LiveQuestionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState('');
  const [pos, setPos] = useState(0);
  const [showAnswer, setShowAnswer] = useState(showAnswerDefault);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetch(apiUrl, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LiveQuestionsPayload | null) => {
        if (cancelled) return;
        setData(d);
        setType(d?.types[0] ?? '');
        setPos(0);
        setShowAnswer(showAnswerDefault);
      })
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [apiUrl, showAnswerDefault]);

  const list = useMemo(() => (data?.items ?? []).filter((q) => q.type === type), [data, type]);
  const q = list[Math.min(pos, Math.max(list.length - 1, 0))];
  const answerNos = useMemo(() => new Set(CIRCLED.filter((c) => q?.answer.includes(c))), [q]);

  if (loading) return <p className="py-6 text-center text-sm text-slate-400">실전 문항 불러오는 중…</p>;
  if (!data || data.items.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-400">
        {data?.scope === 'free' ? '이 지문에는 아직 공개 실전 문항이 없어요.' : '이 지문에는 완료된 변형문제가 아직 없어요.'}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {data.types.map((t) => {
          const n = data.items.filter((x) => x.type === t).length;
          return (
            <button
              key={t}
              type="button"
              onClick={() => {
                setType(t);
                setPos(0);
                setShowAnswer(showAnswerDefault);
              }}
              className={`rounded-full border px-3 py-1 text-[0.8em] font-semibold ${
                type === t ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600 hover:border-slate-500'
              }`}
            >
              {t}
              {n > 1 ? <span className="ml-1 opacity-60">{n}</span> : null}
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setShowAnswer((v) => !v)}
          className={`rounded-lg border px-3 py-1.5 text-[0.8em] font-semibold ${
            showAnswer ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {showAnswer ? '정답 숨기기' : '정답 보기'}
        </button>
      </div>

      {q ? (
        <article className="space-y-3">
          <div className="flex items-baseline gap-2">
            <p className="flex-1 font-bold">{q.question}</p>
            {list.length > 1 ? (
              <button
                type="button"
                onClick={() => {
                  setPos((p) => (p + 1) % list.length);
                  setShowAnswer(showAnswerDefault);
                }}
                className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-[0.75em] text-slate-600 hover:bg-slate-50"
                title="같은 유형 다른 문항"
              >
                다른 문제 {Math.min(pos, list.length - 1) + 1}/{list.length}
              </button>
            ) : null}
          </div>
          {q.paragraph ? <Paragraph text={q.paragraph} /> : null}
          {q.options.length ? (
            <ol className="space-y-1">
              {q.options.map((o, i) => {
                const hit = showAnswer && CIRCLED.some((c) => answerNos.has(c) && o.startsWith(c));
                return (
                  <li
                    key={i}
                    className={`rounded-md px-2 py-1 ${hit ? 'bg-amber-100 font-semibold' : ''}`}
                    dangerouslySetInnerHTML={{ __html: htmlKeepUnderline(o) }}
                  />
                );
              })}
            </ol>
          ) : null}
          {showAnswer ? (
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-[0.9em] leading-relaxed">
              <p className="font-bold text-rose-600">정답 {q.answer || '—'}</p>
              {q.explanation ? <p className="mt-1 whitespace-pre-wrap text-slate-700">{q.explanation}</p> : null}
            </div>
          ) : null}
        </article>
      ) : null}
      {data.pulledFrom ? <p className="mt-4 text-[0.75em] text-sky-600">원출처 {data.pulledFrom} 문항을 끌어왔어요.</p> : null}
    </div>
  );
}
