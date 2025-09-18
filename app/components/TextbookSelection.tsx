'use client';

import textbooksData from '../data/converted_data.json';

interface TextbookSelectionProps {
  onTextbookSelect: (textbook: string) => void;
}

const TextbookSelection = ({ onTextbookSelect }: TextbookSelectionProps) => {
  const textbooks = Object.keys(textbooksData);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8">
      <div className="container mx-auto px-4">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            📚 교재 선택
          </h1>
          <p className="text-gray-600 text-lg">
            주문할 교재를 선택해주세요
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

        {/* 교재 목록 */}
        <div className="max-w-3xl mx-auto">
          <div className="space-y-4">
            {textbooks.map((textbook) => (
              <div
                key={textbook}
                onClick={() => onTextbookSelect(textbook)}
                className="bg-white rounded-xl shadow-md hover:shadow-lg transition-all duration-300 cursor-pointer transform hover:scale-[1.02] p-6 border-2 border-transparent hover:border-blue-500"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-800 mb-1">
                      {textbook}
                    </h3>
                    <p className="text-sm text-gray-500">클릭하여 선택하기</p>
                  </div>
                  <div className="text-blue-500 text-xl font-bold ml-4">
                    →
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

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
