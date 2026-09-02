'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppBar from '../components/AppBar';
import {
  ESSAY_WORKBOOK_PRICE_PER_SOURCE,
  quoteEssayWorkbook,
} from '@/lib/essay-workbook-pricing';
import { groupPassages, unitOf } from '@/lib/essay-workbook-grouping';
import { saveOrderToDb } from '@/lib/orders';
import { ORDER_PREFIX } from '@/lib/orderPrefix';

const KAKAO_INQUIRY_URL =
  process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

interface TextbookRow { textbook: string; sourceCount: number }
/** 워크북 유형 — 조건영작배열 / 글의의미 서술형. 지문마다 보유 난도가 다르다. */
type WorkbookKind = 'arrange' | 'meaning';
const KIND_LABEL: Record<WorkbookKind, string> = {
  arrange: '조건영작배열',
  meaning: '글의의미 서술형',
};
interface PassageRow {
  sourceKey: string;
  /** 유형별 보유 난도. 비어 있으면 그 유형은 이 지문에 없다. */
  arrange: string[];
  meaning: string[];
  difficulties: string[];
  isMeaningType: boolean;
}
const diffsOf = (p: PassageRow, kind: WorkbookKind) =>
  (kind === 'meaning' ? p.meaning : p.arrange) ?? [];
interface SampleQuestion { prompt: string; points: number | null; conditions: string[]; bogi: string }
interface Sample {
  key: string; label: string; textbook: string; sourceKey: string; difficulty: string;
  배점: string; passage: string; questions: SampleQuestion[];
}

/** 「… 23번」 에서 번호만 짧게 */
function shortLabel(sourceKey: string, textbook: string): string {
  const t = sourceKey.startsWith(textbook) ? sourceKey.slice(textbook.length).trim() : sourceKey;
  return t || sourceKey;
}

/**
 * 지문 카드 — 단원 묶음과 평면 격자 양쪽에서 같은 모양으로 쓴다.
 * 묶음 안에서는 단원명이 머리에 이미 있으므로 번호만 남겨 짧게 보인다.
 */
function PassageChip({
  p, on, textbook, unit, kind, onToggle,
}: {
  p: PassageRow; on: boolean; textbook: string; unit?: string;
  kind: WorkbookKind; onToggle: (key: string) => void;
}) {
  const label = shortLabel(p.sourceKey, textbook);
  const text = unit && label.startsWith(unit) ? (label.slice(unit.length).trim() || label) : label;
  return (
    <button
      type="button"
      onClick={() => onToggle(p.sourceKey)}
      aria-pressed={on}
      className={`rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors ${
        on ? 'border-blue-600 bg-blue-50 font-bold text-blue-800' : 'border-gray-200 bg-white hover:border-blue-300'
      }`}
    >
      <span className="block truncate">{text}</span>
      <span className="mt-0.5 block text-[10px] text-gray-500">
        {diffsOf(p, kind).length > 0
          ? `${diffsOf(p, kind).length}난도`
          : /* 아직 만들지 않은 지문 — 주문이 들어오면 제작한다 */
            <span className="text-amber-700">제작</span>}
      </span>
    </button>
  );
}

