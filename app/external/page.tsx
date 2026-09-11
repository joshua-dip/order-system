'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppBar from '../components/AppBar';
import QuestionSettings from '../components/QuestionSettings';
import { saveOrderToDb } from '@/lib/orders';
import { fetchAuthMe } from '@/lib/auth-me-cache';
import { VARIANT_PRICE } from '@/lib/variant-pricing';
import {
  EXTERNAL_MIN_ENGLISH_RATIO,
  EXTERNAL_PASSAGE_LIMITS,
  englishLetterRatio,
  externalizeListPrice,
} from '@/lib/external-variant';

/**
 * 외부지문 변형문제 주문 — 자체 지문·타 출판사 지문을 붙여넣어 변형문제를 주문한다(2026-09-11).
 *
 * ① 지문 붙여넣기 → 이 회원 전용 교재로 등록(/api/my/external-passages)
 * ② 부교재 변형 주문서(QuestionSettings)를 orderFlow="external" 로 그대로 쓴다 —
 *    무료 유형·멤버십 무료 문항 없이 인상 단가, 주문번호 XV-.
 */

type Step = 'input' | 'questions';
type Draft = { title: string; text: string };
type Registered = { textbook: string; chapter: string; lessons: string[] };

const EMPTY: Draft = { title: '', text: '' };
const { maxPassages, minChars, maxChars } = EXTERNAL_PASSAGE_LIMITS;

