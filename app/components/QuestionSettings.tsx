'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import AppBar from './AppBar';
import type { OrderGenerateExtras } from './MockExamSettings';

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
  onOrderGenerate: (orderText: string, orderPrefix?: string, extras?: OrderGenerateExtras) => void;
  onBack: () => void;
  onBackToTextbook: () => void;
}

const QuestionSettings = ({ selectedTextbook, selectedLessons, onOrderGenerate, onBack, onBackToTextbook }: QuestionSettingsProps) => {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [questionsPerType, setQuestionsPerType] = useState<number>(3);
  const [email, setEmail] = useState<string>('');
  const [questionSamples, setQuestionSamples] = useState<Record<string, {blogUrl: string, description: string, sampleTitle: string}>>({});
  const [orderInsertExplanation, setOrderInsertExplanation] = useState<{ 순서: boolean; 삽입: boolean }>({
    순서: true,
    삽입: true,
  });
  const [isMember, setIsMember] = useState(false);
  const [myFormatApproved, setMyFormatApproved] = useState(false);
  const [useCustomHwp, setUseCustomHwp] = useState(false);
  const [formatCounts, setFormatCounts] = useState({ 강의용자료: 0, 수업용자료: 0, 변형문제: 0 });
  const [loadingLatestOptions, setLoadingLatestOptions] = useState(false);

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
        setIsMember(!!u && u.role !== 'admin');
        setMyFormatApproved(!!u?.myFormatApproved);
        if (u?.myFormatApproved) refreshMyFormats();
      })
      .catch(() => setIsMember(false));
  }, [refreshMyFormats]);

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
      if (Array.isArray(m.selectedTypes) && m.selectedTypes.length > 0) {
        setSelectedTypes(m.selectedTypes.filter((t): t is string => typeof t === 'string'));
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
      if (typeof m.email === 'string' && m.email.trim()) setEmail(m.email.trim());
      if (typeof m.useCustomHwp === 'boolean') setUseCustomHwp(m.useCustomHwp);
      alert('최근 부교재 변형 옵션을 불러왔습니다.');
    } finally {
      setLoadingLatestOptions(false);
    }
  };

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

  const questionTypes = ['주제', '제목', '주장', '일치', '불일치', '함의', '빈칸', '요약', '어법', '순서', '삽입'];
  const ORDER_INSERT_TYPES = new Set(['순서', '삽입']);

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
        type === '순서'
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
    const totalPrice = Math.round(basePrice - discountAmount);
    return { basePrice, totalQuestions, discountRate, discountAmount, totalPrice, isDiscounted: totalQuestions >= 100 };
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

  const generateOrder = () => {
    if (selectedTypes.length === 0) {
      alert('문제 유형을 선택해주세요.');
      return;
    }
    if (!email.trim()) {
      alert('이메일 주소를 입력해주세요.');
      return;
    }

    // 이메일 형식 검증
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      alert('올바른 이메일 주소를 입력해주세요.');
      return;
    }

    if (useCustomHwp) {
      if (!myFormatApproved) {
        alert(
          '직접 쓰시는 HWP 양식으로도 제작 가능합니다.\n내정보 → 나의양식에서 「변형문제」를 올리고 승인되면, 주문 시 맞춤 양식을 선택하실 수 있어요.'
        );
        return;
      }
      if (formatCounts.변형문제 < 1) {
        alert(
          '부교재 변형문제는 나의양식 「변형문제」 hwp가 필요합니다.\n내정보 → 나의양식에서 업로드한 뒤 다시 주문해 주세요.'
        );
        return;
      }
    }

    const {
      basePrice,
      totalQuestions,
      discountRate,
      discountAmount,
      totalPrice,
      isDiscounted,
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
    const orderInsertNote = orderInsertLines.length ? `\n2-1. ${orderInsertLines.join(' / ')}` : '';

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
: ${totalPrice.toLocaleString()}원${isDiscounted ? ` (${(discountRate * 100)}% 할인 적용: -${Math.round(discountAmount).toLocaleString()}원)` : ''}${useCustomHwp ? `

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
    };
    onOrderGenerate(orderText, 'BV', { orderMeta });
  };

  const {
    basePrice,
    totalQuestions,
    discountRate,
    discountAmount,
    totalPrice,
    isDiscounted,
  } = computeBookVariantPrice();

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
                  • 100문항 이상: <span className="font-medium text-green-600">10% 할인</span><br/>
                  • 200문항 이상: <span className="font-medium text-green-600">20% 할인</span>
                </div>
              </div>

              {/* 문제 유형 선택 */}
              <div className="mb-6">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <h4 className="text-lg font-medium text-black">문제 유형 선택</h4>
                  <div className="flex flex-wrap items-center gap-2">
                    {isMember && (
                      <button
                        type="button"
                        onClick={loadLatestOrderOptions}
                        disabled={loadingLatestOptions}
                        className="px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold bg-[#e0f2fe] text-[#0369a1] border border-[#7dd3fc] hover:bg-[#bae6fd] disabled:opacity-60 whitespace-nowrap"
                      >
                        {loadingLatestOptions ? '불러오는 중…' : '📥 최신 주문 옵션'}
                      </button>
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
                {isMember && (
                  <p className="text-[11px] text-gray-500 mb-3">
                    회원 전용 · 직전 부교재 변형 주문의 유형·문항 수·이메일·HWP 사용 여부를 불러옵니다
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {questionTypes.map((type) => (
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

              {/* 변형 DB 준비 현황 (강·유형별) */}
              {selectedLessons.length > 0 && selectedTypes.length > 0 && (
                <div className="mb-6 rounded-xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/90 to-white p-4 shadow-sm">
                  <h4 className="text-base font-bold text-indigo-950 mb-1 flex items-center gap-2">
                    <span aria-hidden>📦</span> 변형문제 DB 준비 현황
                  </h4>
                  <p className="text-[11px] text-indigo-800/80 mb-3 leading-relaxed">
                    선택하신 <strong>교재·강(지문)</strong>과 <strong>유형</strong> 조합으로 등록된 변형 데이터가 있는지 표시합니다.
                    관리자 DB의 <strong>출처</strong>가 여기서 고른 강 이름과 같을 때 &quot;전 강 준비&quot;가 정확합니다.
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
                            <strong>제작에 약 1영업일</strong> 정도 걸릴 수 있어요. 아래에서 유형별로 확인해 보세요.
                          </>
                        )}
                      </div>
                      <ul className="space-y-2">
                        {avData.typeSummary.map((row) => {
                          let badge: { text: string; className: string };
                          if (row.strictAllReady) {
                            badge = {
                              text: `전 강 준비 (${row.totalLessons}강 × ${avData.minCount}문항+)`,
                              className: 'bg-emerald-600 text-white',
                            };
                          } else if (row.readyLessons > 0) {
                            badge = {
                              text: `일부 강만 (${row.readyLessons}/${row.totalLessons}강)`,
                              className: 'bg-amber-500 text-white',
                            };
                          } else if (row.looselyEnough) {
                            badge = {
                              text: `교재 합산 충분 (${row.textbookTotal}건) · 강명 일치 확인`,
                              className: 'bg-sky-600 text-white',
                            };
                          } else if (row.textbookTotal > 0) {
                            badge = {
                              text: `DB ${row.textbookTotal}건 · 강별 부족`,
                              className: 'bg-orange-500 text-white',
                            };
                          } else {
                            badge = {
                              text: 'DB 없음 → 제작 필요',
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
                    </div>
                  </div>

                  {/* 주문서 생성 버튼 */}
                  <button
                    onClick={generateOrder}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 px-6 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all"
                  >
                    주문서 생성하기
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
        </div>

      </div>
    </div>
    </>
  );
};

export default QuestionSettings;
