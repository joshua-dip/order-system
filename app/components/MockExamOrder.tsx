'use client';

import { useState, useEffect } from 'react';
import { useTextbooksData } from '@/lib/useTextbooksData';
import { useCurrentUser, filterTextbooksByAllowed } from '@/lib/useCurrentUser';

interface MockExamOrderProps {
  onOrderGenerate: (orderText: string, orderPrefix?: string) => void;
}

interface LessonItem {
  번호: string;
}

interface TextbookContent {
  [lessonKey: string]: LessonItem[];
}

interface TextbookStructure {
  Sheet1?: {
    부교재?: {
      [textbookName: string]: TextbookContent;
    };
  };
  '지문 데이터'?: {
    부교재?: {
      [textbookName: string]: TextbookContent;
    };
  };
  부교재?: {
    [textbookName: string]: TextbookContent;
  };
}

const MockExamOrder = ({ onOrderGenerate }: MockExamOrderProps) => {
  const { data: textbooksData, loading: dataLoading, error: dataError } = useTextbooksData();
  const currentUser = useCurrentUser();
  const [selectedTextbook, setSelectedTextbook] = useState<string>('');
  const [selectedLessons, setSelectedLessons] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [questionsPerType, setQuestionsPerType] = useState<number>(2);
  const [lessonGroups, setLessonGroups] = useState<{[key: string]: string[]}>({});
  const [expandedLessons, setExpandedLessons] = useState<string[]>([]);

  const questionTypes = ['주제', '제목', '주장', '일치', '불일치', '빈칸', '함의', '어법'];

  useEffect(() => {
    if (!textbooksData || !selectedTextbook || !textbooksData[selectedTextbook]) {
      setLessonGroups({});
      setSelectedLessons([]);
      setExpandedLessons([]);
      return;
    }
    const textbookData = textbooksData[selectedTextbook] as TextbookStructure;
    let actualData: TextbookContent | null = null;
    const pickFirstIfSingle = (sub: Record<string, TextbookContent> | undefined) => {
      if (!sub) return null;
      if (sub[selectedTextbook]) return sub[selectedTextbook];
      const keys = Object.keys(sub);
      return keys.length > 0 ? sub[keys[0]] : null;
    };
    actualData = pickFirstIfSingle(textbookData.Sheet1?.부교재)
      ?? pickFirstIfSingle(textbookData['지문 데이터']?.부교재)
      ?? pickFirstIfSingle(textbookData.부교재);

    if (actualData) {
      const groups: {[key: string]: string[]} = {};
      Object.keys(actualData).forEach(lessonKey => {
        const lessonData = actualData![lessonKey];
        if (Array.isArray(lessonData)) {
          groups[lessonKey] = [];
          lessonData.forEach((item: LessonItem) => {
            groups[lessonKey].push(`${lessonKey} ${item.번호}`);
          });
        }
      });
      setLessonGroups(groups);
      setSelectedLessons([]);
      setExpandedLessons([]);
    } else {
      setLessonGroups({});
      setSelectedLessons([]);
      setExpandedLessons([]);
    }
  }, [selectedTextbook, textbooksData]);

  const handleLessonChange = (lesson: string) => {
    setSelectedLessons(prev => 
      prev.includes(lesson) 
        ? prev.filter(l => l !== lesson)
        : [...prev, lesson]
    );
  };

  // 강별 일괄 선택/해제 (왼쪽 클릭)
  const handleLessonGroupToggle = (lessonKey: string) => {
    const groupLessons = lessonGroups[lessonKey] || [];
    const allSelected = groupLessons.every(lesson => selectedLessons.includes(lesson));
    
    if (allSelected) {
      // 모두 선택된 경우 -> 모두 해제
      setSelectedLessons(prev => prev.filter(lesson => !groupLessons.includes(lesson)));
    } else {
      // 일부 또는 전혀 선택되지 않은 경우 -> 모두 선택
      setSelectedLessons(prev => {
        const filtered = prev.filter(lesson => !groupLessons.includes(lesson));
        return [...filtered, ...groupLessons];
      });
    }
  };

  // 개별 번호 선택 영역 확장/축소 (오른쪽 클릭)
  const handleLessonExpand = (lessonKey: string) => {
    setExpandedLessons(prev => 
      prev.includes(lessonKey)
        ? prev.filter(key => key !== lessonKey)
        : [...prev, lessonKey]
    );
  };

  const handleTypeChange = (type: string) => {
    setSelectedTypes(prev => 
      prev.includes(type) 
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  // 문제 유형 전체 선택/해제
  const handleAllTypesToggle = () => {
    if (selectedTypes.length === questionTypes.length) {
      // 모두 선택된 경우 -> 모두 해제
      setSelectedTypes([]);
    } else {
      // 일부 또는 전혀 선택되지 않은 경우 -> 모두 선택
      setSelectedTypes([...questionTypes]);
    }
  };

  const generateOrder = () => {
    if (!selectedTextbook) {
      alert('교재를 선택해주세요.');
      return;
    }
    if (selectedLessons.length === 0 || selectedTypes.length === 0) {
      alert('강과 번호와 문제 유형을 선택해주세요.');
      return;
    }

    const textbookName = selectedTextbook;
    
    // 총 문제 수 계산
    const totalQuestions = selectedTypes.length * questionsPerType;
    
    // 가격 계산 (100문항 이상 시 할인 적용)
    const pricePerQuestion = totalQuestions >= 100 ? 50 : 80;
    const totalPrice = totalQuestions * pricePerQuestion;
    const isDiscounted = totalQuestions >= 100;
    
    const orderText = `교재: ${textbookName}

1. 필요하신 강과 번호
: ${selectedLessons.join(', ')}
2. 문제 유형
: ${selectedTypes.join(', ')}
3. 유형별로 필요한 문제수
: ${questionsPerType}문항씩
4. 가격
: ${totalPrice.toLocaleString()}원 (총 ${totalQuestions}문항 × ${pricePerQuestion}원${isDiscounted ? ' - 100문항 이상 할인 적용' : ''})`;

    onOrderGenerate(orderText, 'MV');
  };

  // 진행 단계 계산
  const getProgressStep = () => {
    if (!selectedTextbook) return 1;
    if (selectedLessons.length === 0) return 2;
    if (selectedTypes.length === 0) return 3;
    return 4;
  };

  const currentStep = getProgressStep();
  const isCompleted = selectedTextbook && selectedLessons.length > 0 && selectedTypes.length > 0;

  if (dataLoading) {
    return (
      <div className="bg-white rounded-xl shadow-lg overflow-hidden p-8 text-center">
        <p className="text-gray-600">교재 데이터를 불러오는 중...</p>
      </div>
    );
  }
  if (dataError || !textbooksData) {
    return (
      <div className="bg-white rounded-xl shadow-lg overflow-hidden p-8 text-center">
        <p className="text-red-600">데이터를 불러올 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      {/* 헤더 */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6">
        <h2 className="text-2xl font-bold mb-2">모의고사 주문서 작성</h2>
        <p className="text-blue-100">단계별로 진행하여 주문서를 완성하세요</p>
      </div>

      {/* 진행 단계 표시 */}
      <div className="px-6 py-4 bg-gray-50 border-b">
        <div className="flex items-center justify-between">
          {[
            { step: 1, title: "교재 선택" },
            { step: 2, title: "강 선택" },
            { step: 3, title: "문제 유형" },
            { step: 4, title: "완료" }
          ].map(({ step, title }) => (
            <div key={step} className="flex flex-col items-center">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                currentStep >= step 
                  ? 'bg-blue-600 text-white' 
                  : 'bg-gray-200 text-gray-500'
              }`}>
                {currentStep > step ? '✓' : step}
              </div>
              <span className={`text-xs mt-1 ${currentStep >= step ? 'text-blue-600 font-medium' : 'text-gray-500'}`}>
                {title}
              </span>
            </div>
          ))}
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 mt-3">
          <div 
            className="bg-blue-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${(currentStep / 4) * 100}%` }}
          ></div>
        </div>
      </div>

      <div className="p-6">
        {/* 1단계: 교재 선택 */}
        <div className={`mb-8 ${currentStep === 1 ? 'ring-2 ring-blue-500 rounded-lg p-4' : ''}`}>
          <div className="flex items-center mb-4">
            <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold mr-3">1</div>
            <h3 className="text-xl font-bold text-gray-800">교재 선택</h3>
            {selectedTextbook && <span className="ml-2 text-green-600 font-bold">✓</span>}
          </div>
          
          <select
            value={selectedTextbook}
            onChange={(e) => setSelectedTextbook(e.target.value)}
            className={`w-full border-2 rounded-lg px-4 py-3 text-lg focus:outline-none transition-all ${
              currentStep === 1 
                ? 'border-blue-500 focus:ring-4 focus:ring-blue-200' 
                : selectedTextbook 
                ? 'border-green-500 bg-green-50' 
                : 'border-gray-300'
            }`}
          >
            <option value="">교재를 선택해주세요</option>
            {filterTextbooksByAllowed(Object.keys(textbooksData), currentUser?.allowedTextbooks).map((textbookKey) => (
              <option key={textbookKey} value={textbookKey}>
                {textbookKey}
              </option>
            ))}
          </select>
          
          {currentStep === 1 && (
            <p className="text-blue-600 text-sm mt-2 animate-pulse">
              ↑ 먼저 교재를 선택해주세요
            </p>
          )}
        </div>

        {/* 2단계: 강과 번호 선택 */}
        <div className={`mb-8 ${currentStep === 2 ? 'ring-2 ring-blue-500 rounded-lg p-4' : selectedTextbook ? '' : 'opacity-50 pointer-events-none'}`}>
          <div className="flex items-center mb-4">
            <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold mr-3">2</div>
            <h3 className="text-xl font-bold text-gray-800">강과 번호 선택</h3>
            {selectedLessons.length > 0 && <span className="ml-2 text-green-600 font-bold">✓</span>}
            {selectedLessons.length > 0 && (
              <span className="ml-2 bg-blue-100 text-blue-800 px-2 py-1 rounded-full text-sm font-medium">
                {selectedLessons.length}개 선택됨
              </span>
            )}
          </div>
          
          {selectedTextbook ? (
            <>
              {currentStep === 2 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                  <p className="text-blue-700 text-sm">
                    <strong>💡 사용법:</strong> 왼쪽을 클릭하면 강 전체 선택, 오른쪽 + 버튼을 클릭하면 개별 번호 선택이 가능해요!
                  </p>
                </div>
              )}
              
              <div className="space-y-3">
                {Object.keys(lessonGroups).map((lessonKey) => {
                  const groupLessons = lessonGroups[lessonKey];
                  const allSelected = groupLessons.every(lesson => selectedLessons.includes(lesson));
                  const someSelected = groupLessons.some(lesson => selectedLessons.includes(lesson));
                  const selectedCount = groupLessons.filter(lesson => selectedLessons.includes(lesson)).length;
                  const isExpanded = expandedLessons.includes(lessonKey);
                  
                  return (
                    <div key={lessonKey} className="border-2 rounded-xl bg-white hover:shadow-md transition-all">
                      {/* 강 헤더 */}
                      <div className="flex items-center">
                        {/* 왼쪽: 강 전체 선택 버튼 */}
                        <button
                          onClick={() => handleLessonGroupToggle(lessonKey)}
                          className={`flex-1 flex items-center justify-between px-4 py-4 rounded-l-xl font-medium transition-all ${
                            allSelected 
                              ? 'bg-blue-600 text-white shadow-lg' 
                              : someSelected 
                              ? 'bg-blue-100 text-blue-800 shadow-md' 
                              : 'bg-gray-50 text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <span className="text-lg">
                              {allSelected ? '●' : someSelected ? '◐' : '○'}
                            </span>
                            <span className="text-lg font-bold">{lessonKey}</span>
                          </div>
                          <div className={`min-w-[50px] text-center text-sm px-3 py-1 rounded-full font-bold shadow-sm ${
                            allSelected 
                              ? 'bg-white text-blue-600' 
                              : someSelected
                              ? 'bg-blue-800 text-white'
                              : 'bg-gray-200 text-gray-700'
                          }`}>
                            {selectedCount}/{groupLessons.length}
                          </div>
                        </button>

                        {/* 오른쪽: 개별 선택 확장 버튼 */}
                        <button
                          onClick={() => handleLessonExpand(lessonKey)}
                          className={`px-4 py-4 border-l-2 rounded-r-xl transition-all ${
                            isExpanded 
                              ? 'bg-indigo-100 text-indigo-700 border-indigo-200' 
                              : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border-gray-200'
                          }`}
                          title="개별 번호 선택"
                        >
                          <span className="text-lg font-bold">
                            {isExpanded ? '−' : '+'}
                          </span>
                        </button>
                      </div>
                      
                      {/* 개별 번호 선택 영역 (확장 시에만 표시) */}
                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 border-t border-gray-100 bg-gray-50 rounded-b-xl">
                          <p className="text-xs text-gray-600 mb-3">개별 번호를 선택하세요:</p>
                          <div className="grid grid-cols-4 gap-2">
                            {groupLessons.map((lesson) => (
                              <label key={lesson} className="flex items-center space-x-2 cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={selectedLessons.includes(lesson)}
                                  onChange={() => handleLessonChange(lesson)}
                                  className="form-checkbox h-4 w-4 text-indigo-600 rounded focus:ring-indigo-500"
                                />
                                <span className="text-sm text-gray-700 group-hover:text-indigo-600 font-medium">
                                  {lesson.split(' ')[1]}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-gray-400">1</span>
              </div>
              <p>먼저 1단계에서 교재를 선택해주세요</p>
            </div>
          )}
          
          {currentStep === 2 && selectedLessons.length === 0 && (
            <p className="text-blue-600 text-sm mt-4 animate-pulse">
              ↑ 필요한 강과 번호를 선택해주세요
            </p>
          )}
        </div>

        {/* 3단계: 문제 유형 및 개수 선택 */}
        <div className={`mb-8 ${currentStep === 3 ? 'ring-2 ring-blue-500 rounded-lg p-4' : selectedLessons.length === 0 ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center mb-4">
            <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold mr-3">3</div>
            <h3 className="text-xl font-bold text-gray-800">문제 유형 및 개수</h3>
            {selectedTypes.length > 0 && <span className="ml-2 text-green-600 font-bold">✓</span>}
            {selectedTypes.length > 0 && (
              <span className="ml-2 bg-green-100 text-green-800 px-2 py-1 rounded-full text-sm font-medium">
                {selectedTypes.length}개 유형 선택됨
              </span>
            )}
          </div>

          {selectedLessons.length > 0 ? (
            <>
              {currentStep === 3 && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
                  <p className="text-green-700 text-sm">
                    <strong>ⓘ 안내:</strong> 선택한 유형별로 지정한 문항 수만큼 문제가 출제됩니다
                  </p>
                </div>
              )}

              {/* 문제 유형 선택 */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-lg font-medium text-gray-800">문제 유형 선택</h4>
                  <button
                    onClick={handleAllTypesToggle}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      selectedTypes.length === questionTypes.length
                        ? 'bg-red-100 text-red-700 hover:bg-red-200'
                        : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
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
                          ? 'border-blue-500 bg-blue-50 text-blue-800'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTypes.includes(type)}
                        onChange={() => handleTypeChange(type)}
                        className="form-checkbox h-5 w-5 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span className="font-medium">{type}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 문제 수 설정 */}
              <div className="mb-6">
                <h4 className="text-lg font-medium mb-3 text-gray-800">유형별 문제 개수</h4>
                <div className="flex items-center space-x-4">
                  <select
                    value={questionsPerType}
                    onChange={(e) => setQuestionsPerType(Number(e.target.value))}
                    className="border-2 border-gray-300 rounded-lg px-4 py-3 text-lg focus:outline-none focus:ring-4 focus:ring-blue-200 focus:border-blue-500"
                  >
                    <option value={1}>1개</option>
                    <option value={2}>2개</option>
                    <option value={3}>3개</option>
                  </select>
                  <span className="text-gray-700 text-lg">문항씩</span>
                </div>
                <p className="text-sm text-gray-600 mt-2">
                  각 문제 유형별로 <strong>{questionsPerType}개</strong>의 문항이 출제됩니다
                </p>
              </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-gray-400">2</span>
              </div>
              <p>먼저 2단계에서 강과 번호를 선택해주세요</p>
            </div>
          )}

          {currentStep === 3 && selectedTypes.length === 0 && (
            <p className="text-blue-600 text-sm mt-4 animate-pulse">
              ↑ 문제 유형을 선택해주세요
            </p>
          )}
        </div>

        {/* 4단계: 최종 확인 및 주문서 생성 */}
        <div className={`${isCompleted ? '' : 'opacity-50 pointer-events-none'}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-bold mr-3">4</div>
              <h3 className="text-xl font-bold text-gray-800">최종 확인 및 주문서 생성</h3>
            </div>
            
            {/* 할인 정보 아이콘 */}
            <div className="relative group">
              <div className="w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center cursor-help">
                <span className="text-sm font-bold">ⓘ</span>
              </div>
              <div className="absolute right-0 top-8 w-64 bg-gray-800 text-white text-sm rounded-lg p-3 opacity-0 group-hover:opacity-100 transition-opacity z-10 pointer-events-none">
                <div className="text-xs font-medium mb-2">💰 할인 안내</div>
                <div className="text-xs leading-relaxed">
                  • 기본: 문항당 80원<br/>
                  • 100문항 이상: <span className="text-yellow-300 font-medium">10% 할인</span><br/>
                  • 200문항 이상: <span className="text-yellow-300 font-medium">20% 할인</span>
                </div>
                <div className="absolute -top-1 right-3 w-2 h-2 bg-gray-800 transform rotate-45"></div>
              </div>
            </div>
          </div>

          {isCompleted ? (
            <>
              {/* 주문 요약 */}
              <div className="bg-gradient-to-r from-green-50 to-blue-50 border-2 border-green-200 rounded-xl p-6 mb-6">
                <h4 className="text-lg font-bold text-green-800 mb-4">주문 요약</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">교재:</span>
                    <span className="font-medium">{selectedTextbook}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">선택된 강:</span>
                    <span className="font-medium">{selectedLessons.length}개</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">문제 유형:</span>
                    <span className="font-medium">{selectedTypes.join(', ')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">유형별 문항 수:</span>
                    <span className="font-medium">{questionsPerType}개</span>
                  </div>
                  <hr className="my-3 border-gray-300" />
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">총 문항 수:</span>
                    <span className="font-bold text-lg text-blue-600">
                      {selectedTypes.length} × {questionsPerType} = {selectedTypes.length * questionsPerType}개
                    </span>
                  </div>
                  {(() => {
                    const totalQuestions = selectedTypes.length * questionsPerType;
                    const pricePerQuestion = totalQuestions >= 100 ? 50 : 80;
                    const totalPrice = totalQuestions * pricePerQuestion;
                    const isDiscounted = totalQuestions >= 100;
                    const originalPrice = totalQuestions * 80;
                    const savings = originalPrice - totalPrice;
                    
                    return (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">문항당 가격:</span>
                          <span className={`font-medium ${isDiscounted ? 'text-red-600' : 'text-gray-800'}`}>
                            {isDiscounted && <span className="line-through text-gray-400 mr-2">80원</span>}
                            {pricePerQuestion}원
                            {isDiscounted && <span className="text-green-600 text-xs ml-1">(30원 할인!)</span>}
                          </span>
                        </div>
                        {isDiscounted && (
                          <div className="flex justify-between items-center text-green-600">
                            <span>할인 금액:</span>
                            <span className="font-bold">-{savings.toLocaleString()}원</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <span className="text-gray-600">총 가격:</span>
                          <span className={`font-bold text-2xl ${isDiscounted ? 'text-red-600' : 'text-green-600'}`}>
                            {totalPrice.toLocaleString()}원
                          </span>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* 주문서 생성 버튼 */}
              <button
                onClick={generateOrder}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-4 px-6 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all flex items-center justify-center space-x-2"
              >
                <span>주문서 생성하기</span>
              </button>
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl text-gray-400">...</span>
              </div>
              <p>위의 단계들을 완료하면 주문서를 생성할 수 있습니다</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MockExamOrder;
