'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import AppBar from './AppBar';
import type { OrderGenerateExtras, OrderGenerateHandler } from './MockExamSettings';
import { DEFAULT_VARIANT_SOLBOOK_EXTRA_FEE_WON } from '@/lib/variant-solbook-settings';
import {
  loadBookVariantPresets,
  saveBookVariantPreset,
  deleteBookVariantPreset,
  type BookVariantPresetRow,
  type BookVariantPresetPayloadV1,
} from '@/lib/book-variant-order-presets';

const KAKAO_INQUIRY_URL =
  process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

/** HWP 결과물 저장·분할 방식 (주문 미리보기에서 복수 선택) */
export type HwpStorageModeKey = 'bySourceNumber' | 'byCategory' | 'byChapter' | 'byRound' | 'fullRandomPair';

const HWP_STORAGE_OPTIONS: readonly { key: HwpStorageModeKey; label: string; hint: string }[] = [
  { key: 'bySourceNumber', label: '번호별', hint: '번호(Source)마다 파일 나눔' },
  { key: 'byCategory', label: '카테고리별', hint: '문제 유형마다 파일 나눔' },
  { key: 'byChapter', label: '강별', hint: '강(Chapter)마다 파일 나눔' },
  { key: 'byRound', label: '회차별', hint: '회차마다 파일 나눔' },
  { key: 'fullRandomPair', label: '전문항랜덤', hint: '기본 순서 1벌 + 무작위 순서 1벌 추가' },
] as const;

const DEFAULT_HWP_STORAGE_MODES: HwpStorageModeKey[] = ['byChapter'];

function formatHwpStorageSummary(modes: HwpStorageModeKey[]): string {
  if (modes.length === 0) return '1파일(기본)';
  return modes.map((k) => HWP_STORAGE_OPTIONS.find((o) => o.key === k)?.label ?? k).join(' + ');
}

type VariantTypeSummary = {
  type: string;
  readyLessons: number;
  totalLessons: number;
  strictAllReady: boolean;
  textbookTotal: number;
  looselyEnough: boolean;
};

interface QuestionSettingsProps {
  selectedTextbook: string;
  selectedLessons: string[];
  onOrderGenerate: OrderGenerateHandler;
  onBack: () => void;
  onBackToTextbook: () => void;
  /** /gyogwaseo 에서만 전달 — 쏠북 우선·통합 주문 안내 */
  orderFlow?: 'gyogwaseo';
}