export default function ExternalOrderPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [step, setStep] = useState<Step>('input');
  const [batchTitle, setBatchTitle] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([{ ...EMPTY }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [registered, setRegistered] = useState<Registered | null>(null);
  const [registeredSig, setRegisteredSig] = useState('');

  useEffect(() => {
    fetchAuthMe()
      .then((d) => setLoggedIn(!!d?.user))
      .catch(() => setLoggedIn(false))
      .finally(() => setAuthChecked(true));
  }, []);

  /** 입력이 등록 때와 같은지 — 되돌아와서 그대로 넘어가면 같은 지문을 또 등록하지 않는다 */
  const sig = useMemo(
    () =>
      JSON.stringify({
        b: batchTitle.trim(),
        d: drafts.map((d) => [d.title.trim(), d.text.trim()]),
      }),
    [batchTitle, drafts],
  );

  const filled = drafts.filter((d) => d.text.trim() !== '');
  const problems = drafts
    .map((d, i) => {
      const t = d.text.trim();
      if (!t) return null;
      if (t.length < minChars) return `지문 ${i + 1}이 너무 짧습니다 (${minChars}자 이상)`;
      if (t.length > maxChars) return `지문 ${i + 1}이 너무 깁니다 (${maxChars}자 이하)`;
      if (englishLetterRatio(t) < EXTERNAL_MIN_ENGLISH_RATIO) return `지문 ${i + 1}: 영어 지문만 받을 수 있어요`;
      return null;
    })
    .filter((x): x is string => !!x);
  const canNext = filled.length > 0 && problems.length === 0 && !submitting;

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const addDraft = () =>
    setDrafts((prev) => (prev.length >= maxPassages ? prev : [...prev, { ...EMPTY }]));
  const removeDraft = (i: number) =>
    setDrafts((prev) => (prev.length <= 1 ? [{ ...EMPTY }] : prev.filter((_, j) => j !== i)));

  const goNext = async () => {
    if (!canNext) return;
    if (registered && registeredSig === sig) {
      setStep('questions');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/my/external-passages', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batchTitle: batchTitle.trim(),
          passages: filled.map((d) => ({ title: d.title.trim(), text: d.text })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok) {
        setError(typeof d?.error === 'string' ? d.error : '지문 등록에 실패했습니다.');
        return;
      }
      setRegistered({ textbook: d.textbook, chapter: d.chapter, lessons: d.lessons });
      setRegisteredSig(sig);
      setStep('questions');
      window.scrollTo(0, 0);
    } catch {
      setError('네트워크 오류로 지문을 등록하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOrderGenerate = async (
    orderText: string,
    orderPrefix?: string,
    extras?: { orderMeta?: Record<string, unknown>; pointsUsed?: number },
  ) => {
    const res = await saveOrderToDb(orderText, orderPrefix, extras?.pointsUsed, extras?.orderMeta);
    if (res.ok && res.id) {
      router.push('/order/done?id=' + res.id);
    } else {
      const msg = (res as { error?: string }).error;
      alert(msg || '주문을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  };

  if (step === 'questions' && registered) {
    return (
      <QuestionSettings
        selectedTextbook={registered.textbook}
        selectedLessons={registered.lessons}
        onOrderGenerate={handleOrderGenerate}
        onBack={() => setStep('input')}
        onBackToTextbook={() => setStep('input')}
        orderFlow="external"
      />
    );
  }

  const price = {
    base: externalizeListPrice(VARIANT_PRICE.base),
    advanced: externalizeListPrice(VARIANT_PRICE.advanced),
    oiWith: externalizeListPrice(VARIANT_PRICE.orderInsertWithExplanation),
    oiNo: externalizeListPrice(VARIANT_PRICE.orderInsertNoExplanation),
  };

  return (
    <>
      <AppBar showBackButton onBackClick={() => router.push('/')} title="외부지문 변형문제 주문" />
      <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
        <div className="mx-auto max-w-3xl px-4">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-bold mb-2" style={{ color: '#101820' }}>
              외부지문 변형문제 주문
            </h1>
            <p className="text-sm text-gray-500">
              자체 지문·타 출판사 지문을 붙여넣으면 그 지문으로 변형문제를 만들어 드립니다
            </p>
          </div>

          {/* 가격·안내 */}
          <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700 leading-relaxed">
            <p className="font-semibold text-slate-900 mb-1">외부지문 단가</p>
            <p>
              기본난도 <b>{price.base}원</b> · 고난도 <b>{price.advanced}원</b> · 순서·삽입 해설 포함{' '}
              <b>{price.oiWith}원</b> / 문제·답만 <b>{price.oiNo}원</b> (문항당)
            </p>
            <p className="mt-1 text-[13px] text-slate-500">
              새로 등록해 만드는 지문이라 <b className="text-slate-700">무료 유형·멤버십 무료 문항이 적용되지 않습니다.</b>{' '}
              포인트 결제·대량 할인은 그대로 됩니다. 등록한 지문은 선생님 계정에서만 쓰입니다.
            </p>
          </div>

          {!authChecked ? (
            <p className="text-center text-gray-500 py-10">확인 중…</p>
          ) : !loggedIn ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
              <p className="text-slate-800 font-semibold mb-1">로그인한 회원만 주문할 수 있어요</p>
              <p className="text-sm text-slate-500 mb-4">등록한 지문은 선생님 계정 전용으로 보관됩니다.</p>
              <Link
                href="/login?from=/external"
                className="inline-block rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
              >
                로그인하고 주문하기
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
                <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                  자료 이름 <span className="font-normal text-slate-400">(선택)</span>
                </label>
                <input
                  value={batchTitle}
                  onChange={(e) => setBatchTitle(e.target.value)}
                  maxLength={40}
                  placeholder="예: 2학기 중간고사 프린트"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
                <p className="mt-1 text-[12px] text-slate-400">비워 두면 오늘 날짜로 붙습니다. 주문서와 자료 파일에 이 이름이 쓰입니다.</p>
              </div>

              <div className="space-y-3">
                {drafts.map((d, i) => {
                  const len = d.text.trim().length;
                  return (
                    <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-bold text-slate-900 shrink-0">지문 {i + 1}</span>
                        <input
                          value={d.title}
                          onChange={(e) => update(i, { title: e.target.value })}
                          maxLength={60}
                          placeholder="제목·출처 (선택)"
                          className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-300"
                        />
                        <button
                          type="button"
                          onClick={() => removeDraft(i)}
                          className="shrink-0 text-xs text-slate-400 hover:text-red-500"
                        >
                          삭제
                        </button>
                      </div>
                      <textarea
                        value={d.text}
                        onChange={(e) => update(i, { text: e.target.value })}
                        rows={8}
                        placeholder="영어 지문 원문을 붙여넣어 주세요. 지문마다 칸을 나눠 주세요."
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-slate-400"
                      />
                      <p className={`mt-1 text-right text-[11px] tabular-nums ${len > maxChars || (len > 0 && len < minChars) ? 'text-red-500' : 'text-slate-400'}`}>
                        {len.toLocaleString()}자
                      </p>
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={addDraft}
                disabled={drafts.length >= maxPassages}
                className="mt-3 w-full rounded-xl border border-dashed border-slate-300 bg-white py-3 text-sm font-semibold text-slate-600 hover:border-slate-400 hover:text-slate-800 disabled:opacity-40"
              >
                + 지문 추가 ({drafts.length}/{maxPassages})
              </button>

              {(problems.length > 0 || error) && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 space-y-0.5">
                  {problems.map((p) => (
                    <p key={p}>{p}</p>
                  ))}
                  {error && <p>{error}</p>}
                </div>
              )}

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => void goNext()}
                  disabled={!canNext}
                  className="rounded-xl bg-slate-900 px-8 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {submitting ? '지문 등록 중…' : `다음: 문제 설정 → (${filled.length}개 지문)`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
