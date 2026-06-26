'use client';

/**
 * 루트 에러 바운더리 — 어떤 페이지든 렌더 중 예외가 나면 이 화면이 대신 뜬다.
 * (전엔 Next 기본 "Application error: a client-side exception..." 문구가 그대로 노출됐다.)
 * 하이드레이션 오류 등 일시적 예외는 "다시 시도(reset)" 또는 "새로고침"으로 대부분 복구된다.
 */

import { useEffect } from 'react';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 프로덕션 콘솔에서도 원인을 볼 수 있게 남김
    console.error('[app error]', error, error?.digest ? `digest=${error.digest}` : '');
  }, [error]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-rose-50">
          <svg className="h-8 w-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-slate-900">일시적인 오류가 발생했어요</h1>
        <p className="mt-2 text-sm text-slate-600">
          잠시 후 다시 시도해 주세요. 문제가 계속되면 새로고침하거나 학원으로 문의해 주세요.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-indigo-700"
          >
            다시 시도
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          >
            새로고침
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50"
          >
            홈으로
          </a>
        </div>
        {error?.digest && (
          <p className="mt-4 text-[11px] text-slate-400">오류 코드: {error.digest}</p>
        )}
      </div>
    </main>
  );
}
