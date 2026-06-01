'use client';

/**
 * 펼치기/접기 가능한 사이드바 메뉴 그룹 (공통).
 *
 * 대시보드(`/admin/page.tsx`) 와 하위 페이지(`AdminSidebar`) 양쪽에서 같은 컴포넌트를 써서
 * 메뉴 위치·동작 통일감을 보장한다.
 *
 *  - 헤더 = `header.href` 로 이동하는 Link
 *  - 오른쪽 chevron 버튼 = 하위 메뉴 펼침/접힘 토글
 *  - 현재 경로가 `autoExpandPrefix` 로 시작하면 자동 펼침
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export interface NavChild {
  href: string;
  label: string;
  /** 활성 판정용 경로 prefix (query string 메뉴는 pathname 만으론 구분 못하므로 명시). 없으면 href 로 판정. */
  activePrefix?: string;
  /** true 면 정확히 일치할 때만 활성 (베이스 경로와 같은 href 가 sub-route 까지 활성화되는 것 방지). */
  exact?: boolean;
}

interface CollapsibleNavGroupProps {
  header: { href: string; label: string };
  children: NavChild[];
  /** 이 prefix 로 시작하는 경로면 자동 펼침 + 헤더 하이라이트. */
  autoExpandPrefix: string;
  /** 자동 펼침에서 제외할 하위 경로들 (예: review-logs 처럼 별도 메뉴인 경우). */
  excludePrefixes?: string[];
}

export default function CollapsibleNavGroup({
  header,
  children,
  autoExpandPrefix,
  excludePrefixes = [],
}: CollapsibleNavGroupProps) {
  const pathname = usePathname();

  const isExcluded = excludePrefixes.some(p => pathname === p || pathname.startsWith(p + '/'));
  const onSection = !isExcluded && (pathname === autoExpandPrefix || pathname.startsWith(autoExpandPrefix + '/'));
  const [open, setOpen] = useState(onSection);

  useEffect(() => {
    if (onSection) setOpen(true);
  }, [onSection]);

  const headerActive = pathname === header.href;
  const childActive = (c: NavChild) => {
    // href 에 query string 이 있으면 pathname 만으로 판정 (activePrefix 우선)
    const prefix = c.activePrefix ?? c.href.split('?')[0];
    if (c.exact) return pathname === prefix;
    return pathname === prefix || pathname.startsWith(prefix + '/');
  };

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={header.href}
          className={`flex-1 text-left px-4 py-2.5 rounded-lg font-medium transition-colors ${
            headerActive ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/50'
          }`}
        >
          {header.label}
        </Link>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          title={open ? '접기' : '펼치기'}
          aria-expanded={open}
          className="ml-1 w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-slate-500 hover:text-white hover:bg-slate-700/50 transition-colors"
        >
          <span className={`text-xs transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>▸</span>
        </button>
      </div>
      {open && (
        <div className="ml-3 mt-0.5 mb-1 flex flex-col gap-0.5">
          {children.map((c, i) => {
            const prefix = i === children.length - 1 ? '└' : '├';
            const active = childActive(c);
            return (
              <Link
                key={c.href}
                href={c.href}
                className={`block w-full text-left px-3 py-1.5 rounded-md text-xs transition-colors ${
                  active
                    ? 'bg-slate-700/70 text-white font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-slate-700/40'
                }`}
              >
                {prefix} {c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
