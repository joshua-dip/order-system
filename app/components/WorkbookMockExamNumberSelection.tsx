'use client';

import { useState } from 'react';
import AppBar from './AppBar';

interface WorkbookMockExamNumberSelectionProps {
  selectedExam: string;
  onNumbersSelect: (numbers: string[]) => void;
  onBack: () => void;
  onBackToTextbook: () => void;
}

const WorkbookMockExamNumberSelection = ({ 
  selectedExam, 
  onNumbersSelect, 
  onBack,
  onBackToTextbook 
}: WorkbookMockExamNumberSelectionProps) => {
  const [selectedNumbers, setSelectedNumbers] = useState<string[]>([]);

  // 모의고사 번호별 구성 (MockExamSettings와 동일)
  const examNumbers = [
    // 18번부터 40번까지 개별 번호
    ...Array.from({ length: 23 }, (_, i) => ({
      id: `${18 + i}`,
      name: `${18 + i}번`,
      questionCount: 1
    })),
    // 41~42번 (하나의 지문)
    { id: '41-42', name: '41~42번', questionCount: 1 },
    // 43~45번 (하나의 지문)  
    { id: '43-45', name: '43~45번', questionCount: 1 }
  ];

  const handleNumberChange = (numberId: string) => {
    setSelectedNumbers(prev => 
      prev.includes(numberId) 
        ? prev.filter(n => n !== numberId)
        : [...prev, numberId]
    );
  };

  const handleAllNumbersToggle = () => {
    if (selectedNumbers.length === examNumbers.length) {
      setSelectedNumbers([]);
    } else {
      setSelectedNumbers(examNumbers.map(number => number.id));
    }
  };

  const handleNext = () => {
    if (selectedNumbers.length === 0) {
      alert('번호를 선택해주세요.');
      return;
    }
    onNumbersSelect(selectedNumbers);
  };

  return (
    <>
      <AppBar 
        showBackButton={true} 
        onBackClick={onBack}
        title="번호 선택"
      />
      <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
        <div className="container mx-auto px-4">
          {/* 헤더 */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
              번호 선택
            </h1>
            <p className="text-lg" style={{ color: '#888B8D' }}>
              워크북을 제작할 번호를 선택해주세요
            </p>
          </div>

          {/* 진행 단계 표시 */}
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
              <div className="flex-1 h-1 bg-green-600 mx-4"></div>
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
              <div className="flex-1 h-1 mx-4" style={{ backgroundColor: '#00A9E0' }}></div>
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 text-white rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: '#00A9E0' }}>
                  3
                </div>
                <span className="text-xs mt-1 font-medium" style={{ color: '#00A9E0' }}>번호 선택</span>
              </div>
              <div className="flex-1 h-1 bg-gray-200 mx-4"></div>
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 bg-gray-200 text-gray-500 rounded-full flex items-center justify-center text-sm font-bold">
                  4
                </div>
                <span className="text-xs mt-1 text-gray-500">워크북 유형</span>
              </div>
            </div>
          </div>

          {/* 선택한 교재 표시 */}
          <div className="max-w-4xl mx-auto mb-6">
            <div className="bg-white rounded-lg shadow-sm p-4 border-2 border-blue-200">
              <p className="text-sm text-gray-600">선택한 모의고사</p>
              <p className="text-lg font-semibold" style={{ color: '#101820' }}>{selectedExam}</p>
            </div>
          </div>

          {/* 번호 선택 */}
          <div className="max-w-4xl mx-auto">
            <div className="bg-white rounded-xl shadow-md p-6 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold" style={{ color: '#101820' }}>
                  번호 선택 ({selectedNumbers.length}개 선택됨)
                </h2>
                <button
                  onClick={handleAllNumbersToggle}
                  className="px-4 py-2 rounded-lg font-medium transition-colors text-sm"
                  style={{ 
                    backgroundColor: selectedNumbers.length === examNumbers.length ? '#E8F5E9' : '#E3F2FD',
                    color: selectedNumbers.length === examNumbers.length ? '#2E7D32' : '#1976D2'
                  }}
                >
                  {selectedNumbers.length === examNumbers.length ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              
              <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
                {examNumbers.map((number) => (
                  <button
                    key={number.id}
                    onClick={() => handleNumberChange(number.id)}
                    className={`py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                      selectedNumbers.includes(number.id)
                        ? 'bg-blue-600 text-white shadow-md scale-105'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {number.name}
                  </button>
                ))}
              </div>
            </div>

            {/* 다음 단계 버튼 */}
            <div className="flex justify-center gap-4">
              <button
                onClick={onBackToTextbook}
                className="px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium"
              >
                이전 단계
              </button>
              <button
                onClick={handleNext}
                disabled={selectedNumbers.length === 0}
                className={`px-8 py-3 rounded-lg font-semibold transition-all duration-200 ${
                  selectedNumbers.length > 0
                    ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                다음 단계 ({selectedNumbers.length}개 번호 선택됨)
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default WorkbookMockExamNumberSelection;

