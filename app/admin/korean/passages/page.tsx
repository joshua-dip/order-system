'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../../_components/AdminSidebar';

export default function KoreanPassagesStubPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState('');

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (!d?.user || d.user.role !== 'admin') { router.replace('/admin/login'); return; }
        setLoginId(d.user.loginId ?? '');
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  return (
    <div className="flex min-h-svh bg-gray-100">
      <AdminSidebar loginId={loginId} />
      <main className="flex-1 p-10">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700 border border-rose-300 mb-4">
            KOREAN · 국어
          </div>
          <h1 className="text-2xl font-bold text-gray-900">국어 원문 관리</h1>
          <p className="mt-2 text-gray-600">
            모의고사 국어 지문(set 단위)을 등록·편집하는 화면.
          </p>
          <div className="mt-8 rounded-xl border-2 border-dashed border-rose-300 bg-white p-8">
            <p className="text-rose-700 font-semibold">🚧 준비 중 (PR #2 이후)</p>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              본 페이지는 <code className="px-1 py-0.5 bg-gray-100 rounded">korean_passages</code> 컬렉션 CRUD UI 자리입니다. 현재는 사이드바·라우팅 자리만 잡혀 있습니다. 자세한 범위는{' '}
              <code className="px-1 py-0.5 bg-gray-100 rounded">PLAN-korean-explainer.md</code> §3-1 참고.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
