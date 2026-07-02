'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { loadTossPayments, type TossPaymentsWidgets } from '@tosspayments/tosspayments-sdk';
import AppBar from '@/app/components/AppBar';
import {
  POINT_CHARGE_PACKAGES,
  type PointChargePackage,
  type PointChargeTierId,
} from '@/lib/point-charge-packages';
import { getTossPaymentsClientKeyPublic, isTossWidgetClientKey } from '@/lib/toss-payments-env';
import { effectivePointChargeDiscount, type CouponView } from '@/lib/coupons-shared';
import { MEMBERSHIP_MONTHLY_WON, MEMBERSHIP_ANNUAL_REFERENCE_WON } from '@/lib/membership-pricing';

/** 토스 customerKey (회원당 고유, 2~50자) — app/my/page.tsx 와 동일 규칙. */
function tossCustomerKeyFromLoginId(loginId: string): string {
  const raw = (loginId || 'member').replace(/[^a-zA-Z0-9._@-]/g, '_').slice(0, 44);
  return `u_${raw}`;
}

type Me = {
  loginId: string;
  name: string;
  email: string;
  points: number;
  isMonthlyMemberActive?: boolean;
  monthlyMemberUntil?: string | null;
  isAnnualMemberActive?: boolean;
  annualMemberSince?: string | null;
};

type MembershipPlan = 'monthly' | 'annual';
type Selection = { kind: 'points'; tier: PointChargeTierId } | { kind: 'membership'; plan: MembershipPlan };

function formatKoDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR');
}
/** annualMemberSince(가입일) 로부터 1년 뒤 만료일 */
function annualUntil(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  d.setFullYear(d.getFullYear() + 1);
  return d.toLocaleDateString('ko-KR');
}

