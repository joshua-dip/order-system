'use client';

import { useState } from 'react';

interface QuestionSettingsProps {
  selectedTextbook: string;
  selectedLessons: string[];
  onOrderGenerate: (orderText: string) => void;
  onBack: () => void;
  onBackToTextbook: () => void;
}

const QuestionSettings = ({ selectedTextbook, selectedLessons, onOrderGenerate, onBack, onBackToTextbook }: QuestionSettingsProps) => {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [questionsPerType, setQuestionsPerType] = useState<number>(2);

  const questionTypes = ['주제', '제목', '주장', '일치', '불일치', '빈칸', '함의'];

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

    // 총 문제 수 계산 (문제 유형 수 × 유형별 문항 수 × 선택한 지문 수)
    const totalQuestions = selectedTypes.length * questionsPerType * selectedLessons.length;
    
    // 가격 계산 (100문항 이상 시 할인 적용)
    const pricePerQuestion = totalQuestions >= 100 ? 60 : 80;
    const totalPrice = totalQuestions * pricePerQuestion;
    const isDiscounted = totalQuestions >= 100;
    
    const orderText = `교재: ${selectedTextbook}

1. 필요하신 강과 번호
: ${selectedLessons.join(', ')}
2. 문제 유형
: ${selectedTypes.join(', ')}
3. 유형별로 필요한 문제수
: ${questionsPerType}문항씩
4. 가격
: ${totalPrice.toLocaleString()}원 (총 ${totalQuestions}문항 × ${pricePerQuestion}원${isDiscounted ? ' - 100문항 이상 할인 적용' : ''})`;

    onOrderGenerate(orderText);
  };

  // 가격 계산 (문제 유형 수 × 유형별 문항 수 × 선택한 지문 수)
  const totalQuestions = selectedTypes.length * questionsPerType * selectedLessons.length;
  const pricePerQuestion = totalQuestions >= 100 ? 60 : 80;
  const totalPrice = totalQuestions * pricePerQuestion;
  const isDiscounted = totalQuestions >= 100;
  const originalPrice = totalQuestions * 80;
  const savings = originalPrice - totalPrice;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8">
      <div className="container mx-auto px-4">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            문제 설정
          </h1>
          <p className="text-gray-600 text-lg">
            문제 유형과 개수를 선택해주세요
          </p>
        </div>

        {/* 진행 단계 표시 */}
        <div className="max-w-2xl mx-auto mb-8">
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
                  • 100문항 이상: 문항당 60원 <span className="font-medium text-green-600">(20원 할인!)</span>
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
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {questionTypes.map((type) => (
                    <label 
                      key={type} 
                      className={`flex items-center space-x-3 p-3 border-2 rounded-lg cursor-pointer transition-all hover:shadow-md ${
                        selectedTypes.includes(type)
                          ? 'border-blue-500 bg-blue-50 text-black'
                          : 'border-gray-300 hover:border-gray-400 text-black'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTypes.includes(type)}
                        onChange={() => handleTypeChange(type)}
                        className="form-checkbox h-5 w-5 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span className="font-medium text-black">{type}</span>
                    </label>
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
                        <span className="text-black">문항당 가격:</span>
                        <span className="font-medium text-black">
                          {isDiscounted && <span className="line-through text-gray-400 mr-2">80원</span>}
                          {pricePerQuestion}원
                          {isDiscounted && <span className="text-green-600 text-xs ml-1">(20원 할인!)</span>}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-black">총 가격:</span>
                        <div className="text-right">
                          {isDiscounted ? (
                            <>
                              <div className="line-through text-gray-400 text-sm">
                                {originalPrice.toLocaleString()}원
                              </div>
                              <div className="font-bold text-2xl text-red-600">
                                {totalPrice.toLocaleString()}원 
                                <span className="text-green-600 text-sm ml-2">
                                  ({savings.toLocaleString()}원 할인)
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

        {/* 네비게이션 버튼 */}
        <div className="max-w-4xl mx-auto mt-8 flex justify-between">
          <button
            onClick={onBack}
            className="px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium"
          >
            ← 이전 단계
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuestionSettings;
