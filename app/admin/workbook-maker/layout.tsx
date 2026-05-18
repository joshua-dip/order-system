'use client';

/**
 * 워크북 제작기 — 공용 레이아웃.
 *
 * 사이드바 + 상단 탭(블록 빈칸 / 순서배열)을 책임진다.
 * 각 하위 페이지는 본문(<main>)만 책임지면 된다.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AdminSidebar from '../_components/AdminSidebar';

interface TabDef {
  href: string;
  label: string;
}

const TABS: TabDef[] = [
  { href: '/admin/workbook-maker/block-blank', label: '블록 빈칸' },
  { href: '/admin/workbook-maker/sentence-order', label: '순서배열' },
  { href: '/admin/workbook-maker/grammar', label: '어법공략' },
  { href: '/admin/workbook-maker/essay-step', label: '서술형집중' },
];

export default function WorkbookMakerLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [adminLoginId, setAdminLoginId] = useState('');
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (!d?.user || d.user.role !== 'admin') {
          router.replace('/admin/login');
          return;
        }
        setAdminLoginId(d.user.loginId ?? '');
        setAuthChecked(true);
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <span className="text-sm text-slate-400">인증 확인 중...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      <AdminSidebar loginId={adminLoginId} />
      <div className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-slate-700 bg-slate-950/80 sticky top-0 z-20">
          <div className="px-6 py-3 flex items-center gap-3 flex-wrap">
            <h1 className="text-base font-bold text-white mr-4">워크북 제작기</h1>
            <nav className="flex items-center gap-1">
              {TABS.map(t => {
                const active = pathname === t.href || pathname.startsWith(t.href + '/');
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      active
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-300 hover:bg-slate-700/60'
                    }`}
                  >
                    {t.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