export default function PointChargePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [meLoading, setMeLoading] = useState(true);
  const [coupons, setCoupons] = useState<CouponView[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: 'points', tier: 'p10k' });
  const [selectedCouponId, setSelectedCouponId] = useState('');
  const [phase, setPhase] = useState<'select' | 'widget'>('select');
  const [orderInfo, setOrderInfo] = useState<{ orderId: string; amount: number; orderName: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const widgetsRef = useRef<TossPaymentsWidgets | null>(null);

  const clientKey = getTossPaymentsClientKeyPublic();
  const isTestKey = clientKey.includes('test_');
  const isWidgetKey = isTossWidgetClientKey(clientKey);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/me', { credentials: 'include' });
        const d = await r.json();
        if (!cancelled) setMe((d?.user as Me) ?? null);
      } catch {
        if (!cancelled) setMe(null);
      } finally {
        if (!cancelled) setMeLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/my/coupons', { credentials: 'include' });
        const d = await r.json();
        if (!cancelled && r.ok && Array.isArray(d.coupons)) setCoupons(d.coupons as CouponView[]);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const customerKey = me ? tossCustomerKeyFromLoginId(me.loginId) : '';
  const selectedCoupon = coupons.find((c) => c.id === selectedCouponId) ?? null;
  const couponPct = selectedCoupon?.discountPct ?? 0;
  const effAmountWon = (p: PointChargePackage): number => {
    const pct = effectivePointChargeDiscount(p.discountPct, couponPct);
    return Math.round((p.points * (100 - pct)) / 100);
  };

  // 선택한 상품의 결제 금액·이름
  const selectedSummary = (() => {
    if (selection.kind === 'membership') {
      const won = selection.plan === 'annual' ? MEMBERSHIP_ANNUAL_REFERENCE_WON : MEMBERSHIP_MONTHLY_WON;
      const name = selection.plan === 'annual' ? '연회원 (12개월)' : '월회원 (1개월)';
      return { won, name };
    }
    const pkg = POINT_CHARGE_PACKAGES.find((p) => p.id === selection.tier) ?? POINT_CHARGE_PACKAGES[0];
    return { won: effAmountWon(pkg), name: `포인트 충전 ${pkg.points.toLocaleString()}P` };
  })();

  // 결제위젯 렌더
  useEffect(() => {
    if (phase !== 'widget' || !orderInfo || !clientKey || !customerKey) return;
    let cancelled = false;
    (async () => {
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
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, orderInfo, clientKey, customerKey]);

  const handleProceed = useCallback(async () => {
    setError(null);
    if (!clientKey) {
      setError('결제 연동 키가 설정되지 않았습니다. 관리자에게 문의해 주세요.');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, string> =
        selection.kind === 'membership'
          ? { purpose: 'membership', plan: selection.plan }
          : { tier: selection.tier, ...(selectedCouponId ? { couponId: selectedCouponId } : {}) };
      const prep = await fetch('/api/my/point-charge/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const d = await prep.json();
      if (!prep.ok || !d?.ok) {
        setError(typeof d?.error === 'string' ? d.error : '주문 준비에 실패했습니다.');
        return;
      }
      setOrderInfo({ orderId: d.orderId as string, amount: d.amount as number, orderName: d.orderName as string });
      setPhase('widget');
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }, [clientKey, selection, selectedCouponId]);

  const handlePay = useCallback(async () => {
    if (!widgetsRef.current || !orderInfo || !me) return;
    setBusy(true);
    try {
      const origin = window.location.origin;
      await widgetsRef.current.requestPayment({
        orderId: orderInfo.orderId,
        orderName: orderInfo.orderName,
        successUrl: `${origin}/my/point-charge/success`,
        failUrl: `${origin}/my/point-charge/fail`,
        customerEmail: (me.email || '').trim() || 'member@gomijoshua.local',
        customerName: (me.name || me.loginId || '회원').slice(0, 50),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('PAY_PROCESS_CANCELED')) setError(msg || '결제 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }, [orderInfo, me]);

  return (
    <>
      <AppBar title="포인트 · 멤버십 결제" />
      <div className="min-h-screen bg-[#f8fafc] pb-28">
        <div className="max-w-3xl mx-auto px-4 sm:px-5 py-6">
          {meLoading ? (
            <div className="py-24 flex justify-center">
              <div className="animate-spin w-9 h-9 border-4 border-[#2563eb] border-t-transparent rounded-full" />
            </div>
          ) : !me ? (
            <div className="bg-white rounded-2xl border border-[#e2e8f0] p-8 text-center">
              <p className="text-3xl mb-3">🔒</p>
              <p className="text-[#475569] text-sm mb-5">결제는 로그인 후 이용할 수 있어요.</p>
              <Link
                href="/login?from=/my/point-charge"
                className="inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[#2563eb] text-white text-sm font-bold no-underline hover:opacity-95"
              >
                로그인하러 가기
              </Link>
            </div>
          ) : (
            <>
              {/* 헤더 — 보유 포인트 · 멤버십 상태 */}
              <div className="rounded-2xl bg-gradient-to-r from-[#0064ff] to-[#2563eb] text-white p-5 mb-5 shadow-sm">
                <p className="text-[12px] font-semibold text-blue-100">{me.name || me.loginId} 님</p>
                <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
                  <span className="text-2xl font-black tracking-tight">
                    {(me.points ?? 0).toLocaleString()} <span className="text-sm font-semibold text-blue-100">P 보유</span>
                  </span>
                  {me.isAnnualMemberActive ? (
                    <span className="px-2.5 py-1 rounded-full bg-white/20 text-[11px] font-bold">
                      연회원 이용 중{annualUntil(me.annualMemberSince) ? ` · ~${annualUntil(me.annualMemberSince)}` : ''}
                    </span>
                  ) : me.isMonthlyMemberActive ? (
                    <span className="px-2.5 py-1 rounded-full bg-white/20 text-[11px] font-bold">
                      월회원 이용 중{formatKoDate(me.monthlyMemberUntil) ? ` · ~${formatKoDate(me.monthlyMemberUntil)}` : ''}
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full bg-white/15 text-[11px] font-medium text-blue-50">일반 회원</span>
                  )}
                </div>
              </div>

              {(isTestKey && !isWidgetKey) && (
                <p className="mb-4 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  테스트 API 개별 키 감지 — 결제위젯은 gck_ 키가 필요합니다. 결제위젯 연동 키로 교체하세요.
                </p>
              )}
              {(isTestKey && isWidgetKey) && (
                <p className="mb-4 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  테스트 키 — 실제 과금 없이 결제 흐름만 확인됩니다.
                </p>
              )}

              {phase === 'select' ? (
                <>
                  {/* 포인트 충전 */}
                  <section className="bg-white rounded-2xl border border-[#e2e8f0] p-5 mb-5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">⚡</span>
                      <h2 className="text-base font-bold text-[#0f172a]">포인트 충전</h2>
                    </div>
                    <p className="text-[12px] text-[#94a3b8] mb-4">1P = 1원. 고액 패키지는 할인 적용됩니다.</p>
                    <div className="grid grid-cols-2 gap-2.5">
                      {POINT_CHARGE_PACKAGES.map((p) => {
                        const pay = effAmountWon(p);
                        const effPct = effectivePointChargeDiscount(p.discountPct, couponPct);
                        const couponWins = couponPct > p.discountPct;
                        const active = selection.kind === 'points' && selection.tier === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setSelection({ kind: 'points', tier: p.id })}
                            className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                              active
                                ? 'border-[#2563eb] bg-[#eff6ff] ring-2 ring-[#2563eb]/25'
                                : 'border-[#e2e8f0] hover:border-[#cbd5e1] bg-white'
                            }`}
                          >
                            <div className="flex items-baseline justify-between gap-1">
                              <span className="font-bold text-[#0f172a]">{p.points.toLocaleString()} P</span>
                              {effPct > 0 ? (
                                <span className="text-[11px] font-semibold text-[#16a34a]">
                                  {effPct}%{couponWins && <span className="text-[#7c3aed]">·쿠폰</span>}
                                </span>
                              ) : (
                                <span className="text-[11px] text-[#94a3b8]">정가</span>
                              )}
                            </div>
                            <div className="mt-1 text-sm text-[#475569]">
                              <strong className="text-[#0f172a]">{pay.toLocaleString()}원</strong>
                              {effPct > 0 && (
                                <span className="text-[11px] text-[#94a3b8] line-through ml-1.5">
                                  {p.points.toLocaleString()}원
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* 쿠폰 (포인트 선택 시) */}
                    {coupons.length > 0 && selection.kind === 'points' && (
                      <div className="mt-3 rounded-xl border border-[#e2e8f0] bg-[#faf5ff] px-4 py-3">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-[13px] font-semibold text-[#6d28d9]">🎟 할인 쿠폰</span>
                          <span className="text-[11px] text-[#94a3b8]">패키지 할인과 중복 안 됨 — 더 큰 할인 적용</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedCouponId('')}
                            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium border transition-colors ${
                              selectedCouponId === ''
                                ? 'border-[#7c3aed] bg-white text-[#6d28d9] ring-2 ring-[#7c3aed]/20'
                                : 'border-[#e9d5ff] bg-white text-[#64748b] hover:border-[#c4b5fd]'
                            }`}
                          >
                            사용 안 함
                          </button>
                          {coupons.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => setSelectedCouponId(c.id)}
                              className={`px-3 py-1.5 rounded-lg text-[13px] font-bold border transition-colors ${
                                selectedCouponId === c.id
                                  ? 'border-[#7c3aed] bg-[#7c3aed] text-white'
                                  : 'border-[#e9d5ff] bg-white text-[#6d28d9] hover:border-[#c4b5fd]'
                              }`}
                              title={c.note || `${c.discountPct}% 할인 쿠폰`}
                            >
                              {c.discountPct}% 할인
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>

                  {/* 멤버십 */}
                  <section className="bg-white rounded-2xl border border-[#e2e8f0] p-5 mb-5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-lg">👑</span>
                      <h2 className="text-base font-bold text-[#0f172a]">멤버십 가입 · 연장</h2>
                    </div>
                    <p className="text-[12px] text-[#94a3b8] mb-4">
                      월회원·연회원 <b className="text-[#475569]">기능은 동일</b>해요(이용 기간만 차이). 이용 중이면 만료일에서 자동으로 이어서 연장돼요.
                    </p>

                    {/* 멤버십으로 쓸 수 있는 기능 */}
                    <div className="mb-4 rounded-xl border border-[#dbeafe] bg-[#f8fbff] px-4 py-3.5">
                      <p className="text-[12px] font-bold text-[#1d4ed8] mb-2">멤버십 회원은 이런 기능을 쓸 수 있어요</p>
                      <ul className="space-y-1.5">
                        {[
                          { icon: '✏️', title: '변형문제 만들기', desc: '지문을 골라 변형문제를 직접 제작·다운로드' },
                          { icon: '📝', title: '파이널 예비 모의고사', desc: '시험 범위로 예비 시험지를 바로 제작' },
                          { icon: '📖', title: '단어장', desc: '교재 단어장·단어시험지 편집·다운로드' },
                          { icon: '📥', title: '무료 공유자료', desc: '회원 전용 공유자료 다운로드' },
                          { icon: '💸', title: '쏠북 교재 추가비 면제', desc: '쏠북 교재 커스텀 추가 요금 무료' },
                        ].map((f) => (
                          <li key={f.title} className="flex items-start gap-2 text-[12px]">
                            <span className="text-[#16a34a] font-bold leading-5">✓</span>
                            <span className="leading-5">
                              <b className="text-[#0f172a]">{f.icon} {f.title}</b>
                              <span className="text-[#64748b]"> — {f.desc}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {/* 월회원 */}
                      <button
                        type="button"
                        onClick={() => setSelection({ kind: 'membership', plan: 'monthly' })}
                        className={`text-left rounded-xl border px-4 py-4 transition-colors ${
                          selection.kind === 'membership' && selection.plan === 'monthly'
                            ? 'border-[#2563eb] bg-[#eff6ff] ring-2 ring-[#2563eb]/25'
                            : 'border-[#e2e8f0] hover:border-[#cbd5e1] bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[#0f172a]">월회원</span>
                          {me.isMonthlyMemberActive && (
                            <span className="text-[10px] font-bold text-[#16a34a] bg-[#f0fdf4] border border-[#bbf7d0] rounded-full px-2 py-0.5">이용 중</span>
                          )}
                        </div>
                        <div className="mt-1.5">
                          <strong className="text-lg text-[#0f172a]">{MEMBERSHIP_MONTHLY_WON.toLocaleString()}원</strong>
                          <span className="text-[12px] text-[#94a3b8]"> / 1개월</span>
                        </div>
                        <p className="mt-1 text-[11px] text-[#64748b]">매월 직접 결제로 갱신 (자동결제 아님)</p>
                      </button>
                      {/* 연회원 */}
                      <button
                        type="button"
                        onClick={() => setSelection({ kind: 'membership', plan: 'annual' })}
                        className={`relative text-left rounded-xl border px-4 py-4 transition-colors ${
                          selection.kind === 'membership' && selection.plan === 'annual'
                            ? 'border-[#2563eb] bg-[#eff6ff] ring-2 ring-[#2563eb]/25'
                            : 'border-[#e2e8f0] hover:border-[#cbd5e1] bg-white'
                        }`}
                      >
                        <span className="absolute top-3 right-3 text-[10px] font-extrabold text-white bg-[#f59e0b] rounded-full px-2 py-0.5">
                          약 16%↓
                        </span>
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-[#0f172a]">연회원</span>
                          {me.isAnnualMemberActive && (
                            <span className="text-[10px] font-bold text-[#16a34a] bg-[#f0fdf4] border border-[#bbf7d0] rounded-full px-2 py-0.5 mr-14">이용 중</span>
                          )}
                        </div>
                        <div className="mt-1.5">
                          <strong className="text-lg text-[#0f172a]">{MEMBERSHIP_ANNUAL_REFERENCE_WON.toLocaleString()}원</strong>
                          <span className="text-[12px] text-[#94a3b8]"> / 12개월</span>
                        </div>
                        <p className="mt-1 text-[11px] text-[#64748b]">월 {Math.round(MEMBERSHIP_ANNUAL_REFERENCE_WON / 12).toLocaleString()}원 꼴 · 1년 한 번에</p>
                      </button>
                    </div>
                  </section>

                  {error && (
                    <p className="mb-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
                  )}

                  {/* 결제 진행 — 하단 고정 바 */}
                  <div className="fixed bottom-0 inset-x-0 z-40 border-t border-[#e2e8f0] bg-white/95 backdrop-blur">
                    <div className="max-w-3xl mx-auto px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] text-[#64748b] truncate">{selectedSummary.name}</p>
                        <p className="text-lg font-black text-[#0f172a]">{selectedSummary.won.toLocaleString()}원</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleProceed()}
                        disabled={busy}
                        className="shrink-0 px-6 py-3 rounded-xl bg-[#0064ff] text-white text-sm font-bold hover:opacity-95 disabled:opacity-50"
                      >
                        {busy ? '확인 중…' : '결제 진행'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                /* 결제위젯 단계 */
                <section className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() => {
                        setPhase('select');
                        setError(null);
                        widgetsRef.current = null;
                      }}
                      className="text-[#64748b] hover:text-[#0f172a] text-sm px-1"
                      aria-label="상품 선택으로 돌아가기"
                    >
                      ← 뒤로
                    </button>
                  </div>
                  {orderInfo && (
                    <p className="text-[13px] text-[#64748b] mb-3">
                      {orderInfo.orderName} — <strong className="text-[#0f172a]">{orderInfo.amount.toLocaleString()}원</strong>
                    </p>
                  )}
                  <div id="toss-payment-methods" className="min-h-[200px]" />
                  <div id="toss-agreement" />
                  {error && (
                    <p className="mt-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void handlePay()}
                    disabled={busy}
                    className="mt-4 w-full px-4 py-3.5 rounded-xl bg-[#0064ff] text-white text-sm font-bold hover:opacity-95 disabled:opacity-50"
                  >
                    {busy ? '결제 중…' : `${selectedSummary.won.toLocaleString()}원 결제하기`}
                  </button>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
