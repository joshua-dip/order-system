'use client';

import { useState, useEffect } from 'react';
import AppBar from './AppBar';
import { useTextbooksData } from '@/lib/useTextbooksData';
import { groupTextbooksByRevised } from '@/lib/textbookSort';

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
  const { data: textbooksData, loading: dataLoading, error: dataError } = useTextbooksData();
  const [selectedLessons, setSelectedLessons] = useState<string[]>([]);
  const [lessonGroups, setLessonGroups] = useState<{[key: string]: string[]}>({});
  const [expandedLessons, setExpandedLessons] = useState<string[]>([]);
  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [filteredTextbooks, setFilteredTextbooks] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showTextbookList, setShowTextbookList] = useState(false);
  const [textbookLinks, setTextbookLinks] = useState<Record<string, {kyoboUrl: string, description: string}>>({});

  // 선택된 교재에 따라 강과 번호 목록 업데이트
  useEffect(() => {
    if (!textbooksData) return;
    const loadTextbookData = async () => {
      try {
        // 부교재 목록을 보여주는 경우
        if (selectedTextbook === '부교재_목록') {
          const textbookList = Object.keys(textbooksData);
          setTextbooks(textbookList);
          setFilteredTextbooks(textbookList);
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
        
        if (selectedTextbook && textbooksData[selectedTextbook]) {
          const textbookData = textbooksData[selectedTextbook] as TextbookStructure;
          
          // 다양한 구조에 대응하기 위한 안전한 접근 (내부 키가 교재명(버전) 등으로 다를 수 있음)
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
  }, [selectedTextbook, textbooksData]);

  // 검색 필터링 로직
  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredTextbooks(textbooks);
    } else {
      const filtered = textbooks.filter(textbook =>
        textbook.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredTextbooks(filtered);
    }
  }, [searchTerm, textbooks]);

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

  const allLessonItems = Object.keys(lessonGroups).flatMap(key => lessonGroups[key] || []);
  const allSelected = allLessonItems.length > 0 && selectedLessons.length === allLessonItems.length;

  const handleAllToggle = () => {
    if (allSelected) {
      setSelectedLessons([]);
    } else {
      setSelectedLessons([...allLessonItems]);
    }
  };

  const handleNext = () => {
    if (selectedLessons.length === 0) {
      alert('강과 번호를 선택해주세요.');
      return;
    }
    onLessonsSelect(selectedLessons);
  };

  if (dataLoading) {
    return (
      <>
        <AppBar showBackButton={true} onBackClick={onBack} title="강과 번호 선택" />
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F5F5' }}>
          <p className="text-gray-600">교재 데이터를 불러오는 중...</p>
        </div>
      </>
    );
  }
  if (dataError || !textbooksData) {
    return (
      <>
        <AppBar showBackButton={true} onBackClick={onBack} title="강과 번호 선택" />
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F5F5' }}>
          <p className="text-red-600">데이터를 불러올 수 없습니다.</p>
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar 
        showBackButton={true} 
        onBackClick={onBack}
        title={showTextbookList ? "부교재 선택" : "강과 번호 선택"}
      />
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
            <div>
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
                <div className="space-y-6">
                  {(() => {
                    const { ebs, revised, other } = groupTextbooksByRevised(filteredTextbooks);
                    const renderCard = (textbook: string) => (
                      <div
                        key={textbook}
                        onClick={() => {
                          if (onTextbookSelect) {
                            onTextbookSelect(textbook);
                            setShowTextbookList(false);
                          }
                        }}
                        className="rounded-lg shadow-sm hover:shadow-md transition-all duration-200 p-4 border border-gray-200 bg-white hover:bg-blue-50 hover:border-blue-300 cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <h3 className="text-base font-medium text-gray-800 mb-1">
                              {textbook}
                            </h3>
                            <p className="text-xs text-gray-500">클릭하여 선택</p>
                          </div>
                          {textbookLinks[textbook]?.kyoboUrl && (
                            <div className="ml-4">
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
                    );
                    return (
                      <>
                        {ebs.length > 0 && (
                          <div>
                            <h3 className="text-base font-semibold text-gray-800 mb-2 pb-2 border-b-2 border-emerald-200">
                              EBS
                            </h3>
                            <div className="space-y-4">
                              {ebs.map(renderCard)}
                            </div>
                          </div>
                        )}
                        {revised.length > 0 && (
                          <div>
                            <h3 className="text-base font-semibold text-gray-800 mb-2 pb-2 border-b-2 border-blue-200">
                              개정판
                            </h3>
                            <div className="space-y-4">
                              {revised.map(renderCard)}
                            </div>
                          </div>
                        )}
                        {other.length > 0 && (
                          <div>
                            {(ebs.length > 0 || revised.length > 0) && (
                              <h3 className="text-base font-semibold text-gray-800 mb-2 pb-2 border-b-2 border-gray-200">
                                기타 교재
                              </h3>
                            )}
                            <div className="space-y-4">
                              {other.map(renderCard)}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-md p-6">
              {selectedTextbook !== '부교재_목록' && (
                <>
                  <div className="mb-4">
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                      <p className="text-blue-700 text-sm">
                        <strong>사용법:</strong> 왼쪽을 클릭하면 강 전체 선택, 오른쪽 + 버튼을 클릭하면 개별 번호 선택이 가능해요!
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAllToggle}
                      className="w-full py-2.5 px-4 rounded-lg font-medium text-sm transition-colors mb-4 border-2 border-blue-300 bg-blue-50 text-blue-800 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {allSelected ? '전체 해제' : '전체 선택 (모든 강·번호)'}
                    </button>
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
    </>
  );
};

export default LessonSelection;