const QuestionSettings = ({
  selectedTextbook,
  selectedLessons,
  onOrderGenerate,
  onBack,
  onBackToTextbook,
  orderFlow,
}: QuestionSettingsProps) => {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [questionsPerType, setQuestionsPerType] = useState<number>(3);
  const [email, setEmail] = useState<string>('');
  const [questionSamples, setQuestionSamples] = useState<Record<string, {blogUrl: string, description: string, sampleTitle: string}>>({});
  const [orderInsertExplanation, setOrderInsertExplanation] = useState<{ 순서: boolean; 삽입: boolean }>({
    순서: true,
    삽입: true,
  });
  const [isMember, setIsMember] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  /** 쏠북 커스텀 요금 면제: 연회원 또는 월구독 유효 시 */
  const [isAnnualMemberActive, setIsAnnualMemberActive] = useState(false);
  const [isMonthlyMemberActive, setIsMonthlyMemberActive] = useState(false);
  const [signupPremiumTrialActive, setSignupPremiumTrialActive] = useState(false);
  const [myFormatApproved, setMyFormatApproved] = useState(false);
  const [useCustomHwp, setUseCustomHwp] = useState(false);
  const [formatCounts, setFormatCounts] = useState({ 강의용자료: 0, 수업용자료: 0, 변형문제: 0 });
  const [loadingLatestOptions, setLoadingLatestOptions] = useState(false);
  const [orderOptionsMenuOpen, setOrderOptionsMenuOpen] = useState(false);
  const [presetRows, setPresetRows] = useState<BookVariantPresetRow[]>([]);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetName, setSavePresetName] = useState('');
  const orderOptionsWrapRef = useRef<HTMLDivElement>(null);
  const [userPoints, setUserPoints] = useState(0);
  /** 주문 미리보기에서 포인트로 결제 금액 차감 여부 */
  const [usePoints, setUsePoints] = useState(false);
  const [pointsToUse, setPointsToUse] = useState(0);
  /** HWP 저장 방식 — 복수 선택, 기본은 강별 */
  const [hwpStorageModes, setHwpStorageModes] = useState<HwpStorageModeKey[]>(DEFAULT_HWP_STORAGE_MODES);
  const [hwpStorageDetailOpen, setHwpStorageDetailOpen] = useState(false);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const orderSubmittingRef = useRef(false);

  /** 쏠북 교재(변형문제) — 공개 설정 */
  const [solbookKeys, setSolbookKeys] = useState<string[]>([]);
  const [solbookPurchaseUrl, setSolbookPurchaseUrl] = useState('');
  const [solbookExtraFeeWon, setSolbookExtraFeeWon] = useState(DEFAULT_VARIANT_SOLBOOK_EXTRA_FEE_WON);
  const [solbookRetailGuideText, setSolbookRetailGuideText] = useState('');

  const [avLoading, setAvLoading] = useState(false);
  const [avErr, setAvErr] = useState<string | null>(null);
  const [avData, setAvData] = useState<{
    typeSummary: VariantTypeSummary[];
    allLessonsAllTypesReady: boolean;
    minCount: number;
  } | null>(null);
  const avSeq = useRef(0);

  const refreshMyFormats = useCallback(() => {
    fetch('/api/my/my-format-upload', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const bt = d.byType || {};
        setFormatCounts({
          강의용자료: Array.isArray(bt.강의용자료) ? bt.강의용자료.length : 0,
          수업용자료: Array.isArray(bt.수업용자료) ? bt.수업용자료.length : 0,
          변형문제: Array.isArray(bt.변형문제) ? bt.변형문제.length : 0,
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const u = d?.user;
        setLoggedIn(!!u);
        setIsMember(!!u && u.role !== 'admin');
        setIsAnnualMemberActive(!!u?.isAnnualMemberActive);
        setIsMonthlyMemberActive(!!u?.isMonthlyMemberActive);
        setSignupPremiumTrialActive(!!u?.signupPremiumTrialActive);
        setMyFormatApproved(!!u?.myFormatApproved);
        if (u?.myFormatApproved) refreshMyFormats();
        const pts = typeof u?.points === 'number' && u.points >= 0 ? u.points : 0;
        setUserPoints(pts);
      })
      .catch(() => {
        setLoggedIn(false);
        setIsMember(false);
      });
  }, [refreshMyFormats]);

  useEffect(() => {
    fetch('/api/settings/variant-solbook', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setSolbookKeys(Array.isArray(d?.textbookKeys) ? d.textbookKeys : []);
        setSolbookPurchaseUrl(typeof d?.purchaseUrl === 'string' ? d.purchaseUrl.trim() : '');
        if (typeof d?.extraFeeWon === 'number' && Number.isFinite(d.extraFeeWon) && d.extraFeeWon >= 0) {
          setSolbookExtraFeeWon(Math.round(d.extraFeeWon));
        }
        setSolbookRetailGuideText(
          typeof d?.retailPriceGuideText === 'string' ? d.retailPriceGuideText.trim() : ''
        );
      })
      .catch(() => {});
  }, []);

  // 문제 샘플 데이터 로드
  useEffect(() => {
    const loadQuestionSamples = async () => {
      try {
        const samplesData = await import('../data/question-samples.json');
        setQuestionSamples(samplesData.default);
      } catch (error) {
        console.error('문제 샘플 데이터 로드 실패:', error);
        setQuestionSamples({});
      }
    };

    loadQuestionSamples();
  }, []);

  const standardTypes = ['주제', '제목', '주장', '일치', '불일치', '함의', '빈칸', '요약', '어법', '순서', '삽입', '무관한문장'];
  const advancedTypes = ['삽입-고난도'];
  const questionTypes = [...standardTypes, ...advancedTypes];
  const ORDER_INSERT_TYPES = new Set(['순서', '삽입']);

  const applyOrderMetaToForm = useCallback(
    (
      m: Record<string, unknown>,
      opts?: { allowEmptyQuestionTypes?: boolean; allowEmptyEmail?: boolean }
    ) => {
      const allowEmptyTypes = !!opts?.allowEmptyQuestionTypes;
      const allowEmptyEmail = !!opts?.allowEmptyEmail;
      if (Array.isArray(m.selectedTypes)) {
        const next = m.selectedTypes.filter((t): t is string => typeof t === 'string');
        if (next.length > 0 || allowEmptyTypes) setSelectedTypes(next);
      }
      if (m.orderInsertExplanation && typeof m.orderInsertExplanation === 'object' && m.orderInsertExplanation !== null) {
        const o = m.orderInsertExplanation as { 순서?: boolean; 삽입?: boolean };
        setOrderInsertExplanation({
          순서: typeof o.순서 === 'boolean' ? o.순서 : true,
          삽입: typeof o.삽입 === 'boolean' ? o.삽입 : true,
        });
      }
      if (typeof m.questionsPerType === 'number' && m.questionsPerType >= 1 && m.questionsPerType <= 3) {
        setQuestionsPerType(m.questionsPerType);
      }
      if (typeof m.email === 'string') {
        const t = m.email.trim();
        if (t || allowEmptyEmail) setEmail(t);
      }
      if (typeof m.useCustomHwp === 'boolean') setUseCustomHwp(m.useCustomHwp);
      if (Array.isArray(m.hwpStorageModes)) {
        const allowed: HwpStorageModeKey[] = HWP_STORAGE_OPTIONS.map((o) => o.key);
        const next = m.hwpStorageModes.filter(
          (x): x is HwpStorageModeKey => typeof x === 'string' && (allowed as string[]).includes(x)
        );
        setHwpStorageModes(next.length > 0 ? next : DEFAULT_HWP_STORAGE_MODES);
      }
    },
    []
  );

  const loadLatestOrderOptions = async () => {
    setLoadingLatestOptions(true);
    try {
      const res = await fetch('/api/my/latest-order-options?flow=bookVariant', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '불러오기에 실패했습니다.');
        return;
      }
      const m = data.orderMeta as Record<string, unknown> | null;
      if (!m || m.flow !== 'bookVariant') {
        alert('저장된 최근 부교재 변형 주문 옵션이 없습니다.');
        return;
      }
      if (typeof m.selectedTextbook === 'string' && m.selectedTextbook !== selectedTextbook) {
        if (!confirm(`저장된 주문은 교재「${m.selectedTextbook}」입니다. 현재 교재와 다릅니다. 유형·문항수·이메일만 적용할까요?`)) return;
      }
      applyOrderMetaToForm(m, { allowEmptyQuestionTypes: false, allowEmptyEmail: false });
      alert('최근 부교재 변형 옵션을 불러왔습니다.');
    } finally {
      setLoadingLatestOptions(false);
      setOrderOptionsMenuOpen(false);
    }
  };

  const refreshPresetRows = useCallback(() => {
    setPresetRows(loadBookVariantPresets());
  }, []);

  const applyNamedPreset = useCallback(
    (row: BookVariantPresetRow) => {
      if (row.textbookAtSave !== selectedTextbook) {
        if (
          !confirm(
            `저장 당시 교재는「${row.textbookAtSave}」입니다. 현재「${selectedTextbook}」와 다릅니다. 유형·문항·이메일·HWP 설정만 적용할까요?`
          )
        )
          return;
      }
      const { payload } = row;
      applyOrderMetaToForm(
        {
          selectedTypes: payload.selectedTypes,
          orderInsertExplanation: payload.orderInsertExplanation,
          questionsPerType: payload.questionsPerType,
          email: payload.email,
          useCustomHwp: payload.useCustomHwp,
          hwpStorageModes: payload.hwpStorageModes,
        },
        { allowEmptyQuestionTypes: true, allowEmptyEmail: true }
      );
      setUsePoints(payload.usePoints);
      setPointsToUse(Math.max(0, payload.pointsToUse));
      setOrderOptionsMenuOpen(false);
      alert(`「${row.name}」옵션을 적용했습니다.`);
    },
    [applyOrderMetaToForm, selectedTextbook]
  );

  const handleConfirmSavePreset = () => {
    try {
      const payload: BookVariantPresetPayloadV1 = {
        v: 1,
        selectedTypes: [...selectedTypes],
        orderInsertExplanation: { ...orderInsertExplanation },
        questionsPerType,
        email: email.trim(),
        useCustomHwp,
        hwpStorageModes: [...hwpStorageModes],
        usePoints,
        pointsToUse,
      };
      saveBookVariantPreset(savePresetName, selectedTextbook, payload);
      refreshPresetRows();
      setSavePresetOpen(false);
      setSavePresetName('');
      alert('이 브라우저에 저장했습니다. 「주문 옵션」에서 이름을 눌러 불러올 수 있어요.');
    } catch (e) {
      alert(e instanceof Error ? e.message : '저장에 실패했습니다.');
    }
  };

  useEffect(() => {
    setPresetRows(loadBookVariantPresets());
  }, []);

  useEffect(() => {
    if (!orderOptionsMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (orderOptionsWrapRef.current && !orderOptionsWrapRef.current.contains(e.target as Node)) {
        setOrderOptionsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [orderOptionsMenuOpen]);

  useEffect(() => {
    if (!savePresetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSavePresetOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [savePresetOpen]);

  useEffect(() => {
    if (selectedLessons.length === 0 || selectedTypes.length === 0) {
      avSeq.current += 1;
      setAvData(null);
      setAvErr(null);
      setAvLoading(false);
      return;
    }
    const seq = ++avSeq.current;
    const t = window.setTimeout(async () => {
      setAvLoading(true);
      setAvErr(null);
      try {
        const res = await fetch('/api/public/variant-availability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            textbook: selectedTextbook,
            lessons: selectedLessons,
            types: selectedTypes,
            minCount: questionsPerType,
          }),
        });
        const d = await res.json();
        if (seq !== avSeq.current) return;
        if (!res.ok) {
          setAvErr(typeof d.error === 'string' ? d.error : '조회 실패');
          setAvData(null);
          return;
        }
        setAvData({
          typeSummary: Array.isArray(d.typeSummary) ? d.typeSummary : [],
          allLessonsAllTypesReady: !!d.allLessonsAllTypesReady,
          minCount: typeof d.minCount === 'number' ? d.minCount : questionsPerType,
        });
      } catch {
        if (seq !== avSeq.current) return;
        setAvErr('네트워크 오류');
        setAvData(null);
      } finally {
        if (seq === avSeq.current) setAvLoading(false);
      }
    }, 480);
    return () => {
      window.clearTimeout(t);
      avSeq.current += 1;
    };
  }, [selectedTextbook, selectedLessons, selectedTypes, questionsPerType]);

  const computeBookVariantPrice = () => {
    const mult = selectedLessons.length;
    let basePrice = 0;
    for (const type of selectedTypes) {
      const n = mult * questionsPerType;
      const unit =
        type === '삽입-고난도'
          ? 100
          : type === '순서'
            ? orderInsertExplanation.순서
              ? 80
              : 50
            : type === '삽입'
              ? orderInsertExplanation.삽입
                ? 80
                : 50
              : 80;
      basePrice += n * unit;
    }
    const totalQuestions = selectedTypes.length * questionsPerType * mult;
    let discountRate = 0;
    if (totalQuestions >= 200) discountRate = 0.2;
    else if (totalQuestions >= 100) discountRate = 0.1;
    const discountAmount = basePrice * discountRate;
    const variantSubtotal = Math.round(basePrice - discountAmount);
    const isSolbookTextbook = solbookKeys.includes(selectedTextbook);
    const solbookCustomFeeWaived =
      isAnnualMemberActive || isMonthlyMemberActive || signupPremiumTrialActive;
    const solbookFee =
      isSolbookTextbook && !solbookCustomFeeWaived ? solbookExtraFeeWon : 0;
    const totalPrice = variantSubtotal + solbookFee;
    return {
      basePrice,
      totalQuestions,
      discountRate,
      discountAmount,
      variantSubtotal,
      solbookFee,
      totalPrice,
      isDiscounted: totalQuestions >= 100,
      isSolbookTextbook,
      solbookCustomFeeWaived,
    };
  };

  const handleTypeChange = (type: string) => {
    setSelectedTypes(prev => 
      prev.includes(type) 
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  const handleAllTypesToggle = () => {
    if (selectedTypes.length === questionTypes.length) {
      setSelectedTypes([]);
    } else {
      setSelectedTypes([...questionTypes]);
    }
  };

  const validateOrder = (): boolean => {
    if (selectedTypes.length === 0) {
      alert('문제 유형을 선택해주세요.');
      return false;
    }
    if (!email.trim()) {
      alert('이메일 주소를 입력해주세요.');
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      alert('올바른 이메일 주소를 입력해주세요.');
      return false;
    }
    if (useCustomHwp) {
      if (!myFormatApproved) {
        alert(
          '직접 쓰시는 HWP 양식으로도 제작 가능합니다.\n내정보 → 나의양식에서 「변형문제」를 올리고 승인되면, 주문 시 맞춤 양식을 선택하실 수 있어요.'
        );
        return false;
      }
      if (formatCounts.변형문제 < 1) {
        alert(
          '부교재 변형문제는 나의양식 「변형문제」 hwp가 필요합니다.\n내정보 → 나의양식에서 업로드한 뒤 다시 주문해 주세요.'
        );
        return false;
      }
    }
    return true;
  };

  const toggleHwpStorageMode = (key: HwpStorageModeKey) => {
    setHwpStorageModes((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const submitOrder = async (pointsUsedAmount: number) => {
    if (orderSubmittingRef.current) return;
    orderSubmittingRef.current = true;
    setOrderSubmitting(true);
    try {
    const {
      totalQuestions,
      discountRate,
      discountAmount,
      totalPrice,
      isDiscounted,
      variantSubtotal,
      solbookFee,
      isSolbookTextbook,
      solbookCustomFeeWaived,
    } = computeBookVariantPrice();

    const orderInsertLines: string[] = [];
    if (selectedTypes.includes('순서')) {
      orderInsertLines.push(
        `순서: ${orderInsertExplanation.순서 ? '해설 포함 (80원/문항)' : '해설 미포함·문제·답만 (50원/문항)'}`
      );
    }
    if (selectedTypes.includes('삽입')) {
      orderInsertLines.push(
        `삽입: ${orderInsertExplanation.삽입 ? '해설 포함 (80원/문항)' : '해설 미포함·문제·답만 (50원/문항)'}`
      );
    }
    if (selectedTypes.includes('삽입-고난도')) {
      orderInsertLines.push('삽입-고난도: 100원/문항');
    }
    const orderInsertNote = orderInsertLines.length ? `\n2-1. ${orderInsertLines.join(' / ')}` : '';

    const isSolbookOrder = solbookFee > 0;
    const solbookPurchaseLine = solbookPurchaseUrl.trim()
      ? `교재 구매 링크(참고): ${solbookPurchaseUrl.trim()}`
      : `교재 구매: 쏠북 링크로 구매하실 수 있습니다. (구체 URL은 운영자가 별도 안내드릴 수 있습니다.)`;
    const solbookRetailLine =
      solbookRetailGuideText.trim().length > 0
        ? `쏠북 교재 본체 예상 금액(참고): ${solbookRetailGuideText.trim()}`
        : '쏠북 교재 본체 소비자가는 교재·옵션에 따라 달라지므로, 쏠북 또는 위 구매 링크에서 확인해 주세요.';
    const solbookBlockPaid = isSolbookOrder
      ? `

5-2. 금액 구분 (쏠북 연계)
- 쏠북 커스텀 수수료(이곳 입금): ${solbookExtraFeeWon.toLocaleString()}원 — 고미조슈아 계좌로 입금
- 변형 문항 제작 합계(쏠북 결제): ${variantSubtotal.toLocaleString()}원 — 쏠북에서 교재와 함께 결제
- 교재 본체(인쇄본·전자본 등): 쏠북에서 별도 결제
5-3. 교재 본체(쏠북) 안내
${solbookPurchaseLine}
${solbookRetailLine}
5-4. 제작 착수(입금)
위 「쏠북 커스텀 수수료」 ${solbookExtraFeeWon.toLocaleString()}원을 계좌 입금해 주시면, 확인 후 제작을 시작합니다. 변형 제작비와 교재 본체 대금은 쏠북에서 결제하시므로 이 입금에 포함되지 않습니다.
5-5. 구매 링크 발송
입금 확인 후 1일 이내에 쏠북 구매 링크(또는 안내)를 카카오·문자·이메일 등으로 보내드릴 수 있습니다.`
      : '';
    const solbookBlockMemberWaived =
      isSolbookTextbook && solbookCustomFeeWaived && solbookFee === 0
        ? `

5-2. 쏠북 교재 (연·월 회원)
: 쏠북 지정 교재 주문입니다. 연회원·월구독 회원은 쏠북 커스텀 수수료가 면제되어, 고미조슈아로 별도 입금하실 금액이 없습니다. 변형 문항 제작 합계(${variantSubtotal.toLocaleString()}원)와 교재 본체 대금은 쏠북에서 결제해 주세요.
5-3. 교재 본체(쏠북) 안내
${solbookPurchaseLine}
${solbookRetailLine}
변형문제 제작과 별도로, 교재 본체는 쏠북(또는 안내드리는 링크)을 통해 구매하시면 됩니다.`
        : '';
    const solbookBlock = solbookBlockPaid || solbookBlockMemberWaived;

    const pointLine =
      pointsUsedAmount > 0 && !isSolbookTextbook
        ? `\n\n포인트 사용: ${pointsUsedAmount.toLocaleString()}P\n입금하실 금액(제작료): ${Math.max(0, totalPrice - pointsUsedAmount).toLocaleString()}원`
        : '';

    const priceBreakdownLine = isSolbookOrder
      ? `\n   (이곳 입금: 쏠북 커스텀 ${solbookExtraFeeWon.toLocaleString()}원 · 쏠북 결제: 변형 제작 ${variantSubtotal.toLocaleString()}원 + 교재 본체)`
      : isSolbookTextbook && solbookCustomFeeWaived
        ? `\n   (이곳 입금: 0원 — 연·월 회원 쏠북 커스텀 면제 · 쏠북 결제: 변형 제작 ${variantSubtotal.toLocaleString()}원 + 교재 본체)`
        : '';

    const orderText = `교재: ${selectedTextbook}

자료 받으실 이메일 주소: ${email.trim()}

1. 필요하신 강과 번호
: ${selectedLessons.join(', ')}
2. 문제 유형
: ${selectedTypes.join(', ')}${orderInsertNote}
3. 유형별로 필요한 문제수
: ${questionsPerType}문항씩
4. 총 문항 수
: ${totalQuestions}문항
5. 가격
: ${isSolbookTextbook
    ? `${solbookFee.toLocaleString()}원 (이곳 입금 — 쏠북 커스텀 수수료${solbookCustomFeeWaived ? ' · 연·월 회원 면제' : ''})`
    : `${totalPrice.toLocaleString()}원${isDiscounted ? ` (${(discountRate * 100)}% 할인 적용: -${Math.round(discountAmount).toLocaleString()}원)` : ''}`}${priceBreakdownLine}${pointLine}${isSolbookTextbook ? '\n   ※ 쏠북 연계 교재: 변형 제작비와 교재 본체는 쏠북에서 결제하시며, 포인트 사용은 적용되지 않습니다.' : ''}

5-1. HWP 저장 방식
: ${formatHwpStorageSummary(hwpStorageModes)}${solbookBlock}${useCustomHwp ? `

6. 커스텀 HWP 양식 사용
   나의양식 「변형문제」 양식 적용 요청 (업로드 ${formatCounts.변형문제}건)` : ''}`;

    const orderMeta = {
      flow: 'bookVariant',
      version: 1,
      selectedTextbook,
      selectedLessons,
      selectedTypes,
      orderInsertExplanation,
      questionsPerType,
      email: email.trim(),
      useCustomHwp,
      hwpStorageModes: [...hwpStorageModes],
      ...(isSolbookTextbook
        ? {
            solbook: {
              textbookKey: selectedTextbook,
              extraFeeWon: solbookExtraFeeWon,
              chargedExtraFeeWon: solbookFee,
              purchaseUrl: solbookPurchaseUrl.trim(),
              retailPriceGuideText: solbookRetailGuideText.trim(),
              customFeeWaivedMember: solbookCustomFeeWaived && solbookFee === 0,
              pointsDisabled: true,
            },
          }
        : {}),
    };
    await Promise.resolve(
      onOrderGenerate(orderText, 'BV', { orderMeta, pointsUsed: pointsUsedAmount || undefined })
    );
    } finally {
      orderSubmittingRef.current = false;
      setOrderSubmitting(false);
    }
  };

  const generateOrder = () => {
    if (orderSubmittingRef.current) return;
    if (!validateOrder()) return;
    const { totalPrice: tp, isSolbookTextbook: sb } = computeBookVariantPrice();
    const maxUsable = Math.min(userPoints, tp);
    const effective =
      loggedIn && usePoints && userPoints > 0 && !sb ? Math.min(Math.max(0, pointsToUse), maxUsable) : 0;
    void submitOrder(effective);
  };

  const {
    basePrice,
    totalQuestions,
    discountRate,
    discountAmount,
    solbookFee,
    totalPrice,
    isDiscounted,
    isSolbookTextbook,
    solbookCustomFeeWaived,
  } = computeBookVariantPrice();

  const maxPointUsable = isSolbookTextbook ? 0 : Math.min(userPoints, totalPrice);
  const pointsAppliedPreview =
    loggedIn && usePoints && userPoints > 0 && !isSolbookTextbook
      ? Math.min(Math.max(0, pointsToUse), maxPointUsable)
      : 0;
  const depositAfterPoints = Math.max(0, totalPrice - pointsAppliedPreview);

  useEffect(() => {
    if (!isSolbookTextbook) return;
    setUsePoints(false);
    setPointsToUse(0);
  }, [isSolbookTextbook]);

  useEffect(() => {
    if (!usePoints || userPoints <= 0 || isSolbookTextbook) return;
    setPointsToUse((p) => Math.min(Math.max(0, p), maxPointUsable));
  }, [usePoints, userPoints, maxPointUsable, isSolbookTextbook]);

  return (
    <>
      <AppBar 
        showBackButton={true} 
        onBackClick={onBack}
        title="문제 설정"
      />
      <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="container mx-auto px-4">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
            문제 설정
          </h1>
          <p className="text-lg" style={{ color: '#888B8D' }}>
            문제 유형과 개수를 선택해주세요
          </p>
        </div>

        {/* 진행 단계 표시 */}
        <div className="max-w-2xl mx-auto mb-6">
          <div className="flex items-center justify-between">
            <div 
              className="flex flex-col items-center cursor-pointer group"
              onClick={onBackToTextbook}
              title="교재 선택으로 돌아가기"
            >
              <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold group-hover:bg-green-700 transition-colors">
                ✓
              </div>
              <span className="text-xs mt-1 text-green-600 font-medium group-hover:text-green-700">교재 선택</span>
            </div>
            <div className="flex-1 h-1 bg-green-600 mx-4"></div>
            <div 
              className="flex flex-col items-center cursor-pointer group"
              onClick={onBack}
              title="강과 번호 선택으로 돌아가기"
            >
              <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold group-hover:bg-green-700 transition-colors">
                ✓
              </div>
              <span className="text-xs mt-1 text-green-600 font-medium group-hover:text-green-700">강과 번호</span>
            </div>
            <div className="flex-1 h-1 bg-blue-600 mx-4"></div>
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                3
              </div>
              <span className="text-xs mt-1 text-blue-600 font-medium">문제 설정</span>
            </div>
          </div>
        </div>

        {orderFlow === 'gyogwaseo' ? (
          <div className="max-w-4xl mx-auto mb-6 rounded-xl border border-violet-200 bg-violet-50/90 px-4 py-3.5 sm:px-5 text-sm text-violet-950 shadow-sm">
            <p className="font-semibold text-violet-950">교과서 자료 주문 — 유형·문항 맞춤</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-violet-900/95">
              이 단계에서는 선택하신 강·지문에 대한 <strong className="text-violet-950">변형 문항 조합</strong>을 정합니다.
              교재 본체는 앞 단계의 쏠북 안내를 참고해 주시고, 단어장·워크북·분석지 등을 한꺼번에 담으시려면{' '}
              <Link href="/bundle" className="font-semibold underline decoration-violet-400 underline-offset-2 hover:text-violet-800">
                통합 주문
              </Link>
              을 이용해 보세요.
            </p>
          </div>
        ) : null}

        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* 왼쪽: 설정 */}
            <div className="bg-white rounded-xl shadow-md p-6">
              {/* 선택 요약 */}
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <h3 className="font-semibold text-black mb-2">선택 요약</h3>
                <div className="text-sm text-black space-y-1">
                  <p><strong>교재:</strong> {selectedTextbook}</p>
                  <p><strong>선택된 지문수:</strong> {selectedLessons.length}개</p>
                </div>
              </div>

              {/* 할인 정보 */}
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center mb-2">
                  <span className="text-blue-600 font-semibold">💰 할인 안내</span>
                </div>
                <div className="text-sm text-blue-700">
                  • 기본: 문항당 80원 (순서·삽입은 해설 추가하면 80원, 문제·답만이면 50원)<br/>
                  • 삽입-고난도: 문항당 100원<br/>
                  • 100문항 이상: <span className="font-medium text-green-600">10% 할인</span><br/>
                  • 200문항 이상: <span className="font-medium text-green-600">20% 할인</span>
                </div>
              </div>

              {/* 문제 유형 선택 */}
              <div className="mb-6">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h4 className="text-lg font-medium text-black">문제 유형 선택</h4>
                  <div className="flex flex-wrap items-center gap-2">
                    {loggedIn && (
                      <>
                        <div className="relative" ref={orderOptionsWrapRef}>
                          <button
                            type="button"
                            onClick={() => setOrderOptionsMenuOpen((o) => !o)}
                            disabled={loadingLatestOptions}
                            className="px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-[#e0f2fe] text-[#0369a1] border border-[#7dd3fc] hover:bg-[#bae6fd] disabled:opacity-60 whitespace-nowrap"
                          >
                            {loadingLatestOptions ? '불러오는 중…' : '📥 주문 옵션 ▼'}
                          </button>
                          {orderOptionsMenuOpen && (
                            <div
                              className="absolute right-0 top-full z-30 mt-1 min-w-[240px] max-w-[min(92vw,320px)] rounded-xl border border-sky-200 bg-white py-1.5 text-left shadow-lg"
                              role="menu"
                            >
                              {isMember && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="block w-full px-3 py-2.5 text-left text-sm text-sky-950 hover:bg-sky-50 disabled:opacity-50"
                                  disabled={loadingLatestOptions}
                                  onClick={() => void loadLatestOrderOptions()}
                                >
                                  직전 완료 주문(서버에서 불러오기)
                                </button>
                              )}
                              {isMember && <div className="mx-2 my-1 border-t border-gray-100" />}
                              <p className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                                이 브라우저에 저장한 이름
                              </p>
                              {presetRows.length === 0 ? (
                                <p className="px-3 pb-2 text-[11px] leading-snug text-gray-500">
                                  아직 없습니다. 오른쪽 「현재 옵션 저장」으로 이름을 정해 저장하세요.
                                </p>
                              ) : (
                                <ul className="max-h-56 overflow-y-auto py-0.5">
                                  {presetRows.map((row) => (
                                    <li key={row.id} className="flex items-stretch gap-0 border-t border-gray-50 first:border-t-0">
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="min-w-0 flex-1 px-3 py-2 text-left text-sm text-gray-800 hover:bg-gray-50"
                                        onClick={() => applyNamedPreset(row)}
                                      >
                                        <span className="font-medium">{row.name}</span>
                                        <span className="mt-0.5 block text-[10px] text-gray-400">
                                          {new Date(row.savedAt).toLocaleString('ko-KR', {
                                            month: 'short',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })}
                                          {row.textbookAtSave !== selectedTextbook ? ' · 교재 다름' : ''}
                                        </span>
                                      </button>
                                      <button
                                        type="button"
                                        className="shrink-0 px-2.5 text-lg leading-none text-gray-400 hover:bg-red-50 hover:text-red-600"
                                        aria-label={`${row.name} 삭제`}
                                        title="삭제"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!confirm(`「${row.name}」저장 옵션을 삭제할까요?`)) return;
                                          deleteBookVariantPreset(row.id);
                                          refreshPresetRows();
                                        }}
                                      >
                                        ×
                                      </button>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSavePresetName('');
                            setSavePresetOpen(true);
                          }}
                          className="px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold border border-teal-300 bg-white text-teal-800 hover:bg-teal-50 whitespace-nowrap"
                        >
                          💾 현재 옵션 저장…
                        </button>
                      </>
                    )}
                    <button
                      onClick={handleAllTypesToggle}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        selectedTypes.length === questionTypes.length
                          ? 'bg-red-100 text-black hover:bg-red-200'
                          : 'bg-blue-100 text-black hover:bg-blue-200'
                      }`}
                    >
                      {selectedTypes.length === questionTypes.length ? '전체 해제' : '전체 선택'}
                    </button>
                  </div>
                </div>
                {loggedIn && (
                  <p className="text-[11px] text-gray-500 mb-3">
                    {isMember ? '회원: 서버에 있는 직전 완료 주문을 불러오거나, ' : ''}이름으로 저장한 옵션은 이 기기(브라우저)에만 보관됩니다. 다른 PC에서는 보이지 않습니다.
                  </p>
                )}
                {/* 기본 유형 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {standardTypes.map((type) => (
                    <div 
                      key={type} 
                      className={`p-3 border-2 rounded-lg transition-all hover:shadow-md ${
                        selectedTypes.includes(type)
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label className="flex items-center space-x-3 cursor-pointer flex-1 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedTypes.includes(type)}
                            onChange={() => handleTypeChange(type)}
                            className="form-checkbox h-5 w-5 text-blue-600 rounded focus:ring-blue-500 shrink-0"
                          />
                          <span className="font-medium text-black">{type}</span>
                        </label>
                        {ORDER_INSERT_TYPES.has(type) && selectedTypes.includes(type) && (
                          <div
                            className="flex rounded-lg border border-amber-300 bg-white overflow-hidden text-[11px] font-semibold shrink-0"
                            role="group"
                            aria-label={`${type} 해설 여부`}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                setOrderInsertExplanation((p) =>
                                  type === '순서' ? { ...p, 순서: false } : { ...p, 삽입: false }
                                );
                              }}
                              className={`px-2 py-1 transition-colors ${
                                !(type === '순서' ? orderInsertExplanation.순서 : orderInsertExplanation.삽입)
                                  ? 'bg-amber-500 text-white'
                                  : 'text-gray-600 hover:bg-amber-50'
                              }`}
                            >
                              미포함
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                setOrderInsertExplanation((p) =>
                                  type === '순서' ? { ...p, 순서: true } : { ...p, 삽입: true }
                                );
                              }}
                              className={`px-2 py-1 border-l border-amber-300 transition-colors ${
                                (type === '순서' ? orderInsertExplanation.순서 : orderInsertExplanation.삽입)
                                  ? 'bg-blue-600 text-white'
                                  : 'text-gray-600 hover:bg-blue-50'
                              }`}
                            >
                              해설
                            </button>
                          </div>
                        )}
                        {questionSamples[type] && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(questionSamples[type].blogUrl, '_blank');
                            }}
                            className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-600 hover:text-gray-800 transition-all duration-200 shrink-0"
                            title={`${questionSamples[type].sampleTitle} - 블로그에서 샘플 확인`}
                          >
                            📝 샘플
                          </button>
                        )}
                      </div>
                      {ORDER_INSERT_TYPES.has(type) && selectedTypes.includes(type) && (
                        <p className="text-[10px] text-gray-500 mt-1.5 pl-8">미포함 50원 · 해설 80원/문항</p>
                      )}
                    </div>
                  ))}
                </div>

                {/* 고난도 유형 */}
                <div className="mt-5 pt-4 border-t border-gray-200">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded">고난도</span>
                    <span className="text-xs text-gray-500">더 높은 변별력의 문항 유형</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {advancedTypes.map((type) => (
                      <div
                        key={type}
                        className={`p-3 border-2 rounded-lg transition-all hover:shadow-md ${
                          selectedTypes.includes(type)
                            ? 'border-orange-400 bg-orange-50'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <label className="flex items-center space-x-3 cursor-pointer flex-1 min-w-0">
                            <input
                              type="checkbox"
                              checked={selectedTypes.includes(type)}
                              onChange={() => handleTypeChange(type)}
                              className="form-checkbox h-5 w-5 text-orange-500 rounded focus:ring-orange-400 shrink-0"
                            />
                            <span className="font-medium text-black">{type}</span>
                          </label>
                          {questionSamples[type] && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(questionSamples[type].blogUrl, '_blank');
                              }}
                              className="px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-600 hover:text-gray-800 transition-all duration-200 shrink-0"
                              title={`${questionSamples[type].sampleTitle} - 블로그에서 샘플 확인`}
                            >
                              📝 샘플
                            </button>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500 mt-1.5 pl-8">100원/문항 · 새 문장을 생성하여 삽입 위치를 찾는 고난도 문항</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 문제 개수 설정 */}
              <div className="mb-6">
                <h4 className="text-lg font-medium mb-3 text-black">유형별 문제 개수</h4>
                <div className="flex items-center space-x-4">
                  <select
                    value={questionsPerType}
                    onChange={(e) => setQuestionsPerType(Number(e.target.value))}
                    className="border-2 border-gray-300 rounded-lg px-4 py-3 text-lg text-black focus:outline-none focus:ring-4 focus:ring-blue-200 focus:border-blue-500"
                  >
                    <option value={1}>1개</option>
                    <option value={2}>2개</option>
                    <option value={3}>3개</option>
                  </select>
                  <span className="text-black text-lg">문항씩</span>
                </div>
                <p className="text-sm text-black mt-2">
                  각 문제 유형별로 <strong>{questionsPerType}개</strong>의 문항이 출제됩니다
                </p>
              </div>

              {/* 나의양식(HWP) — 부교재 변형문제 */}
              {isMember && myFormatApproved && (
                <div className="mb-6 p-4 rounded-xl border-2 border-[#0ea5e9] bg-sky-50">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                    <span className="font-bold text-[#0c4a6e]">커스텀 HWP 양식 사용</span>
                    <div className="flex rounded-lg border border-amber-400 bg-white overflow-hidden text-xs font-bold">
                      <button
                        type="button"
                        onClick={() => setUseCustomHwp(false)}
                        className={`px-3 py-2 ${!useCustomHwp ? 'bg-slate-600 text-white' : 'text-gray-600 hover:bg-slate-100'}`}
                      >
                        사용 안 함
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setUseCustomHwp(true);
                          refreshMyFormats();
                        }}
                        className={`px-3 py-2 border-l border-amber-400 ${useCustomHwp ? 'bg-[#0284c7] text-white' : 'text-gray-600 hover:bg-sky-100'}`}
                      >
                        사용
                      </button>
                    </div>
                  </div>
                  {useCustomHwp && (
                    <div className="text-sm text-[#0f172a] space-y-2">
                      <p className="text-[13px] text-[#334155]">
                        내정보 → <strong>나의양식</strong>의 <strong>「변형문제」</strong> hwp/hwpx로 레이아웃을 맞춰 제작 요청합니다.
                      </p>
                      <div className="flex flex-wrap gap-3 text-[12px]">
                        <span>변형문제 양식 {formatCounts.변형문제}건</span>
                        <Link href="/my" className="text-[#2563eb] font-semibold underline">
                          나의양식에서 업로드 →
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {isMember && !myFormatApproved && (
                <div className="mb-6 p-4 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50/80 border border-amber-200/90 text-[13px] text-amber-950 leading-relaxed shadow-sm">
                  <p className="font-bold text-amber-900 mb-2 flex items-center gap-1.5">
                    <span aria-hidden>✨</span> 직접 쓰시는 HWP 양식으로도 제작해 드려요
                  </p>
                  <p className="text-amber-900/95 mb-2">
                    평소 강의·자료에 쓰시는 레이아웃이 있으시면, 그 파일을 기준으로 맞춤 제작이 가능합니다. 활용해 보시면 표준 양식과 다른 느낌으로 쓰실 수 있어요.
                  </p>
                  <p className="text-amber-900/90 text-[12px]">
                    <Link href="/my" className="font-bold text-[#b45309] underline underline-offset-2 hover:text-amber-950">
                      내정보 → 나의양식
                    </Link>
                    에서 「변형문제」 hwp/hwpx를 올려 주시면, 간단히 확인 후 주문 화면에서 <strong>「사용」</strong>을 선택하실 수 있습니다. 아직 준비 전이시면 지금처럼 표준 양식으로 주문하시면 됩니다.
                  </p>
                </div>
              )}

              {/* 이메일 주소 입력 */}
              <div className="mb-6">
                <h4 className="text-lg font-medium mb-3 text-black">
                  자료 받으실 이메일 주소 <span className="text-red-500">*</span>
                </h4>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-black focus:outline-none focus:ring-4 focus:ring-blue-200 focus:border-blue-500"
                  required
                />
                <p className="text-xs text-gray-600 mt-2">
                  완성된 부교재 변형문제 자료를 받으실 이메일 주소를 입력해주세요
                </p>
              </div>
            </div>

            {/* 오른쪽: 가격 미리보기 */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <h3 className="text-xl font-bold text-black mb-3">주문 미리보기</h3>

              {isMember ? (
                <div
                  className={`mb-4 p-3 rounded-xl border-2 ${
                    myFormatApproved
                      ? useCustomHwp
                        ? 'border-sky-400 bg-sky-50'
                        : 'border-slate-200 bg-slate-50'
                      : 'border-amber-200 bg-amber-50'
                  }`}
                >
                  <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-1">
                    나의양식 (HWP)
                  </div>
                  {myFormatApproved ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        className={`text-sm font-bold ${
                          useCustomHwp ? 'text-sky-800' : 'text-slate-700'
                        }`}
                      >
                        {useCustomHwp
                          ? '✓ 변형문제 양식 사용 (업로드 hwp/hwpx)'
                          : '○ 기본 양식 (표준 레이아웃)'}
                      </span>
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded-lg shrink-0 ${
                          useCustomHwp ? 'bg-sky-600 text-white' : 'bg-slate-500 text-white'
                        }`}
                      >
                        {useCustomHwp ? 'HWP 사용' : 'HWP 미사용'}
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-900 leading-snug">
                      <span className="font-semibold">맞춤 HWP</span>는 내정보에서 양식만 올려 주시면 이후 주문부터 선택 가능해요.
                      <span className="block mt-1 text-[12px] text-amber-800/95">지금 주문은 표준 양식으로 진행됩니다.</span>
                    </p>
                  )}
                </div>
              ) : (
                <div className="mb-4 p-3 rounded-xl border border-gray-200 bg-gray-50">
                  <div className="text-[11px] font-bold text-gray-500 mb-1">나의양식 (HWP)</div>
                  <p className="text-sm text-gray-700">비회원 주문 · 기본 양식</p>
                </div>
              )}

              <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/90 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setHwpStorageDetailOpen((v) => !v)}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-100/80 transition-colors"
                >
                  <span className="min-w-0">
                    <span className="text-sm font-bold text-black">저장 방식</span>
                    <span className="block text-xs text-slate-600 mt-0.5 truncate">{formatHwpStorageSummary(hwpStorageModes)}</span>
                  </span>
                  <span className="text-xs font-medium text-blue-600 shrink-0">{hwpStorageDetailOpen ? '접기' : '추가로 선택'}</span>
                </button>
                {hwpStorageDetailOpen ? (
                  <div className="px-3 pb-3 pt-0 border-t border-slate-200">
                    <p className="text-[11px] text-slate-500 pt-2 pb-2">여러 개 동시에 켤 수 있어요.</p>
                    <ul className="space-y-2">
                      {HWP_STORAGE_OPTIONS.map((opt) => {
                        const checked = hwpStorageModes.includes(opt.key);
                        return (
                          <li key={opt.key}>
                            <label className="flex items-start gap-2 cursor-pointer group">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleHwpStorageMode(opt.key)}
                                className="mt-0.5 w-4 h-4 rounded border-slate-400 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-black">{opt.label}</span>
                                <span className="block text-[11px] text-slate-500 mt-0.5">{opt.hint}</span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
              
              {selectedTypes.length > 0 ? (
                <div className="space-y-4">
                  <div className="p-4 bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between items-center gap-2 pt-0 border-b border-dashed border-green-200 pb-2 mb-2">
                        <span className="text-black">나의양식(HWP):</span>
                        <span className="font-semibold text-sm">
                          {!isMember ? (
                            <span className="text-gray-600">기본</span>
                          ) : !myFormatApproved ? (
                            <span className="text-amber-800">표준 (맞춤은 업로드 후)</span>
                          ) : useCustomHwp ? (
                            <span className="text-sky-700">변형문제 양식</span>
                          ) : (
                            <span className="text-slate-600">기본 양식</span>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between items-start gap-2 border-b border-dashed border-green-200 pb-2 mb-2">
                        <span className="text-black shrink-0">저장 방식:</span>
                        <span className="font-medium text-sm text-right text-emerald-900 leading-snug">
                          {formatHwpStorageSummary(hwpStorageModes)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">문제 유형:</span>
                        <span className="font-medium text-black">{selectedTypes.join(', ')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">유형별 문항 수:</span>
                        <span className="font-medium text-black">{questionsPerType}개</span>
                      </div>
                      <hr className="my-3 border-gray-300" />
                      <div className="flex flex-col space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="text-black">총 문항 수:</span>
                          <span className="font-bold text-lg text-black">
                            {totalQuestions}개
                          </span>
                        </div>
                        <div className="text-xs text-gray-600 text-right">
                          {selectedTypes.length}개 유형 × {questionsPerType}개 문항 × {selectedLessons.length}개 지문
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-black">기본 가격:</span>
                        <span className="font-medium text-black">
                          유형별 단가 합계 {basePrice.toLocaleString()}원
                        </span>
                      </div>
                      {isDiscounted && (
                        <div className="flex justify-between items-center">
                          <span className="text-black">할인율:</span>
                          <span className="font-medium text-green-600">
                            {(discountRate * 100)}% 할인
                          </span>
                        </div>
                      )}
                      {isDiscounted && (
                        <div className="flex justify-between items-center">
                          <span className="text-black">할인 금액:</span>
                          <span className="font-medium text-green-600">
                            -{discountAmount.toLocaleString()}원
                          </span>
                        </div>
                      )}
                      {isSolbookTextbook && (
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center">
                            <span className="text-black">쏠북 커스텀:</span>
                            {solbookFee > 0 ? (
                              <span className="font-medium text-violet-700">+{solbookFee.toLocaleString()}원</span>
                            ) : solbookCustomFeeWaived ? (
                              <span className="font-medium text-emerald-700">면제 (연회원·월구독)</span>
                            ) : (
                              <span className="font-medium text-gray-600">추가 없음</span>
                            )}
                          </div>
                          {solbookFee > 0 && (
                            <p className="text-[11px] leading-relaxed text-violet-950 bg-violet-50/90 border border-violet-100 rounded-lg px-2.5 py-2">
                              <strong>월구독</strong> 또는 <strong>연회원</strong>이시면 위 쏠북 커스텀 비용은{' '}
                              <strong className="text-emerald-800">무료(면제)</strong>입니다. 부교재 변형을 자주 이용하신다면
                              회원으로 전환해 비용을 절약해 보세요.{' '}
                              <Link href="/my" className="text-blue-700 underline font-semibold hover:text-blue-900">
                                내 정보
                              </Link>
                              에서 회원 여부를 확인하거나,{' '}
                              <a
                                href={KAKAO_INQUIRY_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-700 underline font-semibold hover:text-blue-900"
                              >
                                카카오톡
                              </a>
                              으로 월구독·연회원 가입을 문의해 주세요.
                            </p>
                          )}
                          {solbookCustomFeeWaived && solbookFee === 0 && (
                            <p className="text-[11px] text-emerald-900/90 leading-relaxed">
                              연회원·월구독 혜택으로 쏠북 커스텀 비용이 면제되었습니다.
                            </p>
                          )}
                        </div>
                      )}
                      {!isSolbookTextbook && (
                        <div className="flex justify-between items-center">
                          <span className="text-black">총 가격:</span>
                          <div className="text-right">
                            {isDiscounted ? (
                              <>
                                <div className="line-through text-gray-400 text-sm">
                                  {basePrice.toLocaleString()}원
                                </div>
                                <div className="font-bold text-2xl text-red-600">
                                  {totalPrice.toLocaleString()}원
                                  <span className="text-green-600 text-sm ml-2">
                                    ({(discountRate * 100)}% 할인)
                                  </span>
                                </div>
                              </>
                            ) : (
                              <div className="font-bold text-2xl text-black">
                                {totalPrice.toLocaleString()}원
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-sm">
                        {isSolbookTextbook ? (
                          <div className="space-y-3">
                            {/* ① 이곳 입금 (쏠북 커스텀 비용만) */}
                            <div className="rounded-xl border-2 border-violet-300 bg-white px-3.5 py-3 shadow-sm">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-[11px] font-bold text-white">1</span>
                                <span className="text-[13px] font-bold text-violet-900">이곳에서 결제 (쏠북 커스텀 비용)</span>
                              </div>
                              {solbookFee > 0 ? (
                                <>
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-700">쏠북 커스텀 수수료</span>
                                    <span className="text-xl font-extrabold text-violet-700 tabular-nums">
                                      {solbookFee.toLocaleString()}원
                                    </span>
                                  </div>
                                  <p className="mt-1.5 text-[11px] text-slate-500 leading-snug">
                                    이 금액만 고미조슈아 계좌로 입금됩니다.
                                  </p>
                                </>
                              ) : solbookCustomFeeWaived ? (
                                <>
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-700">쏠북 커스텀 수수료</span>
                                    <span className="text-lg font-bold text-emerald-700 tabular-nums">
                                      면제 (0원)
                                    </span>
                                  </div>
                                  <p className="mt-1.5 text-[11px] text-emerald-700 leading-snug">
                                    연회원·월구독 혜택으로 면제 — 별도 입금이 필요 없습니다.
                                  </p>
                                </>
                              ) : (
                                <>
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs text-slate-700">쏠북 커스텀 수수료</span>
                                    <span className="text-lg font-bold text-slate-700 tabular-nums">
                                      0원
                                    </span>
                                  </div>
                                  <p className="mt-1.5 text-[11px] text-slate-500 leading-snug">
                                    이 교재는 추가 커스텀 수수료가 없습니다.
                                  </p>
                                </>
                              )}
                            </div>

                            {/* ② 쏠북에서 결제 (변형 제작 + 교재 본체) */}
                            <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-3">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">2</span>
                                <span className="text-[13px] font-bold text-amber-900">쏠북에서 결제 (예상)</span>
                              </div>
                              <div className="space-y-1.5 text-xs text-amber-950">
                                <div className="flex justify-between items-start gap-2">
                                  <span className="shrink-0">변형 제작비</span>
                                  <span className="text-right tabular-nums font-semibold">
                                    {basePrice.toLocaleString()}원
                                  </span>
                                </div>
                                <div className="flex justify-between items-start gap-2">
                                  <span className="shrink-0">교재 본체 가격</span>
                                  <span className="text-right tabular-nums font-semibold">
                                    {solbookRetailGuideText.trim() || '쏠북 매장에서 확인'}
                                  </span>
                                </div>
                                <p className="text-[11px] text-amber-800/80 leading-snug pt-1">
                                  변형 제작비와 교재 본체 대금은 모두 쏠북에서 결제하시며, 이곳 입금 금액에 포함되지 않습니다.
                                </p>
                              </div>
                              {solbookPurchaseUrl.trim() && (
                                <a
                                  href={solbookPurchaseUrl.trim()}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-bold text-white hover:bg-amber-600 transition-colors no-underline"
                                >
                                  쏠북에서 결제하기 →
                                </a>
                              )}
                            </div>

                            <p className="text-[11px] text-slate-500 leading-snug px-1">
                              ※ 쏠북 가격 정책과의 혼선 방지를 위해 쏠북 연계 주문은 포인트 사용이 불가합니다.
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="flex justify-between items-center">
                              <span className="text-gray-800 font-medium">내 포인트</span>
                              <span className="font-bold text-indigo-700 tabular-nums">
                                {loggedIn ? `${userPoints.toLocaleString()}P` : '—'}
                              </span>
                            </div>
                            {!loggedIn && (
                              <p className="text-xs text-gray-500 leading-snug">
                                로그인하면 보유 포인트로 결제 금액을 줄일 수 있어요.
                              </p>
                            )}
                            {loggedIn && userPoints === 0 && (
                              <p className="text-xs text-gray-500">사용 가능한 포인트가 없습니다.</p>
                            )}
                            {loggedIn && userPoints > 0 && (
                              <>
                                <label className="flex items-start gap-2.5 cursor-pointer pt-0.5">
                                  <input
                                    type="checkbox"
                                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                                    checked={usePoints}
                                    onChange={(e) => {
                                      const on = e.target.checked;
                                      setUsePoints(on);
                                      if (on) {
                                        setPointsToUse(Math.min(userPoints, totalPrice));
                                      } else {
                                        setPointsToUse(0);
                                      }
                                    }}
                                  />
                                  <span className="text-gray-800 leading-snug">
                                    포인트로 결제 금액 차감 <span className="text-gray-500">(1P = 1원)</span>
                                  </span>
                                </label>
                                {usePoints && (
                                  <div className="pl-0 space-y-2 border-t border-slate-200 pt-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-xs text-gray-600">사용할 포인트</span>
                                      <button
                                        type="button"
                                        onClick={() => setPointsToUse(maxPointUsable)}
                                        className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                                      >
                                        전액
                                      </button>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="number"
                                        min={0}
                                        max={maxPointUsable}
                                        value={pointsToUse}
                                        onChange={(e) => {
                                          const v = Math.max(
                                            0,
                                            Math.min(maxPointUsable, Math.floor(Number(e.target.value) || 0)),
                                          );
                                          setPointsToUse(v);
                                        }}
                                        className="flex-1 min-w-0 border border-gray-300 rounded-lg px-2 py-1.5 text-right text-sm font-bold text-black focus:outline-none focus:ring-2 focus:ring-blue-300"
                                      />
                                      <span className="text-gray-500 text-xs shrink-0">P</span>
                                    </div>
                                    <input
                                      type="range"
                                      min={0}
                                      max={maxPointUsable}
                                      value={Math.min(pointsToUse, maxPointUsable)}
                                      onChange={(e) => setPointsToUse(Number(e.target.value))}
                                      className="w-full accent-blue-600"
                                    />
                                    <div className="flex justify-between text-[11px] text-gray-400">
                                      <span>0P</span>
                                      <span>{maxPointUsable.toLocaleString()}P</span>
                                    </div>
                                    {pointsAppliedPreview > 0 && (
                                      <div className="flex justify-between items-center text-xs pt-1">
                                        <span className="text-green-700">포인트 차감</span>
                                        <span className="font-bold text-green-700">
                                          -{pointsAppliedPreview.toLocaleString()}P
                                        </span>
                                      </div>
                                    )}
                                    <div className="flex justify-between items-center border-t border-slate-200 pt-2">
                                      <span className="text-gray-800 font-medium">입금 예정</span>
                                      <span className="font-bold text-lg text-black tabular-nums">
                                        {depositAfterPoints.toLocaleString()}원
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 주문서 생성 버튼 */}
                  <button
                    type="button"
                    onClick={generateOrder}
                    disabled={orderSubmitting}
                    className={`w-full py-4 px-6 rounded-xl font-bold text-lg shadow-lg transition-all ${
                      orderSubmitting
                        ? 'bg-gray-400 text-white cursor-not-allowed'
                        : 'bg-blue-600 hover:bg-blue-700 text-white hover:shadow-xl'
                    }`}
                  >
                    {orderSubmitting ? '접수 중…' : '주문서 생성하기'}
                  </button>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl text-gray-400">?</span>
                  </div>
                  <p>문제 유형을 선택해주세요</p>
                </div>
              )}
            </div>
          </div>

          {/* 변형 DB 준비 현황 — 주문서(위) 아래 배치 */}
          {selectedLessons.length > 0 && selectedTypes.length > 0 && (
            <div className="max-w-2xl mx-auto mt-10 mb-6 rounded-xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/90 to-white p-4 shadow-sm">
              <h4 className="text-base font-bold text-indigo-950 mb-1 flex items-center gap-2">
                <span aria-hidden>📦</span> 변형문제 DB 준비 현황
              </h4>
              <p className="text-[11px] text-indigo-800/80 mb-3 leading-relaxed">
                선택하신 <strong>교재·강(지문)</strong>과 <strong>유형</strong> 조합으로 등록된 변형 데이터가 있는지 표시합니다.
                관리자 DB의 <strong>출처</strong>가 여기서 고른 강 이름과 같을 때 100%가 정확합니다.
              </p>
              {avLoading && (
                <p className="text-sm text-indigo-600 py-2">불러오는 중…</p>
              )}
              {avErr && !avLoading && (
                <p className="text-sm text-red-600 py-1">{avErr}</p>
              )}
              {!avLoading && !avErr && avData && (
                <>
                  <div
                    className={`mb-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                      avData.allLessonsAllTypesReady
                        ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                        : 'bg-amber-50 text-amber-950 border border-amber-200'
                    }`}
                  >
                    {avData.allLessonsAllTypesReady ? (
                      <>
                        ✓ 선택하신 유형·강 조합마다 DB에 문항이{' '}
                        <strong>{avData.minCount}문항 이상</strong> 있어,{' '}
                        <strong>빠르게 자료를 받아보실 수 있는 경우가 많습니다</strong>
                        (최종 일정은 별도 안내를 기준으로 합니다).
                      </>
                    ) : (
                      <>
                        일부 강·유형은 DB에 아직 없을 수 있습니다. 없는 조합은{' '}
                        <strong>제작에 약 1영업일</strong> 정도 걸릴 수 있어요. 아래에서 유형별 퍼센트를 확인해 보세요.
                      </>
                    )}
                  </div>
                  <ul className="space-y-2">
                    {avData.typeSummary.map((row) => {
                      const pct =
                        row.totalLessons > 0
                          ? Math.round((row.readyLessons / row.totalLessons) * 100)
                          : 0;
                      let badge: { text: string; className: string };
                      if (row.strictAllReady) {
                        badge = {
                          text: `100% (${row.totalLessons}강 × ${avData.minCount}문항+)`,
                          className: 'bg-emerald-600 text-white',
                        };
                      } else if (row.readyLessons > 0) {
                        badge = {
                          text: `${pct}% (${row.readyLessons}/${row.totalLessons}강)`,
                          className: 'bg-amber-500 text-white',
                        };
                      } else if (row.looselyEnough) {
                        badge = {
                          text: `교재 합산 충분 (${row.textbookTotal}건) · 강명 일치 확인`,
                          className: 'bg-sky-600 text-white',
                        };
                      } else if (row.textbookTotal > 0) {
                        badge = {
                          text: `0% · DB ${row.textbookTotal}건 (강별 부족)`,
                          className: 'bg-orange-500 text-white',
                        };
                      } else {
                        badge = {
                          text: '0% · DB 없음 → 제작 필요',
                          className: 'bg-slate-500 text-white',
                        };
                      }
                      return (
                        <li
                          key={row.type}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-100 bg-white/80 px-3 py-2"
                        >
                          <span className="font-semibold text-black">{row.type}</span>
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${badge.className}`}>
                            {badge.text}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>

      </div>
    </div>

    {savePresetOpen && (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-save-title"
        onClick={() => setSavePresetOpen(false)}
      >
        <div
          className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 id="preset-save-title" className="text-lg font-bold text-gray-900">
            현재 옵션 저장
          </h3>
          <p className="mt-2 text-xs text-gray-600 leading-relaxed">
            문제 유형, 문항 수, 이메일, HWP 방식, 포인트 사용 여부 등이 저장됩니다. 교재와 강·번호는 이 화면에서 이미 고른 값이 유지됩니다.
          </p>
          <label className="mt-4 block text-xs font-semibold text-gray-700" htmlFor="preset-name-input">
            저장할 이름
          </label>
          <input
            id="preset-name-input"
            type="text"
            value={savePresetName}
            onChange={(e) => setSavePresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirmSavePreset();
              }
            }}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-400"
            placeholder="예: 내신 대비 풀세트"
            maxLength={80}
            autoFocus
          />
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              onClick={() => setSavePresetOpen(false)}
            >
              취소
            </button>
            <button
              type="button"
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700"
              onClick={handleConfirmSavePreset}
            >
              저장
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default QuestionSettings;
