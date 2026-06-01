'use client';

/**
 * 클래스키트 유형 탭 — 강의용자료 + 수업용자료 4모드를 한 줄로.
 *
 * - 강의용자료(lecture): 항상 라우트 이동(Link, /admin/class-kit/lecture)
 * - 수업용 모드(영한대조/한줄해석/영작하기/해석쓰기):
 *     · onSelectLessonMode 가 있으면(= 수업용 페이지 안) 버튼으로 즉시 전환
 *     · 없으면(= 강의용 페이지) 해당 라우트로 이동(Link)
 */

import Link from 'next/link';
import type { LessonMode } from '@/lib/lesson-material-html';

export type ClassKitTabKey = 'lecture' | LessonMode;

const TABS: { key: ClassKitTabKey; label: string; href: string }[] = [
  { key: 'lecture', label: '강의용자료', href: '/admin/class-kit/lecture' },
  { key: 'parallel', label: '수업용자료', href: '/admin/class-kit/lesson' },
  { key: 'lineByLine', label: '한줄해석', href: '/admin/class-kit/lesson/line' },
  { key: 'writeEn', label: '영작하기', href: '/admin/class-kit/lesson/write-en' },
  { key: 'writeKo', label: '해석쓰기', href: '/admin/class-kit/lesson/write-ko' },
];

export default function ClassKitTabs({
  current,
  onSelectLessonMode,
}: {
  current: ClassKitTabKey;
  onSelectLessonMode?: (m: LessonMode) => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-slate-800/70 border border-slate-700 rounded-lg p-0.5 w-fit">
      {TABS.map(t => {
        const active = t.key === current;
        const cls = `px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
          active ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-700/60'
        }`;
        // 수업용 모드 탭 + 콜백 → 즉시 전환(버튼), 그 외 → 라우트 이동(Link)
        if (t.key !== 'lecture' && onSelectLessonMode) {
          return (
            <button key={t.key} type="button" onClick={() => onSelectLessonMode(t.key as LessonMode)} className={cls}>
              {t.label}
            </button>
          );
        }
        return (
          <Link key={t.key} href={t.href} className={cls}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
