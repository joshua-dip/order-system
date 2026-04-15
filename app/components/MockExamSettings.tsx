'use client';

import { useState, useEffect, useRef } from 'react';
import AppBar from './AppBar';
export type OrderGenerateExtras = { orderMeta?: Record<string, unknown>; pointsUsed?: number };

export type OrderGenerateHandler = (
  orderText: string,
  orderPrefix?: string,
  extras?: OrderGenerateExtras
) => void | Promise<void>;

interface MockExamSettingsProps {
  onOrderGenerate: OrderGenerateHandler;
  onBack: () => void;
}

// 개별 모의고사 선택 항목
interface ExamSelection {
  id: string;
  grade: string;
  exam: string;
  numbers: string[];
}

const MockExamSettings = ({ onOrderGenerate, onBack }: MockExamSettingsProps) => {
  const [examSelections, setExamSelections] = useState<ExamSelection[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [questionsPerType, setQuestionsPerType] = useState<number>(3);
  const [email, setEmail] = useState<string>('');
  const [mockExamsData, setMockExamsData] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [questionSamples, setQuestionSamples] = useState<Record<string, {blogUrl: string, description: string, sampleTitle: string}>>({});
  /** 순서·삽입 각각: true=해설포함 80원, false=미포함(문제·답만) 50원 */
  const [orderInsertExplanation, setOrderInsertExplanation] = useState<{ 순서: boolean; 삽입: boolean }>({
    순서: true,
    삽입: true,
  });

  // 새 모의고사 추가를 위한 임시 상태
  const [tempGrade, setTempGrade] = useState<string>('');
  const [tempExam, setTempExam] = useState<string>('');
  const [tempNumbers, setTempNumbers] = useState<string[]>([]);
  const [isMember, setIsMember] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [loadingLatestOptions, setLoadingLatestOptions] = useState(false);
  const [userPoints, setUserPoints] = useState(0);
  /** 주문 미리보기에서 포인트 차감 사용 여부 */
  const [usePoints, setUsePoints] = useState(false);
  const [pointsToUse, setPointsToUse] = useState(0);
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const orderSubmittingRef = useRef(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const u = d?.user;
        setLoggedIn(!!u);
        setIsMember(!!u && u.role !== 'admin');
        const pts = typeof u?.points === 'number' && u.points >= 0 ? u.points : 0;
        setUserPoints(pts);
      })
      .catch(() => {
        setLoggedIn(false);
        setIsMember(false);
      });
  }, []);

  const loadLatestOrderOptions = async () => {
    setLoadingLatestOptions(true);
    try {
      const res = await fetch('/api/my/latest-order-options?flow=mockVariant', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '불러오기에 실패했습니다.');
        return;
      }
      const m = data.orderMeta as Record<string, unknown> | null;
      if (!m || m.flow !== 'mockVariant') {
        alert('저장된 최근 모의고사 변형 주문 옵션이 없습니다. 주문을 한 번 완료하면 다음부터 불러올 수 있어요.');
        return;
      }
      if (Array.isArray(m.examSelections) && m.examSelections.length > 0) {
        setExamSelections(
          (m.examSelections as { grade?: string; exam?: string; numbers?: string[] }[]).map((e, i) => ({
            id: `loaded-${Date.now()}-${i}`,
            grade: typeof e.grade === 'string' ? e.grade : '',
            exam: typeof e.exam === 'string' ? e.exam : '',
            numbers: Array.isArray(e.numbers) ? e.numbers.filter((x) => typeof x === 'string') : [],
          }))
        );
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
      alert(data.orderNumber ? `주문 ${data.orderNumber} 기준 옵션을 불러왔습니다.` : '최근 옵션을 불러왔습니다.');
    } finally {
      setLoadingLatestOptions(false);
    }
  };

  useEffect(() => {
    const loadMockExamsData = async () => {
      try {
        const mockExamData = await import('../data/mock-exams.json');
        setMockExamsData(mockExamData.default);
        
        const samplesData = await import('../data/question-samples.json');
        setQuestionSamples(samplesData.default);
      } catch (error) {
        console.error('데이터 로드 실패:', error);
        setMockExamsData({});
        setQuestionSamples({});
      } finally {
        setLoading(false);
      }
    };

    loadMockExamsData();
  }, []);

  const standardTypes = ['주제', '제목', '주장', '일치', '불일치', '함의', '빈칸', '요약', '어법', '순서', '삽입', '무관한문장'];
  const advancedTypes = ['삽입-고난도'];
  const questionTypes = [...standardTypes, ...advancedTypes];
  const ORDER_INSERT_TYPES = new Set(['순서', '삽입']);

  const computeMockExamPrice = () => {
    const totalNumberCount = examSelections.reduce((sum, exam) => sum + exam.numbers.length, 0);
    let basePrice = 0;
    for (const type of selectedTypes) {
      const n = totalNumberCount * questionsPerType;
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
    const totalQuestions = totalNumberCount * selectedTypes.length * questionsPerType;
    let discountRate = 0;
    if (totalQuestions >= 200) discountRate = 0.2;
    else if (totalQuestions >= 100) discountRate = 0.1;
    const discountAmount = basePrice * discountRate;
    const totalPrice = Math.round(basePrice - discountAmount);
    return { basePrice, totalQuestions, discountRate, discountAmount, totalPrice, isDiscounted: totalQuestions >= 100, totalNumberCount };
  };

  // 모의고사 번호별 구성
  const examNumbers = [
    ...Array.from({ length: 23 }, (_, i) => ({
      id: `${18 + i}`,
      name: `${18 + i}번`,
      questionCount: 1
    })),
    { id: '41-42', name: '41~42번', questionCount: 1 },
    { id: '43-45', name: '43~45번', questionCount: 1 }
  ];

  const grades = Object.keys(mockExamsData);

  // 모의고사 추가
  const handleAddExam = () => {
    if (!tempGrade) {
      alert('학년을 선택해주세요.');
      return;
    }
    if (!tempExam) {
      alert('모의고사를 선택해주세요.');
      return;
    }
    if (tempNumbers.length === 0) {
      alert('문항 번호를 선택해주세요.');
      return;
    }

    const newExam: ExamSelection = {
      id: `${Date.now()}`,
      grade: tempGrade,
      exam: tempExam,
      numbers: [...tempNumbers]
    };

    setExamSelections([...examSelections, newExam]);
    
    // 임시 상태 초기화
    setTempGrade('');
    setTempExam('');
    setTempNumbers([]);
  };

  // 모의고사 삭제
  const handleRemoveExam = (id: string) => {
    setExamSelections(examSelections.filter(exam => exam.id !== id));
  };

  const handleTempNumberChange = (numberId: string) => {
    setTempNumbers(prev => 
      prev.includes(numberId) 
        ? prev.filter(n => n !== numberId)
        : [...prev, numberId]
    );
  };

  const handleAllTempNumbersToggle = () => {
    if (tempNumbers.length === examNumbers.length) {
      setTempNumbers([]);
    } else {
      setTempNumbers(examNumbers.map(number => number.id));
    }
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
    if (examSelections.length === 0) {
      alert('모의고사를 추가해주세요.');
      return false;
    }
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
    return true;
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
      totalNumberCount,
    } = computeMockExamPrice();

    const examDetails = examSelections.map((exam, index) => {
      const selectedNumberNames = exam.numbers.map(numberId => 
        examNumbers.find(number => number.id === numberId)?.name
      ).join(', ');
      
      return `${index + 1}. ${exam.exam}
   - 선택된 문항: ${selectedNumberNames}`;
    }).join('\n');
    
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

    const pointLine = pointsUsedAmount > 0
      ? `\n\n포인트 사용: ${pointsUsedAmount.toLocaleString()}P\n입금하실 금액: ${Math.max(0, totalPrice - pointsUsedAmount).toLocaleString()}원`
      : '';

    const orderText = `모의고사 주문서

자료 받으실 이메일 주소: ${email.trim()}

1. 선택된 모의고사 (${examSelections.length}개)
${examDetails}

2. 문제 유형
: ${selectedTypes.join(', ')}${orderInsertNote}

3. 번호별 문항 수
: ${questionsPerType}문항씩

4. 총 문항 수
: ${totalQuestions}문항 (총 ${totalNumberCount}개 번호 × ${selectedTypes.length}개 유형 × ${questionsPerType}문항)

5. 가격
: ${totalPrice.toLocaleString()}원${isDiscounted ? ` (${(discountRate * 100)}% 할인 적용: -${Math.round(discountAmount).toLocaleString()}원)` : ''}${pointLine}`;

    const orderMeta = {
      flow: 'mockVariant',
      version: 1,
      examSelections: examSelections.map(({ grade, exam, numbers }) => ({ grade, exam, numbers })),
      selectedTypes,
      orderInsertExplanation,
      questionsPerType,
      email: email.trim(),
    };
    await Promise.resolve(
      onOrderGenerate(orderText, 'MV', { orderMeta, pointsUsed: pointsUsedAmount || undefined })
    );
    } finally {
      orderSubmittingRef.current = false;
      setOrderSubmitting(false);
    }
  };

  const generateOrder = () => {
    if (orderSubmittingRef.current) return;
    if (!validateOrder()) return;
    const { totalPrice } = computeMockExamPrice();
    const maxUsable = Math.min(userPoints, totalPrice);
    const effective =
      loggedIn && usePoints && userPoints > 0 ? Math.min(Math.max(0, pointsToUse), maxUsable) : 0;
    void submitOrder(effective);
  };

  const {
    basePrice,
    totalQuestions,
    discountRate,
    discountAmount,
    totalPrice,
    isDiscounted,
    totalNumberCount,
  } = computeMockExamPrice();

  const maxPointUsable = Math.min(userPoints, totalPrice);
  const depositAfterPoints = Math.max(0, totalPrice - (usePoints ? Math.min(pointsToUse, maxPointUsable) : 0));

  useEffect(() => {
    if (!usePoints || userPoints <= 0) return;
    setPointsToUse((p) => Math.min(Math.max(0, p), maxPointUsable));
  }, [usePoints, userPoints, maxPointUsable]);

  return (
    <>
      <AppBar 
        showBackButton={true} 
        onBackClick={onBack}
        title="모의고사 변형문제 설정"
      />
      <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="container mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
            모의고사 설정
          </h1>
          <p className="text-lg" style={{ color: '#888B8D' }}>
            여러 모의고사를 조합해서 주문할 수 있습니다
          </p>
        </div>

        <div className="max-w-2xl mx-auto mb-6">
          <div className="flex items-center justify-between">
            <div 
              className="flex flex-col items-center cursor-pointer group"
              onClick={onBack}
              title="주문 유형 선택으로 돌아가기"
            >
              <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold group-hover:bg-green-700 transition-colors">
                ✓
              </div>
              <span className="text-xs mt-1 text-green-600 font-medium group-hover:text-green-700">유형 선택</span>
            </div>
            <div className="flex-1 h-1 bg-blue-600 mx-4"></div>
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                2
              </div>
              <span className="text-xs mt-1 text-blue-600 font-medium">모의고사 설정</span>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto">
          {loading ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-gray-600">모의고사 데이터를 불러오는 중...</p>
            </div>
          ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* 왼쪽: 모의고사 추가 */}
            <div className="lg:col-span-2 space-y-6">
              {/* 추가된 모의고사 목록 */}
              {examSelections.length > 0 && (
                <div className="bg-white rounded-xl shadow-md p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-black">선택된 모의고사 ({examSelections.length}개)</h3>
                    <button
                      onClick={() => setExamSelections([])}
                      className="px-3 py-1 bg-red-100 text-red-600 rounded-lg text-sm hover:bg-red-200 transition-colors"
                    >
                      전체 삭제
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    {examSelections.map((exam) => (
                      <div key={exam.id} className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="font-bold text-blue-900 mb-2">{exam.exam}</div>
                            <div className="text-sm text-blue-700">
                              선택 번호: {exam.numbers.map(numberId => 
                                examNumbers.find(n => n.id === numberId)?.name
                              ).join(', ')}
                              <span className="ml-2 font-medium">({exam.numbers.length}개)</span>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveExam(exam.id)}
                            className="ml-4 px-3 py-1 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 transition-colors"
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 새 모의고사 추가 */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <h3 className="text-xl font-bold text-black">모의고사 추가하기</h3>
                <p className="mt-2 mb-4 rounded-lg border border-sky-100 bg-sky-50/80 px-3 py-2.5 text-sm leading-relaxed text-sky-950">
                  <strong className="text-sky-900">여러 모의고사를 담아 한 번에 주문할 수 있어요.</strong>{' '}
                  학년·시험·번호를 고른 뒤 아래 초록 버튼으로 추가하고, 다른 시험도 같은 방식으로 계속 담은 다음 주문서를 만들면 됩니다.
                </p>

                {/* 학년 선택 */}
                <div className="mb-4">
                  <h4 className="text-lg font-medium text-black mb-3">학년/유형 선택</h4>
                  <select
                    value={tempGrade}
                    onChange={(e) => {
                      setTempGrade(e.target.value);
                      setTempExam('');
                    }}
                    className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-lg text-black focus:outline-none focus:ring-4 focus:ring-blue-200 focus:border-blue-500"
                  >
                    <option value="">학년을 선택해주세요</option>
                    {grades.map((grade) => (
                      <option key={grade} value={grade}>
                        {grade}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 모의고사 선택 */}
                {tempGrade && (
                  <div className="mb-4">
                    <h4 className="text-lg font-medium text-black mb-3">모의고사 선택</h4>
                    <select
                      value={tempExam}
                      onChange={(e) => setTempExam(e.target.value)}
                      className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-lg text-black focus:outline-none focus:ring-4 focus:ring-blue-200 focus:border-blue-500"
                    >
                      <option value="">모의고사를 선택해주세요</option>
                      {(mockExamsData[tempGrade] || []).map((exam) => (
                        <option key={exam} value={exam}>
                          {exam}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 문항 번호 선택 */}
                {tempExam && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-lg font-medium text-black">문항 번호 선택</h4>
                      <button
                        onClick={handleAllTempNumbersToggle}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                          tempNumbers.length === examNumbers.length
                            ? 'bg-red-100 text-black hover:bg-red-200'
                            : 'bg-blue-100 text-black hover:bg-blue-200'
                        }`}
                      >
                        {tempNumbers.length === examNumbers.length ? '전체 해제' : '전체 선택'}
                      </button>
                    </div>
                    
                    <div className="border border-gray-200 rounded-lg p-3 max-h-60 overflow-y-auto">
                      <div className="grid grid-cols-5 gap-2">
                        {examNumbers.map((number) => (
                          <label 
                            key={number.id} 
                            className={`flex items-center justify-center p-2 border rounded cursor-pointer transition-all hover:shadow-sm ${
                              tempNumbers.includes(number.id)
                                ? 'border-blue-500 bg-blue-50 text-blue-800'
                                : 'border-gray-300 hover:border-gray-400'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={tempNumbers.includes(number.id)}
                              onChange={() => handleTempNumberChange(number.id)}
                              className="form-checkbox h-3 w-3 text-blue-600 rounded focus:ring-blue-500 mr-1"
                            />
                            <span className="text-xs text-black font-medium">{number.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 추가 버튼 */}
                <button
                  onClick={handleAddExam}
                  disabled={!tempGrade || !tempExam || tempNumbers.length === 0}
                  className={`w-full py-3 rounded-lg font-bold text-lg transition-all ${
                    tempGrade && tempExam && tempNumbers.length > 0
                      ? 'bg-green-600 hover:bg-green-700 text-white shadow-lg hover:shadow-xl'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  모의고사 추가하기 {tempNumbers.length > 0 && `(${tempNumbers.length}개 번호)`}
                </button>
              </div>

              {/* 문제 유형 및 개수 선택 */}
              <div className="bg-white rounded-xl shadow-md p-6">
                <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                  <h3 className="text-xl font-bold text-black">문제 유형 및 개수</h3>
                  {isMember && (
                    <div className="text-right">
                      <button
                        type="button"
                        onClick={loadLatestOrderOptions}
                        disabled={loadingLatestOptions}
                        className="px-3 py-2 rounded-lg text-sm font-semibold bg-[#e0f2fe] text-[#0369a1] border border-[#7dd3fc] hover:bg-[#bae6fd] disabled:opacity-60 whitespace-nowrap"
                      >
                        {loadingLatestOptions ? '불러오는 중…' : '📥 최신 주문 옵션'}
                      </button>
                      <p className="text-[11px] text-gray-500 mt-1 max-w-[200px] ml-auto">회원 · 직전 모의고사 변형 설정 불러오기</p>
                    </div>
                  )}
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
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-lg font-medium text-black">문제 유형 선택</h4>
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
                  {/* 기본 유형 */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {standardTypes.map((type) => (
                      <div 
                        key={type} 
                        className={`p-3 border-2 rounded-lg transition-all hover:shadow-md ${
                          selectedTypes.includes(type)
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-300 hover:border-gray-400'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
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
                              📝
                            </button>
                          )}
                        </div>
                        {ORDER_INSERT_TYPES.has(type) && selectedTypes.includes(type) && (
                          <p className="text-[10px] text-gray-500 mt-1.5 pl-8">
                            미포함 50원 · 해설 80원/문항
                          </p>
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
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {advancedTypes.map((type) => (
                        <div
                          key={type}
                          className={`p-3 border-2 rounded-lg transition-all hover:shadow-md ${
                            selectedTypes.includes(type)
                              ? 'border-orange-400 bg-orange-50'
                              : 'border-gray-300 hover:border-gray-400'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
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
                                📝
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
                  <h4 className="text-lg font-medium mb-3 text-black">번호별 문제 개수</h4>
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
                    각 번호/지문별로 <strong>{questionsPerType}개</strong>의 문항이 출제됩니다
                  </p>
                </div>

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
                    완성된 모의고사 자료를 받으실 이메일 주소를 입력해주세요
                  </p>
                </div>
              </div>
            </div>

            {/* 오른쪽: 가격 미리보기 */}
            <div className="bg-white rounded-xl shadow-md p-6 h-fit sticky top-4">
              <h3 className="text-xl font-bold text-black mb-4">주문 미리보기</h3>
              
              {examSelections.length > 0 && selectedTypes.length > 0 ? (
                <div className="space-y-4">
                  <div className="p-4 bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-black">선택된 모의고사:</span>
                        <span className="font-medium text-black">{examSelections.length}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">총 번호/지문:</span>
                        <span className="font-medium text-black">{totalNumberCount}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">문제 유형:</span>
                        <span className="font-medium text-black">{selectedTypes.length}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">번호별 문항 수:</span>
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
                          {totalNumberCount}개 번호 × {selectedTypes.length}개 유형 × {questionsPerType}개 문항
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-black">기본 가격:</span>
                        <span className="font-medium text-black text-right">
                          유형별 단가 합계 {basePrice.toLocaleString()}원
                        </span>
                      </div>
                      {isDiscounted && (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-black">할인율:</span>
                            <span className="font-medium text-green-600">
                              {(discountRate * 100)}% 할인
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-black">할인 금액:</span>
                            <span className="font-medium text-green-600">
                              -{discountAmount.toLocaleString()}원
                            </span>
                          </div>
                        </>
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
                      <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-sm">
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
                                    const tp = computeMockExamPrice().totalPrice;
                                    setPointsToUse(Math.min(userPoints, tp));
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
                                {Math.min(pointsToUse, maxPointUsable) > 0 && (
                                  <div className="flex justify-between items-center text-xs pt-1">
                                    <span className="text-green-700">포인트 차감</span>
                                    <span className="font-bold text-green-700">
                                      -{Math.min(pointsToUse, maxPointUsable).toLocaleString()}P
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
                      </div>
                    </div>
                  </div>

                  {/* 주문서 생성 버튼 */}
                  <button
                    type="button"
                    onClick={generateOrder}
                    disabled={!email.trim() || orderSubmitting}
                    className={`w-full py-4 px-6 rounded-xl font-bold text-lg shadow-lg transition-all ${
                      email.trim() && !orderSubmitting
                        ? 'bg-blue-600 hover:bg-blue-700 text-white hover:shadow-xl'
                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    }`}
                  >
                    {orderSubmitting ? '접수 중…' : '모의고사 주문서 생성하기'}
                    {!email.trim() && !orderSubmitting && (
                      <div className="text-xs mt-1 font-normal opacity-75">이메일을 입력해주세요</div>
                    )}
                  </button>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl text-gray-400">📝</span>
                  </div>
                  <p className="text-sm">
                    {examSelections.length === 0 
                      ? '모의고사를 추가해주세요' 
                      : '문제 유형을 선택해주세요'}
                  </p>
                </div>
              )}
            </div>
          </div>
          )}
        </div>

      </div>
    </div>
    </>
  );
};

export default MockExamSettings;
