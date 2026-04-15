'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AppBar from '@/app/components/AppBar';

function SuccessInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'ok' | 'err'>('loading');
  const [message, setMessage] = useState('');
  const [balanceAfter, setBalanceAfter] = useState<number | null>(null);

  useEffect(() => {
    const paymentKey = sp.get('paymentKey');
    const orderId = sp.get('orderId');
    const amountStr = sp.get('amount');
    if (!paymentKey || !orderId || amountStr == null) {
      setStatus('err');
      setMessage('결제 정보가 없습니다. 마이페이지에서 잔액을 확인해 주세요.');
      return;
    }
    const idemOk = `pc_ok_${orderId}_${paymentKey}`;
    try {
      if (sessionStorage.getItem(idemOk)) {
        setStatus('ok');
        setMessage('포인트가 충전되었습니다.');
        return;
      }
    } catch {
      /* ignore */
    }

    const amount = parseInt(amountStr, 10);
    if (!Number.isFinite(amount)) {
      setStatus('err');
      setMessage('결제 금액 정보가 올바르지 않습니다.');
      return;
    }

    fetch('/api/my/point-charge/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ paymentKey, orderId, amount }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.ok && d?.ok) {
          try {
            sessionStorage.setItem(idemOk, '1');
          } catch {
            /* ignore */
          }
          setStatus('ok');
          setMessage(d.already ? '이미 처리된 결제입니다.' : '포인트가 충전되었습니다.');
          if (typeof d.balanceAfter === 'number') setBalanceAfter(d.balanceAfter);
          router.refresh();
          return;
        }
        setStatus('err');
        setMessage(typeof d?.error === 'string' ? d.error : '충전 처리에 실패했습니다.');
      })
      .catch(() => {
        setStatus('err');
        setMessage('네트워크 오류가 발생했습니다.');
      });
  }, [sp, router]);

  return (
    <div className="max-w-md mx-auto px-5 py-10 text-center">
      {status === 'loading' && (
        <>
          <div className="animate-spin w-10 h-10 border-4 border-[#2563eb] border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-[#475569] text-sm">결제를 확인하는 중입니다…</p>
        </>
      )}
      {status === 'ok' && (
        <>
          <p className="text-4xl mb-3">✓</p>
          <h1 className="text-lg font-bold text-[#0f172a] mb-2">충전 완료</h1>
          <p className="text-[#475569] text-sm mb-2">{message}</p>
          {balanceAfter != null && (
            <p className="text-sm text-[#0f172a] font-semibold mb-6">현재 보유 {balanceAfter.toLocaleString()} P</p>
          )}
          <Link
            href="/my"
            className="inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[#2563eb] text-white text-sm font-bold no-underline hover:opacity-95"
          >
            마이페이지로
          </Link>
        </>
      )}
      {status === 'err' && (
        <>
          <p className="text-4xl mb-3">!</p>
          <h1 className="text-lg font-bold text-[#0f172a] mb-2">처리 실패</h1>
          <p className="text-red-600 text-sm mb-6">{message}</p>
          <Link href="/my" className="inline-flex text-[#2563eb] text-sm font-semibold underline">
            마이페이지로 돌아가기
          </Link>
        </>
      )}
    </div>
  );
}

export default function PointChargeSuccessPage() {
  return (
    <>
      <AppBar title="포인트 충전" />
      <div className="min-h-screen bg-[#f8fafc]">
        <Suspense
          fallback={
            <div className="py-20 flex justify-center">
              <div className="animate-spin w-10 h-10 border-4 border-[#2563eb] border-t-transparent rounded-full" />
            </div>
          }
        >
          <SuccessInner />
        </Suspense>
      </div>
    </>
  );
}
