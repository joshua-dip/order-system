'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppBar from '../components/AppBar';
import {
  ESSAY_WORKBOOK_PRICE_PER_SOURCE,
  ESSAY_WORKBOOK_FREE_COUNT,
  quoteEssayWorkbook,
} from '@/lib/essay-workbook-pricing';

const KAKAO_INQUIRY_URL =
  process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

interface TextbookRow { textbook: string; sourceCount: number }
interface PassageRow { sourceKey: string; difficulties: string[]; isMeaningType: boolean }
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

export default function EssayWorkbookPage() {
  const [textbooks, setTextbooks] = useState<TextbookRow[]>([]);
  const [needLogin, setNeedLogin] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [selectedTextbook, setSelectedTextbook] = useState('');
  const [passages, setPassages] = useState<PassageRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');

  const [samples, setSamples] = useState<Sample[]>([]);
  const [openSample, setOpenSample] = useState<Sample | null>(null);

  const [copied, setCopied] = useState(false);

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
    try {
      const r = await fetch(`/api/essay-workbook/passages?textbook=${encodeURIComponent(textbook)}`);
      const d = await r.json();
      setPassages(Array.isArray(d?.passages) ? d.passages : []);
    } finally {
      setLoading(false);
    }
  }, []);

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

  const orderText = useMemo(() => {
    if (!selectedTextbook || selectedKeys.length === 0) return '';
    return [
      '=== 서술형 워크북 주문 ===',
      `교재: ${selectedTextbook}`,
      `지문 ${selectedKeys.length}개 (난도 4종 PDF 포함)`,
      ...selectedKeys.map((k) => `  · ${shortLabel(k, selectedTextbook)}`),
      '',
      `무료 체험 ${quote.freeCount}개 / 유료 ${quote.paidCount}개`,
      `기본 금액: ${quote.basePrice.toLocaleString()}원`,
      ...(quote.discountPct > 0
        ? [`${quote.discountLabel} 할인 ${quote.discountPct}%: -${quote.discountAmount.toLocaleString()}원`]
        : []),
      `최종 금액: ${quote.finalPrice.toLocaleString()}원`,
      '',
      '※ 서술형 워크북은 PDF 로 제공됩니다.',
    ].join('\n');
  }, [selectedTextbook, selectedKeys, quote]);

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
                  이미 제작해 둔 서술형 연습 자료를 바로 받아 보실 수 있습니다.
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

            {/* 제공 형식 안내 — 문제 주문(한글파일)과 다르다 */}
            <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <p className="text-[13px] font-extrabold text-rose-900">📄 PDF 로 제공됩니다</p>
              <p className="mt-1 text-[12px] leading-relaxed text-rose-800/90">
                서술형 워크북은 <b>편집이 불가능한 PDF</b> 로 드립니다. 한글파일(HWP)로 받아 직접 편집하시려면{' '}
                <Link href="/essay" className="font-bold text-rose-900 underline">서술형문제 주문제작</Link>
                {' '}메뉴를 이용해 주세요.
              </p>
            </div>

            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] leading-relaxed text-gray-700">
              <b>가격</b> — 지문 1개당 {ESSAY_WORKBOOK_PRICE_PER_SOURCE.toLocaleString()}원
              (기본·중·고·최고 <b>4난도 PDF 한 묶음</b>).
              교재별 <b>앞 {ESSAY_WORKBOOK_FREE_COUNT}개 지문은 무료</b>로 체험하실 수 있고,
              한 교재의 절반 이상을 담으면 11%, 전부 담으면 20% 할인됩니다.
            </div>

            {/* 샘플 */}
            {samples.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-gray-500">샘플 보기</span>
                {samples.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setOpenSample(s)}
                    className="rounded-full border border-[#4A72C0] bg-[#EAF0FB] px-3 py-1 text-[12px] font-semibold text-[#1B3F7A] hover:bg-[#D0DEFA]"
                  >
                    📄 {s.label} 샘플
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 1. 교재 */}
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-bold text-gray-900">1. 교재 선택</h2>
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
                  onClick={() => setSelectedTextbook(t.textbook)}
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
          </div>

          {/* 2. 지문 */}
          {selectedTextbook && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold text-gray-900">2. 지문 선택 — {selectedTextbook}</h2>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedKeys(passages.map((p) => p.sourceKey))}
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

              {loading ? (
                <p className="py-8 text-center text-sm text-gray-400">불러오는 중…</p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {passages.map((p, i) => {
                    const on = selectedKeys.includes(p.sourceKey);
                    const free = i < ESSAY_WORKBOOK_FREE_COUNT;
                    return (
                      <button
                        key={p.sourceKey}
                        type="button"
                        onClick={() => toggle(p.sourceKey)}
                        className={`rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors ${
                          on ? 'border-blue-600 bg-blue-50 font-bold text-blue-800' : 'border-gray-200 hover:border-blue-300'
                        }`}
                      >
                        <span className="block truncate">{shortLabel(p.sourceKey, selectedTextbook)}</span>
                        <span className="mt-0.5 block text-[10px] text-gray-500">
                          {free ? <b className="text-emerald-600">무료 체험</b> : `${p.difficulties.length}난도`}
                          {p.isMeaningType && ' · 글의의미'}
                        </span>
                      </button>
                    );
                  })}
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
                <p><b>선택 지문</b> {selectedKeys.length}개 · 난도 4종 PDF 포함</p>
                {quote.freeCount > 0 && <p className="text-emerald-700"><b>무료 체험</b> {quote.freeCount}개</p>}
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

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={copyOrder}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700"
                >
                  {copied ? '✓ 복사됨' : '📋 주문서 복사'}
                </button>
                <a
                  href={KAKAO_INQUIRY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl bg-[#FEE500] px-4 py-2.5 text-sm font-bold text-[#3B1E1E] no-underline hover:brightness-95"
                >
                  💬 카톡으로 주문서 보내기
                </a>
              </div>
              <p className="mt-2 text-[11px] text-gray-500">
                주문서를 복사해 카톡으로 보내주시면 확인 후 PDF 를 보내드립니다.
              </p>
            </div>
          )}
        </div>
      </div>

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

              <div className="border-t border-gray-200 bg-gray-50 px-6 py-3">
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
