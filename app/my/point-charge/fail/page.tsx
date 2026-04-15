'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import AppBar from '@/app/components/AppBar';

function FailInner() {
  const sp = useSearchParams();
  const code = sp.get('code') || '';
  const msg = sp.get('message') || '';

  return (
    <div className="max-w-md mx-auto px-5 py-10 text-center">
      <p className="text-4xl mb-3">✕</p>
      <h1 className="text-lg font-bold text-[#0f172a] mb-2">결제가 완료되지 않았습니다</h1>
      {code && <p className="text-xs text-[#94a3b8] mb-2 font-mono">{code}</p>}
      {msg && <p className="text-[#475569] text-sm mb-6 break-words">{decodeURIComponent(msg)}</p>}
      {!msg && <p className="text-[#475569] text-sm mb-6">창을 닫았거나 결제가 취소되었을 수 있습니다.</p>}
      <Link
        href="/my"
        className="inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[#0f172a] text-white text-sm font-bold no-underline hover:opacity-95"
      >
        마이페이지로
      </Link>
    </div>
  );
}

export default function PointChargeFailPage() {
  return (
    <>
      <AppBar title="포인트 충전" />
      <div className="min-h-screen bg-[#f8fafc]">
        <Suspense fallback={<div className="py-20 text-center text-[#94a3b8] text-sm">불러오는 중…</div>}>
          <FailInner />
        </Suspense>
      </div>
    </>
  );
}
