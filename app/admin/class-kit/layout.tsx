'use client';

/**
 * 클래스키트 섹션 공통 레이아웃 — 관리자 인증 + 사이드바.
 * 하위 페이지(강의용자료/수업용자료)는 본문만 렌더.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../_components/AdminSidebar';

export default function ClassKitLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [adminLoginId, setAdminLoginId] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user || d.user.role !== 'admin') {
          router.replace('/admin/login');
          return;
        }
        setAdminLoginId(d.user.loginId ?? '');
        setReady(true);
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin w-10 h-10 border-4 border-slate-600 border-t-white rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      <AdminSidebar loginId={adminLoginId} />
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
}
