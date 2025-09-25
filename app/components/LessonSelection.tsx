'use client';

import { useState, useEffect } from 'react';

interface LessonSelectionProps {
  selectedTextbook: string;
  onLessonsSelect: (lessons: string[]) => void;
  onBack: () => void;
  onTextbookSelect?: (textbook: string) => void;
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

const LessonSelection = ({ selectedTextbook, onLessonsSelect, onBack, onTextbookSelect }: LessonSelectionProps) => {
  const [selectedLessons, setSelectedLessons] = useState<string[]>([]);
  const [lessonGroups, setLessonGroups] = useState<{[key: string]: string[]}>({});
  const [expandedLessons, setExpandedLessons] = useState<string[]>([]);
  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [showTextbookList, setShowTextbookList] = useState(false);
  const [textbookLinks, setTextbookLinks] = useState<Record<string, {kyoboUrl: string, description: string}>>({});

  // 선택된 교재에 따라 강과 번호 목록 업데이트
  useEffect(() => {
    const loadTextbookData = async () => {
      try {
        // 동적으로 큰 JSON 파일 로드
        const { default: textbooksData } = await import('../data/converted_data.json');
        
        // 부교재 목록을 보여주는 경우
        if (selectedTextbook === '부교재_목록') {
          setTextbooks(Object.keys(textbooksData));
          setShowTextbookList(true);
          
          // 교보문고 링크 데이터 로드
          try {
            const linksData = await import('../data/textbook-links.json');
            setTextbookLinks(linksData.default);
          } catch (error) {
            console.error('교보문고 링크 데이터 로드 실패:', error);
            setTextbookLinks({});
          }
          
          return;
        }
        
        // 실제 교재가 선택된 경우 목록 숨기기
        if (selectedTextbook !== '부교재_목록') {
          setShowTextbookList(false);
        }
        
        if (selectedTextbook && textbooksData[selectedTextbook as keyof typeof textbooksData]) {
          const textbookData = textbooksData[selectedTextbook as keyof typeof textbooksData] as TextbookStructure;
          
          // 다양한 구조에 대응하기 위한 안전한 접근
          let actualData: TextbookContent | null = null;
          
          // Sheet1 구조 시도
          if (textbookData.Sheet1?.부교재?.[selectedTextbook]) {
            actualData = textbookData.Sheet1.부교재[selectedTextbook];
          }
          // 지문 데이터 구조 시도  
          else if (textbookData['지문 데이터']?.부교재?.[selectedTextbook]) {
            actualData = textbookData['지문 데이터'].부교재[selectedTextbook];
          }
          // 직접 부교재 구조 시도
          else if (textbookData.부교재?.[selectedTextbook]) {
            actualData = textbookData.부교재[selectedTextbook];
          }
          
          if (actualData) {
            const groups: {[key: string]: string[]} = {};
            
            Object.keys(actualData).forEach(lessonKey => {
              const lessonData = actualData![lessonKey];
              if (Array.isArray(lessonData)) {
                groups[lessonKey] = [];
                lessonData.forEach((item: LessonItem) => {
                  // item.번호가 이미 "1번" 형태이므로 그대로 사용
                  const lessonItem = `${lessonKey} ${item.번호}`;
                  groups[lessonKey].push(lessonItem);
                });
              }
            });
            
            setLessonGroups(groups);
          }
        }
      } catch (error) {
        console.error('교재 데이터 로딩 실패:', error);
        // 오류 발생 시 빈 그룹으로 설정
        setLessonGroups({});
      }
    };

    if (selectedTextbook) {
      loadTextbookData();
    }
  }, [selectedTextbook]);

  const handleLessonChange = (lesson: string) => {
    setSelectedLessons(prev => 
      prev.includes(lesson) 
        ? prev.filter(l => l !== lesson)
        : [...prev, lesson]
    );
  };

  const handleLessonGroupToggle = (lessonKey: string) => {
    const groupLessons = lessonGroups[lessonKey] || [];
    const allSelected = groupLessons.every(lesson => selectedLessons.includes(lesson));
    
    if (allSelected) {
      setSelectedLessons(prev => prev.filter(lesson => !groupLessons.includes(lesson)));
    } else {
      setSelectedLessons(prev => {
        const filtered = prev.filter(lesson => !groupLessons.includes(lesson));
        return [...filtered, ...groupLessons];
      });
    }
  };

  const handleLessonExpand = (lessonKey: string) => {
    setExpandedLessons(prev => 
      prev.includes(lessonKey)
        ? prev.filter(key => key !== lessonKey)
        : [...prev, lessonKey]
    );
  };

  const handleNext = () => {
    if (selectedLessons.length === 0) {
      alert('강과 번호를 선택해주세요.');
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
            {showTextbookList ? '부교재 선택' : '강과 번호 선택'}
          </h1>
          <p className="text-lg" style={{ color: '#888B8D' }}>
            {showTextbookList ? '부교재를 선택해주세요' : selectedTextbook}
          </p>
          {showTextbookList && (
            <p className="text-sm mt-2" style={{ color: '#888B8D' }}>
              (목록에 없는 교재가 필요하시다면 문의해주세요)
            </p>
          )}
        </div>

        {/* 진행 단계 표시 */}
        <div className="max-w-2xl mx-auto mb-6">
          <div className="flex items-center justify-between">
            <div 
              className="flex flex-col items-center cursor-pointer group"
              onClick={onBack}
              title="교재 선택으로 돌아가기"
            >
              <div className="w-10 h-10 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold group-hover:bg-green-700 transition-colors">
                ✓
              </div>
              <span className="text-xs mt-1 text-green-600 font-medium group-hover:text-green-700">교재 선택</span>
            </div>
            <div className="flex-1 h-1 bg-blue-600 mx-4"></div>
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-bold">
                2
              </div>
              <span className="text-xs mt-1 text-blue-600 font-medium">강과 번호</span>
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


        {/* 선택된 강 개수 표시 */}
        {selectedLessons.length > 0 && (
          <div className="max-w-4xl mx-auto mb-6">
            <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded-lg text-center">
              <span className="font-medium">{selectedLessons.length}개 지문이 선택되었습니다</span>
            </div>
          </div>
        )}

        {/* 교재 목록 또는 강과 번호 선택 */}
        <div className="max-w-4xl mx-auto mb-8">
          {showTextbookList ? (
            /* 부교재 목록 */
            <div className="space-y-4">
              {textbooks.map((textbook) => (
                <div
                  key={textbook}
                  className="rounded-lg shadow-sm hover:shadow-md transition-all duration-200 p-4 border border-gray-200 bg-white hover:bg-gray-50"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="text-base font-medium text-gray-800 mb-1">
                        {textbook}
                      </h3>
                    </div>
                    
                    {/* 버튼들 */}
                    <div className="ml-4 flex items-center gap-2">
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
                        onClick={() => {
                          if (onTextbookSelect) {
                            onTextbookSelect(textbook);
                            setShowTextbookList(false);
                          }
                        }}
                        className="px-3 py-1 text-white rounded text-xs font-medium hover:opacity-90 transition-all duration-200"
                        style={{ backgroundColor: '#13294B' }}
                      >
                        선택
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-md p-6">
              {selectedTextbook !== '부교재_목록' && (
                <>
                  <div className="mb-4">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6">
                      <p className="text-blue-700 text-sm">
                        <strong>사용법:</strong> 왼쪽을 클릭하면 강 전체 선택, 오른쪽 + 버튼을 클릭하면 개별 번호 선택이 가능해요!
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
              {Object.keys(lessonGroups).map((lessonKey) => {
                const groupLessons = lessonGroups[lessonKey];
                const allSelected = groupLessons.every(lesson => selectedLessons.includes(lesson));
                const someSelected = groupLessons.some(lesson => selectedLessons.includes(lesson));
                const selectedCount = groupLessons.filter(lesson => selectedLessons.includes(lesson)).length;
                const isExpanded = expandedLessons.includes(lessonKey);
                
                return (
                  <div key={lessonKey} className="border-2 rounded-xl bg-white hover:shadow-md transition-all">
                    <div className="flex items-center">
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
                                {lesson.replace(/^[^0-9]*/, '')}
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
              )}
            </div>
          )}
        </div>

        {/* 네비게이션 버튼 */}
        <div className="max-w-4xl mx-auto flex justify-end">
          <button
            onClick={handleNext}
            disabled={selectedLessons.length === 0}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              selectedLessons.length > 0
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            다음 단계 →
          </button>
        </div>
      </div>
    </div>
  );
};

export default LessonSelection;
