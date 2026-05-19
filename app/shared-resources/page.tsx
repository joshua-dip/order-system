import { listSharedResources } from '@/lib/shared-resources';
import SharedResourcesHeader from './_components/SharedResourcesHeader';
import { DocumentStackIcon, LockOpenIcon } from './_components/Icons';

export const metadata = {
  title: '공유자료 | 고미죠수아',
  description: '학원에서 공유하는 학습 자료를 무료로 다운로드할 수 있습니다.',
};

/* DB 에서 매 요청 시 최신 목록을 보여준다. 항목이 바뀐 직후 새로고침으로 즉시 반영. */
export const dynamic = 'force-dynamic';

export default async function SharedResourcesIndexPage() {
  const items = await listSharedResources();

  return (
    <>
      <SharedResourcesHeader />
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="container mx-auto px-4 py-8 sm:py-12 max-w-5xl">
          <header className="mb-8">
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 font-medium">
                <LockOpenIcon className="w-3 h-3" />
                회원가입 없이 누구나 다운로드
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">공유자료</h1>
            <p className="mt-2 text-sm sm:text-base text-slate-600 leading-relaxed">
              영어 모의고사·교재 학습용 자료입니다. 카드를 클릭하면 자료가 정리된 블로그 글이 새 탭으로 열립니다.
            </p>
          </header>

          {items.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2">
              {items.map((it) => (
                <li key={it._id}>
                  <a
                    href={it.blogUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-2xl border border-slate-200 bg-white p-5 hover:border-emerald-400 hover:shadow-md transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                        <DocumentStackIcon className="w-6 h-6" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-slate-900 leading-tight break-keep">
                          {it.title}
                        </h3>
                        {it.subtitle && (
                          <p className="mt-0.5 text-xs text-slate-500">{it.subtitle}</p>
                        )}
                        <p className="mt-3 text-[11px] text-emerald-700">
                          블로그로 이동하여 다운로드 →
                        </p>
                      </div>
                      <svg className="w-5 h-5 text-slate-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                      </svg>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <div className="inline-flex w-14 h-14 items-center justify-center rounded-full bg-slate-100 mb-3">
        <svg className="w-7 h-7 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h6l5 5v11a2 2 0 01-2 2z" />
        </svg>
      </div>
      <p className="text-slate-700 font-semibold">자료를 준비 중입니다.</p>
      <p className="text-slate-500 text-sm mt-1">곧 학습·안내 자료가 업로드될 예정이에요.</p>
    </div>
  );
}
