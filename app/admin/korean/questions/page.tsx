'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../../_components/AdminSidebar';

export default function KoreanQuestionsStubPage() {
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
          <h1 className="text-2xl font-bold text-gray-900">국어 변형문제 관리</h1>
          <p className="mt-2 text-gray-600">
            국어 변형문제 (객관식·서술형) 관리 화면.
          </p>
          <div className="mt-8 rounded-xl border-2 border-dashed border-gray-300 bg-white p-8">
            <p className="text-gray-600 font-semibold">⏸ 본 PLAN 범위 밖 (후속 epic)</p>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              현재 PLAN <code className="px-1 py-0.5 bg-gray-100 rounded">PLAN-korean-explainer.md</code> 는 <strong>해설지 생성</strong>만 다룹니다. 국어 변형문제 작성·관리는 별도 PLAN 으로 분리됩니다.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
