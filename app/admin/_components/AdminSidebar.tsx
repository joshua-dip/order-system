'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';

interface AdminSidebarProps {
  loginId: string;
}

export default function AdminSidebar({ loginId }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const linkCls = (href: string) =>
    `block w-full text-left px-4 py-2.5 rounded-lg font-medium transition-colors ${
      isActive(href)
        ? 'bg-slate-700 text-white'
        : 'text-slate-300 hover:bg-slate-700/50'
    }`;

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/admin/login');
    }
  }

  // 접힌 상태
  if (collapsed) {
    return (
      <aside className="w-10 bg-slate-800 shrink-0 flex flex-col items-center border-r border-slate-700 h-svh sticky top-0">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="사이드바 펼치기"
          className="mt-4 w-7 h-7 flex items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors text-sm"
        >
          ›
        </button>
        {/* 현재 페이지 활성 표시 */}
        <div className="mt-4 flex-1 flex flex-col items-center gap-1 w-full px-1">
          {isActive('/admin/essay-generator') && (
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1" />
          )}
        </div>
        {/* 하단 아바타 */}
        <div className="mb-4 w-7 h-7 rounded-full bg-slate-600 flex items-center justify-center text-xs font-bold text-white">
          {(loginId || 'A').charAt(0).toUpperCase()}
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-60 bg-slate-800 shrink-0 flex flex-col border-r border-slate-700 h-svh sticky top-0">
      <div className="p-5 border-b border-slate-700 shrink-0 flex items-center justify-between">
        <h1 className="font-bold text-lg text-white">PAYPERIC ADMIN</h1>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          title="사이드바 접기"
          className="text-slate-500 hover:text-white hover:bg-slate-700 rounded p-1 transition-colors text-sm"
        >
          ‹
        </button>
      </div>
      <nav className="p-3 flex-1 text-sm overflow-y-auto min-h-0">
        <p className="px-3 py-2 text-slate-500 uppercase tracking-wider text-xs">OVERVIEW</p>
        <Link href="/admin" className={linkCls('/admin')}>
          대시보드
        </Link>

        <p className="px-3 py-2 text-slate-500 uppercase tracking-wider text-xs mt-4">ORDERS</p>
        <Link href="/admin?section=orders" className="block w-full text-left px-4 py-2.5 rounded-lg font-medium text-slate-300 hover:bg-slate-700/50 transition-colors">
          전체 주문
        </Link>

        <p className="px-3 py-2 text-slate-500 uppercase tracking-wider text-xs mt-4">UPLOADS</p>
        <Link href="/admin/passages" className={linkCls('/admin/passages')}>
          원문 관리 (DB)
        </Link>
        <Link href="/admin/generated-questions" className={linkCls('/admin/generated-questions')}>
          변형문제 관리 (DB)
        </Link>
        <div className="ml-3 mt-0.5 mb-1 flex flex-col gap-0.5">
          <Link
            href="/admin/generated-questions?mode=objective"
            className="block w-full text-left px-3 py-1.5 rounded-md text-xs text-slate-400 hover:text-white hover:bg-slate-700/40 transition-colors"
          >
            ├ 객관식 관리
          </Link>
          <Link
            href="/admin/generated-questions?mode=essay"
            className="block w-full text-left px-3 py-1.5 rounded-md text-xs text-slate-400 hover:text-white hover:bg-slate-700/40 transition-colors"
          >
            └ 서술형 관리
          </Link>
        </div>
        <Link href="/admin/essay-generator" className={linkCls('/admin/essay-generator')}>
          서술형 출제기
        </Link>
        <Link href="/admin/block-workbook" className={linkCls('/admin/block-workbook')}>
          블록 빈칸 워크북
        </Link>
        <Link href="/admin/syntax-analyzer" className={linkCls('/admin/syntax-analyzer')}>
          구문 분석기
        </Link>
        <Link href="/admin/mcp" className={linkCls('/admin/mcp')}>
          Claude MCP
        </Link>
        <Link
          href="/admin/generated-questions/review-logs"
          className="block w-full text-left px-4 py-2.5 rounded-lg font-medium text-emerald-200/90 hover:bg-emerald-950/40 transition-colors border border-emerald-800/40 mt-1"
        >
          Claude Code 검수 로그
        </Link>
        <Link
          href="/admin/guest-variant-logs"
          className="block w-full text-left px-4 py-2.5 rounded-lg font-medium text-amber-200/90 hover:bg-amber-950/40 transition-colors border border-amber-800/40 mt-1"
        >
          비회원 변형 로그
        </Link>

        <p className="px-3 py-2 text-slate-500 uppercase tracking-wider text-xs mt-4">MEMBERS</p>
        <Link href="/admin?section=members" className="block w-full text-left px-4 py-2.5 rounded-lg font-medium text-slate-300 hover:bg-slate-700/50 transition-colors">
          회원 관리
        </Link>
        <Link href="/admin/users" className={linkCls('/admin/users')}>
          회원상세관리
        </Link>
        <Link href="/admin/vocabulary-library" className={linkCls('/admin/vocabulary-library')}>
          단어장 구매·편집 분석
        </Link>

        <p className="px-3 py-2 text-slate-500 uppercase tracking-wider text-xs mt-4">SETTINGS</p>
        <Link href="/admin?section=settings" className="block w-full text-left px-4 py-2.5 rounded-lg font-medium text-slate-300 hover:bg-slate-700/50 transition-colors">
          교재 노출 설정
        </Link>
        <Link href="/admin?section=essayTypes" className="block w-full text-left px-4 py-2.5 rounded-lg font-medium text-slate-300 hover:bg-slate-700/50 transition-colors">
          서술형 유형 관리
        </Link>
      </nav>
      <div className="p-4 border-t border-slate-700 flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 rounded-full bg-slate-600 flex items-center justify-center text-sm font-bold text-white">
          {(loginId || 'A').charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="font-medium text-white text-sm">{loginId}</p>
          <p className="text-slate-400 text-xs">관리자</p>
        </div>
      </div>
      <div className="p-4 border-t border-slate-700 shrink-0">
        <Link href="/" className="text-slate-400 hover:text-white text-sm">← 메인으로</Link>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="block mt-2 text-slate-400 hover:text-white text-sm"
        >
          로그아웃
        </button>
      </div>
    </aside>
  );
}
