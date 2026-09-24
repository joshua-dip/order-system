'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import AppBar from '@/app/components/AppBar';
import { fetchAuthMe } from '@/lib/auth-me-cache';

/**
 * 학습실 — 모의고사 순서·삽입 문항을 웹에서 한 문항씩 풀고 바로 채점한다(회원 전용).
 * 정답·해설은 세트에 없고, 답을 고를 때마다 /api/practice/check 로 받는다.
 */

type Kind = '순서' | '삽입';
type Layout =
  | { kind: '순서'; intro: string; A: string; B: string; C: string; options: string[] }
  | { kind: '삽입'; given: string; passage: string };
type Question = { id: string; kind: Kind; hard: boolean; number: string; question: string; layout: Layout };
type Exam = { textbook: string; year: number; month: number; grade: number; counts: Record<string, number> };
type Checked = { picked: string; correct: boolean; correctAnswer: string; explanation: string };

const CIRCLED = ['①', '②', '③', '④', '⑤'];
const KIND_CHOICES: { key: string; label: string; kinds: Kind[] }[] = [
  { key: 'both', label: '순서 + 삽입', kinds: ['순서', '삽입'] },
  { key: 'order', label: '순서만', kinds: ['순서'] },
  { key: 'insert', label: '삽입만', kinds: ['삽입'] },
];

