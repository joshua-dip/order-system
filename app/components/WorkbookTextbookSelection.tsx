'use client';

import { useState, useEffect } from 'react';
import AppBar from './AppBar';

interface WorkbookTextbookSelectionProps {
  onTextbookSelect: (textbook: string) => void;
  onBack: () => void;
}

const WorkbookTextbookSelection = ({ onTextbookSelect, onBack }: WorkbookTextbookSelectionProps) => {
  const [workbookTextbooks, setWorkbookTextbooks] = useState<string[]>([]);
  const [filteredTextbooks, setFilteredTextbooks] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
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
        setFilteredTextbooks(textbookNames);
      } catch (error) {
        console.error('교재 데이터 로드 실패:', error);
        // 에러 시 빈 배열로 설정
        setWorkbookTextbooks([]);
        setFilteredTextbooks([]);
      } finally {
        setLoading(false);
      }
    };

    loadTextbooks();
  }, []);

  // 검색 필터링 로직
  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredTextbooks(workbookTextbooks);
    } else {
      const filtered = workbookTextbooks.filter(textbook =>
        textbook.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredTextbooks(filtered);
    }
  }, [searchTerm, workbookTextbooks]);

  return (
    <>
      <AppBar 
        showBackButton={true} 
        onBackClick={onBack}
        title="워크북 교재 선택"
      />
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
              
              {/* 검색 입력 필드 */}
              <div className="max-w-md mx-auto mb-6">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="교재명으로 검색..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full px-4 py-3 pl-12 pr-4 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition-colors text-gray-700 placeholder-gray-400"
                  />
                  <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm('')}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                {searchTerm && (
                  <div className="mt-2 text-sm text-gray-600 text-center">
                    {filteredTextbooks.length}개의 교재가 검색되었습니다
                  </div>
                )}
              </div>
              
              {filteredTextbooks.length === 0 && searchTerm ? (
                <div className="text-center py-16">
                  <div className="text-gray-400 mb-4">
                    <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-medium text-gray-600 mb-2">검색 결과가 없습니다</h3>
                  <p className="text-gray-500 mb-4">&apos;{searchTerm}&apos;에 해당하는 교재를 찾을 수 없습니다</p>
                  <button
                    onClick={() => setSearchTerm('')}
                    className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    전체 교재 보기
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredTextbooks.map((textbook) => (
                    <div
                      key={textbook}
                      onClick={() => onTextbookSelect(textbook)}
                      className="rounded-lg shadow-sm hover:shadow-md transition-all duration-200 p-3 border border-gray-200 bg-white hover:bg-blue-50 hover:border-blue-300 cursor-pointer"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h3 className="text-sm font-medium text-gray-800 line-clamp-2 leading-tight mb-1">
                            {textbook}
                          </h3>
                          <p className="text-xs text-gray-500">클릭하여 선택</p>
                        </div>
                        
                        {/* 교재 확인 버튼 */}
                        {textbookLinks[textbook] && (
                          <div className="ml-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(textbookLinks[textbook].kyoboUrl, '_blank');
                              }}
                              className="group relative px-3 py-2 bg-blue-100 hover:bg-blue-200 rounded text-xs text-blue-700 hover:text-blue-800 transition-all duration-200 font-medium"
                              title={`${textbookLinks[textbook].description} - YES24에서 확인`}
                            >
                              📖 교재 확인
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
};

export default WorkbookTextbookSelection;