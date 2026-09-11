'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
 * 「내가 등록한 지문」에서 예전에 올린 지문을 다시 보고 고치고, 골라서 바로 다시 주문할 수 있다.
 * 이미 문제가 만들어진 지문은 본문을 잠근다(만든 문제와 어긋나지 않게) — 제목만 고칠 수 있다.
 */

type Step = 'input' | 'questions';
type Draft = { title: string; text: string };
type Registered = { textbook: string; lessons: string[] };
type LibPassage = {
  id: string;
  number: string;
  sourceKey: string;
  title: string;
  text: string;
  questionCount: number;
  editedAt: string | null;
};
type LibBatch = { chapter: string; createdAt: string | null; passages: LibPassage[] };

const EMPTY: Draft = { title: '', text: '' };
const { maxPassages, minChars, maxChars } = EXTERNAL_PASSAGE_LIMITS;

/** 지문 한 개의 길이·언어 검사(서버와 같은 기준). 문제가 없으면 null */
function passageProblem(text: string, label: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (t.length < minChars) return `${label}이 너무 짧습니다 (${minChars}자 이상)`;
  if (t.length > maxChars) return `${label}이 너무 깁니다 (${maxChars}자 이하)`;
  if (englishLetterRatio(t) < EXTERNAL_MIN_ENGLISH_RATIO) return `${label}: 영어 지문만 받을 수 있어요`;
  return null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

export default function ExternalOrderPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [step, setStep] = useState<Step>('input');
  const [registered, setRegistered] = useState<Registered | null>(null);

  /* 새 지문 붙여넣기 */
  const [batchTitle, setBatchTitle] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([{ ...EMPTY }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  /** 마지막으로 등록한 붙여넣기 — 되돌아와서 그대로 넘어가면 같은 지문을 또 등록하지 않는다 */
  const [pasteReg, setPasteReg] = useState<{ sig: string; textbook: string; lessons: string[] } | null>(null);

  /* 내가 등록한 지문 */
  const [library, setLibrary] = useState<LibBatch[] | null>(null);
  const [libTextbook, setLibTextbook] = useState('');
  const [libLoading, setLibLoading] = useState(false);
  const [libOpen, setLibOpen] = useState(true);
  const [openBatches, setOpenBatches] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editText, setEditText] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  useEffect(() => {
    fetchAuthMe()
      .then((d) => setLoggedIn(!!d?.user))
      .catch(() => setLoggedIn(false))
      .finally(() => setAuthChecked(true));
  }, []);

  const loadLibrary = useCallback(async () => {
    setLibLoading(true);
    try {
      const r = await fetch('/api/my/external-passages', { credentials: 'include', cache: 'no-store' });
      const d = await r.json().catch(() => ({}));
      if (r.ok && Array.isArray(d?.batches)) {
        setLibrary(d.batches as LibBatch[]);
        setLibTextbook(typeof d.textbook === 'string' ? d.textbook : '');
      } else {
        setLibrary([]);
      }
    } catch {
      setLibrary([]);
    } finally {
      setLibLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) void loadLibrary();
  }, [loggedIn, loadLibrary]);

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
    .map((d, i) => passageProblem(d.text, `지문 ${i + 1}`))
    .filter((x): x is string => !!x);
  const canNext = filled.length > 0 && problems.length === 0 && !submitting;
  const libTotal = library ? library.reduce((a, b) => a + b.passages.length, 0) : 0;

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const addDraft = () =>
    setDrafts((prev) => (prev.length >= maxPassages ? prev : [...prev, { ...EMPTY }]));
  const removeDraft = (i: number) =>
    setDrafts((prev) => (prev.length <= 1 ? [{ ...EMPTY }] : prev.filter((_, j) => j !== i)));

  const goQuestions = (reg: Registered) => {
    setRegistered(reg);
    setStep('questions');
    window.scrollTo(0, 0);
  };

  const goNext = async () => {
    if (!canNext) return;
    if (pasteReg && pasteReg.sig === sig) {
      goQuestions({ textbook: pasteReg.textbook, lessons: pasteReg.lessons });
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
      setPasteReg({ sig, textbook: d.textbook, lessons: d.lessons });
      void loadLibrary();
      goQuestions({ textbook: d.textbook, lessons: d.lessons });
    } catch {
      setError('네트워크 오류로 지문을 등록하지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── 내가 등록한 지문 ── */
  const toggleBatch = (chapter: string) =>
    setOpenBatches((prev) => {
      const n = new Set(prev);
      if (n.has(chapter)) n.delete(chapter);
      else n.add(chapter);
      return n;
    });
  const togglePick = (key: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const toggleBatchPick = (b: LibBatch) =>
    setPicked((prev) => {
      const n = new Set(prev);
      const all = b.passages.every((p) => n.has(p.sourceKey));
      b.passages.forEach((p) => (all ? n.delete(p.sourceKey) : n.add(p.sourceKey)));
      return n;
    });

  const orderPicked = () => {
    if (!library || picked.size === 0 || !libTextbook) return;
    /* 목록에 보이는 순서대로 — 고른 순서가 아니라 자료·번호 순이 주문서에 찍힌다 */
    const lessons = library.flatMap((b) => b.passages.map((p) => p.sourceKey)).filter((k) => picked.has(k));
    goQuestions({ textbook: libTextbook, lessons });
  };

  const startEdit = (p: LibPassage) => {
    setEditingId(p.id);
    setEditTitle(p.title);
    setEditText(p.text);
    setEditError('');
  };

  const saveEdit = async (p: LibPassage) => {
    const locked = p.questionCount > 0;
    const textChanged = !locked && editText.trim() !== p.text.trim();
    if (textChanged) {
      const problem = passageProblem(editText, p.number);
      if (problem) {
        setEditError(problem);
        return;
      }
    }
    setEditSaving(true);
    setEditError('');
    try {
      const r = await fetch('/api/my/external-passages', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, title: editTitle, ...(textChanged ? { text: editText } : {}) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) {
        setEditError(typeof d?.error === 'string' ? d.error : '저장하지 못했습니다.');
        return;
      }
      setEditingId(null);
      await loadLibrary();
    } catch {
      setEditError('네트워크 오류로 저장하지 못했습니다.');
    } finally {
      setEditSaving(false);
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
              {/* 내가 등록한 지문 — 다시 보고·고치고·골라서 다시 주문 */}
              <div className="mb-6 rounded-xl border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => setLibOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-sm font-semibold text-slate-900">
                    📂 내가 등록한 지문
                    {library ? <span className="ml-1 font-normal text-slate-400">({libTotal}개)</span> : null}
                  </span>
                  <span className="text-xs text-slate-400">{libOpen ? '접기' : '펼치기'}</span>
                </button>
                {libOpen && (
                  <div className="border-t border-slate-100 px-4 py-3">
                    {libLoading && !library ? (
                      <p className="py-2 text-sm text-slate-400">불러오는 중…</p>
                    ) : !library || library.length === 0 ? (
                      <p className="py-2 text-sm text-slate-400">
                        아직 등록한 지문이 없어요. 아래에 붙여넣어 등록하면 여기서 다시 보고 고칠 수 있어요.
                      </p>
                    ) : (
                      <>
                        <div className="space-y-2">
                          {library.map((b) => {
                            const open = openBatches.has(b.chapter);
                            const allPicked = b.passages.length > 0 && b.passages.every((p) => picked.has(p.sourceKey));
                            const used = b.passages.filter((p) => p.questionCount > 0).length;
                            return (
                              <div key={b.chapter} className="rounded-lg border border-slate-200">
                                <div className="flex items-center gap-2 px-3 py-2">
                                  <input
                                    type="checkbox"
                                    checked={allPicked}
                                    onChange={() => toggleBatchPick(b)}
                                    className="h-4 w-4 shrink-0"
                                    aria-label={`${b.chapter} 전체 선택`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => toggleBatch(b.chapter)}
                                    className="flex-1 min-w-0 text-left"
                                  >
                                    <span className="text-sm font-medium text-slate-900">{b.chapter}</span>
                                    <span className="ml-2 text-xs text-slate-400">
                                      {b.passages.length}개 지문
                                      {b.createdAt ? ` · ${fmtDate(b.createdAt)}` : ''}
                                      {used > 0 ? ` · 문제 만든 지문 ${used}개` : ''}
                                    </span>
                                  </button>
                                  <span className="text-xs text-slate-400">{open ? '▾' : '▸'}</span>
                                </div>
                                {open && (
                                  <ul className="border-t border-slate-100 divide-y divide-slate-100">
                                    {b.passages.map((p) => {
                                      const locked = p.questionCount > 0;
                                      const editing = editingId === p.id;
                                      return (
                                        <li key={p.id} className="px-3 py-2">
                                          <div className="flex items-start gap-2">
                                            <input
                                              type="checkbox"
                                              checked={picked.has(p.sourceKey)}
                                              onChange={() => togglePick(p.sourceKey)}
                                              className="mt-1 h-4 w-4 shrink-0"
                                              aria-label={`${p.number} 선택`}
                                            />
                                            <div className="flex-1 min-w-0">
                                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                                <span className="text-xs font-bold text-slate-700">{p.number}</span>
                                                <span className="text-sm text-slate-800 truncate">
                                                  {p.title || <span className="text-slate-400">제목 없음</span>}
                                                </span>
                                                {locked && (
                                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                                    문제 {p.questionCount}개 · 본문 고정
                                                  </span>
                                                )}
                                                {p.editedAt && <span className="text-[10px] text-slate-400">수정됨</span>}
                                              </div>
                                              {!editing && (
                                                <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">{p.text}</p>
                                              )}
                                            </div>
                                            {!editing && (
                                              <button
                                                type="button"
                                                onClick={() => startEdit(p)}
                                                className="shrink-0 text-xs font-semibold text-slate-600 hover:text-slate-900"
                                              >
                                                {locked ? '보기' : '보기·수정'}
                                              </button>
                                            )}
                                          </div>
                                          {editing && (
                                            <div className="mt-2 pl-6 space-y-2">
                                              <input
                                                value={editTitle}
                                                onChange={(e) => setEditTitle(e.target.value)}
                                                maxLength={60}
                                                placeholder="제목·출처 (선택)"
                                                className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-slate-300"
                                              />
                                              <textarea
                                                value={editText}
                                                onChange={(e) => setEditText(e.target.value)}
                                                readOnly={locked}
                                                rows={10}
                                                className={`w-full rounded-lg border px-3 py-2 text-sm leading-relaxed focus:outline-none ${
                                                  locked
                                                    ? 'border-slate-200 bg-slate-50 text-slate-600'
                                                    : 'border-slate-300 focus:ring-2 focus:ring-slate-400'
                                                }`}
                                              />
                                              {locked && (
                                                <p className="text-[12px] text-slate-500">
                                                  이 지문으로 이미 문제가 만들어져 본문은 고칠 수 없어요(만든 문제와 어긋나지 않게).
                                                  제목만 바꿀 수 있고, 본문을 바꾸려면 새 지문으로 등록해 주세요.
                                                </p>
                                              )}
                                              <div className="flex items-center justify-between">
                                                <span className="text-[11px] tabular-nums text-slate-400">
                                                  {editText.trim().length.toLocaleString()}자
                                                </span>
                                                <div className="flex gap-2">
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setEditingId(null);
                                                      setEditError('');
                                                    }}
                                                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                                                  >
                                                    닫기
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => void saveEdit(p)}
                                                    disabled={editSaving}
                                                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40"
                                                  >
                                                    {editSaving ? '저장 중…' : '저장'}
                                                  </button>
                                                </div>
                                              </div>
                                              {editError && <p className="text-xs text-red-600">{editError}</p>}
                                            </div>
                                          )}
                                        </li>
                                      );
                                    })}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span className="text-xs text-slate-500">
                            {picked.size > 0 ? `${picked.size}개 지문 선택됨` : '다시 주문할 지문을 고르면 붙여넣지 않고 바로 주문할 수 있어요'}
                          </span>
                          <button
                            type="button"
                            onClick={orderPicked}
                            disabled={picked.size === 0}
                            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-40"
                          >
                            선택한 지문으로 주문 →
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* 새 지문 붙여넣기 */}
              <h2 className="mb-2 text-sm font-semibold text-slate-800">새 지문 붙여넣기</h2>
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
                <p className="mt-1 text-[12px] text-slate-400">
                  비워 두면 오늘 날짜로 붙습니다. 주문서와 자료 파일에 이 이름이 쓰입니다.
                </p>
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
                      <p
                        className={`mt-1 text-right text-[11px] tabular-nums ${
                          len > maxChars || (len > 0 && len < minChars) ? 'text-red-500' : 'text-slate-400'
                        }`}
                      >
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
