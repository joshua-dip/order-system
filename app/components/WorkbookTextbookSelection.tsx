'use client';

import { useState, useEffect } from 'react';

interface WorkbookTextbookSelectionProps {
  onTextbookSelect: (textbook: string) => void;
  onBack: () => void;
}

const WorkbookTextbookSelection = ({ onTextbookSelect, onBack }: WorkbookTextbookSelectionProps) => {
  const [workbookTextbooks, setWorkbookTextbooks] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [textbookLinks, setTextbookLinks] = useState<Record<string, {kyoboUrl: string, description: string}>>({});

  useEffect(() => {
    const loadTextbooks = async () => {
      try {
        // 부교재 데이터만 로드
        const convertedData = await import('../data/converted_data.json');
        const textbookNames = Object.keys(convertedData.default as Record<string, unknown>);
        
        // 교보문고 링크 데이터 로드
        try {
          const linksData = await import('../data/textbook-links.json');
          setTextbookLinks(linksData.default);
        } catch (error) {
          console.error('교보문고 링크 데이터 로드 실패:', error);
          setTextbookLinks({});
        }
        
        setWorkbookTextbooks(textbookNames);
      } catch (error) {
        console.error('교재 데이터 로드 실패:', error);
        // 에러 시 빈 배열로 설정
        setWorkbookTextbooks([]);
      } finally {
        setLoading(false);
      }
    };

    loadTextbooks();
  }, []);

  return (
    <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="container mx-auto px-4">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
            워크북 교재 선택
          </h1>
          <p className="text-lg" style={{ color: '#888B8D' }}>
            워크북을 제작할 교재를 선택해주세요
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
            <div className="flex-1 h-1 mx-4" style={{ backgroundColor: '#00A9E0' }}></div>
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 text-white rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: '#00A9E0' }}>
                2
              </div>
              <span className="text-xs mt-1 font-medium" style={{ color: '#00A9E0' }}>교재 선택</span>
            </div>
            <div className="flex-1 h-1 bg-gray-200 mx-4"></div>
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 bg-gray-200 text-gray-500 rounded-full flex items-center justify-center text-sm font-bold">
                3
              </div>
              <span className="text-xs mt-1 text-gray-500">강 선택</span>
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

        {/* 교재 선택 */}
        <div className="max-w-6xl mx-auto">
          {loading ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-gray-600">교재 목록을 불러오는 중...</p>
            </div>
          ) : (
            <div>
              <div className="text-center mb-6">
                <h2 className="text-2xl font-bold mb-2" style={{ color: '#00A9E0' }}>
                  부교재
                </h2>
                <p className="text-gray-600">워크북 제작에 사용할 부교재를 선택해주세요</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {workbookTextbooks.slice(0, 12).map((textbook) => (
                    <div
                      key={textbook}
                      className="rounded-lg shadow-sm hover:shadow-md transition-all duration-200 p-3 border border-gray-200 bg-white hover:bg-gray-50"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h3 className="text-sm font-medium text-gray-800 line-clamp-2 leading-tight">
                            {textbook}
                          </h3>
                        </div>
                        
                        {/* 버튼들 */}
                        <div className="ml-3 flex items-center gap-2">
                          {textbookLinks[textbook] && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(textbookLinks[textbook].kyoboUrl, '_blank');
                              }}
                              className="group relative px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-xs text-gray-600 hover:text-gray-800 transition-all duration-200"
                              title={`${textbookLinks[textbook].description} - YES24에서 확인`}
                            >
                              ⓘ 확인
                            </button>
                          )}
                          
                          <button
                            onClick={() => onTextbookSelect(textbook)}
                            className="px-3 py-1 text-white rounded text-xs font-medium hover:opacity-90 transition-all duration-200"
                            style={{ backgroundColor: '#00A9E0' }}
                          >
                            선택
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                {workbookTextbooks.length > 12 && (
                  <div
                    onClick={() => onTextbookSelect('부교재_목록')}
                    className="group relative bg-gray-100 rounded-lg shadow-md hover:shadow-xl transition-all duration-300 cursor-pointer border border-gray-300 hover:border-blue-300 overflow-hidden"
                  >
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ backgroundColor: '#00A9E0' }}></div>
                    <div className="relative z-10 p-4">
                      <div className="text-center">
                        <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 transition-all duration-300 group-hover:bg-white group-hover:bg-opacity-20 bg-gray-400">
                          <span className="text-lg font-bold text-white">⋯</span>
                        </div>
                        <h3 className="text-sm font-bold text-gray-600 group-hover:text-white transition-colors duration-300 mb-2">
                          더 많은 부교재 보기
                        </h3>
                        <div className="inline-block px-3 py-1 rounded text-xs font-medium transition-all duration-300 border border-gray-400 text-gray-600 group-hover:border-white group-hover:text-white">
                          전체 목록
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkbookTextbookSelection;
