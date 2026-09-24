'use client';

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AppBar from '@/app/components/AppBar';
import { fetchAuthMe } from '@/lib/auth-me-cache';
import { MEMBERSHIP_APPLY_OPEN_EVENT } from '@/lib/membership-apply-event';

/**
 * 학습실 — 모의고사 지문으로 순서·삽입 문항을 **그때그때 새로 만들어** 푼다(무한 연습). 판매 문항은 쓰지 않는다.
 * 풀기·채점은 비회원도 된다(가입 유도). 해설(원래 글 흐름)·기록·오답 분석·복습은 회원만 — 기록은 내정보 「학습실 기록」.
 *   /practice?review=wrong  — 마지막에 틀린 문항 다시 풀기
 *   /practice?retry=<id>    — 한 문항만 다시
 */

type Kind = '순서' | '삽입';
type Layout =
  | { kind: '순서'; intro: string; A: string; B: string; C: string; options: string[] }
  | { kind: '삽입'; given: string; passage: string };
type Question = { id: string; kind: Kind; number: string; textbook: string; question: string; layout: Layout };
type Exam = { textbook: string; year: number; month: number; grade: number; passages: number };
type Reveal = { kind: '순서'; ordered: string[]; order: string } | { kind: '삽입'; before: string; given: string; after: string };
type Checked = { picked: string; correct: boolean; correctAnswer: string; reveal: Reveal | null };

const CIRCLED = ['①', '②', '③', '④', '⑤'];
const KIND_CHOICES: { key: string; label: string; kinds: Kind[] }[] = [
  { key: 'both', label: '순서 + 삽입', kinds: ['순서', '삽입'] },
  { key: 'order', label: '순서만', kinds: ['순서'] },
  { key: 'insert', label: '삽입만', kinds: ['삽입'] },
];
const COUNT_CHOICES = [10, 20, 30];
const ALL = '__all__';

/** 비회원 → 가입 신청 모달(AppBar 가 이 이벤트를 듣는다) */
const openApply = () => window.dispatchEvent(new Event(MEMBERSHIP_APPLY_OPEN_EVENT));

export default function PracticePage() {
  return (
    <Suspense fallback={null}>
      <PracticeInner />
    </Suspense>
  );
}

