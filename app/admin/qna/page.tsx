'use client';

/**
 * /admin/qna — Q&A 분석지 트리아지 페이지.
 *
 * - 답변 폼은 두지 않는다. 카드의 [지문에서 답변하기 →] 버튼 = /qna/[passageId]#thread-<id> 딥링크.
 * - 인라인은 숨김/삭제만.
 * - 최근 50건 · 필터: open / answered / hidden / all.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Status = 'open' | 'answered' | 'hidden' | 'all';

interface ThreadAnswer {
  body: string;
  author: { name: string; role: 'admin'; userId: string };
  createdAt: string;
}

interface AdminThread {
  id: string;
  passageId: string;
  textbook: string;
  sentenceIndex: number;
  asker: { nickname: string; role: 'guest' | 'admin' };
  question: string;
  selectedText?: string;
  status: Exclude<Status, 'all'>;
  answers: ThreadAnswer[];
  createdAt: string;
  sourceKey: string | null;
}

const STATUS_OPTIONS: Array<{ value: Status; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'open', label: '대기 (미답변)' },
  { value: 'answered', label: '답변 완료' },
  { value: 'hidden', label: '숨김' },
];

export default function AdminQnaPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('open');
  const [threads, setThreads] = useState<AdminThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // 권한 게이트 — admin 전용
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => {
        if (j?.user?.role !== 'admin') {
          router.push('/login');
          return;
        }
        setAuthChecked(true);
      })
      .catch(() => router.push('/login'));
  }, [router]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/qna/admin/recent?status=${status}&limit=50`, {
        cache: 'no-store',
        credentials: 'include',
      });
      const j = await res.json();
      if (!res.ok || j.error) throw new Error(j.error || 'load failed');
      setThreads(Array.isArray(j.threads) ? j.threads : []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    if (authChecked) void reload();
  }, [reload, authChecked]);

  const handleHide = useCallback(
    async (t: AdminThread) => {
      if (!confirm('이 질문을 숨김 처리할까요?')) return;
      setBusyId(t.id);
      try {
        const res = await fetch(`/api/qna/threads/${t.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status: 'hidden' }),
        });
        if (!res.ok) {
          alert('숨김 실패');
          return;
        }
        void reload();
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  const handleUnhide = useCallback(
    async (t: AdminThread) => {
      setBusyId(t.id);
      try {
        const nextStatus = t.answers.length > 0 ? 'answered' : 'open';
        const res = await fetch(`/api/qna/threads/${t.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status: nextStatus }),
        });
        if (!res.ok) {
          alert('복원 실패');
          return;
        }
        void reload();
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  const handleDelete = useCallback(
    async (t: AdminThread) => {
      if (!confirm('이 질문을 영구 삭제할까요? 답변도 함께 사라집니다.')) return;
      setBusyId(t.id);
      try {
        const res = await fetch(`/api/qna/threads/${t.id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!res.ok) {
          alert('삭제 실패');
          return;
        }
        void reload();
      } finally {
        setBusyId(null);
      }
    },
    [reload],
  );

  if (!authChecked) {
    return <div className="p-8 text-slate-500">권한 확인 중…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 py-6">
      <div className="container mx-auto max-w-5xl px-4">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-slate-900">Q&amp;A 분석지 모더레이션</h1>
          <p className="mt-1 text-sm text-slate-500">
            답변은 「지문에서 답변하기」 로 들어가서 작성하세요. 여기서는 숨김/삭제만 처리합니다.
          </p>
        </header>

        <div className="mb-4 flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStatus(opt.value)}
              className={
                'rounded-full px-3 py-1.5 text-xs font-medium transition ' +
                (status === opt.value
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100')
              }
            >
              {opt.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-200" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-rose-600">불러오기 실패: {error}</p>
        ) : threads.length === 0 ? (
          <p className="text-sm text-slate-500">표시할 질문이 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {threads.map((t) => {
              const sentenceLabel = t.sentenceIndex < 0 ? '지문 전체' : `${t.sentenceIndex + 1}번 문장`;
              const deepLink = `/qna/${t.passageId}#thread-${t.id}`;
              const lastAnswer = t.answers[t.answers.length - 1];
              return (
                <li
                  key={t.id}
                  className={
                    'rounded-xl bg-white p-4 shadow-sm ring-1 transition ' +
                    (t.status === 'hidden'
                      ? 'ring-slate-300 opacity-60'
                      : t.status === 'open'
                        ? 'ring-amber-200'
                        : 'ring-emerald-100')
                  }
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-xs text-slate-500">
                      <span className="font-semibold text-slate-700">{t.asker.nickname}</span>
                      <span className="mx-1">·</span>
                      <span>{t.textbook}</span>
                      {t.sourceKey && <span className="mx-1">·</span>}
                      {t.sourceKey && <span className="font-mono">{t.sourceKey}</span>}
                      <span className="mx-1">·</span>
                      <span>{sentenceLabel}</span>
                      <span className="mx-1">·</span>
                      <time>{new Date(t.createdAt).toLocaleString('ko-KR')}</time>
                    </div>
                    <StatusBadge status={t.status} answersCount={t.answers.length} />
                  </div>

                  {t.selectedText && (
                    <div className="mt-2 inline-block rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      “{t.selectedText}”
                    </div>
                  )}
                  <p className="mt-2 whitespace-pre-wrap text-sm text-slate-900">{t.question}</p>

                  {lastAnswer && (
                    <div className="mt-2 rounded bg-emerald-50/60 px-3 py-2 text-xs text-emerald-900">
                      <span className="font-semibold">{lastAnswer.author.name}</span>{' '}
                      <span className="text-emerald-700/70">답변 ({t.answers.length}건)</span>:{' '}
                      <span className="whitespace-pre-wrap">
                        {lastAnswer.body.length > 200 ? lastAnswer.body.slice(0, 200) + '…' : lastAnswer.body}
                      </span>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link
                      href={deepLink}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      지문에서 답변하기 →
                    </Link>
                    {t.status === 'hidden' ? (
                      <button
                        type="button"
                        onClick={() => handleUnhide(t)}
                        disabled={busyId === t.id}
                        className="rounded-md bg-white px-3 py-1.5 text-xs text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed"
                      >
                        복원
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleHide(t)}
                        disabled={busyId === t.id}
                        className="rounded-md bg-white px-3 py-1.5 text-xs text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed"
                      >
                        숨김
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(t)}
                      disabled={busyId === t.id}
                      className="rounded-md bg-white px-3 py-1.5 text-xs text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50 disabled:cursor-not-allowed"
                    >
                      삭제
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, answersCount }: { status: 'open' | 'answered' | 'hidden'; answersCount: number }) {
  if (status === 'hidden') {
    return <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">숨김</span>;
  }
  if (status === 'answered') {
    return (
      <span className="rounded bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        답변 {answersCount}건
      </span>
    );
  }
  return <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">대기</span>;
}
