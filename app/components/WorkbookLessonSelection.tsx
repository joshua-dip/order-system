'use client';

import { useState, useEffect } from 'react';

interface WorkbookLessonSelectionProps {
  selectedTextbook: string;
  onLessonsSelect: (lessons: string[]) => void;
  onBack: () => void;
  onBackToTextbook: () => void;
}

const WorkbookLessonSelection = ({ selectedTextbook, onLessonsSelect, onBack, onBackToTextbook }: WorkbookLessonSelectionProps) => {
  const [selectedLessons, setSelectedLessons] = useState<string[]>([]);
  const [availableLessons, setAvailableLessons] = useState<string[]>([]);
  const [lessonTextCounts, setLessonTextCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const loadLessonsForTextbook = async () => {
      try {
        // 부교재의 경우 converted_data.json에서 데이터 로드
        const convertedData = await import('../data/converted_data.json');
        const textbookData = (convertedData.default as Record<string, unknown>)[selectedTextbook];
        
        if (textbookData && typeof textbookData === 'object') {
          // Sheet1 > 부교재 > 교재명 구조에서 강 번호 추출
          const sheet1 = (textbookData as Record<string, unknown>).Sheet1;
          if (sheet1 && typeof sheet1 === 'object') {
            const 부교재 = (sheet1 as Record<string, unknown>).부교재;
            if (부교재 && typeof 부교재 === 'object') {
              const textbookInfo = (부교재 as Record<string, unknown>)[selectedTextbook];
              if (textbookInfo && typeof textbookInfo === 'object') {
                const lessonNames = Object.keys(textbookInfo);
                setAvailableLessons(lessonNames);
                
                // 각 강의 지문 수 계산
                const textCounts: Record<string, number> = {};
                lessonNames.forEach(lessonName => {
                  const lessonData = (textbookInfo as Record<string, unknown>)[lessonName];
                  if (Array.isArray(lessonData)) {
                    textCounts[lessonName] = lessonData.length;
                  }
                });
                setLessonTextCounts(textCounts);
              }
            }
          }
        }
      } catch (error) {
        console.error('강 데이터 로드 실패:', error);
        // 에러 시 빈 배열로 설정
        setAvailableLessons([]);
        setLessonTextCounts({});
      }
    };

    if (selectedTextbook) {
      loadLessonsForTextbook();
    }
  }, [selectedTextbook]);

  const handleLessonToggle = (lesson: string) => {
    setSelectedLessons(prev => 
      prev.includes(lesson)
        ? prev.filter(l => l !== lesson)
        : [...prev, lesson]
    );
  };

  const handleAllToggle = () => {
    if (selectedLessons.length === availableLessons.length) {
      setSelectedLessons([]);
    } else {
      setSelectedLessons([...availableLessons]);
    }
  };

  const handleContinue = () => {
    if (selectedLessons.length === 0) {
      alert('강을 선택해주세요.');
      return;
    }
    onLessonsSelect(selectedLessons);
  };

  return (
    <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="container mx-auto px-4">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
            강 선택
          </h1>
          <p className="text-lg mb-2" style={{ color: '#888B8D' }}>
            워크북을 제작할 강을 선택해주세요
          </p>
          <div className="rounded-lg p-3 max-w-md mx-auto border-2" style={{ backgroundColor: '#00A9E0', borderColor: '#00A9E0' }}>
            <p className="text-white text-sm font-medium">
              선택한 교재: {selectedTextbook}
            </p>
          </div>
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
              <span className="text-xs mt-1 font-medium" style={{ color: '#00A9E0' }}>강 선택</span>
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

        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* 왼쪽: 강 선택 */}
            <div className="lg:col-span-2 bg-white rounded-xl shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-black">강 선택</h3>
                <button
                  onClick={handleAllToggle}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-all border-2 text-white hover:opacity-90"
                  style={{ 
                    backgroundColor: selectedLessons.length === availableLessons.length ? '#888B8D' : '#00A9E0',
                    borderColor: selectedLessons.length === availableLessons.length ? '#888B8D' : '#00A9E0'
                  }}
                >
                  {selectedLessons.length === availableLessons.length ? '전체 해제' : '전체 선택'}
                </button>
              </div>

              {/* 부교재 강 선택: 세로 레이아웃 + 지문 수 표시 */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {availableLessons.map((lesson) => (
                  <button
                    key={lesson}
                    onClick={() => handleLessonToggle(lesson)}
                    className={`w-full p-4 rounded-lg border-2 font-medium transition-all hover:shadow-md text-left flex items-center justify-between ${
                      selectedLessons.includes(lesson)
                        ? 'text-white'
                        : 'border-gray-300 hover:border-gray-400 text-black hover:bg-gray-50'
                    }`}
                    style={selectedLessons.includes(lesson) ? { backgroundColor: '#00A9E0', borderColor: '#00A9E0' } : {}}
                  >
                    <span className="font-medium">{lesson}</span>
                    {lessonTextCounts[lesson] && (
                      <span className={`text-sm ${selectedLessons.includes(lesson) ? 'text-white opacity-90' : 'text-gray-500'}`}>
                        ({lessonTextCounts[lesson]}지문)
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* 오른쪽: 선택 요약 */}
            <div className="bg-white rounded-xl shadow-md p-6">
              <h3 className="text-xl font-bold text-black mb-4">선택 요약</h3>
              
              <div className="space-y-4">
                <div className="p-3 rounded-lg border-2" style={{ backgroundColor: '#00A9E0', borderColor: '#00A9E0' }}>
                  <div className="text-white text-sm">
                    <div className="font-medium">선택한 교재</div>
                    <div className="text-xs opacity-90">{selectedTextbook}</div>
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-gray-200" style={{ backgroundColor: '#F5F5F5' }}>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-black">선택된 강:</span>
                      <span className="font-medium text-black">{selectedLessons.length}개</span>
                    </div>
                    
                    {/* 총 지문 수 표시 */}
                    {selectedLessons.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-black">총 지문 수:</span>
                        <span className="font-medium text-green-600">
                          {selectedLessons.reduce((total, lesson) => total + (lessonTextCounts[lesson] || 0), 0)}지문
                        </span>
                      </div>
                    )}
                    
                    {selectedLessons.length > 0 && (
                      <div className="mt-3">
                        <div className="text-black font-medium mb-2">선택한 강:</div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {selectedLessons.slice(0, 8).map((lesson) => (
                            <div 
                              key={lesson} 
                              className="flex items-center justify-between px-3 py-2 rounded text-xs text-white"
                              style={{ backgroundColor: '#00A9E0' }}
                            >
                              <span>{lesson}</span>
                              {lessonTextCounts[lesson] && (
                                <span className="opacity-90">
                                  {lessonTextCounts[lesson]}지문
                                </span>
                              )}
                            </div>
                          ))}
                          {selectedLessons.length > 8 && (
                            <div className="px-3 py-2 rounded text-xs text-gray-600 bg-gray-200 text-center">
                              +{selectedLessons.length - 8}개 더
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleContinue}
                  disabled={selectedLessons.length === 0}
                  className={`w-full py-3 px-4 rounded-lg font-bold text-lg transition-all ${
                    selectedLessons.length > 0 
                      ? 'text-white hover:opacity-90 shadow-lg hover:shadow-xl' 
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                  style={selectedLessons.length > 0 ? { backgroundColor: '#00A9E0' } : {}}
                >
                  워크북 유형 선택하기
                  {selectedLessons.length === 0 && (
                    <div className="text-xs mt-1 opacity-75">강을 선택해주세요</div>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkbookLessonSelection;
