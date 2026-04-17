'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppBar from '../components/AppBar';
import { useTextbooksData } from '@/lib/useTextbooksData';
import { useCurrentUser, filterTextbooksByAllowed } from '@/lib/useCurrentUser';
import { saveOrderToDb, MEMBER_DEPOSIT_ACCOUNT, ORDER_FOOTER_MESSAGE } from '@/lib/orders';
import { ORDER_PREFIX } from '@/lib/orderPrefix';
import { ESSAY_ORDER_VISIBLE_MAIN_CATEGORIES } from '@/app/data/essay-categories';

/* ────────── 타입 ────────── */

interface LessonItem { 번호: string }
interface TextbookContent { [lessonKey: string]: LessonItem[] }
interface TextbookStructure {
  Sheet1?: { 부교재?: Record<string, TextbookContent> };
  '지문 데이터'?: { 부교재?: Record<string, TextbookContent> };
  부교재?: Record<string, TextbookContent>;
}

interface EssayTypeItem {
  id: string;
  대분류: string;
  소분류: string;
  typeCode?: string;
  price?: number;
}

/* ────────── 상수 ────────── */

const QUESTION_TYPES = ['주제', '제목', '주장', '일치', '불일치', '함의', '빈칸', '요약', '어법', '순서', '삽입'];
const ORDER_INSERT_TYPES = new Set(['순서', '삽입']);
const ANALYSIS_PRICE_PER_ITEM = 500;

const WORKBOOK_PACKAGES = [
  { id: 'blank_package', name: '워크북 빈칸쓰기 패키지', description: '형용사, 키워드, 명사형, 전치사, 동사형 빈칸연습', price: 300 },
  { id: 'keyword_blank', name: '워크북 빈칸쓰기 키워드', description: '키워드 중심의 빈칸쓰기 연습', price: 100 },
  { id: 'word_arrangement', name: '워크북 낱말배열', description: '낱말 순서 배열 연습', price: 100 },
  { id: 'workbook_grammar_either_or', name: '워크북_어법_양자택일', description: '어법 양자택일(두 보기 중 선택) 연습', price: 100 },
  { id: 'workbook_grammar_error_correction', name: '워크북_어법_오류수정', description: '어법 오류를 찾아 수정하는 연습', price: 100 },
  { id: 'lecture_material', name: '강의용자료/수업용자료', description: '원문과 해석 자료', price: 200 },
  { id: 'one_line_interpretation', name: '한줄해석/해석쓰기/영작하기', description: '한줄해석/해석쓰기/영작하기 자료', price: 300 },
] as const;

const VOCABULARY_PACKAGES = [
  { id: 'basic', name: '기본형', description: '단어 + 뜻', price: 300 },
  { id: 'detailed', name: '상세형', description: '단어 + 뜻 + 동의어 + 반의어', price: 500 },
] as const;

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

/* ────────── 유틸 ────────── */

function pickFirstContent(key: string, data: TextbookStructure): TextbookContent | null {
  const sub = data.Sheet1?.부교재 ?? data['지문 데이터']?.부교재 ?? data.부교재;
  if (!sub) return null;
  if (sub[key]) return sub[key];
  const keys = Object.keys(sub);
  return keys.length > 0 ? sub[keys[0]] : null;
}

function computeVariantPrice(
  selectedTypes: string[],
  questionsPerType: number,
  lessonCount: number,
  insertExpl: { 순서: boolean; 삽입: boolean },
) {
  let basePrice = 0;
  for (const type of selectedTypes) {
    const n = lessonCount * questionsPerType;
    const unit = ORDER_INSERT_TYPES.has(type) ? (insertExpl[type as '순서' | '삽입'] ? 80 : 50) : 80;
    basePrice += n * unit;
  }
  const totalQuestions = selectedTypes.length * questionsPerType * lessonCount;
  let discountRate = 0;
  if (totalQuestions >= 200) discountRate = 0.2;
  else if (totalQuestions >= 100) discountRate = 0.1;
  const discountAmount = basePrice * discountRate;
  const totalPrice = Math.round(basePrice - discountAmount);
  return { basePrice, totalQuestions, discountRate, discountAmount, totalPrice, isDiscounted: totalQuestions >= 100 };
}

function computeWorkbookPrice(selectedPackages: string[], textCount: number) {
  const details = selectedPackages.map((id) => WORKBOOK_PACKAGES.find((p) => p.id === id)).filter(Boolean);
  const raw = details.reduce((s, pkg) => s + pkg!.price * textCount, 0);
  let discountRate = 0;
  if (textCount >= 100) discountRate = 20;
  else if (textCount >= 50) discountRate = 10;
  const discountAmount = Math.floor(raw * discountRate / 100);
  return { raw, discountRate, discountAmount, finalPrice: raw - discountAmount, details };
}

