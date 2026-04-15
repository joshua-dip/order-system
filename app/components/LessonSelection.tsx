'use client';

import { useState, useEffect } from 'react';
import AppBar from './AppBar';
import { useTextbooksData } from '@/lib/useTextbooksData';
import { useTextbookLinks } from '@/lib/useTextbookLinks';
import { groupTextbooksByRevised } from '@/lib/textbookSort';
import { filterVariantSupplementaryTextbookKeys, VARIANT_SUPPLEMENTARY_COMMON_KEYS } from '@/lib/variant-textbooks';
const KAKAO_INQUIRY_URL =
  process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

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

type TextbookBranch = '부교재' | '교과서';

interface TextbookStructure {
  Sheet1?: {
    부교재?: {
      [textbookName: string]: TextbookContent;
    };
    교과서?: {
      [textbookName: string]: TextbookContent;
    };
  };
  '지문 데이터'?: {
    부교재?: {
      [textbookName: string]: TextbookContent;
    };
    교과서?: {
      [textbookName: string]: TextbookContent;
    };
  };
  부교재?: {
    [textbookName: string]: TextbookContent;
  };
  교과서?: {
    [textbookName: string]: TextbookContent;
  };
}

const LessonSelection = ({ selectedTextbook, onLessonsSelect, onBack, onTextbookSelect }: LessonSelectionProps) => {
  const { data: textbooksData, loading: dataLoading, error: dataError } = useTextbooksData();
  const { links: textbookLinks } = useTextbookLinks();
  const [defaultTextbooks, setDefaultTextbooks] = useState<string[]>([]);
  const [selectedLessons, setSelectedLessons] = useState<string[]>([]);
  const [lessonGroups, setLessonGroups] = useState<{[key: string]: string[]}>({});
  const [expandedLessons, setExpandedLessons] = useState<string[]>([]);
  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [filteredTextbooks, setFilteredTextbooks] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showTextbookList, setShowTextbookList] = useState(false);
  /** 관리자가 회원 전용 변형문제 부교재 목록을 저장한 경우에만 true */
  const [variantDedicatedActive, setVariantDedicatedActive] = useState(false);
  const [variantDedicatedList, setVariantDedicatedList] = useState<string[]>([]);
  /** /api/auth/me 응답 완료 여부 — 완료 전에는 배정 교재 분기를 쓰지 않아 전체 목록이 잠깐 보이는 현상 방지 */
  const [memberPrefsLoaded, setMemberPrefsLoaded] = useState(false);
  /** /api/settings/default-textbooks 응답 완료 여부 */
  const [defaultTextbooksLoaded, setDefaultTextbooksLoaded] = useState(false);
  /** 변형문제 쏠북 교재 키 (비회원 포함 공개 API) */
  const [solbookKeys, setSolbookKeys] = useState<string[]>([]);
  /** settings.textbookTypeMeta 기준 쏠북 분류 — 교과서 키만 목록 상단 섹션에 사용 */
  const [solbook교과서Keys, setSolbook교과서Keys] = useState<string[]>([]);
  const [solbookLoaded, setSolbookLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        const u = data?.user;
        if (u && 'allowedTextbooksVariant' in u && Array.isArray(u.allowedTextbooksVariant)) {
          setVariantDedicatedActive(true);
          setVariantDedicatedList(u.allowedTextbooksVariant.filter((x: unknown): x is string => typeof x === 'string'));
        } else {
          setVariantDedicatedActive(false);
          setVariantDedicatedList([]);
        }
      })
      .catch(() => {
        setVariantDedicatedActive(false);
        setVariantDedicatedList([]);
      })
      .finally(() => setMemberPrefsLoaded(true));
  }, []);

  useEffect(() => {
    fetch('/api/settings/default-textbooks')
      .then((res) => res.json())
      .then((data) => setDefaultTextbooks(Array.isArray(data?.textbookKeys) ? data.textbookKeys : []))
      .catch(() => setDefaultTextbooks([]))
      .finally(() => setDefaultTextbooksLoaded(true));
  }, []);

  useEffect(() => {
    fetch('/api/settings/variant-solbook', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: Record<string, unknown>) => {
        setSolbookKeys(Array.isArray(data?.textbookKeys) ? (data.textbookKeys as string[]) : []);
        setSolbook교과서Keys(Array.isArray(data?.교과서Keys) ? (data.교과서Keys as string[]) : []);
      })
      .catch(() => {
        setSolbookKeys([]);
        setSolbook교과서Keys([]);
      })
      .finally(() => setSolbookLoaded(true));
  }, []);

  // 선택된 교재에 따라 강과 번호 목록 업데이트
  useEffect(() => {
    if (!textbooksData) return;
    const ac = new AbortController();

    const loadTextbookData = async () => {
      try {
        // 교과서 목록: 쏠북 출판사(YBM·쎄듀·NE능률)가 설정된 교재만 표시
        if (selectedTextbook === '교과서_목록') {
          if (!solbookLoaded) {
            setTextbooks([]);
            setFilteredTextbooks([]);
            setShowTextbookList(true);
            return;
          }
          const allSorted = [...solbookKeys].sort((a, b) => a.localeCompare(b, 'ko'));
          const gyoSorted = [...solbook교과서Keys].sort((a, b) => a.localeCompare(b, 'ko'));
          const textbookList =
            gyoSorted.length > 0 ? gyoSorted.filter((k) => allSorted.includes(k)) : allSorted;
          setTextbooks(textbookList);
          setFilteredTextbooks(textbookList);
          setShowTextbookList(true);
          return;
        }

        // 부교재 목록: 관리자가 설정한 기본 노출 교재만 표시 (비회원 포함). 미설정 시 전체 노출.
        if (selectedTextbook === '부교재_목록') {
          if (!memberPrefsLoaded || !defaultTextbooksLoaded || !solbookLoaded) {
            setTextbooks([]);
            setFilteredTextbooks([]);
            setShowTextbookList(true);
            return;
          }
          const allKeys = Object.keys(textbooksData);
          let textbookList: string[];
          if (variantDedicatedActive) {
            textbookList = filterVariantSupplementaryTextbookKeys(allKeys, {
              allowedTextbooksVariant: [...variantDedicatedList, ...defaultTextbooks],
            });
          } else if (defaultTextbooks.length > 0) {
            textbookList = allKeys.filter((k) => defaultTextbooks.includes(k));
          } else {
            textbookList = allKeys.filter((k) => VARIANT_SUPPLEMENTARY_COMMON_KEYS.includes(k));
            if (textbookList.length === 0) textbookList = [...allKeys];
          }
          // 쏠북 교재는 API·DB에 등록된 키를 모두 노출 (변환 JSON에 아직 없어도 목록에 표시)
          const merged = new Set([...textbookList, ...solbookKeys]);
          const 교과서Set = new Set(solbook교과서Keys);
          textbookList = [...merged]
            .filter((k) => !교과서Set.has(k))
            .sort((a, b) => a.localeCompare(b, 'ko'));
          setTextbooks(textbookList);
          setFilteredTextbooks(textbookList);
          setShowTextbookList(true);
          return;
        }
        
        // 실제 교재가 선택된 경우 목록 숨기기
        if (selectedTextbook !== '부교재_목록' && selectedTextbook !== '교과서_목록') {
          setShowTextbookList(false);
        }
        
        let groups: { [key: string]: string[] } = {};

        if (selectedTextbook && textbooksData[selectedTextbook]) {
          const textbookData = textbooksData[selectedTextbook] as TextbookStructure;

          let actualData: TextbookContent | null = null;
          const pickFirstIfSingle = (sub: Record<string, TextbookContent> | undefined) => {
            if (!sub) return null;
            if (sub[selectedTextbook]) return sub[selectedTextbook];
            const keys = Object.keys(sub);
            return keys.length > 0 ? sub[keys[0]] : null;
          };

          const pickFromBranches = (branch: TextbookBranch) =>
            pickFirstIfSingle(textbookData.Sheet1?.[branch]) ??
            pickFirstIfSingle(textbookData['지문 데이터']?.[branch]) ??
            pickFirstIfSingle(textbookData[branch]);

          actualData = pickFromBranches('부교재') ?? pickFromBranches('교과서');

          if (!actualData) {
            const rawData = textbookData as Record<string, Record<string, Record<string, TextbookContent>>>;
            for (const outerKey of Object.keys(rawData)) {
              const outerVal = rawData[outerKey];
              if (!outerVal || typeof outerVal !== 'object') continue;
              for (const branch of ['부교재', '교과서'] as const) {
                if (outerVal[branch]) {
                  actualData = pickFirstIfSingle(outerVal[branch]);
                  if (actualData) break;
                }
              }
              if (actualData) break;
            }
          }

          if (actualData) {
            const next: { [key: string]: string[] } = {};
            Object.keys(actualData).forEach((lessonKey) => {
              const lessonData = actualData![lessonKey];
              if (Array.isArray(lessonData)) {
                next[lessonKey] = [];
                lessonData.forEach((item: LessonItem) => {
                  const lessonItem = `${lessonKey} ${item.번호}`;
                  next[lessonKey].push(lessonItem);
                });
              }
            });
            groups = next;
          }
        }

        const needsPassageFallback =
          selectedTextbook !== '부교재_목록' &&
          selectedTextbook !== '교과서_목록' &&
          Object.keys(groups).length === 0;

        if (needsPassageFallback) {
          try {
            const res = await fetch(
              `/api/textbooks/lesson-index?textbook=${encodeURIComponent(selectedTextbook)}`,
              { credentials: 'same-origin', signal: ac.signal },
            );
            const j = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              groups?: Record<string, string[]>;
            };
            if (res.ok && j.ok && j.groups && typeof j.groups === 'object') {
              const fromPassages = j.groups;
              if (Object.keys(fromPassages).length > 0) groups = fromPassages;
            }
          } catch (e) {
            if ((e as Error)?.name !== 'AbortError') console.warn('lesson-index 폴백 실패:', e);
          }
        }

        setLessonGroups(groups);
      } catch (error) {
        console.error('교재 데이터 로딩 실패:', error);
        // 오류 발생 시 빈 그룹으로 설정
        setLessonGroups({});
      }
    };

    if (selectedTextbook) {
      void loadTextbookData();
    }
    return () => ac.abort();
  }, [
    selectedTextbook,
    textbooksData,
    defaultTextbooks,
    variantDedicatedActive,
    variantDedicatedList,
    memberPrefsLoaded,
    defaultTextbooksLoaded,
    solbookKeys,
    solbook교과서Keys,
    solbookLoaded,
  ]);

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

  const prefsReady = memberPrefsLoaded && defaultTextbooksLoaded && solbookLoaded;
  const listMode교과서 = showTextbookList && selectedTextbook === '교과서_목록';
  const listScreenTitle = listMode교과서 ? '교과서 선택' : showTextbookList ? '부교재 선택' : '강과 번호 선택';
  const listScreenSubtitle = listMode교과서
    ? '교과서를 선택해주세요'
    : showTextbookList
      ? '부교재를 선택해주세요'
      : selectedTextbook;

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
        title={listScreenTitle}
      />
      <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="container mx-auto px-4">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
            {listScreenTitle}
          </h1>
          <p className="text-lg" style={{ color: '#888B8D' }}>
            {listScreenSubtitle}
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
              {!prefsReady ? (
                <div className="text-center py-20 px-4">
                  <p className="text-gray-600 text-lg mb-2">교재 목록을 불러오는 중입니다</p>
                  <p className="text-sm text-gray-400">잠시만 기다려 주세요</p>
                </div>
              ) : (
                <div className="w-full">
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
                <div className="space-y-10">
                  {(() => {
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

                    if (listMode교과서) {
                      return (
                        <>
                          <div className="mb-6 rounded-xl border-2 border-violet-200 bg-violet-50/90 px-4 py-4 sm:px-5 sm:py-5 text-sm text-slate-800 leading-relaxed shadow-sm">
                            <p className="font-semibold text-violet-900 mb-2">쏠북 교재 안내</p>
                            <p>
                              이 메뉴의 교재는 대부분 <strong className="text-violet-950">쏠북(Solvook)</strong>과 연계됩니다.
                              <strong className="text-slate-900"> 변형 문제 맞춤 제작</strong>은 여기서 주문하신 뒤, 제작이
                              진행되면 <strong className="text-slate-900">교재 본체(인쇄본 등)는 쏠북에서 주문·구매</strong>하실 수
                              있습니다.
                            </p>
                            <p className="mt-2 text-slate-700">
                              주문(문제 설정) 단계에서 쏠북 커스텀 비용·입금 안내가 붙을 수 있으며,{' '}
                              <span className="font-medium text-violet-900">월구독·연회원은 쏠북 커스텀 비용이 면제</span>
                              됩니다.
                            </p>
                          </div>
                          <div className="space-y-4">{filteredTextbooks.map(renderCard)}</div>
                        </>
                      );
                    }

                    // 부교재 목록: 교과서(쏠북 교과서 분류)는 별도 메뉴에서만 — 여기서는 제외된 목록만 표시
                    const solbookSet = new Set(solbookKeys.filter((k) => filteredTextbooks.includes(k)));
                    const commonSet = new Set(defaultTextbooks);
                    const rawCommon =
                      defaultTextbooks.length > 0
                        ? filteredTextbooks.filter((k) => commonSet.has(k))
                        : filteredTextbooks.length > 0
                          ? [...filteredTextbooks]
                          : [];
                    const commonTextbooks = rawCommon.filter((k) => !solbookSet.has(k));
                    const solbookTextbooks = filteredTextbooks.filter((k) => solbookSet.has(k));
                    const nonCommon =
                      defaultTextbooks.length > 0
                        ? filteredTextbooks.filter((k) => !commonSet.has(k) && !solbookSet.has(k))
                        : [];
                    const { ebs, revised, other } = groupTextbooksByRevised(nonCommon);

                    const 부교재Inner = (
                      <>
                        {commonTextbooks.length > 0 && (
                          <div>
                            <h3 className="text-base font-semibold text-gray-800 mb-2 pb-2 border-b-2 border-emerald-600">
                              공통
                            </h3>
                            <div className="space-y-4">
                              {commonTextbooks.map(renderCard)}
                            </div>
                          </div>
                        )}
                        {solbookTextbooks.length > 0 && (
                          <div>
                            <h3 className="text-base font-semibold text-gray-800 mb-2 pb-2 border-b-2 border-violet-600">
                              쏠북
                            </h3>
                            <p className="text-sm text-gray-600 mb-2 leading-relaxed">
                              쏠북 교재는 별도 링크에서 교재 구매가 필요할 수 있으며, 일반적으로 주문(문제 설정) 단계에서{' '}
                              <strong className="text-gray-800">쏠북 커스텀 비용</strong>이 추가되고 입금 안내가 붙습니다.{' '}
                              <span className="text-violet-800 font-medium">
                                월구독 회원·연회원은 쏠북 커스텀 비용이 면제됩니다.
                              </span>
                            </p>
                            <div className="mb-3">
                              <a
                                href={KAKAO_INQUIRY_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#FEE500] text-[#191919] text-sm font-bold shadow-sm border border-[#e6d400] hover:opacity-95 active:opacity-90 no-underline transition-opacity"
                              >
                                <span aria-hidden>💬</span>
                                월구독 회원·연회원 문의하기
                              </a>
                            </div>
                            <div className="space-y-4">
                              {solbookTextbooks.map(renderCard)}
                            </div>
                          </div>
                        )}
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
                            {(commonTextbooks.length > 0 ||
                              solbookTextbooks.length > 0 ||
                              ebs.length > 0 ||
                              revised.length > 0) && (
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

                    return <div className="space-y-6">{부교재Inner}</div>;
                  })()}
                </div>
              )}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-md p-6">
              {selectedTextbook !== '부교재_목록' && (
                <>
                  {Object.keys(lessonGroups).length === 0 ? (
                    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950 leading-relaxed">
                      {solbookKeys.includes(selectedTextbook) ? (
                        <>
                          <strong className="block text-amber-900 mb-1">지문 데이터 준비 전</strong>
                          이 교재는 쏠북으로 등록되어 목록에는 보이지만, 주문용 변환 JSON과 DB 지문(passages) 어느 쪽에도
                          강·번호 목록을 만들 수 있는 데이터가 없습니다. 지문 등록·교재명 일치 여부를 확인하거나 관리자에게
                          문의해 주세요.
                        </>
                      ) : (
                        <>
                          <strong className="block text-amber-900 mb-1">데이터를 찾을 수 없음</strong>
                          선택한 교재의 지문 데이터를 불러오지 못했습니다. 교재명이 시스템 데이터와 일치하는지 확인하거나
                          관리자에게 문의해 주세요.
                        </>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="mb-4">
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                          <p className="text-blue-700 text-sm">
                            <strong>사용법:</strong> 왼쪽을 클릭하면 강 전체 선택, 오른쪽 + 버튼을 클릭하면 개별 번호
                            선택이 가능해요!
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
