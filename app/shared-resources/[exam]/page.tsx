import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getExamDetail, listExamSlugs, formatFileSize, getCategoryMeta } from '@/lib/shared-resources';
import SharedResourcesHeader from '../_components/SharedResourcesHeader';
import { CategoryIcon, DocumentStackIcon, DownloadIcon, LockOpenIcon } from '../_components/Icons';
import ExamCategoryAccordion from './_components/ExamCategoryAccordion';

export const dynamic = 'force-static';
export const revalidate = 60;

export async function generateStaticParams() {
  return listExamSlugs().map((slug) => ({ exam: slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ exam: string }> }) {
  const { exam } = await params;
  const decoded = decodeURIComponent(exam);
  const detail = getExamDetail(decoded);
  if (!detail) return { title: '공유자료 | 고미죠수아' };
  return {
    title: `${detail.meta.label} 공유자료 | 고미죠수아`,
    description: `${detail.meta.label} 학습 자료를 HWP·PDF 로 무료 다운로드`,
  };
}

export default async function ExamSharedResourcesPage({ params }: { params: Promise<{ exam: string }> }) {
  const { exam } = await params;
  const decoded = decodeURIComponent(exam);
  const detail = getExamDetail(decoded);
  if (!detail) notFound();

  const { meta, groups } = detail;

  const zipAllHref = `/api/shared-resources/zip?exam=${encodeURIComponent(meta.slug)}`;

  return (
    <>
      <SharedResourcesHeader title={meta.shortLabel ?? meta.label} backTo="/shared-resources" />
      <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
        <div className="container mx-auto px-4 py-6 sm:py-10 max-w-5xl">
          {/* 헤더 */}
          <div className="mb-6">
            <Link
              href="/shared-resources"
              className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              ← 공유자료 목록
            </Link>
            <div className="mt-2 flex items-start gap-3 sm:gap-4">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                <DocumentStackIcon className="w-7 h-7 sm:w-8 sm:h-8" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 leading-tight break-keep">
                  {meta.label}
                </h1>
                {meta.subtitle && (
                  <p className="mt-1 text-sm text-slate-500">{meta.subtitle}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  <span>카테고리 {meta.stats.categoryCount}</span>
                  <span className="text-slate-300">·</span>
                  <span>파일 {meta.stats.totalFiles.toLocaleString()}개</span>
                  {formatFileSize(meta.stats.totalBytes) && (
                    <>
                      <span className="text-slate-300">·</span>
                      <span>{formatFileSize(meta.stats.totalBytes)}</span>
                    </>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 font-medium text-[10px]">
                    <LockOpenIcon className="w-3 h-3" />
                    회원가입 불필요
                  </span>
                </div>
              </div>
            </div>

            {/* 회차 전체 ZIP 다운로드 + 변형문제 만들기 CTA */}
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={zipAllHref}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm transition-colors"
              >
                <DownloadIcon className="w-4 h-4" />
                회차 전체 ZIP 다운로드
                {formatFileSize(meta.stats.totalBytes) && (
                  <span className="text-xs font-normal opacity-80">({formatFileSize(meta.stats.totalBytes)})</span>
                )}
              </a>
              <Link
                href="/my/premium/variant-generate"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold shadow-sm transition-colors"
                title="이 회차 지문으로 변형문제 만들기"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3l1.8 4.4L18 9l-4.2 1.6L12 15l-1.8-4.4L6 9l4.2-1.6L12 3z" />
                  <path d="M19 14l.8 1.8L22 17l-2.2.8L19 20l-.8-1.8L16 17l2.2-1.2L19 14z" />
                </svg>
                변형문제 만들러 가기
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white/20">Premium</span>
              </Link>
            </div>
          </div>

          {/* 카테고리 목록 (anchor nav) */}
          <nav className="mb-6 -mx-4 px-4 overflow-x-auto">
            <ul className="flex gap-2 min-w-min py-1">
              {groups.map((g) => {
                const m = getCategoryMeta(g.category);
                return (
                  <li key={g.category}>
                    <a
                      href={`#cat-${encodeURIComponent(g.category)}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:border-emerald-400 hover:text-emerald-700 transition-colors whitespace-nowrap"
                    >
                      <CategoryIcon name={m.icon} className="w-4 h-4 text-slate-500" />
                      {g.category.replace(/_/g, ' ')}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* 카테고리별 섹션 */}
          <div className="space-y-4">
            {groups.map((g) => (
              <ExamCategoryAccordion key={g.category} examSlug={meta.slug} group={g} />
            ))}
          </div>

          <footer className="mt-12 text-center text-xs text-slate-500">
            자료에 문제가 있으면 학원으로 문의해주세요.
          </footer>
        </div>
      </main>
    </>
  );
}
