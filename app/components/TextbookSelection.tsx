'use client';


interface TextbookSelectionProps {
  onTextbookSelect: (textbook: string) => void;
  onMockExamSelect: () => void;
  onWorkbookSelect: () => void;
}

const TextbookSelection = ({ onTextbookSelect, onMockExamSelect, onWorkbookSelect }: TextbookSelectionProps) => {

  return (
    <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="container mx-auto px-4">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
            주문 유형 선택
          </h1>
          <p className="text-lg mb-4" style={{ color: '#888B8D' }}>
            원하시는 자료 유형을 선택해주세요
          </p>
        </div>


        {/* 주문 유형 선택 */}
        <div className="max-w-6xl mx-auto mb-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* 모의고사 변형문제 주문 */}
            <div
              onClick={onMockExamSelect}
              className="group relative bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-500 cursor-pointer border border-gray-200 hover:border-gray-300 overflow-hidden"
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ backgroundColor: '#13294B' }}></div>
              <div className="relative z-10 p-8">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 transition-all duration-500 group-hover:bg-white group-hover:bg-opacity-20" style={{ backgroundColor: '#13294B' }}>
                    <span className="text-2xl font-bold text-white">📝</span>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-800 group-hover:text-white transition-colors duration-500 mb-3">모의고사 변형문제 주문</h3>
                  <p className="text-gray-600 group-hover:text-white group-hover:opacity-90 transition-all duration-500 text-sm mb-6 leading-relaxed">
                    18~40번, 41~42번, 43~45번<br/>
                    정해진 문항 구성
                  </p>
                  <div className="inline-block px-4 py-2 rounded-lg text-sm font-medium transition-all duration-500 border-2 text-gray-700 border-gray-300 group-hover:border-white group-hover:text-white">
                    선택하기
                  </div>
                </div>
              </div>
            </div>

            {/* 부교재 변형문제 주문 */}
            <div
              onClick={() => onTextbookSelect('부교재_목록')}
              className="group relative bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-500 cursor-pointer border border-gray-200 hover:border-gray-300 overflow-hidden"
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ backgroundColor: '#13294B' }}></div>
              <div className="relative z-10 p-8">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 transition-all duration-500 group-hover:bg-white group-hover:bg-opacity-20" style={{ backgroundColor: '#13294B' }}>
                    <span className="text-2xl font-bold text-white">📚</span>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-800 group-hover:text-white transition-colors duration-500 mb-3">부교재 변형문제 주문</h3>
                  <p className="text-gray-600 group-hover:text-white group-hover:opacity-90 transition-all duration-500 text-sm mb-6 leading-relaxed">
                    교재별 맞춤 문항 선택<br/>
                    다양한 교재 지원
                  </p>
                  <div className="inline-block px-4 py-2 rounded-lg text-sm font-medium transition-all duration-500 border-2 text-gray-700 border-gray-300 group-hover:border-white group-hover:text-white">
                    선택하기
                  </div>
                </div>
              </div>
            </div>

            {/* 워크북 주문 */}
            <div
              onClick={onWorkbookSelect}
              className="group relative bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-500 cursor-pointer border border-gray-200 hover:border-gray-300 overflow-hidden"
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500" style={{ backgroundColor: '#00A9E0' }}></div>
              <div className="relative z-10 p-8">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6 transition-all duration-500 group-hover:bg-white group-hover:bg-opacity-20" style={{ backgroundColor: '#00A9E0' }}>
                    <span className="text-2xl font-bold text-white">📖</span>
                  </div>
                  <h3 className="text-2xl font-bold text-gray-800 group-hover:text-white transition-colors duration-500 mb-3">워크북 주문</h3>
                  <p className="text-gray-600 group-hover:text-white group-hover:opacity-90 transition-all duration-500 text-sm mb-6 leading-relaxed">
                    빈칸쓰기,  낱말배열 등<br/>
                    카테고리별 문제 구성
                  </p>
                  <div className="inline-block px-4 py-2 rounded-lg text-sm font-medium transition-all duration-500 border-2 text-gray-700 border-gray-300 group-hover:border-white group-hover:text-white">
                    선택하기
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>


      </div>
    </div>
  );
};

export default TextbookSelection;
