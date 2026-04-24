'use client';

import { useState, useEffect, useRef } from 'react';
import { loadTossPayments, type TossPaymentsWidgets } from '@tosspayments/tosspayments-sdk';
import {
  POINT_CHARGE_PACKAGES,
  amountWonForPackage,
  type PointChargePackage,
  type PointChargeTierId,
} from '@/lib/point-charge-packages';
import { getTossPaymentsClientKeyPublic, isTossWidgetClientKey } from '@/lib/toss-payments-env';

type Props = {
  open: boolean;
  onClose: () => void;
  /** 토스 customerKey (회원당 고유, 2~50자) */
  customerKey: string;
  customerName: string;
  customerEmail: string;
};

export default function PointChargeModal({
  open,
  onClose,
  customerKey,
  customerName,
  customerEmail,
}: Props) {
  const [selected, setSelected] = useState<PointChargeTierId>('p10k');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'select' | 'widget'>('select');
  const [orderInfo, setOrderInfo] = useState<{
    orderId: string;
    amount: number;
    orderName: string;
  } | null>(null);
  const widgetsRef = useRef<TossPaymentsWidgets | null>(null);

  const clientKey = getTossPaymentsClientKeyPublic();
  const isTestKey = clientKey.includes('test_');
  const isWidgetKey = isTossWidgetClientKey(clientKey);

  // 모달 닫힐 때 초기화
  useEffect(() => {
    if (!open) {
      setPhase('select');
      setError(null);
      setOrderInfo(null);
      widgetsRef.current = null;
    }
  }, [open]);

  // widget 단계로 전환되면 결제위젯 렌더링
  useEffect(() => {
    if (phase !== 'widget' || !open || !orderInfo || !clientKey) return;

    let cancelled = false;
    const init = async () => {
      try {
        const tossPayments = await loadTossPayments(clientKey);
        const widgets = tossPayments.widgets({ customerKey });
        if (cancelled) return;
        widgetsRef.current = widgets;

        await widgets.setAmount({ currency: 'KRW', value: orderInfo.amount });
        await widgets.renderPaymentMethods({ selector: '#toss-payment-methods' });
        await widgets.renderAgreement({ selector: '#toss-agreement' });
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '결제 UI 초기화 실패');
          setPhase('select');
        }
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, [phase, open, orderInfo, clientKey, customerKey]);

  const handleProceed = async () => {
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
      setOrderInfo({
        orderId: prepData.orderId as string,
        amount: prepData.amount as number,
        orderName: prepData.orderName as string,
      });
      setPhase('widget');
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const handlePay = async () => {
    if (!widgetsRef.current || !orderInfo) return;
    setBusy(true);
    try {
      const origin = window.location.origin;
      await widgetsRef.current.requestPayment({
        orderId: orderInfo.orderId,
        orderName: orderInfo.orderName,
        successUrl: `${origin}/my/point-charge/success`,
        failUrl: `${origin}/my/point-charge/fail`,
        customerEmail: customerEmail.trim() || 'member@gomijoshua.local',
        customerName: (customerName.trim() || '회원').slice(0, 50),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 사용자가 직접 결제 취소한 경우는 에러 표시 생략
      if (!msg.includes('PAY_PROCESS_CANCELED')) {
        setError(msg || '결제 중 오류가 발생했습니다.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"
      onClick={phase === 'select' ? onClose : undefined}
      role="presentation"
    >
      <div
        className={`w-full bg-white rounded-2xl shadow-xl border border-[#e2e8f0] overflow-hidden transition-all duration-200 ${
          phase === 'widget' ? 'max-w-lg' : 'max-w-md'
        }`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="point-charge-title"
      >
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-[#e2e8f0] flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {phase === 'widget' && (
              <button
                type="button"
                onClick={() => {
                  setPhase('select');
                  setError(null);
                  widgetsRef.current = null;
                }}
                className="text-[#64748b] hover:text-[#0f172a] text-sm mr-1 px-1"
                aria-label="패키지 선택으로 돌아가기"
              >
                ←
              </button>
            )}
            <h2 id="point-charge-title" className="text-base font-bold text-[#0f172a]">
              {phase === 'select' ? '포인트 미리 충전' : '결제 정보 입력'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg text-[#64748b] hover:bg-[#f1f5f9] text-lg leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* 패키지 선택 단계 */}
        {phase === 'select' && (
          <div className="px-5 py-4 space-y-3">
            <p className="text-[13px] text-[#64748b] leading-relaxed">
              1P = 1원 기준. 고액 패키지는 할인 적용됩니다.
              토스페이먼츠 결제위젯으로 진행됩니다.
            </p>
            {isTestKey && !isWidgetKey && (
              <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                테스트 API 개별 키 감지 — 결제위젯은 gck_ 키가 필요합니다. 결제위젯 연동 키로 교체하세요.
              </p>
            )}
            {isTestKey && isWidgetKey && (
              <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                테스트 키 — 실제 과금 없이 결제 흐름만 확인됩니다.
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
                      결제{' '}
                      <strong className="text-[#0f172a]">{pay.toLocaleString()}원</strong>
                      {p.discountPct > 0 && (
                        <span className="text-[11px] text-[#94a3b8] line-through ml-2">
                          {p.points.toLocaleString()}원
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>
        )}

        {/* 결제위젯 단계 */}
        {phase === 'widget' && (
          <div className="px-5 py-4 space-y-2">
            {orderInfo && (
              <p className="text-[13px] text-[#64748b]">
                {orderInfo.orderName} —{' '}
                <strong className="text-[#0f172a]">{orderInfo.amount.toLocaleString()}원</strong>
              </p>
            )}
            <div id="toss-payment-methods" className="min-h-[200px]" />
            <div id="toss-agreement" />
            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>
        )}

        {/* 하단 버튼 */}
        <div className="px-5 py-4 border-t border-[#e2e8f0] flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-[#e2e8f0] text-[#475569] text-sm font-semibold hover:bg-[#f8fafc]"
          >
            취소
          </button>
          {phase === 'select' ? (
            <button
              type="button"
              onClick={() => void handleProceed()}
              disabled={busy}
              className="px-4 py-2.5 rounded-xl bg-[#0064ff] text-white text-sm font-bold hover:opacity-95 disabled:opacity-50"
            >
              {busy ? '확인 중…' : '결제 진행'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handlePay()}
              disabled={busy}
              className="px-4 py-2.5 rounded-xl bg-[#0064ff] text-white text-sm font-bold hover:opacity-95 disabled:opacity-50"
            >
              {busy ? '결제 중…' : '결제하기'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
