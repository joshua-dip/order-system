'use client';

import { useState } from 'react';
import { loadTossPayments } from '@tosspayments/tosspayments-sdk';
import {
  POINT_CHARGE_PACKAGES,
  amountWonForPackage,
  type PointChargePackage,
  type PointChargeTierId,
} from '@/lib/point-charge-packages';
import { getTossPaymentsClientKeyPublic } from '@/lib/toss-payments-env';

type Props = {
  open: boolean;
  onClose: () => void;
  /** 토스 customerKey (회원당 고유, 2~50자 규칙 준수) */
  customerKey: string;
  customerName: string;
  customerEmail: string;
};

export default function PointChargeModal({ open, onClose, customerKey, customerName, customerEmail }: Props) {
  const [selected, setSelected] = useState<PointChargeTierId>('p10k');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const clientKey = getTossPaymentsClientKeyPublic();
  const isTestKey = clientKey.startsWith('test_ck_');

  const startPay = async () => {
    setError(null);
    if (!clientKey) {
      setError('결제 연동 키가 설정되지 않았습니다. 관리자에게 문의해 주세요.');
      return;
    }
    const pkg = POINT_CHARGE_PACKAGES.find((p) => p.id === selected);
    if (!pkg) return;
    setBusy(true);
    try {
      const prep = await fetch('/api/my/point-charge/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tier: pkg.id }),
      });
      const prepData = await prep.json();
      if (!prep.ok || !prepData?.ok) {
        setError(typeof prepData?.error === 'string' ? prepData.error : '주문 준비에 실패했습니다.');
        return;
      }
      const { orderId, amount, orderName } = prepData as { orderId: string; amount: number; orderName: string };

      const tossPayments = await loadTossPayments(clientKey);
      const payment = tossPayments.payment({ customerKey });

      const origin = window.location.origin;
      await payment.requestPayment({
        method: 'CARD',
        amount: { currency: 'KRW', value: amount },
        orderId,
        orderName,
        successUrl: `${origin}/my/point-charge/success`,
        failUrl: `${origin}/my/point-charge/fail`,
        customerEmail: customerEmail.trim() || 'member@solvook.local',
        customerName: (customerName.trim() || '회원').slice(0, 50),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg || '결제를 시작할 수 없습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-[#e2e8f0] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="point-charge-title"
      >
        <div className="px-5 py-4 border-b border-[#e2e8f0] flex items-center justify-between gap-2">
          <h2 id="point-charge-title" className="text-base font-bold text-[#0f172a]">
            포인트 미리 충전
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg text-[#64748b] hover:bg-[#f1f5f9] text-lg leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <p className="text-[13px] text-[#64748b] leading-relaxed">
            1P = 1원 기준으로 충전합니다. 고액 패키지는 결제 금액에 할인이 적용됩니다. 결제는 토스페이먼츠 카드창으로 진행됩니다.
          </p>
          {isTestKey && (
            <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              테스트 클라이언트 키로 연결됨 — 실제 과금 없이 결제 흐름만 확인할 수 있습니다.
            </p>
          )}
          <div className="grid grid-cols-1 gap-2">
            {POINT_CHARGE_PACKAGES.map((p: PointChargePackage) => {
              const pay = amountWonForPackage(p);
              const active = selected === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelected(p.id)}
                  className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                    active
                      ? 'border-[#2563eb] bg-[#eff6ff] ring-2 ring-[#2563eb]/25'
                      : 'border-[#e2e8f0] hover:border-[#cbd5e1] bg-white'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-bold text-[#0f172a]">{p.points.toLocaleString()} P</span>
                    {p.discountPct > 0 ? (
                      <span className="text-[11px] font-semibold text-[#16a34a]">{p.discountPct}% 할인</span>
                    ) : (
                      <span className="text-[11px] text-[#94a3b8]">정가</span>
                    )}
                  </div>
                  <div className="mt-1 text-sm text-[#475569]">
                    결제 <strong className="text-[#0f172a]">{pay.toLocaleString()}원</strong>
                    {p.discountPct > 0 && (
                      <span className="text-[11px] text-[#94a3b8] line-through ml-2">{p.points.toLocaleString()}원</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
        </div>
        <div className="px-5 py-4 border-t border-[#e2e8f0] flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-[#e2e8f0] text-[#475569] text-sm font-semibold hover:bg-[#f8fafc]"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void startPay()}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl bg-[#0064ff] text-white text-sm font-bold hover:opacity-95 disabled:opacity-50"
          >
            {busy ? '처리 중…' : '결제하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
