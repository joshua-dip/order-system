import Link from 'next/link';
import SharedResourcesHeader from './_components/SharedResourcesHeader';

export const metadata = {
  title: '회차를 찾을 수 없음 | 공유자료',
};

export default function SharedResourcesNotFound() {
  return (
    <>
      <SharedResourcesHeader title="공유자료" backTo="/shared-resources" />
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="container mx-auto px-4 py-16 max-w-xl text-center">
          <div className="inline-flex w-16 h-16 items-center justify-center rounded-full bg-slate-100 mb-4">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">회차를 찾을 수 없습니다</h1>
          <p className="mt-2 text-sm text-slate-600">
            요청하신 자료 회차가 존재하지 않거나 삭제되었어요.
          </p>
          <Link
            href="/shared-resources"
            className="mt-6 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors"
          >
            공유자료 목록으로
          </Link>
        </div>
      </main>
    </>
  );
}
