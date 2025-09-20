'use client';

import { useState } from 'react';
import mockExamsData from '../data/mock-exams.json';

interface MockExamSettingsProps {
  onOrderGenerate: (orderText: string) => void;
  onBack: () => void;
}

const MockExamSettings = ({ onOrderGenerate, onBack }: MockExamSettingsProps) => {
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [selectedExams, setSelectedExams] = useState<string[]>([]);
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [questionsPerType, setQuestionsPerType] = useState<number>(2);

  // 모의고사 고정 구성
  const examSections = [
    { id: '18-40', name: '18~40번', description: '독해 문항 (23문항)' },
    { id: '41-42', name: '41~42번', description: '장문 독해 (2문항)' },
    { id: '43-45', name: '43~45번', description: '장문 독해 (3문항)' }
  ];

  const grades = Object.keys(mockExamsData);

  const handleExamChange = (exam: string) => {
    setSelectedExams(prev => 
      prev.includes(exam) 
        ? prev.filter(e => e !== exam)
        : [...prev, exam]
    );
  };

  const handleAllExamsToggle = () => {
    if (selectedGrade) {
      const gradeExams = mockExamsData[selectedGrade as keyof typeof mockExamsData];
      if (selectedExams.length === gradeExams.length) {
        setSelectedExams([]);
      } else {
        setSelectedExams([...gradeExams]);
      }
    }
  };

  const handleSectionChange = (sectionId: string) => {
    setSelectedSections(prev => 
      prev.includes(sectionId) 
        ? prev.filter(s => s !== sectionId)
        : [...prev, sectionId]
    );
  };

  const handleAllSectionsToggle = () => {
    if (selectedSections.length === examSections.length) {
      setSelectedSections([]);
    } else {
      setSelectedSections(examSections.map(section => section.id));
    }
  };

  const generateOrder = () => {
    if (!selectedGrade) {
      alert('학년을 선택해주세요.');
      return;
    }
    if (selectedExams.length === 0) {
      alert('모의고사를 선택해주세요.');
      return;
    }
    if (selectedSections.length === 0) {
      alert('문항 구간을 선택해주세요.');
      return;
    }

    // 선택된 구간의 총 문항 수 계산
    const getTotalQuestions = () => {
      let sectionTotal = 0;
      selectedSections.forEach(sectionId => {
        switch(sectionId) {
          case '18-40': sectionTotal += 23; break;
          case '41-42': sectionTotal += 2; break;
          case '43-45': sectionTotal += 3; break;
        }
      });
      return sectionTotal * selectedExams.length * questionsPerType;
    };

    const totalQuestions = getTotalQuestions();
    
    // 가격 계산 (100문항 이상 시 할인 적용)
    const pricePerQuestion = totalQuestions >= 100 ? 50 : 80;
    const totalPrice = totalQuestions * pricePerQuestion;
    const isDiscounted = totalQuestions >= 100;

    const selectedSectionNames = selectedSections.map(sectionId => 
      examSections.find(section => section.id === sectionId)?.name
    ).join(', ');
    
    const orderText = `모의고사 주문서

1. 학년/유형
: ${selectedGrade}
2. 선택된 모의고사
: ${selectedExams.join(', ')}
3. 선택된 구간
: ${selectedSectionNames}
4. 구간별 문항 수
: ${questionsPerType}문항씩
5. 총 문항 수
: ${totalQuestions}문항
6. 가격
: ${totalPrice.toLocaleString()}원 (총 ${totalQuestions}문항 × ${pricePerQuestion}원${isDiscounted ? ' - 100문항 이상 할인 적용' : ''})`;

    onOrderGenerate(orderText);
  };

  // 가격 계산
  const getTotalQuestions = () => {
    let sectionTotal = 0;
    selectedSections.forEach(sectionId => {
      switch(sectionId) {
        case '18-40': sectionTotal += 23; break;
        case '41-42': sectionTotal += 2; break;
        case '43-45': sectionTotal += 3; break;
      }
    });
    return sectionTotal * selectedExams.length * questionsPerType;
  };

  const totalQuestions = getTotalQuestions();
  const pricePerQuestion = totalQuestions >= 100 ? 50 : 80;
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
            모의고사 설정
          </h1>
          <p className="text-gray-600 text-lg">
            모의고사 구간과 문항 수를 선택해주세요
          </p>
        </div>

        {/* 진행 단계 표시 */}
        <div className="max-w-2xl mx-auto mb-8">
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

        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* 왼쪽: 설정 */}
            <div className="bg-white rounded-xl shadow-md p-6">
              {/* 학년 선택 */}
              <div className="mb-6">
                <h4 className="text-lg font-medium text-black mb-3">학년/유형 선택</h4>
                <select
                  value={selectedGrade}
                  onChange={(e) => {
                    setSelectedGrade(e.target.value);
                    setSelectedExams([]); // 학년 변경 시 선택된 모의고사 초기화
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
              {selectedGrade && (
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-lg font-medium text-black">모의고사 선택</h4>
                    <button
                      onClick={handleAllExamsToggle}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        selectedExams.length === mockExamsData[selectedGrade as keyof typeof mockExamsData].length
                          ? 'bg-red-100 text-black hover:bg-red-200'
                          : 'bg-blue-100 text-black hover:bg-blue-200'
                      }`}
                    >
                      {selectedExams.length === mockExamsData[selectedGrade as keyof typeof mockExamsData].length ? '전체 해제' : '전체 선택'}
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-3">
                    <div className="space-y-2">
                      {mockExamsData[selectedGrade as keyof typeof mockExamsData].map((exam) => (
                        <label 
                          key={exam} 
                          className={`flex items-center space-x-3 p-2 rounded cursor-pointer transition-all hover:bg-gray-50 ${
                            selectedExams.includes(exam) ? 'bg-blue-50' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedExams.includes(exam)}
                            onChange={() => handleExamChange(exam)}
                            className="form-checkbox h-4 w-4 text-blue-600 rounded focus:ring-blue-500"
                          />
                          <span className="text-sm text-black">{exam}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    {selectedExams.length}개 모의고사 선택됨
                  </p>
                </div>
              )}

              {/* 할인 정보 */}
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="flex items-center mb-2">
                  <span className="text-blue-600 font-semibold">💰 할인 안내</span>
                </div>
                <div className="text-sm text-blue-700">
                  • 기본: 문항당 80원<br/>
                  • 100문항 이상: 문항당 50원 <span className="font-medium text-green-600">(30원 할인!)</span>
                </div>
              </div>

              {/* 문항 구간 선택 */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-lg font-medium text-black">모의고사 구간 선택</h4>
                  <button
                    onClick={handleAllSectionsToggle}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      selectedSections.length === examSections.length
                        ? 'bg-red-100 text-black hover:bg-red-200'
                        : 'bg-blue-100 text-black hover:bg-blue-200'
                    }`}
                  >
                    {selectedSections.length === examSections.length ? '전체 해제' : '전체 선택'}
                  </button>
                </div>
                <div className="space-y-3">
                  {examSections.map((section) => (
                    <label 
                      key={section.id} 
                      className={`flex items-center justify-between p-4 border-2 rounded-lg cursor-pointer transition-all hover:shadow-md ${
                        selectedSections.includes(section.id)
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <input
                          type="checkbox"
                          checked={selectedSections.includes(section.id)}
                          onChange={() => handleSectionChange(section.id)}
                          className="form-checkbox h-5 w-5 text-blue-600 rounded focus:ring-blue-500"
                        />
                        <div>
                          <span className="font-bold text-black text-lg">{section.name}</span>
                          <p className="text-sm text-gray-600">{section.description}</p>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* 문제 개수 설정 */}
              <div className="mb-6">
                <h4 className="text-lg font-medium mb-3 text-black">구간별 문제 개수</h4>
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
                  각 구간별로 <strong>{questionsPerType}개</strong>의 문항이 출제됩니다
                </p>
              </div>
            </div>

            {/* 오른쪽: 가격 미리보기 */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <h3 className="text-xl font-bold text-black mb-4">주문 미리보기</h3>
              
              {selectedGrade && selectedExams.length > 0 && selectedSections.length > 0 ? (
                <div className="space-y-4">
                  <div className="p-4 bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-black">학년/유형:</span>
                        <span className="font-medium text-black">{selectedGrade}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">선택된 모의고사:</span>
                        <span className="font-medium text-black">{selectedExams.length}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">선택된 구간:</span>
                        <span className="font-medium text-black">{selectedSections.length}개</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-black">구간별 문항 수:</span>
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
                          {selectedSections.map(sectionId => {
                            const section = examSections.find(s => s.id === sectionId);
                            const count = sectionId === '18-40' ? 23 : sectionId === '41-42' ? 2 : 3;
                            return `${section?.name}(${count}개)`;
                          }).join(' + ')} × {selectedExams.length}개 모의고사 × {questionsPerType}개
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-black">문항당 가격:</span>
                        <span className="font-medium text-black">
                          {isDiscounted && <span className="line-through text-gray-400 mr-2">80원</span>}
                          {pricePerQuestion}원
                          {isDiscounted && <span className="text-green-600 text-xs ml-1">(30원 할인!)</span>}
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
                    모의고사 주문서 생성하기
                  </button>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl text-gray-400">📝</span>
                  </div>
                  <p>모의고사 구간을 선택해주세요</p>
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

export default MockExamSettings;
