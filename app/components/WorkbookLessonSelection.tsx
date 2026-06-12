'use client';

import { useState, useEffect } from 'react';
import AppBar from './AppBar';
import { useTextbooksData } from '@/lib/useTextbooksData';

/** 강별 선택 결과 — 강 전체 선택 시 numbers 에 전체 번호가 들어간다. */
export interface WorkbookLessonPick {
  lesson: string;
  /** 선택한 번호 라벨 (지문 데이터의 「번호」 필드, 데이터 순서 유지) */
  numbers: string[];
  /** 강의 전체 지문 수 */
  totalInLesson: number;
}

interface WorkbookLessonSelectionProps {
  selectedTextbook: string;
  onLessonsSelect: (lessons: string[], picks: WorkbookLessonPick[]) => void;
  onBack: () => void;
  onBackToTextbook: () => void;
}

const WorkbookLessonSelection = ({ selectedTextbook, onLessonsSelect, onBack, onBackToTextbook }: WorkbookLessonSelectionProps) => {
  const { data: convertedData, loading: dataLoading, error: dataError } = useTextbooksData();
  const [availableLessons, setAvailableLessons] = useState<string[]>([]);
  /** 강 → 번호 라벨 배열 (지문 데이터 순서) */
  const [lessonNumbers, setLessonNumbers] = useState<Record<string, string[]>>({});
  /** 강 → 선택된 번호 인덱스 (키 존재 = 강 선택됨). 동일 라벨 중복 데이터가 있어 인덱스로 식별 */
  const [selectedByLesson, setSelectedByLesson] = useState<Record<string, number[]>>({});
  const [expandedLessons, setExpandedLessons] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!convertedData) return;
    /** Sheet1.{branch}, {branch}, '지문 데이터'.{branch} 순으로 검색해 강 데이터를 찾는다.
     *  교과서 키도 같은 흐름(부교재 → 교과서 fallback)으로 처리. */
    const pickFromBranch = (
      textbookData: Record<string, unknown>,
      branch: '부교재' | '교과서',
    ): Record<string, unknown> | null => {
      const candidates: Array<unknown> = [];
      const sheet1 = textbookData.Sheet1;
      if (sheet1 && typeof sheet1 === 'object') {
        candidates.push((sheet1 as Record<string, unknown>)[branch]);
      }
      const dataSection = (textbookData as Record<string, unknown>)['지문 데이터'];
      if (dataSection && typeof dataSection === 'object') {
        candidates.push((dataSection as Record<string, unknown>)[branch]);
      }
      candidates.push(textbookData[branch]);
      for (const cand of candidates) {
        if (!cand || typeof cand !== 'object') continue;
        const branchRec = cand as Record<string, unknown>;
        let info = branchRec[selectedTextbook];
        if (!info && Object.keys(branchRec).length > 0) {
          info = branchRec[Object.keys(branchRec)[0]];
        }
        if (info && typeof info === 'object') {
          return info as Record<string, unknown>;
        }
      }
      return null;
    };

    const loadLessonsForTextbook = () => {
      try {
        const textbookData = (convertedData as Record<string, unknown>)[selectedTextbook];
        if (!textbookData || typeof textbookData !== 'object') {
          setAvailableLessons([]);
          setLessonNumbers({});
          return;
        }
        const data = textbookData as Record<string, unknown>;
        // 부교재 우선, 없으면 교과서 fallback (교과서 워크북 신규 카테고리)
        const textbookInfo = pickFromBranch(data, '부교재') ?? pickFromBranch(data, '교과서');
        if (!textbookInfo) {
          setAvailableLessons([]);
          setLessonNumbers({});
          return;
        }
        const lessonNames = Object.keys(textbookInfo);
        setAvailableLessons(lessonNames);
        const numbersMap: Record<string, string[]> = {};
        lessonNames.forEach((lessonName) => {
          const lessonData = textbookInfo[lessonName];
          if (Array.isArray(lessonData)) {
            numbersMap[lessonName] = lessonData.map((item, idx) => {
              if (item && typeof item === 'object') {
                const num = (item as Record<string, unknown>)['번호'];
                if (num != null && String(num).trim()) return String(num);
              }
              return `${idx + 1}번`;
            });
          } else {
            numbersMap[lessonName] = [];
          }
        });
        setLessonNumbers(numbersMap);
      } catch (error) {
        console.error('강 데이터 로드 실패:', error);
        setAvailableLessons([]);
        setLessonNumbers({});
      }
    };

    if (selectedTextbook) {
      loadLessonsForTextbook();
    }
  }, [selectedTextbook, convertedData]);

  const selectedCount = (lesson: string) => selectedByLesson[lesson]?.length ?? 0;
  const isLessonSelected = (lesson: string) => lesson in selectedByLesson;
  const isFullySelected = (lesson: string) =>
    isLessonSelected(lesson) && selectedCount(lesson) === (lessonNumbers[lesson]?.length ?? 0);

  const selectedLessonsList = availableLessons.filter(isLessonSelected);
  const totalSelectedTexts = selectedLessonsList.reduce((sum, lesson) => sum + selectedCount(lesson), 0);
  const allFullySelected = availableLessons.length > 0 && availableLessons.every(isFullySelected);

  const handleLessonToggle = (lesson: string) => {
    setSelectedByLesson(prev => {
      const next = { ...prev };
      const all = lessonNumbers[lesson] ?? [];
      if (lesson in next && next[lesson].length === all.length) {
        delete next[lesson];
      } else {
        next[lesson] = all.map((_, i) => i);
      }
      return next;
    });
  };

  const handleNumberToggle = (lesson: string, idx: number) => {
    setSelectedByLesson(prev => {
      const cur = prev[lesson] ?? [];
      const nextArr = cur.includes(idx)
        ? cur.filter(i => i !== idx)
        : [...cur, idx].sort((a, b) => a - b);
      const next = { ...prev };
      if (nextArr.length === 0) {
        delete next[lesson];
      } else {
        next[lesson] = nextArr;
      }
      return next;
    });
  };

  const handleExpandToggle = (lesson: string) => {
    setExpandedLessons(prev => ({ ...prev, [lesson]: !prev[lesson] }));
  };

  const handleAllToggle = () => {
    if (allFullySelected) {
      setSelectedByLesson({});
    } else {
      const next: Record<string, number[]> = {};
      availableLessons.forEach(lesson => {
        next[lesson] = (lessonNumbers[lesson] ?? []).map((_, i) => i);
      });
      setSelectedByLesson(next);
    }
  };

  const handleContinue = () => {
    if (selectedLessonsList.length === 0) {
      alert('강 또는 번호를 선택해주세요.');
      return;
    }
    const picks: WorkbookLessonPick[] = selectedLessonsList.map(lesson => {
      const all = lessonNumbers[lesson] ?? [];
      const idxs = selectedByLesson[lesson] ?? [];
      return {
        lesson,
        numbers: idxs.map(i => all[i]).filter((n): n is string => typeof n === 'string'),
        totalInLesson: all.length,
      };
    });
    onLessonsSelect(selectedLessonsList, picks);
  };

  if (dataLoading) {
    return (
      <>
        <AppBar showBackButton={true} onBackClick={onBack} title="워크북 강 선택" />
        <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F5F5F5' }}>
          <p className="text-gray-600">교재 데이터를 불러오는 중...</p>
        </div>
      </>
    );
  }
  if (dataError || !convertedData) {
    return (
      <>
        <AppBar showBackButton={true} onBackClick={onBack} title="워크북 강 선택" />
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
        title="워크북 강 선택"
      />
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
          <p className="text-sm mb-2" style={{ color: '#888B8D' }}>
            강을 누르면 전체 선택, 「번호 선택」을 누르면 원하는 번호만 고를 수 있어요
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
                    backgroundColor: allFullySelected ? '#888B8D' : '#00A9E0',
                    borderColor: allFullySelected ? '#888B8D' : '#00A9E0'
                  }}
                >
                  {allFullySelected ? '전체 해제' : '전체 선택'}
                </button>
              </div>

              {/* 부교재 강 선택: 강 전체 토글 + 번호별 부분 선택 */}
              <div className="space-y-2 max-h-[32rem] overflow-y-auto">
                {availableLessons.map((lesson) => {
                  const numbers = lessonNumbers[lesson] ?? [];
                  const selCount = selectedCount(lesson);
                  const fully = isFullySelected(lesson);
                  const partial = selCount > 0 && !fully;
                  const expanded = !!expandedLessons[lesson];
                  const selectedIdxs = selectedByLesson[lesson] ?? [];
                  return (
                    <div
                      key={lesson}
                      className={`rounded-lg border-2 transition-all ${
                        fully ? '' : partial ? 'bg-sky-50' : 'border-gray-300'
                      }`}
                      style={fully || partial ? { borderColor: '#00A9E0', backgroundColor: fully ? '#00A9E0' : undefined } : {}}
                    >
                      <div className="flex items-stretch">
                        <button
                          onClick={() => handleLessonToggle(lesson)}
                          className={`flex-1 p-4 font-medium text-left flex items-center justify-between rounded-l-lg transition-all ${
                            fully ? 'text-white' : partial ? 'text-black' : 'text-black hover:bg-gray-50'
                          }`}
                        >
                          <span className="font-medium">{lesson}</span>
                          {numbers.length > 0 && (
                            <span className={`text-sm ml-2 shrink-0 ${
                              fully ? 'text-white opacity-90' : partial ? 'font-semibold' : 'text-gray-500'
                            }`}
                            style={partial ? { color: '#0284c7' } : {}}
                            >
                              {partial ? `(${selCount}/${numbers.length}지문)` : `(${numbers.length}지문)`}
                            </span>
                          )}
                        </button>
                        {numbers.length > 0 && (
                          <button
                            onClick={() => handleExpandToggle(lesson)}
                            className={`px-3 text-xs font-semibold rounded-r-lg border-l transition-all shrink-0 ${
                              fully
                                ? 'text-white border-white/40 hover:bg-white/10'
                                : partial
                                  ? 'border-sky-200 hover:bg-sky-100'
                                  : 'text-gray-500 border-gray-200 hover:bg-gray-100'
                            }`}
                            style={partial ? { color: '#0284c7' } : {}}
                            title="번호별로 선택하기"
                          >
                            번호 선택 {expanded ? '▴' : '▾'}
                          </button>
                        )}
                      </div>
                      {expanded && numbers.length > 0 && (
                        <div className={`px-3 pb-3 pt-1 flex flex-wrap gap-1.5 rounded-b-lg ${fully ? 'bg-white/95 mx-0.5 mb-0.5' : ''}`}>
                          {numbers.map((num, idx) => {
                            const numSelected = selectedIdxs.includes(idx);
                            return (
                              <button
                                key={`${lesson}-${idx}`}
                                onClick={() => handleNumberToggle(lesson, idx)}
                                className={`px-2.5 py-1.5 rounded-md text-xs font-medium border transition-all ${
                                  numSelected
                                    ? 'text-white'
                                    : 'border-gray-300 text-black bg-white hover:border-gray-400 hover:bg-gray-50'
                                }`}
                                style={numSelected ? { backgroundColor: '#00A9E0', borderColor: '#00A9E0' } : {}}
                              >
                                {num}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
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
                      <span className="font-medium text-black">{selectedLessonsList.length}개</span>
                    </div>

                    {/* 총 지문 수 표시 */}
                    {selectedLessonsList.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-black">총 지문 수:</span>
                        <span className="font-medium text-green-600">
                          {totalSelectedTexts}지문
                        </span>
                      </div>
                    )}

                    {selectedLessonsList.length > 0 && (
                      <div className="mt-3">
                        <div className="text-black font-medium mb-2">선택한 강:</div>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                          {selectedLessonsList.slice(0, 8).map((lesson) => {
                            const numbers = lessonNumbers[lesson] ?? [];
                            const fully = isFullySelected(lesson);
                            const idxs = selectedByLesson[lesson] ?? [];
                            const pickedLabels = idxs.map(i => numbers[i]).filter(Boolean);
                            return (
                              <div
                                key={lesson}
                                className="px-3 py-2 rounded text-xs text-white"
                                style={{ backgroundColor: '#00A9E0' }}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate">{lesson}</span>
                                  <span className="opacity-90 shrink-0">
                                    {fully ? `전체 ${numbers.length}지문` : `${idxs.length}/${numbers.length}지문`}
                                  </span>
                                </div>
                                {!fully && pickedLabels.length > 0 && (
                                  <div className="mt-1 opacity-90 leading-snug">
                                    {pickedLabels.slice(0, 6).join(', ')}
                                    {pickedLabels.length > 6 && ` 외 ${pickedLabels.length - 6}개`}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {selectedLessonsList.length > 8 && (
                            <div className="px-3 py-2 rounded text-xs text-gray-600 bg-gray-200 text-center">
                              +{selectedLessonsList.length - 8}개 더
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleContinue}
                  disabled={selectedLessonsList.length === 0}
                  className={`w-full py-3 px-4 rounded-lg font-bold text-lg transition-all ${
                    selectedLessonsList.length > 0
                      ? 'text-white hover:opacity-90 shadow-lg hover:shadow-xl'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                  style={selectedLessonsList.length > 0 ? { backgroundColor: '#00A9E0' } : {}}
                >
                  워크북 유형 선택하기
                  {selectedLessonsList.length === 0 && (
                    <div className="text-xs mt-1 opacity-75">강 또는 번호를 선택해주세요</div>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

export default WorkbookLessonSelection;
