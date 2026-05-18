'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import SharedResourcesHeader from './_components/SharedResourcesHeader';

export default function SharedResourcesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[shared-resources error]', error);
  }, [error]);

  return (
    <>
      <SharedResourcesHeader title="공유자료" backTo="/shared-resources" />
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="container mx-auto px-4 py-16 max-w-xl text-center">
          <div className="inline-flex w-16 h-16 items-center justify-center rounded-full bg-rose-50 mb-4">
            <svg className="w-8 h-8 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">자료를 불러오지 못했어요</h1>
          <p className="mt-2 text-sm text-slate-600">
            잠시 후 다시 시도해 주세요. 문제가 계속되면 학원으로 문의해 주세요.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors"
            >
              다시 시도
            </button>
            <Link
              href="/shared-resources"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-bold transition-colors"
            >
              목록으로
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