export default function PracticePage() {
  const [auth, setAuth] = useState<'checking' | 'member' | 'guest'>('checking');
  const [exams, setExams] = useState<Exam[]>([]);
  const [grade, setGrade] = useState(1);
  const [textbook, setTextbook] = useState('');
  const [kindKey, setKindKey] = useState('both');
  const [hard, setHard] = useState(false);
  const [msg, setMsg] = useState('');

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Record<string, Checked>>({});
  const [checking, setChecking] = useState(false);
  const [loadingSet, setLoadingSet] = useState(false);

  useEffect(() => {
    fetchAuthMe()
      .then((d) => {
        if (!d?.user) {
          setAuth('guest');
          return;
        }
        setAuth('member');
        return fetch('/api/practice/exams', { credentials: 'include' })
          .then((r) => r.json())
          .then((j) => setExams(Array.isArray(j?.exams) ? j.exams : []));
      })
      .catch(() => setAuth('guest'));
  }, []);

  const gradeExams = useMemo(() => exams.filter((e) => e.grade === grade), [exams, grade]);
  const kinds = KIND_CHOICES.find((k) => k.key === kindKey)!.kinds;

  const countOf = (e: Exam) =>
    kinds.reduce((a, k) => a + (e.counts[hard ? `${k}-고난도` : k] ?? 0), 0);

  const startSet = useCallback(
    async (onlyIds?: string[]) => {
      if (onlyIds && questions) {
        setQuestions(questions.filter((q) => onlyIds.includes(q.id)));
        setIdx(0);
        setResults({});
        return;
      }
      if (!textbook) return;
      setMsg('');
      setLoadingSet(true);
      try {
        const qs = new URLSearchParams({ textbook, kinds: kinds.join(','), hard: hard ? '1' : '0' });
        const r = await fetch(`/api/practice/set?${qs}`, { credentials: 'include' });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error || '문항을 불러오지 못했습니다.');
        if (!j.questions?.length) {
          setMsg('이 회차에는 고른 유형의 연습 문항이 아직 없습니다. 다른 회차나 난도를 골라 주세요.');
          return;
        }
        setQuestions(j.questions);
        setIdx(0);
        setResults({});
        window.scrollTo({ top: 0 });
      } catch (e) {
        setMsg(e instanceof Error ? e.message : '문항을 불러오지 못했습니다.');
      } finally {
        setLoadingSet(false);
      }
    },
    [textbook, kinds, hard, questions],
  );

  const current = questions?.[idx];
  const currentResult = current ? results[current.id] : undefined;

  const answer = async (picked: string) => {
    if (!current || currentResult || checking) return;
    setChecking(true);
    try {
      const r = await fetch('/api/practice/check', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: current.id, answer: picked }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || '채점하지 못했습니다.');
      setResults((prev) => ({ ...prev, [current.id]: { picked, correct: j.correct, correctAnswer: j.correctAnswer, explanation: j.explanation } }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '채점하지 못했습니다.');
    } finally {
      setChecking(false);
    }
  };

  const finished = questions !== null && idx >= questions.length;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppBar title="학습실" />
      <div className="max-w-3xl mx-auto px-4 py-8">
        {auth === 'checking' && <p className="text-sm text-slate-500">불러오는 중…</p>}

        {auth === 'guest' && (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
            <h1 className="text-xl font-bold text-slate-900">순서·삽입 연습</h1>
            <p className="mt-2 text-sm text-slate-600">모의고사 순서·삽입 문항을 웹에서 풀고 바로 채점받는 회원 전용 학습실입니다.</p>
            <Link
              href="/login?from=/practice"
              className="inline-block mt-5 px-5 py-2.5 rounded-full bg-slate-900 text-white text-sm font-bold hover:bg-slate-700"
            >
              로그인하고 연습하기
            </Link>
          </div>
        )}

        {auth === 'member' && questions === null && (
          <>
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-slate-900">순서·삽입 연습</h1>
              <p className="mt-2 text-sm text-slate-600">
                모의고사 지문으로 만든 순서·삽입 문항을 한 문항씩 풀고 바로 정답과 해설을 확인합니다. 번호마다 한 문항씩, 풀 때마다 다른 변형이 나올 수 있어요.
              </p>
            </div>

            <section className="mb-6">
              <h2 className="text-sm font-bold text-slate-900 mb-3">1. 유형·난도</h2>
              <div className="flex flex-wrap gap-2">
                {KIND_CHOICES.map((k) => (
                  <Chip key={k.key} on={kindKey === k.key} onClick={() => setKindKey(k.key)}>{k.label}</Chip>
                ))}
                <span className="w-px bg-slate-200 mx-1" />
                <Chip on={!hard} onClick={() => setHard(false)}>기본</Chip>
                <Chip on={hard} onClick={() => setHard(true)}>고난도</Chip>
              </div>
            </section>

            <section className="mb-6">
              <h2 className="text-sm font-bold text-slate-900 mb-3">2. 회차</h2>
              <div className="flex gap-2 mb-3">
                {[1, 2, 3].map((g) => (
                  <Chip key={g} on={grade === g} onClick={() => { setGrade(g); setTextbook(''); }}>고{g}</Chip>
                ))}
              </div>
              {gradeExams.length === 0 ? (
                <p className="text-sm text-slate-500">연습할 수 있는 회차가 없습니다.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {gradeExams.map((e) => {
                    const n = countOf(e);
                    const on = textbook === e.textbook;
                    return (
                      <button
                        key={e.textbook}
                        type="button"
                        disabled={n === 0}
                        onClick={() => setTextbook(e.textbook)}
                        className={`text-left px-3 py-2.5 rounded-lg border transition disabled:opacity-40 disabled:cursor-not-allowed ${
                          on ? 'border-sky-600 bg-sky-50 ring-1 ring-sky-600' : 'border-slate-200 bg-white hover:border-slate-400'
                        }`}
                      >
                        <div className="font-semibold text-slate-900 text-sm">{e.year % 100}년 {e.month}월</div>
                        <div className="mt-0.5 text-xs text-slate-500">{n > 0 ? `${n}문항` : '문항 없음'}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {msg && <p className="mb-4 text-sm text-red-600">{msg}</p>}
            <button
              type="button"
              disabled={!textbook || loadingSet}
              onClick={() => void startSet()}
              className="w-full py-3 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loadingSet ? '문항 준비 중…' : textbook ? `${textbook} 연습 시작` : '회차를 골라 주세요'}
            </button>
          </>
        )}

        {auth === 'member' && current && (
          <QuestionView
            q={current}
            idx={idx}
            total={questions!.length}
            textbook={textbook}
            result={currentResult}
            checking={checking}
            onAnswer={answer}
            onNext={() => { setIdx((i) => i + 1); window.scrollTo({ top: 0 }); }}
            onQuit={() => setQuestions(null)}
            msg={msg}
          />
        )}

        {auth === 'member' && finished && (
          <Summary
            questions={questions!}
            results={results}
            onRetryWrong={(ids) => void startSet(ids)}
            onAgain={() => void startSet()}
            onPick={() => setQuestions(null)}
          />
        )}
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-sm border transition ${
        on ? 'border-slate-900 bg-slate-900 text-white font-semibold' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

function QuestionView({
  q, idx, total, textbook, result, checking, onAnswer, onNext, onQuit, msg,
}: {
  q: Question; idx: number; total: number; textbook: string; result?: Checked; checking: boolean;
  onAnswer: (a: string) => void; onNext: () => void; onQuit: () => void; msg: string;
}) {
  const optionState = (c: string) => {
    if (!result) return 'idle';
    if (c === result.correctAnswer) return 'correct';
    if (c === result.picked) return 'wrong';
    return 'dim';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3 text-xs text-slate-500">
        <span>{textbook}</span>
        <button type="button" onClick={onQuit} className="hover:text-slate-800">그만하기</button>
      </div>
      <div className="h-1.5 bg-slate-200 rounded-full mb-6 overflow-hidden">
        <div className="h-full bg-sky-600 transition-all" style={{ width: `${((idx + (result ? 1 : 0)) / total) * 100}%` }} />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold text-slate-500 tabular-nums">{idx + 1} / {total}</span>
          <span className="px-2 py-0.5 rounded bg-slate-900 text-white text-[11px] font-bold">{q.number}</span>
          <span className="px-2 py-0.5 rounded border border-slate-300 text-slate-700 text-[11px] font-semibold">
            {q.kind}{q.hard ? ' · 고난도' : ''}
          </span>
        </div>
        <p className="text-[15px] font-semibold text-slate-900 mb-4">{q.question}</p>

        {q.layout.kind === '순서' ? (
          <div className="space-y-3 font-serif text-[15px] leading-7 text-slate-800">
            <p className="border border-slate-300 rounded-lg px-4 py-3">{q.layout.intro}</p>
            {(['A', 'B', 'C'] as const).map((L) => (
              <p key={L}>
                <b className="font-sans text-slate-900">({L})</b> {(q.layout as Extract<Layout, { kind: '순서' }>)[L]}
              </p>
            ))}
          </div>
        ) : (
          <div className="font-serif text-[15px] leading-7 text-slate-800">
            <p className="border border-slate-300 rounded-lg px-4 py-3 mb-4">{q.layout.given}</p>
            <p>
              {q.layout.passage.split(/([①②③④⑤])/).map((part, i) =>
                CIRCLED.includes(part) ? (
                  <button
                    key={i}
                    type="button"
                    disabled={!!result || checking}
                    onClick={() => onAnswer(part)}
                    className={`mx-0.5 px-1 rounded font-sans font-bold ${markerClass(optionState(part))}`}
                  >
                    {part}
                  </button>
                ) : (
                  <Fragment key={i}>{part}</Fragment>
                ),
              )}
            </p>
          </div>
        )}

        <div className={`mt-6 grid gap-2 ${q.layout.kind === '삽입' ? 'grid-cols-5' : 'grid-cols-1'}`}>
          {CIRCLED.map((c, i) => {
            const st = optionState(c);
            return (
              <button
                key={c}
                type="button"
                disabled={!!result || checking}
                onClick={() => onAnswer(c)}
                className={`text-left px-4 py-2.5 rounded-lg border text-sm transition ${optionClass(st)}`}
              >
                <span className="font-bold mr-2">{c}</span>
                {q.layout.kind === '순서' ? q.layout.options[i] : ''}
              </button>
            );
          })}
        </div>

        {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}

        {result && (
          <div className={`mt-5 rounded-xl px-4 py-3 border ${result.correct ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
            <p className={`text-sm font-bold ${result.correct ? 'text-emerald-700' : 'text-rose-700'}`}>
              {result.correct ? '정답입니다' : `오답입니다 — 정답은 ${result.correctAnswer}`}
            </p>
            {result.explanation && <p className="mt-2 text-sm leading-6 text-slate-700 whitespace-pre-line">{result.explanation}</p>}
          </div>
        )}
      </div>

      {result && (
        <button
          type="button"
          onClick={onNext}
          className="w-full mt-4 py-3 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-700"
        >
          {idx + 1 < total ? '다음 문항' : '결과 보기'}
        </button>
      )}
    </div>
  );
}

function optionClass(st: string) {
  switch (st) {
    case 'correct': return 'border-emerald-500 bg-emerald-50 text-emerald-800';
    case 'wrong': return 'border-rose-500 bg-rose-50 text-rose-800';
    case 'dim': return 'border-slate-200 bg-white text-slate-400';
    default: return 'border-slate-300 bg-white text-slate-800 hover:border-sky-600 hover:bg-sky-50';
  }
}

function markerClass(st: string) {
  switch (st) {
    case 'correct': return 'bg-emerald-100 text-emerald-700';
    case 'wrong': return 'bg-rose-100 text-rose-700';
    case 'dim': return 'text-slate-400';
    default: return 'text-sky-700 hover:bg-sky-100';
  }
}

function Summary({
  questions, results, onRetryWrong, onAgain, onPick,
}: {
  questions: Question[]; results: Record<string, Checked>;
  onRetryWrong: (ids: string[]) => void; onAgain: () => void; onPick: () => void;
}) {
  const answered = questions.filter((q) => results[q.id]);
  const correct = answered.filter((q) => results[q.id].correct);
  const wrong = answered.filter((q) => !results[q.id].correct);
  const byKind = (k: Kind) => {
    const a = answered.filter((q) => q.kind === k);
    return a.length ? `${a.filter((q) => results[q.id].correct).length} / ${a.length}` : null;
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6">
      <h2 className="text-lg font-bold text-slate-900">연습 결과</h2>
      <p className="mt-3 text-3xl font-bold text-slate-900 tabular-nums">
        {correct.length} <span className="text-lg text-slate-400">/ {answered.length}</span>
      </p>
      <div className="mt-2 flex gap-4 text-sm text-slate-600">
        {byKind('순서') && <span>순서 {byKind('순서')}</span>}
        {byKind('삽입') && <span>삽입 {byKind('삽입')}</span>}
      </div>

      {wrong.length > 0 && (
        <div className="mt-5">
          <p className="text-sm font-semibold text-slate-900 mb-2">틀린 문항</p>
          <div className="flex flex-wrap gap-1.5">
            {wrong.map((q) => (
              <span key={q.id} className="px-2 py-1 rounded bg-rose-50 border border-rose-200 text-xs text-rose-700">
                {q.number} {q.kind}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-2 sm:grid-cols-3">
        {wrong.length > 0 && (
          <button type="button" onClick={() => onRetryWrong(wrong.map((q) => q.id))} className="py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-700">
            틀린 문항 다시 풀기
          </button>
        )}
        <button type="button" onClick={onAgain} className="py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 hover:border-slate-500">
          같은 회차 새로 풀기
        </button>
        <button type="button" onClick={onPick} className="py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 hover:border-slate-500">
          다른 회차 고르기
        </button>
      </div>
    </div>
  );
}