/* ────────── 서비스 섹션 카드 ────────── */

function SectionCard({ title, enabled, onToggle, disabled, disabledMessage, children, subtotalLabel }: {
  title: string;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
  disabledMessage?: string;
  children: React.ReactNode;
  subtotalLabel?: string;
}) {
  return (
    <div className={`border rounded-2xl overflow-hidden ${enabled ? 'border-blue-400 bg-blue-50/30' : 'border-gray-200 bg-white'}`}>
      <button
        type="button"
        onClick={disabled ? undefined : onToggle}
        className={`w-full flex items-center justify-between px-5 py-4 text-left ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-50'}`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs font-bold transition-colors ${enabled ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-300 text-transparent'}`}>
            ✓
          </div>
          <span className="font-bold text-gray-800">{title}</span>
        </div>
        <div className="flex items-center gap-3">
          {subtotalLabel && <span className="text-sm font-semibold text-blue-600">{subtotalLabel}</span>}
          {disabled && disabledMessage && <span className="text-xs text-amber-600">{disabledMessage}</span>}
        </div>
      </button>
      {enabled && !disabled && (
        <div className="px-5 pb-5 pt-1 border-t border-gray-200/50">
          {children}
        </div>
      )}
    </div>
  );
}

/* ────────── 페이지 ────────── */

export default function BundlePage() {
  const router = useRouter();
  const { data: textbooksData, loading: dataLoading, error: dataError } = useTextbooksData();
  const currentUser = useCurrentUser();

  /* ── auth ── */
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setAuthorized(!!d?.user);
      })
      .catch(() => { setAuthorized(false); })
      .finally(() => setChecking(false));
  }, []);

  /* ── 교재 ── */
  const [selectedTextbook, setSelectedTextbook] = useState('');

  const textbookList = useMemo(() => {
    if (!textbooksData || !currentUser) return [];
    const allKeys = Object.keys(textbooksData).filter(
      (k) => !k.startsWith('고1_') && !k.startsWith('고2_') && !k.startsWith('고3_'),
    );
    const sets = [
      currentUser.allowedTextbooksVariant,
      currentUser.allowedTextbooksWorkbook,
      currentUser.allowedTextbooksEssay,
      currentUser.allowedTextbooksAnalysis,
    ].filter((s): s is string[] => Array.isArray(s));
    if (sets.length === 0) return allKeys;
    const union = new Set(sets.flat());
    return allKeys.filter((k) => union.has(k));
  }, [textbooksData, currentUser]);

  /* ── 강·번호 ── */
  const [selectedLessons, setSelectedLessons] = useState<string[]>([]);
  const [lessonGroups, setLessonGroups] = useState<Record<string, string[]>>({});
  const [expandedLessons, setExpandedLessons] = useState<string[]>([]);

  useEffect(() => {
    if (!textbooksData || !selectedTextbook || !textbooksData[selectedTextbook]) {
      setLessonGroups({});
      setSelectedLessons([]);
      setExpandedLessons([]);
      return;
    }
    const td = textbooksData[selectedTextbook] as TextbookStructure;
    const content = pickFirstContent(selectedTextbook, td);
    if (!content) { setLessonGroups({}); return; }
    const groups: Record<string, string[]> = {};
    Object.keys(content).forEach((lk) => {
      const arr = content[lk];
      if (Array.isArray(arr)) groups[lk] = arr.map((it) => `${lk} ${it.번호}`);
    });
    setLessonGroups(groups);
    setSelectedLessons([]);
    setExpandedLessons([]);
  }, [selectedTextbook, textbooksData]);

  const allLessonsFlat = useMemo(() => Object.values(lessonGroups).flat(), [lessonGroups]);

  const handleLessonChange = (l: string) => setSelectedLessons((p) => p.includes(l) ? p.filter((x) => x !== l) : [...p, l]);
  const handleLessonGroupToggle = (lk: string) => {
    const group = lessonGroups[lk] || [];
    const allSel = group.every((l) => selectedLessons.includes(l));
    if (allSel) setSelectedLessons((p) => p.filter((l) => !group.includes(l)));
    else setSelectedLessons((p) => { const s = new Set(p); group.forEach((l) => s.add(l)); return [...s]; });
  };
  const handleLessonExpand = (lk: string) => setExpandedLessons((p) => p.includes(lk) ? p.filter((k) => k !== lk) : [...p, lk]);
  const handleAllLessonsToggle = () => {
    if (selectedLessons.length === allLessonsFlat.length) setSelectedLessons([]);
    else setSelectedLessons([...allLessonsFlat]);
  };

  const textCount = useMemo(() => {
    if (!textbooksData || !selectedTextbook) return selectedLessons.length;
    const td = textbooksData[selectedTextbook] as TextbookStructure;
    const content = pickFirstContent(selectedTextbook, td);
    if (!content) return selectedLessons.length;
    let count = 0;
    const selSet = new Set(selectedLessons);
    Object.keys(content).forEach((lk) => {
      const arr = content[lk];
      if (!Array.isArray(arr)) return;
      arr.forEach((it) => { if (selSet.has(`${lk} ${it.번호}`)) count++; });
    });
    return count || selectedLessons.length;
  }, [textbooksData, selectedTextbook, selectedLessons]);

  /* ── 변형문제 ── */
  const [variantEnabled, setVariantEnabled] = useState(false);
  const [variantTypes, setVariantTypes] = useState<string[]>([]);
  const [questionsPerType, setQuestionsPerType] = useState(3);
  const [orderInsertExplanation, setOrderInsertExplanation] = useState<{ 순서: boolean; 삽입: boolean }>({ 순서: true, 삽입: true });

  const variantAllowed = currentUser?.allowedTextbooksVariant === undefined || !selectedTextbook
    ? true
    : (currentUser.allowedTextbooksVariant ?? []).includes(selectedTextbook);

  const variantPrice = variantEnabled && variantTypes.length > 0 && selectedLessons.length > 0
    ? computeVariantPrice(variantTypes, questionsPerType, selectedLessons.length, orderInsertExplanation)
    : null;

  /* ── 워크북 ── */
  const [workbookEnabled, setWorkbookEnabled] = useState(false);
  const [wbPackages, setWbPackages] = useState<string[]>([]);

  const workbookAllowed = currentUser?.allowedTextbooksWorkbook === undefined || !selectedTextbook
    ? true
    : (currentUser.allowedTextbooksWorkbook ?? []).includes(selectedTextbook);

  const handleWbPkgChange = (id: string) => {
    setWbPackages((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      let next = [...prev, id];
      if (id === 'blank_package') next = next.filter((p) => p !== 'keyword_blank');
      else if (id === 'keyword_blank') next = next.filter((p) => p !== 'blank_package');
      return next;
    });
  };

  const wbPrice = workbookEnabled && wbPackages.length > 0 && textCount > 0
    ? computeWorkbookPrice(wbPackages, textCount)
    : null;

  /* ── 서술형 ── */
  const [essayEnabled, setEssayEnabled] = useState(false);
  const [essayCategories, setEssayCategories] = useState<string[]>([]);
  const [essayTypes, setEssayTypes] = useState<EssayTypeItem[]>([]);
  const [essayTypesLoading, setEssayTypesLoading] = useState(true);

  const essayAllowed = currentUser?.allowedTextbooksEssay === undefined || !selectedTextbook
    ? true
    : (currentUser.allowedTextbooksEssay ?? []).includes(selectedTextbook);

  useEffect(() => {
    setEssayTypesLoading(true);
    fetch('/api/essay-types').then((r) => r.json()).then((d) => {
      if (Array.isArray(d?.types)) setEssayTypes(d.types);
    }).catch(() => {}).finally(() => setEssayTypesLoading(false));
  }, []);

  const visible대분류Set = useMemo(() => new Set(ESSAY_ORDER_VISIBLE_MAIN_CATEGORIES), []);
  const essayTypesGrouped = useMemo(() => {
    if (essayTypes.length === 0) return [];
    const grouped = Object.entries(
      essayTypes.reduce<Record<string, EssayTypeItem[]>>((acc, t) => {
        const key = t.대분류 || '(미분류)';
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
      }, {}),
    )
      .map(([대분류, types]) => ({ 대분류, types }))
      .filter((g) => visible대분류Set.has(g.대분류));
    return grouped;
  }, [essayTypes, visible대분류Set]);

  const essaySumPerPassage = essayTypesGrouped
    .filter((g) => essayCategories.includes(g.대분류))
    .reduce((sum, g) => sum + (g.types[0]?.price ?? 0), 0);
  const essaySubtotal = essayEnabled && essayCategories.length > 0 ? essaySumPerPassage * selectedLessons.length : 0;

  /* ── 분석지 (준비중) ── */
  const analysisEnabled = false;
  const analysisSubtotal = 0;

  /* ── 단어장 ── */
  const [vocabEnabled, setVocabEnabled] = useState(false);
  const [vocabPackage, setVocabPackage] = useState<'basic' | 'detailed'>('basic');
  const vocabPkg = VOCABULARY_PACKAGES.find((p) => p.id === vocabPackage)!;
  const vocabSubtotal = vocabEnabled ? selectedLessons.length * vocabPkg.price : 0;

  /* ── 이메일 + 포인트 ── */
  const [email, setEmail] = useState('');
  const [useCustomHwp, setUseCustomHwp] = useState(false);
  const [pointsToUse, setPointsToUse] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  /* ── 합계 ── */
  const grandTotal =
    (variantPrice?.totalPrice ?? 0)
    + (wbPrice?.finalPrice ?? 0)
    + essaySubtotal
    + analysisSubtotal
    + vocabSubtotal;

  const enabledCount = [variantEnabled, workbookEnabled, essayEnabled, analysisEnabled, vocabEnabled].filter(Boolean).length;
  const effectivePoints = Math.min(Math.max(0, pointsToUse), currentUser?.points ?? 0, grandTotal);
  const amountDue = grandTotal - effectivePoints;

  /* ── 주문 제출 ── */
  const handleSubmit = async () => {
    if (enabledCount === 0) { alert('서비스를 1개 이상 선택해주세요.'); return; }
    if (selectedLessons.length === 0) { alert('강과 번호를 선택해주세요.'); return; }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      alert('올바른 이메일 주소를 입력해주세요.'); return;
    }
    if (variantEnabled && variantTypes.length === 0) { alert('변형문제 유형을 선택해주세요.'); return; }
    if (workbookEnabled && wbPackages.length === 0) { alert('워크북 패키지를 선택해주세요.'); return; }
    if (essayEnabled && essayCategories.length === 0) { alert('서술형 유형을 선택해주세요.'); return; }

    const lines: string[] = [
      `통합 주문서 (부교재)`,
      ``,
      `교재: ${selectedTextbook}`,
      `이메일: ${email.trim()}`,
      ``,
      `1. 강과 번호 (${selectedLessons.length}개)`,
      `: ${selectedLessons.join(', ')}`,
    ];

    if (variantEnabled && variantPrice) {
      const insertNote = variantTypes.some((t) => ORDER_INSERT_TYPES.has(t))
        ? `\n   순서: 해설 ${orderInsertExplanation.순서 ? '포함' : '미포함'} / 삽입: 해설 ${orderInsertExplanation.삽입 ? '포함' : '미포함'}`
        : '';
      lines.push(
        ``, `━━ 변형문제 ━━`,
        `유형: ${variantTypes.join(', ')}${insertNote}`,
        `유형당 문항수: ${questionsPerType}문항씩`,
        `총 문항: ${variantPrice.totalQuestions}문항`,
        `소계: ${variantPrice.totalPrice.toLocaleString()}원${variantPrice.isDiscounted ? ` (${(variantPrice.discountRate * 100)}% 할인 적용)` : ''}`,
      );
    }
    if (workbookEnabled && wbPrice) {
      const pkgNames = wbPackages.map((id) => WORKBOOK_PACKAGES.find((p) => p.id === id)?.name).filter(Boolean);
      lines.push(
        ``, `━━ 워크북 ━━`,
        `패키지: ${pkgNames.join(', ')}`,
        `총 지문 수: ${textCount}개`,
        `소계: ${wbPrice.finalPrice.toLocaleString()}원${wbPrice.discountRate > 0 ? ` (${wbPrice.discountRate}% 할인 적용)` : ''}`,
      );
    }
    if (essayEnabled && essayCategories.length > 0) {
      lines.push(
        ``, `━━ 서술형 ━━`,
        `유형: ${essayCategories.join(', ')}`,
        `지문 수: ${selectedLessons.length}개 (지문당 ${essaySumPerPassage.toLocaleString()}원)`,
        `소계: ${essaySubtotal.toLocaleString()}원`,
      );
    }
    if (analysisEnabled) {
      lines.push(
        ``, `━━ 분석지 ━━`,
        `지문 수: ${selectedLessons.length}개 (지문당 ${ANALYSIS_PRICE_PER_ITEM.toLocaleString()}원)`,
        `소계: ${analysisSubtotal.toLocaleString()}원`,
      );
    }
    if (vocabEnabled) {
      lines.push(
        ``, `━━ 단어장 ━━`,
        `유형: ${vocabPkg.name} — ${vocabPkg.description}`,
        `지문 수: ${selectedLessons.length}개 (지문당 ${vocabPkg.price.toLocaleString()}원)`,
        `소계: ${vocabSubtotal.toLocaleString()}원`,
      );
    }

    if (useCustomHwp) {
      lines.push(``, `커스텀 HWP 양식: 사용`);
    }

    lines.push(
      ``, `────────────`,
      `합계: ${grandTotal.toLocaleString()}원`,
    );
    if (effectivePoints > 0) {
      lines.push(`포인트 사용: ${effectivePoints.toLocaleString()}원`);
    }
    lines.push(`입금액: ${amountDue.toLocaleString()}원`);

    if (authorized) {
      lines.push(``, `입금 계좌: ${MEMBER_DEPOSIT_ACCOUNT}`, ``, ORDER_FOOTER_MESSAGE);
    }

    const orderText = lines.join('\n');

    const orderMeta: Record<string, unknown> = {
      flow: 'bookBundle',
      version: 1,
      selectedTextbook,
      selectedLessons,
      email: email.trim(),
      useCustomHwp,
      services: {
        ...(variantEnabled && variantPrice ? {
          variant: { selectedTypes: variantTypes, questionsPerType, orderInsertExplanation, subtotal: variantPrice.totalPrice },
        } : {}),
        ...(workbookEnabled && wbPrice ? {
          workbook: { selectedPackages: wbPackages, subtotal: wbPrice.finalPrice },
        } : {}),
        ...(essayEnabled && essayCategories.length > 0 ? {
          essay: { selectedCategories: essayCategories, subtotal: essaySubtotal },
        } : {}),
        ...(analysisEnabled ? {
          analysis: { subtotal: analysisSubtotal },
        } : {}),
        ...(vocabEnabled ? {
          vocabulary: { packageType: vocabPackage, subtotal: vocabSubtotal },
        } : {}),
      },
      totalPrice: grandTotal,
      pointsUsed: effectivePoints,
    };

    setSubmitting(true);
    try {
      const res = await saveOrderToDb(orderText, ORDER_PREFIX.BOOK_BUNDLE, effectivePoints, orderMeta);
      if (res.ok && res.id) {
        router.push('/order/done?id=' + res.id);
      } else {
        alert(res.error || '주문 저장에 실패했습니다.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /* ── 로딩·인증 분기 ── */
  if (checking) {
    return (
      <>
        <AppBar title="통합 주문" />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  if (!authorized) {
    return (
      <>
        <AppBar title="통합 주문" />
        <div className="min-h-screen py-12 px-4 bg-gray-50">
          <div className="max-w-md mx-auto text-center bg-white rounded-2xl shadow-lg p-8">
            <h1 className="text-2xl font-bold text-gray-800 mb-3">통합 주문</h1>
            <p className="text-gray-600 mb-6">회원 전용 서비스입니다. 로그인 후 이용해 주세요.</p>
            <Link href="/login" className="inline-block px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-semibold">
              로그인
            </Link>
            <p className="mt-5">
              <Link href="/" className="text-sm text-gray-500 hover:underline">메인으로 돌아가기</Link>
            </p>
          </div>
        </div>
      </>
    );
  }

  /* ── 렌더 ── */
  return (
    <>
      <AppBar title="통합 주문" />
      <div className="min-h-screen py-8 px-4" style={{ backgroundColor: '#F5F5F5' }}>
        <div className="max-w-3xl mx-auto space-y-6">
          <p>
            <Link href="/" className="text-sm font-medium text-blue-600 hover:underline">← 메인 화면으로</Link>
          </p>

          {/* 헤더 */}
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h1 className="text-2xl font-bold text-gray-800">통합 주문서</h1>
            <p className="text-gray-500 text-sm mt-1">
              교과서·부교재 중 하나를 고른 뒤, 변형문제·워크북·서술형·분석지·단어장 등 필요한 항목만 골라 한 번에 담을 수 있습니다.
            </p>
          </div>

          {/* 1. 교재 선택 */}
          <div className="bg-white rounded-2xl shadow p-6 space-y-3">
            <h2 className="font-bold text-gray-800">1. 교재 선택</h2>
            {dataLoading ? (
              <p className="text-gray-400 text-sm">교재 목록 로딩 중…</p>
            ) : dataError || !textbooksData ? (
              <p className="text-red-500 text-sm">교재 데이터를 불러올 수 없습니다.</p>
            ) : textbookList.length === 0 ? (
              <p className="text-gray-500 text-sm">허용된 교재가 없습니다. 관리자에게 문의해 주세요.</p>
            ) : (
              <select
                value={selectedTextbook}
                onChange={(e) => setSelectedTextbook(e.target.value)}
                className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">교재를 선택하세요</option>
                {textbookList.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            )}
          </div>

          {/* 2. 강·번호 선택 */}
          {selectedTextbook && Object.keys(lessonGroups).length > 0 && (
            <div className="bg-white rounded-2xl shadow p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-gray-800">2. 강·번호 선택</h2>
                <button type="button" onClick={handleAllLessonsToggle} className="text-xs text-blue-600 hover:underline font-medium">
                  {selectedLessons.length === allLessonsFlat.length ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <p className="text-xs text-gray-500">왼쪽 클릭: 강 전체 선택/해제 · + 버튼: 개별 번호 선택</p>
              {selectedLessons.length > 0 && (
                <p className="text-sm font-semibold text-blue-600">{selectedLessons.length}개 선택됨</p>
              )}
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {Object.entries(lessonGroups).map(([lk, group]) => {
                  const allSel = group.every((l) => selectedLessons.includes(l));
                  const someSel = group.some((l) => selectedLessons.includes(l));
                  const count = group.filter((l) => selectedLessons.includes(l)).length;
                  const expanded = expandedLessons.includes(lk);
                  return (
                    <div key={lk} className="border rounded-xl bg-gray-50 overflow-hidden">
                      <div className="flex">
                        <button
                          type="button"
                          onClick={() => handleLessonGroupToggle(lk)}
                          className={`flex-1 flex items-center justify-between px-4 py-3 text-left font-medium rounded-l-xl ${
                            allSel ? 'bg-blue-600 text-white' : someSel ? 'bg-blue-100 text-blue-800' : 'bg-white text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          <span className="font-bold">{lk}</span>
                          <span className="text-sm">{count}/{group.length}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLessonExpand(lk)}
                          className={`px-3 py-3 border-l ${expanded ? 'bg-indigo-100 text-indigo-700' : 'bg-white text-gray-500 hover:bg-gray-100'}`}
                        >
                          {expanded ? '−' : '+'}
                        </button>
                      </div>
                      {expanded && (
                        <div className="px-4 pb-3 pt-1 border-t bg-white grid grid-cols-4 gap-2">
                          {group.map((lesson) => (
                            <label key={lesson} className="flex items-center gap-2 cursor-pointer text-sm text-gray-800">
                              <input type="checkbox" checked={selectedLessons.includes(lesson)} onChange={() => handleLessonChange(lesson)} className="rounded text-blue-600" />
                              <span>{lesson.split(' ').slice(1).join(' ')}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 3. 서비스 선택 */}
          {selectedTextbook && selectedLessons.length > 0 && (
            <div className="bg-white rounded-2xl shadow p-6 space-y-4">
              <h2 className="font-bold text-gray-800">3. 서비스 선택</h2>
              <p className="text-xs text-gray-500">원하는 서비스를 켜고 세부 설정을 조정하세요.</p>

              {/* 3-1. 변형문제 */}
              <SectionCard
                title="변형문제"
                enabled={variantEnabled}
                onToggle={() => setVariantEnabled((p) => !p)}
                disabled={!variantAllowed}
                disabledMessage="이 교재는 변형문제 이용 불가"
                subtotalLabel={variantPrice ? `${variantPrice.totalPrice.toLocaleString()}원` : undefined}
              >
                <div className="space-y-4 mt-3">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-700">문제 유형</span>
                      <button type="button" onClick={() => setVariantTypes(variantTypes.length === QUESTION_TYPES.length ? [] : [...QUESTION_TYPES])} className="text-xs text-blue-600 hover:underline">
                        {variantTypes.length === QUESTION_TYPES.length ? '전체 해제' : '전체 선택'}
                      </button>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      {QUESTION_TYPES.map((t) => (
                        <label key={t} className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
                          <input type="checkbox" checked={variantTypes.includes(t)} onChange={() => setVariantTypes((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])} className="rounded text-blue-600" />
                          {t}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <label className="text-sm font-semibold text-gray-700">유형당 문항수</label>
                    <select value={questionsPerType} onChange={(e) => setQuestionsPerType(Number(e.target.value))} className="border rounded-lg px-3 py-2 text-sm text-gray-800">
                      <option value={1}>1문항</option>
                      <option value={2}>2문항</option>
                      <option value={3}>3문항</option>
                    </select>
                  </div>
                  {variantTypes.some((t) => ORDER_INSERT_TYPES.has(t)) && (
                    <div className="space-y-2">
                      <span className="text-sm font-semibold text-gray-700">순서/삽입 해설</span>
                      {(['순서', '삽입'] as const).filter((t) => variantTypes.includes(t)).map((t) => (
                        <label key={t} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input type="checkbox" checked={orderInsertExplanation[t]} onChange={() => setOrderInsertExplanation((p) => ({ ...p, [t]: !p[t] }))} className="rounded text-blue-600" />
                          {t} 해설 포함 (포함 80원 / 미포함 50원)
                        </label>
                      ))}
                    </div>
                  )}
                  {variantPrice && (
                    <p className="text-sm text-gray-600">
                      {variantPrice.totalQuestions}문항 × 단가 = {variantPrice.basePrice.toLocaleString()}원
                      {variantPrice.isDiscounted && <span className="text-blue-600 font-semibold"> → {(variantPrice.discountRate * 100)}% 할인 → {variantPrice.totalPrice.toLocaleString()}원</span>}
                    </p>
                  )}
                </div>
              </SectionCard>

              {/* 3-2. 워크북 */}
              <SectionCard
                title="워크북"
                enabled={workbookEnabled}
                onToggle={() => setWorkbookEnabled((p) => !p)}
                disabled={!workbookAllowed}
                disabledMessage="이 교재는 워크북 이용 불가"
                subtotalLabel={wbPrice ? `${wbPrice.finalPrice.toLocaleString()}원` : undefined}
              >
                <div className="space-y-3 mt-3">
                  {WORKBOOK_PACKAGES.map((pkg) => {
                    const mutuallyExcluded =
                      (pkg.id === 'blank_package' && wbPackages.includes('keyword_blank')) ||
                      (pkg.id === 'keyword_blank' && wbPackages.includes('blank_package'));
                    return (
                      <label key={pkg.id} className={`flex items-start gap-3 text-sm cursor-pointer ${mutuallyExcluded ? 'opacity-40' : ''}`}>
                        <input
                          type="checkbox"
                          checked={wbPackages.includes(pkg.id)}
                          onChange={() => handleWbPkgChange(pkg.id)}
                          disabled={mutuallyExcluded}
                          className="rounded text-blue-600 mt-0.5"
                        />
                        <div>
                          <span className="font-medium text-gray-800">{pkg.name}</span>
                          <span className="text-gray-400 ml-2">지문당 {pkg.price.toLocaleString()}원</span>
                          <p className="text-xs text-gray-500">{pkg.description}</p>
                        </div>
                      </label>
                    );
                  })}
                  {wbPrice && (
                    <p className="text-sm text-gray-600 pt-2 border-t">
                      {textCount}지문 × 패키지 합산 = {wbPrice.raw.toLocaleString()}원
                      {wbPrice.discountRate > 0 && <span className="text-blue-600 font-semibold"> → {wbPrice.discountRate}% 할인 → {wbPrice.finalPrice.toLocaleString()}원</span>}
                    </p>
                  )}
                </div>
              </SectionCard>

              {/* 3-3. 서술형 */}
              <SectionCard
                title="서술형"
                enabled={essayEnabled}
                onToggle={() => setEssayEnabled((p) => !p)}
                disabled={!essayAllowed}
                disabledMessage="이 교재는 서술형 이용 불가"
                subtotalLabel={essaySubtotal > 0 ? `${essaySubtotal.toLocaleString()}원` : undefined}
              >
                <div className="space-y-3 mt-3">
                  {essayTypesLoading ? (
                    <p className="text-sm text-gray-400">서술형 유형을 불러오는 중…</p>
                  ) : essayTypesGrouped.length === 0 ? (
                    <p className="text-sm text-gray-400">표시할 서술형 유형이 없습니다.</p>
                  ) : (
                    essayTypesGrouped.map((g) => (
                      <label key={g.대분류} className="flex items-start gap-3 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={essayCategories.includes(g.대분류)}
                          onChange={() => setEssayCategories((p) => p.includes(g.대분류) ? p.filter((x) => x !== g.대분류) : [...p, g.대분류])}
                          className="rounded text-blue-600 mt-0.5"
                        />
                        <div>
                          <span className="font-medium text-gray-800">{g.대분류}</span>
                          <span className="text-gray-400 ml-2">지문당 {(g.types[0]?.price ?? 0).toLocaleString()}원</span>
                          <p className="text-xs text-gray-500">소분류: {g.types.map((t) => t.소분류).join(', ')}</p>
                        </div>
                      </label>
                    ))
                  )}
                  {essaySubtotal > 0 && (
                    <p className="text-sm text-gray-600 pt-2 border-t">
                      {selectedLessons.length}지문 × 지문당 {essaySumPerPassage.toLocaleString()}원 = {essaySubtotal.toLocaleString()}원
                    </p>
                  )}
                </div>
              </SectionCard>

              {/* 3-4. 분석지 */}
              <SectionCard
                title="분석지 (PDF)"
                enabled={false}
                onToggle={() => {}}
                disabled
                disabledMessage="준비중"
                subtotalLabel={undefined}
              >
                <div />
              </SectionCard>

              {/* 3-5. 단어장 */}
              <SectionCard
                title="단어장"
                enabled={vocabEnabled}
                onToggle={() => setVocabEnabled((p) => !p)}
                subtotalLabel={vocabSubtotal > 0 ? `${vocabSubtotal.toLocaleString()}원` : undefined}
              >
                <div className="space-y-3 mt-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {VOCABULARY_PACKAGES.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setVocabPackage(p.id as 'basic' | 'detailed')}
                        className={`p-3 rounded-xl border-2 text-left transition-colors ${
                          vocabPackage === p.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-bold text-sm text-gray-800">{p.name}</span>
                          <span className="text-xs font-semibold text-blue-600">{p.price.toLocaleString()}원/지문</span>
                        </div>
                        <p className="text-xs text-gray-500">{p.description}</p>
                      </button>
                    ))}
                  </div>
                  {vocabSubtotal > 0 && (
                    <p className="text-sm text-gray-600 pt-2 border-t">
                      {selectedLessons.length}지문 × {vocabPkg.price.toLocaleString()}원 = <span className="font-semibold text-blue-600">{vocabSubtotal.toLocaleString()}원</span>
                    </p>
                  )}
                </div>
              </SectionCard>
            </div>
          )}

          {/* 4. 이메일 + HWP */}
          {enabledCount > 0 && selectedLessons.length > 0 && (
            <div className="bg-white rounded-2xl shadow p-6 space-y-4">
              <h2 className="font-bold text-gray-800">4. 이메일 및 옵션</h2>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">자료 받으실 이메일</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              {(variantEnabled || workbookEnabled) && (
                <label className="flex items-center gap-3 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={useCustomHwp} onChange={() => setUseCustomHwp((p) => !p)} className="rounded text-blue-600" />
                  나의 HWP 양식 사용 (내정보에서 양식 등록 필요)
                </label>
              )}
            </div>
          )}

          {/* 5. 가격 요약 + 주문 */}
          {enabledCount > 0 && selectedLessons.length > 0 && (
            <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
              <h2 className="font-bold text-gray-800">5. 주문 요약</h2>
              <div className="space-y-2 text-sm text-gray-700">
                <div className="flex justify-between"><span>교재</span><span className="font-medium text-gray-900">{selectedTextbook}</span></div>
                <div className="flex justify-between"><span>선택 지문</span><span>{selectedLessons.length}개</span></div>
                <hr />
                {variantEnabled && variantPrice && (
                  <div className="flex justify-between"><span>변형문제 ({variantPrice.totalQuestions}문항)</span><span>{variantPrice.totalPrice.toLocaleString()}원</span></div>
                )}
                {workbookEnabled && wbPrice && (
                  <div className="flex justify-between"><span>워크북 ({wbPackages.length}패키지)</span><span>{wbPrice.finalPrice.toLocaleString()}원</span></div>
                )}
                {essayEnabled && essaySubtotal > 0 && (
                  <div className="flex justify-between"><span>서술형 ({essayCategories.length}유형)</span><span>{essaySubtotal.toLocaleString()}원</span></div>
                )}
                {analysisEnabled && analysisSubtotal > 0 && (
                  <div className="flex justify-between"><span>분석지</span><span>{analysisSubtotal.toLocaleString()}원</span></div>
                )}
                {vocabEnabled && vocabSubtotal > 0 && (
                  <div className="flex justify-between"><span>단어장 ({vocabPkg.name})</span><span>{vocabSubtotal.toLocaleString()}원</span></div>
                )}
                <hr />
                <div className="flex justify-between font-bold text-base text-gray-900">
                  <span>합계</span><span>{grandTotal.toLocaleString()}원</span>
                </div>

                {/* 포인트 */}
                {(currentUser?.points ?? 0) > 0 && (
                  <div className="flex items-center gap-3 pt-2">
                    <label className="text-sm text-gray-700 whitespace-nowrap">포인트 사용</label>
                    <input
                      type="number"
                      min={0}
                      max={Math.min(currentUser?.points ?? 0, grandTotal)}
                      value={pointsToUse}
                      onChange={(e) => setPointsToUse(Math.max(0, Number(e.target.value)))}
                      className="w-28 border rounded-lg px-3 py-2 text-sm text-gray-800"
                    />
                    <span className="text-xs text-gray-400">보유 {(currentUser?.points ?? 0).toLocaleString()}P</span>
                  </div>
                )}
                {effectivePoints > 0 && (
                  <>
                    <div className="flex justify-between text-blue-600"><span>포인트 차감</span><span>-{effectivePoints.toLocaleString()}원</span></div>
                    <div className="flex justify-between font-bold text-lg text-gray-900"><span>입금액</span><span>{amountDue.toLocaleString()}원</span></div>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || grandTotal === 0}
                className="w-full py-4 bg-blue-600 text-white font-bold text-lg rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? '주문 처리 중…' : `통합 주문하기 (${amountDue.toLocaleString()}원)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
