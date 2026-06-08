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

const TAB_DEFS: { key: ClassKitTabKey; label: string; path: string }[] = [
  { key: 'lecture', label: '강의용자료', path: '/lecture' },
  { key: 'parallel', label: '수업용자료', path: '/lesson' },
  { key: 'lineByLine', label: '한줄해석', path: '/lesson/line' },
  { key: 'writeEn', label: '영작하기', path: '/lesson/write-en' },
  { key: 'writeKo', label: '해석쓰기', path: '/lesson/write-ko' },
];

export default function ClassKitTabs({
  current,
  onSelectLessonMode,
  routeBase = '/admin/class-kit',
}: {
  current: ClassKitTabKey;
  onSelectLessonMode?: (m: LessonMode) => void;
  /** 사용자용 `/class-kit`, 관리자용 `/admin/class-kit` */
  routeBase?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {TAB_DEFS.map((t) => {
        const active = t.key === current;
        const cls = `relative rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
          active
            ? 'bg-emerald-600/15 text-emerald-300 ring-1 ring-emerald-500/40'
            : 'text-zinc-500 hover:bg-zinc-800/80 hover:text-zinc-200'
        }`;
        const href = `${routeBase}${t.path}`;
        if (t.key !== 'lecture' && onSelectLessonMode) {
          return (
            <button key={t.key} type="button" onClick={() => onSelectLessonMode(t.key as LessonMode)} className={cls}>
              {t.label}
            </button>
          );
        }
        return (
          <Link key={t.key} href={href} className={cls}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
