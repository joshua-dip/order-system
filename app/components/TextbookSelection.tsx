'use client';

import { useState, useEffect } from 'react';

interface TextbookSelectionProps {
  onTextbookSelect: (textbook: string) => void;
  onMockExamSelect: () => void;
}

const TextbookSelection = ({ onTextbookSelect, onMockExamSelect }: TextbookSelectionProps) => {
  const [showTextbooks, setShowTextbooks] = useState(false);
  const [textbooks, setTextbooks] = useState<string[]>([]);

  // 부교재 목록을 동적으로 로드
  useEffect(() => {
    const loadTextbooks = async () => {
      try {
        const { default: textbooksData } = await import('../data/converted_data.json');
        setTextbooks(Object.keys(textbooksData));
      } catch (error) {
        console.error('교재 데이터 로딩 실패:', error);
        // 폴백으로 샘플 데이터 사용
        setTextbooks(["능률김성곤_5과", "천재이재영_6과", "비상홍민표_7과"]);
      }
    };

    if (showTextbooks) {
      loadTextbooks();
    }
  }, [showTextbooks]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8">
      <div className="container mx-auto px-4">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            주문 유형 선택
          </h1>
          <p className="text-gray-600 text-lg">
            모의고사 또는 부교재를 선택해주세요
          </p>
        </div>

        {/* 진행 단계 표시 */}
        <div className="max-w-2xl mx-auto mb-8">
          <div className="flex items-center justify-between">
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                1
              </div>
              <span className="text-xs mt-1 text-blue-600 font-medium">교재 선택</span>
            </div>
            <div className="flex-1 h-1 bg-gray-200 mx-4"></div>
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 bg-gray-200 text-gray-500 rounded-full flex items-center justify-center text-sm font-bold">
                2
              </div>
              <span className="text-xs mt-1 text-gray-500">강과 번호</span>
            </div>
            <div className="flex-1 h-1 bg-gray-200 mx-4"></div>
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 bg-gray-200 text-gray-500 rounded-full flex items-center justify-center text-sm font-bold">
                3
              </div>
              <span className="text-xs mt-1 text-gray-500">문제 설정</span>
            </div>
          </div>
        </div>

        {/* 주문 유형 선택 */}
        <div className="max-w-2xl mx-auto mb-12">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 모의고사 */}
            <div
              onClick={onMockExamSelect}
              className="bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-300 cursor-pointer transform hover:scale-105 p-8 border-2 border-transparent hover:border-blue-500"
            >
              <div className="text-center">
                <div className="w-20 h-20 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl font-bold">📝</span>
                </div>
                <h3 className="text-2xl font-bold text-gray-800 mb-2">모의고사</h3>
                <p className="text-gray-600 text-sm mb-4">
                  18~40번, 41~42번, 43~45번
                </p>
                <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-sm">
                  정해진 문항 구성
                </div>
              </div>
            </div>

            {/* 부교재 */}
            <div 
              onClick={() => setShowTextbooks(true)}
              className="bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-300 cursor-pointer transform hover:scale-105 p-8 border-2 border-transparent hover:border-green-500"
            >
              <div className="text-center">
                <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl font-bold">📚</span>
                </div>
                <h3 className="text-2xl font-bold text-gray-800 mb-2">부교재</h3>
                <p className="text-gray-600 text-sm mb-4">
                  교재별 맞춤 문항 선택
                </p>
                <div className="bg-green-50 text-green-700 px-4 py-2 rounded-lg text-sm">
                  교재 선택 후 진행
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 부교재 목록 (조건부 표시) */}
        {showTextbooks && (
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-800">부교재 목록</h2>
              <button
                onClick={() => setShowTextbooks(false)}
                className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                ← 돌아가기
              </button>
            </div>
            <div className="space-y-4">
              {textbooks.map((textbook) => (
                <div
                  key={textbook}
                  onClick={() => onTextbookSelect(textbook)}
                  className="bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-300 cursor-pointer transform hover:scale-[1.02] p-6 border-2 border-transparent hover:border-green-500"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-800 mb-1">
                        {textbook}
                      </h3>
                      <p className="text-sm text-gray-500">클릭하여 선택하기</p>
                    </div>
                    <div className="text-green-500 text-xl font-bold ml-4">
                      →
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 안내 메시지 */}
        <div className="text-center mt-12">
          <p className="text-gray-500 text-sm">
            💡 교재를 선택하면 해당 교재의 강과 번호를 선택할 수 있습니다
          </p>
        </div>
      </div>
    </div>
  );
};

export default TextbookSelection;