export default function EssayWorkbookPage() {
  const [textbooks, setTextbooks] = useState<TextbookRow[]>([]);
  const [needLogin, setNeedLogin] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [selectedTextbook, setSelectedTextbook] = useState('');
  const [passages, setPassages] = useState<PassageRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  /** 지문 번호 검색 — 「12강」·「05번」 처럼 부분만 쳐도 걸린다 */
  const [pq, setPq] = useState('');
  /** 주문할 워크북 유형. 교재가 한 유형만 가지면 그쪽으로 자동으로 맞춘다. */
  const [kind, setKind] = useState<WorkbookKind>('arrange');
  /** 접어 둔 단원. 단원이 많으면 처음엔 모두 접어 목차처럼 보여 준다. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** 교재 목록 접기 — 고르고 나면 자리를 비켜 준다 */
  const [pickerOpen, setPickerOpen] = useState(true);

  const [samples, setSamples] = useState<Sample[]>([]);
  const [openSample, setOpenSample] = useState<Sample | null>(null);

  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/essay-workbook/catalog')
      .then((r) => r.json())
      .then((d) => {
        setTextbooks(Array.isArray(d?.textbooks) ? d.textbooks : []);
        setNeedLogin(d?.needLogin === true);
        setCatalogLoaded(true);
      })
      .catch(() => {});
    fetch('/api/essay-workbook/sample')
      .then((r) => r.json())
      .then((d) => setSamples(Array.isArray(d?.samples) ? d.samples : []))
      .catch(() => {});
  }, []);

  const loadPassages = useCallback(async (textbook: string) => {
    setLoading(true);
    setSelectedKeys([]);
    setPq('');
    try {
      const r = await fetch(`/api/essay-workbook/passages?textbook=${encodeURIComponent(textbook)}`);
      const d = await r.json();
      setPassages(Array.isArray(d?.passages) ? d.passages : []);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 교재를 바꾸면 담아 둔 지문이 사라진다 — 실수로 날리지 않게 한 번 묻는다. */
  const pickTextbook = (name: string) => {
    if (name === selectedTextbook) { setPickerOpen(false); return; }
    if (selectedKeys.length > 0 &&
        !window.confirm(`담아 둔 지문 ${selectedKeys.length}개가 사라집니다. 교재를 바꿀까요?`)) return;
    setSelectedTextbook(name);
    setPickerOpen(false);
  };

  useEffect(() => {
    if (selectedTextbook) loadPassages(selectedTextbook);
    else setPassages([]);
  }, [selectedTextbook, loadPassages]);

  const quote = useMemo(
    () => quoteEssayWorkbook(selectedKeys.length, passages.length),
    [selectedKeys.length, passages.length],
  );

  const filteredTextbooks = useMemo(() => {
    const k = q.trim();
    return k ? textbooks.filter((t) => t.textbook.includes(k)) : textbooks;
  }, [textbooks, q]);

  const toggle = (key: string) =>
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  /** 이 교재가 유형별로 몇 지문을 갖고 있나 — 0 이면 그 유형은 고를 수 없다. */
  const kindCounts = useMemo(() => ({
    arrange: passages.filter((p) => (p.arrange ?? []).length > 0).length,
    meaning: passages.filter((p) => (p.meaning ?? []).length > 0).length,
  }), [passages]);

  /* 재고가 없는 유형도 고를 수 있다 — 주문이 들어오면 제작하므로 되돌리지 않는다. */

  /** 검색어가 걸린 지문. 재고 유무와 상관없이 모두 담을 수 있다. */
  const shownPassages = useMemo(() => {
    const k = pq.trim().toLowerCase();
    if (!k) return passages;
    return passages.filter((p) =>
      shortLabel(p.sourceKey, selectedTextbook).toLowerCase().includes(k),
    );
  }, [passages, pq, selectedTextbook]);

  /** 단원별 묶음. 묶어도 의미 없는 교재(모의고사 등)는 null → 평면 격자로 그린다. */
  const groups = useMemo(
    () => groupPassages(shownPassages, (p) => shortLabel(p.sourceKey, selectedTextbook)),
    [shownPassages, selectedTextbook],
  );

  /* 단원이 여럿이면 처음엔 접어 둔다 — 목차부터 보이는 편이 고르기 쉽다. */
  useEffect(() => {
    if (!groups) { setCollapsed(new Set()); return; }
    setCollapsed(groups.length > 5 ? new Set(groups.map((g) => g.unit)) : new Set());
  }, [groups]);

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  /* 유형이 달라도 지문 목록은 같으므로 담아 둔 것을 그대로 둔다. */
  const switchKind = (next: WorkbookKind) => setKind(next);

  /** 단원 통째로 담기/빼기 — 담긴 게 하나라도 있으면 빼는 쪽으로 동작한다. */
  const toggleUnit = (keys: string[]) => {
    const allIn = keys.every((k) => selectedSet.has(k));
    setSelectedKeys((prev) =>
      allIn ? prev.filter((k) => !keys.includes(k)) : [...prev, ...keys.filter((k) => !prev.includes(k))],
    );
  };

  /**
   * 담은 지문들의 난도 구성. 조건영작배열은 4난도지만 글의의미는 1난도뿐이라
   * 「4난도」로 못박아 두면 실제와 어긋난다.
   */
  const difficultyNote = useMemo(() => {
    const counts = new Set(
      passages
        .filter((p) => selectedKeys.includes(p.sourceKey))
        .map((p) => diffsOf(p, kind).length)
        .filter((n) => n > 0),
    );
    if (counts.size === 0) return '';
    if (counts.size === 1) return `${[...counts][0]}종`;
    return `${Math.min(...counts)}~${Math.max(...counts)}종`;
  }, [passages, selectedKeys, kind]);

  /** 담은 것 중 아직 만들지 않은 지문 — 주문서·요약에서 따로 알린다. */
  const toMakeCount = useMemo(
    () =>
      passages.filter((p) => selectedKeys.includes(p.sourceKey) && diffsOf(p, kind).length === 0)
        .length,
    [passages, selectedKeys, kind],
  );

  /** 담은 지문을 단원별로 — 카드 요약과 주문서 텍스트가 같은 기준을 쓴다. */
  const selectedByUnit = useMemo(() => {
    const byUnit = new Map<string, string[]>();
    for (const k of selectedKeys) {
      const label = shortLabel(k, selectedTextbook);
      const u = unitOf(label);
      const rest = label.slice(u.length).trim() || label;
      const arr = byUnit.get(u);
      if (arr) arr.push(rest);
      else byUnit.set(u, [rest]);
    }
    return [...byUnit.entries()];
  }, [selectedKeys, selectedTextbook]);

  const orderText = useMemo(() => {
    if (!selectedTextbook || selectedKeys.length === 0) return '';
    return [
      '=== 서술형 워크북 주문 ===',
      `교재: ${selectedTextbook}`,
      `유형: ${KIND_LABEL[kind]}`,
      `지문 ${selectedKeys.length}개${difficultyNote ? ` (보유분 난도 ${difficultyNote} PDF)` : ''}`,
      ...(toMakeCount > 0 ? [`※ 이 중 ${toMakeCount}개는 제작 요청입니다 (전달까지 시간이 걸립니다)`] : []),
      /* 20개를 20줄로 늘어놓으면 카톡에서 읽기 어렵다 — 단원별로 접어서 적는다. */
      ...selectedByUnit.map(([u, list]) => `  · ${u} — ${list.join(', ')}`),
      '',
      `기본 금액: ${quote.basePrice.toLocaleString()}원`,
      ...(quote.discountPct > 0
        ? [`${quote.discountLabel} 할인 ${quote.discountPct}%: -${quote.discountAmount.toLocaleString()}원`]
        : []),
      `최종 금액: ${quote.finalPrice.toLocaleString()}원`,
      '',
      '※ 서술형 워크북은 PDF 로 제공됩니다.',
    ].join('\n');
  }, [selectedTextbook, selectedKeys, selectedByUnit, quote, kind, difficultyNote, toMakeCount]);

  /**
   * 주문 접수 — 다른 주문서(분석지·번들 등)와 같은 경로로 orders 에 저장한다.
   * 예전에는 주문서를 복사해 카톡으로 보내야 해서 관리자 화면에 남지 않았다.
   */
  const submitOrder = async () => {
    if (!orderText || submitting) return;
    setSubmitting(true);
    try {
      const res = await saveOrderToDb(orderText, ORDER_PREFIX.BOOK_ESSAY_WORKBOOK, 0, {
        /* 나중에 제작 파이프라인이 읽을 수 있게 구조화해 둔다 */
        flow: 'essayWorkbook',
        textbook: selectedTextbook,
        kind,
        kindLabel: KIND_LABEL[kind],
        sourceKeys: selectedKeys,
        toMakeCount,
        pricePerSource: ESSAY_WORKBOOK_PRICE_PER_SOURCE,
        totalPrice: quote.finalPrice,
      });
      if (res.ok && res.id) router.push('/order/done?id=' + res.id);
      else alert(res.error || '주문 저장에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyOrder = async () => {
    if (!orderText) return;
    try {
      await navigator.clipboard.writeText(orderText);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = orderText;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <AppBar title="서술형 워크북" showBackButton onBackClick={() => { window.location.href = '/'; }} />
      <div className="min-h-screen bg-[#F8FAFC]">
        <div className="container mx-auto max-w-5xl px-4 py-8">
          <Link href="/" className="text-sm text-blue-600 no-underline hover:underline">← 메인 화면으로</Link>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-xl font-extrabold text-gray-900">서술형 워크북</h1>
                <p className="mt-1 text-sm text-gray-600">
                  지문을 고르시면 서술형 연습 자료를 제작해 PDF 로 보내 드립니다.
                </p>
              </div>
              {/* 모의고사 서술형은 payperic 에서 판다 — 여기서는 부교재만 취급 */}
              <a
                href="https://payperic.com"
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-800 no-underline transition-colors hover:bg-emerald-100"
              >
                모의고사 서술형 워크북은 <b className="text-emerald-900 underline">페이퍼릭</b> →
              </a>
            </div>

            {/* 제공 형식 안내 — 워크북(PDF 전용) vs 변형문제(HWP) 차이 */}
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] leading-relaxed text-rose-800/90">
              <p className="text-[13px] font-extrabold text-rose-900">📄 서술형 워크북 vs ✍️ 서술형 변형문제</p>
              <p className="mt-1.5">
                • <b>서술형 워크북</b> (이 메뉴) — 난도별로 짜 둔 <b>정해진 양식</b>의 자료를 <b>PDF로만</b> 드립니다. <b>편집은 불가</b>합니다.
              </p>
              <p className="mt-1">
                • <b>서술형 변형문제</b> — 지문마다 문제를 <b>새로 제작</b>해 <b>한글파일(HWP)</b>로 드립니다. 직접 <b>편집·수정</b>이 가능합니다.{' '}
                <Link href="/essay" className="font-bold text-rose-900 underline">서술형문제 주문제작 →</Link>
              </p>
            </div>

            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] leading-relaxed text-gray-700">
              <b>가격</b> — 지문 1개당 {ESSAY_WORKBOOK_PRICE_PER_SOURCE.toLocaleString()}원
              (그 지문의 <b>난도 전부 한 묶음</b>). 조건영작배열은 기본·중·고·최고 4난도입니다.
            </div>

            {/* 샘플 — 화면으로 보는 미리보기는 유형을 고르는 자리(2. 지문 선택)에 있다.
                여기는 교재를 고르기 전(로그인 전 포함)에도 자료를 확인할 수 있게
                실제 PDF 내려받기만 남긴다. 난도 수는 유형마다 달라 라벨에 못박지 않는다. */}
            {samples.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-gray-500">샘플 PDF</span>
                {samples.map((s) => (
                  <a
                    key={s.key}
                    href={`/api/essay-workbook/sample-pdf?type=${s.key}`}
                    className="rounded-full border border-emerald-500 bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-800 no-underline hover:bg-emerald-100"
                  >
                    📥 {s.label}
                  </a>
                ))}
                {/* 난도별 구성·실제 지면 예시는 블로그 글이 더 자세하다 */}
                <a
                  href="https://www.payperic.com/blog/conditional-writing-arrangement"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full border border-gray-300 bg-white px-3 py-1 text-[12px] font-semibold text-gray-600 no-underline hover:bg-gray-50"
                >
                  자료 안내 상세 보기 →
                </a>
              </div>
            )}
          </div>

          {/* 1. 교재 */}
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-gray-900">1. 교재 선택</h2>
              {/* 고른 뒤에는 목록이 자리만 차지한다 — 접어 두고 「변경」으로 다시 연다 */}
              {selectedTextbook && !pickerOpen && (
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="rounded-lg border border-gray-300 px-2.5 py-1 text-[12px] text-gray-600 hover:bg-gray-50"
                >
                  교재 변경
                </button>
              )}
            </div>

            {selectedTextbook && !pickerOpen ? (
              <p className="mt-2 flex items-center gap-2 text-[13px] font-bold text-blue-800">
                <span className="rounded-md bg-blue-50 px-2 py-1">{selectedTextbook}</span>
                <span className="text-[11px] font-normal text-gray-500">{passages.length}지문</span>
              </p>
            ) : (
            <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="교재 검색 (예: 수능특강, 올림포스)"
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <div className="mt-3 grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {filteredTextbooks.map((t) => (
                <button
                  key={t.textbook}
                  type="button"
                  onClick={() => pickTextbook(t.textbook)}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-[13px] transition-colors ${
                    selectedTextbook === t.textbook
                      ? 'border-blue-600 bg-blue-50 font-bold text-blue-800'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300'
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{t.textbook}</span>
                  <span className="ml-2 shrink-0 text-[11px] text-gray-500">{t.sourceCount}지문</span>
                </button>
              ))}
              {filteredTextbooks.length === 0 && catalogLoaded && (
                needLogin ? (
                  <div className="col-span-full rounded-xl border border-amber-200 bg-amber-50 px-4 py-6 text-center">
                    <p className="text-[13px] font-bold text-amber-900">로그인이 필요합니다</p>
                    <p className="mt-1 text-[12px] text-amber-800/90">
                      서술형 워크북은 관리자가 열어 드린 교재만 주문하실 수 있어요.
                    </p>
                    <Link
                      href="/login?from=/essay-workbook"
                      className="mt-3 inline-block rounded-lg bg-amber-600 px-4 py-2 text-[12px] font-bold text-white no-underline hover:bg-amber-700"
                    >
                      로그인하기 →
                    </Link>
                  </div>
                ) : textbooks.length === 0 ? (
                  <div className="col-span-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-6 text-center">
                    <p className="text-[13px] font-bold text-gray-700">이용 가능한 교재가 없습니다</p>
                    <p className="mt-1 text-[12px] text-gray-600">
                      서술형 워크북은 관리자가 열어 드린 교재만 주문하실 수 있어요.
                      필요한 교재가 있으시면 카카오톡으로 문의해 주세요.
                    </p>
                    <a
                      href={KAKAO_INQUIRY_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-block rounded-lg bg-[#FEE500] px-4 py-2 text-[12px] font-bold text-[#3B1E1E] no-underline hover:brightness-95"
                    >
                      💬 교재 요청하기
                    </a>
                  </div>
                ) : (
                  <p className="col-span-full py-6 text-center text-sm text-gray-400">검색 결과가 없습니다.</p>
                )
              )}
            </div>
            </>
            )}
          </div>

          {/* 2. 지문 */}
          {selectedTextbook && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-gray-900">2. 지문 선택 — {selectedTextbook}</h2>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedKeys(shownPassages.map((p) => p.sourceKey))}
                    className="rounded-lg border border-gray-300 px-2.5 py-1 text-[12px] text-gray-600 hover:bg-gray-50"
                  >
                    전체 선택
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedKeys([])}
                    className="rounded-lg border border-gray-300 px-2.5 py-1 text-[12px] text-gray-600 hover:bg-gray-50"
                  >
                    해제
                  </button>
                </div>
              </div>

              {/* 유형 고르기 — 고르는 자리에서 바로 그 유형 샘플을 볼 수 있게 붙인다.
                  맨 위 소개 카드에도 샘플이 있지만 거기까지 올라갔다 와야 했다. */}
              {(
                <div className="mt-3 flex flex-wrap gap-2">
                  {(['arrange', 'meaning'] as WorkbookKind[]).map((k) => {
                    const sample = samples.find((sp) => sp.key === k);
                    return (
                      <div key={k} className="flex items-stretch">
                        <button
                          type="button"
                          onClick={() => switchKind(k)}
                          aria-pressed={kind === k}
                          className={`border px-3 py-2 text-[12.5px] font-bold transition-colors ${
                            sample ? 'rounded-l-xl' : 'rounded-xl'
                          } ${
                            kind === k
                              ? 'border-blue-600 bg-blue-50 text-blue-800'
                              : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
                          }`}
                        >
                          {KIND_LABEL[k]}
                          <span className="ml-1.5 text-[11px] font-normal text-gray-500">
                            {kindCounts[k] > 0 ? `보유 ${kindCounts[k]}지문` : '주문 제작'}
                          </span>
                        </button>
                        {sample && (
                          <button
                            type="button"
                            onClick={() => setOpenSample(sample)}
                            className={`rounded-r-xl border border-l-0 px-2.5 py-2 text-[11.5px] font-semibold transition-colors ${
                              kind === k
                                ? 'border-blue-600 bg-white text-blue-700 hover:bg-blue-50'
                                : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'
                            }`}
                          >
                            📄 샘플
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* 재고가 없는 지문도 담을 수 있다는 것을 미리 알린다 */}
              {shownPassages.some((p) => diffsOf(p, kind).length === 0) && (
                <p className="mt-2 text-[11.5px] text-amber-700">
                  <b className="text-amber-800">제작</b> 표시된 지문은 아직 만들어 두지 않았습니다 —
                  주문해 주시면 제작해 드립니다(제작분은 전달까지 시간이 걸립니다).
                </p>
              )}

              {passages.length > 12 && (
                <input
                  value={pq}
                  onChange={(e) => setPq(e.target.value)}
                  placeholder="지문 찾기 (예: 12강, 05번)"
                  className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              )}

              {loading ? (
                <p className="py-8 text-center text-sm text-gray-400">불러오는 중…</p>
              ) : shownPassages.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-400">
                  {pq.trim() ? '찾는 지문이 없습니다.' : '지문이 없습니다.'}
                </p>
              ) : groups ? (
                <>
                  {groups.length > 1 && (
                    <div className="mt-3 flex gap-2 text-[12px]">
                      <button
                        type="button"
                        onClick={() => setCollapsed(new Set())}
                        className="text-blue-600 hover:underline"
                      >
                        모두 펼치기
                      </button>
                      <span className="text-gray-300">·</span>
                      <button
                        type="button"
                        onClick={() => setCollapsed(new Set(groups.map((g) => g.unit)))}
                        className="text-blue-600 hover:underline"
                      >
                        모두 접기
                      </button>
                    </div>
                  )}
                  <div className="mt-2 space-y-2">
                    {groups.map((g) => {
                      const keys = g.items.map((it) => it.sourceKey);
                      const picked = keys.filter((k) => selectedSet.has(k)).length;
                      const isOpen = !collapsed.has(g.unit);
                      return (
                        <div key={g.unit} className="overflow-hidden rounded-xl border border-gray-200">
                          <div
                            className={`flex items-center gap-2 px-3 py-2 ${picked > 0 ? 'bg-blue-50' : 'bg-gray-50'}`}
                          >
                            {/* 단원 통째로 담기 — 「3강만」 같은 선택이 한 번에 끝난다 */}
                            <input
                              type="checkbox"
                              checked={picked === keys.length}
                              ref={(el) => { if (el) el.indeterminate = picked > 0 && picked < keys.length; }}
                              onChange={() => toggleUnit(keys)}
                              className="h-4 w-4 accent-blue-600"
                              aria-label={`${g.unit} 전체 선택`}
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setCollapsed((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(g.unit)) next.delete(g.unit);
                                  else next.add(g.unit);
                                  return next;
                                })
                              }
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <span className="truncate text-[13px] font-bold text-gray-800">{g.unit}</span>
                              <span className="shrink-0 text-[11px] text-gray-500">
                                {picked > 0 ? `${picked}/${keys.length}` : `${keys.length}지문`}
                              </span>
                              <span className="ml-auto shrink-0 text-[11px] text-gray-400">{isOpen ? '▲' : '▼'}</span>
                            </button>
                          </div>
                          {isOpen && (
                            <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 lg:grid-cols-4">
                              {g.items.map((p) => (
                                <PassageChip
                                  key={p.sourceKey}
                                  p={p}
                                  unit={g.unit}
                                  on={selectedSet.has(p.sourceKey)}
                                  textbook={selectedTextbook}
                                  kind={kind}
                                  onToggle={toggle}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {shownPassages.map((p) => (
                    <PassageChip
                      key={p.sourceKey}
                      p={p}
                      on={selectedSet.has(p.sourceKey)}
                      textbook={selectedTextbook}
                      kind={kind}
                      onToggle={toggle}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 3. 금액 */}
          {selectedKeys.length > 0 && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900">3. 주문 내용</h2>
              <div className="mt-3 space-y-1 text-[13px] text-gray-700">
                <p><b>교재</b> {selectedTextbook}</p>
                <p><b>유형</b> {KIND_LABEL[kind]}</p>
                <p>
                  <b>선택 지문</b> {selectedKeys.length}개
                  {difficultyNote && ` · 보유분 난도 ${difficultyNote} PDF`}
                </p>
                {toMakeCount > 0 && (
                  <p className="text-amber-700">
                    이 중 <b>{toMakeCount}개는 제작 요청</b> — 전달까지 시간이 걸립니다
                  </p>
                )}
                {/* 무엇을 담았는지 단원 단위로 — 20개를 20줄로 늘어놓으면 읽히지 않는다 */}
                {selectedByUnit.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 pt-1">
                    {selectedByUnit.map(([unit, list]) => (
                      <li
                        key={unit}
                        className="rounded-md bg-blue-50 px-2 py-1 text-[11.5px] text-blue-800"
                        title={list.join(', ')}
                      >
                        <b>{unit}</b> {list.length}개
                      </li>
                    ))}
                  </ul>
                )}
                <p className="border-t border-gray-200 pt-2">
                  기본 금액 {quote.basePrice.toLocaleString()}원
                </p>
                {quote.discountPct > 0 && (
                  <p className="text-blue-700">
                    {quote.discountLabel} 할인 {quote.discountPct}% −{quote.discountAmount.toLocaleString()}원
                  </p>
                )}
                <p className="text-base font-extrabold text-blue-800">
                  최종 금액 {quote.finalPrice.toLocaleString()}원
                </p>
              </div>

              {/* 주문 버튼은 아래 고정 바에 늘 떠 있다 — 여기서 또 두면 어느 쪽을
                  눌러야 하는지 헷갈린다. 안내와 보조 동작(복사)만 남긴다. */}
              <p className="mt-3 text-[11px] text-gray-500">
                아래 <b>주문하기</b> 를 누르시면 주문이 접수됩니다. 확인 후 PDF 를 보내드립니다.
              </p>
              <button
                type="button"
                onClick={copyOrder}
                className="mt-2 text-[11px] text-gray-500 underline hover:text-gray-700"
              >
                {copied ? '✓ 주문서를 복사했습니다' : '주문서 내용 복사하기'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 담은 게 있으면 어디서 스크롤하든 금액·주문 버튼이 따라온다 —
          예전에는 맨 아래 「3. 주문 내용」까지 내려가야 확인할 수 있었다. */}
      {selectedKeys.length > 0 && (
        <div className="sticky bottom-0 z-40 border-t border-gray-200 bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur">
          {/* 우하단 문의 위젯(fixed·z-50·64px)이 버튼 위에 떠서 가린다 — 그만큼 비운다.
              또 줄바꿈을 막는다(flex-nowrap) — 폰에서 두 줄이 되면 아래 줄이 위젯에 깔린다. */}
          <div className="container mx-auto flex max-w-5xl flex-nowrap items-center gap-2 py-2.5 pl-3 pr-[84px] sm:gap-3 sm:pl-4 sm:pr-[92px]">
            <div className="min-w-0 flex-1">
              <p className="hidden truncate text-[11px] text-gray-500 sm:block">
                {selectedTextbook} · {KIND_LABEL[kind]}
              </p>
              <p className="whitespace-nowrap text-[13px] font-bold text-gray-900">
                지문 {selectedKeys.length}개
                <span className="ml-1.5 text-[15px] font-extrabold text-blue-800">
                  {quote.finalPrice.toLocaleString()}원
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedKeys([])}
              aria-label="선택 비우기"
              className="shrink-0 rounded-xl border border-gray-300 px-2.5 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50"
            >
              <span className="hidden sm:inline">비우기</span>
              <span className="sm:hidden">✕</span>
            </button>
            <a
              href={KAKAO_INQUIRY_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="카톡으로 문의"
              className="shrink-0 whitespace-nowrap rounded-xl bg-[#FEE500] px-3 py-2.5 text-[13px] font-bold text-[#3B1E1E] no-underline hover:brightness-95 sm:px-4 sm:text-sm"
            >
              💬<span className="hidden sm:inline"> 문의</span>
            </a>
            <button
              type="button"
              onClick={() => void submitOrder()}
              disabled={submitting}
              className="shrink-0 whitespace-nowrap rounded-xl bg-blue-600 px-3 py-2.5 text-[13px] font-bold text-white hover:bg-blue-700 disabled:opacity-50 sm:px-4 sm:text-sm"
            >
              {submitting ? '접수 중…' : '주문하기'}
            </button>
          </div>
        </div>
      )}

      {/* 샘플 모달 */}
      {openSample && (
        <div
          className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-black/60"
          onClick={() => setOpenSample(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="flex min-h-full items-start justify-center p-4 sm:items-center">
            <div
              className="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3 border-b border-gray-200 px-6 py-4">
                <div className="min-w-0 flex-1">
                  <span className="inline-block rounded-full bg-[#E8EDF7] px-2 py-0.5 text-[11px] font-bold text-[#1B3F7A]">
                    {openSample.label}
                  </span>
                  <h2 className="mt-1 text-base font-extrabold text-gray-900">
                    {openSample.sourceKey} · {openSample.difficulty}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-gray-500">
                    실제 제작 자료입니다. {openSample.배점 && `배점 ${openSample.배점} · `}PDF 로 제공됩니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenSample(null)}
                  aria-label="닫기"
                  className="shrink-0 rounded-lg px-2 py-1 text-lg text-gray-400 hover:bg-gray-100"
                >
                  ✕
                </button>
              </div>

              <div className="max-h-[70vh] overflow-y-auto px-6 py-5 text-[13px] leading-relaxed text-gray-800">
                {openSample.passage && (
                  <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 whitespace-pre-line">
                    {openSample.passage}
                  </div>
                )}
                {openSample.questions.map((qq, i) => (
                  <div key={i} className="mb-4">
                    <p className="font-bold text-gray-900">
                      {qq.prompt}{qq.points ? ` [${qq.points}점]` : ''}
                    </p>
                    {qq.bogi && (
                      <div className="mt-2 rounded-lg border border-gray-400 px-3 py-2 text-center">
                        <p className="mb-1 text-[11px] font-bold text-gray-500">&lt; 보 기 &gt;</p>
                        {qq.bogi}
                      </div>
                    )}
                    {qq.conditions.length > 0 && (
                      <ul className="mt-2 space-y-1 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-[12px] text-amber-900">
                        {qq.conditions.map((c, j) => (
                          <li key={j}>· {c}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2 border-t border-gray-200 bg-gray-50 px-6 py-3">
                <a
                  href="https://www.payperic.com/blog/conditional-writing-arrangement"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full rounded-xl border border-[#4A72C0] bg-[#EAF0FB] py-2.5 text-center text-sm font-bold text-[#1B3F7A] no-underline hover:bg-[#D0DEFA]"
                >
                  난도별 구성·지면 예시 자세히 보기 →
                </a>
                <button
                  type="button"
                  onClick={() => setOpenSample(null)}
                  className="w-full rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