function PracticeInner() {
  const sp = useSearchParams();
  const [auth, setAuth] = useState<'checking' | 'member' | 'guest'>('checking');
  const [exams, setExams] = useState<Exam[]>([]);
  const [grade, setGrade] = useState(1);
  const [textbook, setTextbook] = useState(ALL);
  const [kindKey, setKindKey] = useState('both');
  const [count, setCount] = useState(10);
  const [msg, setMsg] = useState('');

  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [mode, setMode] = useState<'new' | 'review'>('new');
  const [idx, setIdx] = useState(0);
  const [results, setResults] = useState<Record<string, Checked>>({});
  const [checking, setChecking] = useState(false);
  const [loadingSet, setLoadingSet] = useState(false);

  const loadSet = useCallback(async (qs: string, nextMode: 'new' | 'review') => {
    setMsg('');
    setLoadingSet(true);
    try {
      const r = await fetch(`/api/practice/set?${qs}`, { credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || '문항을 만들지 못했습니다.');
      if (!j.questions?.length) {
        setMsg(nextMode === 'review' ? '다시 풀 오답이 없습니다. 잘하고 있어요!' : '고른 범위에서 문항을 만들지 못했습니다. 다른 회차를 골라 주세요.');
        return;
      }
      setQuestions(j.questions);
      setMode(nextMode);
      setIdx(0);
      setResults({});
      window.scrollTo({ top: 0 });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '문항을 만들지 못했습니다.');
    } finally {
      setLoadingSet(false);
    }
  }, []);

  useEffect(() => {
    fetchAuthMe()
      .then((d) => {
        fetch('/api/practice/exams', { credentials: 'include' })
          .then((r) => r.json())
          .then((j) => setExams(Array.isArray(j?.exams) ? j.exams : []));
        const role = d?.user?.role;
        if (!d?.user || role === 'student') {
          setAuth('guest');
          return;
        }
        setAuth('member');
        /* 내정보에서 넘어온 복습 링크(회원만) */
        const retry = sp.get('retry');
        if (retry) void loadSet(`retry=${encodeURIComponent(retry)}`, 'review');
        else if (sp.get('review') === 'wrong') void loadSet('review=wrong&count=20', 'review');
      })
      .catch(() => {
        setAuth('guest');
        fetch('/api/practice/exams').then((r) => r.json()).then((j) => setExams(Array.isArray(j?.exams) ? j.exams : [])).catch(() => {});
      });
  }, [sp, loadSet]);

  const gradeExams = useMemo(() => exams.filter((e) => e.grade === grade), [exams, grade]);
  const kinds = KIND_CHOICES.find((k) => k.key === kindKey)!.kinds;

  const startNew = useCallback(() => {
    const q = new URLSearchParams({ kinds: kinds.join(','), count: String(count) });
    if (textbook === ALL) q.set('grade', String(grade));
    else q.set('textbook', textbook);
    void loadSet(q.toString(), 'new');
  }, [kinds, count, textbook, grade, loadSet]);

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
      setResults((prev) => ({ ...prev, [current.id]: { picked, correct: j.correct, correctAnswer: j.correctAnswer, reveal: j.reveal ?? null } }));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '채점하지 못했습니다.');
    } finally {
      setChecking(false);
    }
  };

  const finished = questions !== null && idx >= questions.length;
  const scopeLabel = mode === 'review' ? '오답 복습' : textbook === ALL ? `고${grade} 전체 회차` : textbook;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppBar title="학습실" />
      <div className="max-w-3xl mx-auto px-4 py-8">
        {auth === 'checking' && <p className="text-sm text-slate-500">불러오는 중…</p>}

        {auth !== 'checking' && questions === null && (
          <>
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">순서·삽입 연습</h1>
                <p className="mt-2 text-sm text-slate-600">
                  모의고사 지문으로 문항을 그때그때 새로 만들어요. 풀 때마다 자르는 자리·보기가 달라져 끝없이 연습할 수 있습니다. 키보드 1~5 로 답하고 Enter 로 넘어가요.
                </p>
              </div>
              {auth === 'member' && (
                <Link href="/my?tab=practice" className="shrink-0 px-3 py-1.5 rounded-full border border-slate-300 text-xs font-semibold text-slate-700 hover:border-slate-500">
                  내 기록 →
                </Link>
              )}
            </div>

            {auth === 'guest' && <GuestBand />}

            <section className="mb-6">
              <h2 className="text-sm font-bold text-slate-900 mb-3">1. 유형·문항 수</h2>
              <div className="flex flex-wrap gap-2">
                {KIND_CHOICES.map((k) => (
                  <Chip key={k.key} on={kindKey === k.key} onClick={() => setKindKey(k.key)}>{k.label}</Chip>
                ))}
                <span className="w-px bg-slate-200 mx-1" />
                {COUNT_CHOICES.map((c) => (
                  <Chip key={c} on={count === c} onClick={() => setCount(c)}>{c}문항</Chip>
                ))}
              </div>
            </section>

            <section className="mb-6">
              <h2 className="text-sm font-bold text-slate-900 mb-3">2. 범위</h2>
              <div className="flex gap-2 mb-3">
                {[1, 2, 3].map((g) => (
                  <Chip key={g} on={grade === g} onClick={() => { setGrade(g); setTextbook(ALL); }}>고{g}</Chip>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <ExamButton on={textbook === ALL} onClick={() => setTextbook(ALL)} title={`고${grade} 전체 섞기`} sub="모든 회차에서 무작위" />
                {gradeExams.map((e) => (
                  <ExamButton key={e.textbook} on={textbook === e.textbook} onClick={() => setTextbook(e.textbook)} title={`${e.year % 100}년 ${e.month}월`} sub={`지문 ${e.passages}개`} />
                ))}
              </div>
            </section>

            {msg && <p className="mb-4 text-sm text-red-600">{msg}</p>}
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <button
                type="button"
                disabled={loadingSet}
                onClick={startNew}
                className="w-full py-3 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-700 disabled:opacity-40"
              >
                {loadingSet ? '문항 만드는 중…' : `${textbook === ALL ? `고${grade} 전체` : textbook} · ${count}문항 시작`}
              </button>
              {auth === 'member' && (
                <button
                  type="button"
                  disabled={loadingSet}
                  onClick={() => void loadSet('review=wrong&count=20', 'review')}
                  className="px-4 py-3 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 hover:border-slate-500 disabled:opacity-40"
                >
                  오답 다시 풀기
                </button>
              )}
            </div>
          </>
        )}

        {auth !== 'checking' && current && (
          <QuestionView
            q={current}
            idx={idx}
            total={questions!.length}
            scope={scopeLabel}
            result={currentResult}
            checking={checking}
            onAnswer={answer}
            onNext={() => { setIdx((i) => i + 1); window.scrollTo({ top: 0 }); }}
            onQuit={() => { setQuestions(null); setMsg(''); }}
            msg={msg}
            member={auth === 'member'}
          />
        )}

        {auth !== 'checking' && finished && (
          <Summary
            questions={questions!}
            results={results}
            mode={mode}
            onRetryWrong={(ids) => { setQuestions(questions!.filter((q) => ids.includes(q.id))); setIdx(0); setResults({}); }}
            onAgain={mode === 'review' ? () => void loadSet('review=wrong&count=20', 'review') : startNew}
            onPick={() => setQuestions(null)}
            member={auth === 'member'}
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

function ExamButton({ on, onClick, title, sub }: { on: boolean; onClick: () => void; title: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left px-3 py-2.5 rounded-lg border transition ${on ? 'border-sky-600 bg-sky-50 ring-1 ring-sky-600' : 'border-slate-200 bg-white hover:border-slate-400'}`}
    >
      <div className="font-semibold text-slate-900 text-sm">{title}</div>
      <div className="mt-0.5 text-xs text-slate-500">{sub}</div>
    </button>
  );
}

function QuestionView({
  q, idx, total, scope, result, checking, onAnswer, onNext, onQuit, msg, member,
}: {
  q: Question; idx: number; total: number; scope: string; result?: Checked; checking: boolean;
  onAnswer: (a: string) => void; onNext: () => void; onQuit: () => void; msg: string; member: boolean;
}) {
  const resultRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [result]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      /* 버튼·링크에 포커스가 있으면 그 요소가 Enter 를 처리한다 — 같이 넘기면 한 문항을 건너뛴다 */
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if (!result && !checking && /^[1-5]$/.test(e.key)) {
        onAnswer(CIRCLED[Number(e.key) - 1]);
        return;
      }
      if (result && e.key === 'Enter') {
        const focused = el?.closest?.('button, a') as HTMLButtonElement | null;
        if (focused && !focused.disabled) return;
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, checking, onAnswer, onNext]);

  const optionState = (c: string) => {
    if (!result) return 'idle';
    if (c === result.correctAnswer) return 'correct';
    if (c === result.picked) return 'wrong';
    return 'dim';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3 text-xs text-slate-500">
        <span>{scope}</span>
        <button type="button" onClick={onQuit} className="hover:text-slate-800">그만하기</button>
      </div>
      <div className="h-1.5 bg-slate-200 rounded-full mb-6 overflow-hidden">
        <div className="h-full bg-sky-600 transition-all" style={{ width: `${((idx + (result ? 1 : 0)) / total) * 100}%` }} />
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <span className="text-xs font-bold text-slate-500 tabular-nums">{idx + 1} / {total}</span>
          <span className="px-2 py-0.5 rounded bg-slate-900 text-white text-[11px] font-bold">{q.number}</span>
          <span className="px-2 py-0.5 rounded border border-slate-300 text-slate-700 text-[11px] font-semibold">{q.kind}</span>
          <span className="text-[11px] text-slate-400">{q.textbook}</span>
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
                    className={`px-0.5 rounded font-sans font-bold ${markerClass(optionState(part))}`}
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
          {CIRCLED.map((c, i) => (
            <button
              key={c}
              type="button"
              disabled={!!result || checking}
              onClick={() => onAnswer(c)}
              className={`${q.layout.kind === '삽입' ? 'text-center' : 'text-left'} px-4 py-2.5 rounded-lg border text-sm transition ${optionClass(optionState(c))}`}
            >
              <span className={`font-bold ${q.layout.kind === '순서' ? 'mr-2' : ''}`}>{c}</span>
              {q.layout.kind === '순서' ? q.layout.options[i] : ''}
            </button>
          ))}
        </div>

        {msg && <p className="mt-3 text-sm text-red-600">{msg}</p>}

        {result && (
          <div ref={resultRef} className={`mt-5 rounded-xl px-4 py-3 border scroll-mb-24 ${result.correct ? 'border-emerald-300 bg-emerald-50' : 'border-rose-300 bg-rose-50'}`}>
            <p className={`text-sm font-bold ${result.correct ? 'text-emerald-700' : 'text-rose-700'}`}>
              {result.correct ? '정답입니다' : `오답입니다 — 정답은 ${result.correctAnswer}`}
              {result.reveal?.kind === '순서' && <span className="ml-2 font-semibold text-slate-600">{result.reveal.order}</span>}
            </p>
            {!result.reveal ? (
              /* 비회원 — 해설(원래 글 흐름)은 회원 혜택으로 잠근다 */
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2">
                <p className="text-xs text-slate-600">🔒 원래 글의 흐름(해설)과 오답 분석은 <b>회원</b>에게 보여요</p>
                {!member && (
                  <button type="button" onClick={openApply} className="rounded-full bg-sky-600 px-3 py-1 text-xs font-bold text-white hover:bg-sky-700">
                    가입 신청
                  </button>
                )}
              </div>
            ) : (
            <div className="mt-2 font-serif text-sm leading-6 text-slate-700">
              <p className="mb-1 font-sans text-[11px] font-bold text-slate-500">원래 글의 흐름</p>
              {result.reveal.kind === '순서' ? (
                result.reveal.ordered.map((t, i) => <p key={i} className={i ? 'mt-1' : ''}>{t}</p>)
              ) : (
                <p>
                  {result.reveal.before}{' '}
                  <mark className="bg-sky-100 text-slate-900 px-0.5 rounded">{result.reveal.given}</mark>{' '}
                  {result.reveal.after}
                </p>
              )}
            </div>
            )}
          </div>
        )}
      </div>

      {result && (
        <button type="button" onClick={onNext} className="w-full mt-4 py-3 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-700">
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
  questions, results, mode, onRetryWrong, onAgain, onPick, member,
}: {
  questions: Question[]; results: Record<string, Checked>; mode: 'new' | 'review';
  onRetryWrong: (ids: string[]) => void; onAgain: () => void; onPick: () => void; member: boolean;
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
      <h2 className="text-lg font-bold text-slate-900">{mode === 'review' ? '오답 복습 결과' : '연습 결과'}</h2>
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
              <span key={q.id} className="px-2 py-1 rounded bg-rose-50 border border-rose-200 text-xs text-rose-700">{q.number} {q.kind}</span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={onAgain} className="py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-700">
          {mode === 'review' ? '남은 오답 다시' : '같은 설정으로 새로 풀기'}
        </button>
        {wrong.length > 0 && (
          <button type="button" onClick={() => onRetryWrong(wrong.map((q) => q.id))} className="py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 hover:border-slate-500">
            방금 틀린 문항 다시 풀기
          </button>
        )}
        <button type="button" onClick={onPick} className="py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-800 hover:border-slate-500">
          범위 다시 고르기
        </button>
        {member ? (
          <Link href="/my?tab=practice" className="py-2.5 rounded-xl border border-slate-300 text-center text-sm font-semibold text-slate-800 hover:border-slate-500">
            내 기록 보기
          </Link>
        ) : null}
      </div>
      {!member && (
        <div className="mt-5 rounded-xl bg-slate-900 px-4 py-4 text-white">
          <p className="text-sm font-bold">회원이 되면 이렇게 달라져요</p>
          <p className="mt-1 text-xs text-slate-300">문항마다 원래 글의 흐름(해설) · 유형·번호별 오답 분석 · 틀린 문항만 다시 풀기</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={openApply} className="rounded-full bg-sky-500 px-4 py-1.5 text-xs font-bold text-white hover:bg-sky-600">가입 신청</button>
            <Link href="/login?from=/practice" className="rounded-full border border-slate-500 px-4 py-1.5 text-xs font-semibold text-slate-200 hover:border-slate-300">로그인</Link>
          </div>
        </div>
      )}
    </div>
  );
}

/** 비회원 안내 띠 — 풀기는 무료, 해설·분석은 회원 */
function GuestBand() {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-sm text-slate-700">
        <b>비회원도 무제한으로 풀 수 있어요.</b>{' '}
        <span className="text-slate-500">해설(원래 글 흐름)·오답 분석·복습은 회원 전용</span>
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={openApply} className="rounded-full bg-sky-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-sky-700">가입 신청</button>
        <Link href="/login?from=/practice" className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-slate-500">로그인</Link>
      </div>
    </div>
  );
}
