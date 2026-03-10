'use client';

import { useState, useEffect } from 'react';
import AppBar from './AppBar';

interface QuestionSettingsProps {
  selectedTextbook: string;
  selectedLessons: string[];
  onOrderGenerate: (orderText: string, orderPrefix?: string) => void;
  onBack: () => void;
  onBackToTextbook: () => void;
}

const QuestionSettings = ({ selectedTextbook, selectedLessons, onOrderGenerate, onBack, onBackToTextbook }: QuestionSettingsProps) => {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [questionsPerType, setQuestionsPerType] = useState<number>(2);
  const [email, setEmail] = useState<string>('');
  const [questionSamples, setQuestionSamples] = useState<Record<string, {blogUrl: string, description: string, sampleTitle: string}>>({});

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

  const questionTypes = ['주제', '제목', '주장', '일치', '불일치', '빈칸', '함의', '어법', '순서', '삽입', '요약'];

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

    // 총 문제 수 계산 (문제 유형 수 × 유형별 문항 수 × 선택한 지문 수)
    const totalQuestions = selectedTypes.length * questionsPerType * selectedLessons.length;
    
    // 가격 계산 (퍼센트 할인 적용)
    const basePrice = totalQuestions * 80;
    let discountRate = 0;
    if (totalQuestions >= 200) {
      discountRate = 0.2; // 20% 할인
    } else if (totalQuestions >= 100) {
      discountRate = 0.1; // 10% 할인
    }
    const discountAmount = basePrice * discountRate;
    const totalPrice = basePrice - discountAmount;
    const isDiscounted = totalQuestions >= 100;
    
    const orderText = `교재: ${selectedTextbook}

자료 받으실 이메일 주소: ${email.trim()}

1. 필요하신 강과 번호
: ${selectedLessons.join(', ')}
2. 문제 유형
: ${selectedTypes.join(', ')}
3. 유형별로 필요한 문제수
: ${questionsPerType}문항씩
4. 총 문항 수
: ${totalQuestions}문항
5. 가격
: ${totalPrice.toLocaleString()}원${isDiscounted ? ` (${(discountRate * 100)}% 할인 적용: -${discountAmount.toLocaleString()}원)` : ''}`;

    onOrderGenerate(orderText, 'BV');
  };

  // 가격 계산 (문제 유형 수 × 유형별 문항 수 × 선택한 지문 수)
  const totalQuestions = selectedTypes.length * questionsPerType * selectedLessons.length;
  const basePrice = totalQuestions * 80;
  let discountRate = 0;
  if (totalQuestions >= 200) {
    discountRate = 0.2; // 20% 할인
  } else if (totalQuestions >= 100) {
    discountRate = 0.1; // 10% 할인
  }
  const discountAmount = basePrice * discountRate;
  const totalPrice = basePrice - discountAmount;
  const isDiscounted = totalQuestions >= 100;

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
                  • 기본: 문항당 80원<br/>
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
                      <div className="flex items-center justify-between">
                        <label className="flex items-center space-x-3 cursor-pointer flex-1">
                          <input
                            type="checkbox"
                            checked={selectedTypes.includes(type)}
                            onChange={() => handleTypeChange(type)}
                            className="form-checkbox h-5 w-5 text-blue-600 rounded focus:ring-blue-500"
                          />
                          <span className="font-medium text-black">{type}</span>
                        </label>
                        
                        {/* 샘플 확인 버튼 */}
                        {questionSamples[type] && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(questionSamples[type].blogUrl, '_blank');
                            }}
                            className="ml-2 px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-600 hover:text-gray-800 transition-all duration-200"
                            title={`${questionSamples[type].sampleTitle} - 블로그에서 샘플 확인`}
                          >
                            📝 샘플
                          </button>
                        )}
                      </div>
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
              <h3 className="text-xl font-bold text-black mb-4">주문 미리보기</h3>
              
              {selectedTypes.length > 0 ? (
                <div className="space-y-4">
                  <div className="p-4 bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg">
                    <div className="space-y-2 text-sm">
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
                          {totalQuestions} × 80원 = {basePrice.toLocaleString()}원
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
