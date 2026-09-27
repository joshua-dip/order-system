'use client';

import { useState, useEffect, useMemo } from 'react';
import AppBar from './AppBar';
import { useTextbooksData } from '@/lib/useTextbooksData';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { useTextbookLinks } from '@/lib/useTextbookLinks';
import { filterWorkbookSupplementaryTextbookKeys, WORKBOOK_SUPPLEMENTARY_COMMON_KEYS } from '@/lib/workbook-textbooks';
import mockExamsData from '../data/mock-exams.json';
import { groupTextbooksByRevised } from '@/lib/textbookSort';
import { parseMockExamKey } from '@/lib/mock-exam-key';
import { filterTextbooksBySearch } from '@/lib/textbook-search';
import { gyogwaseoDisplay, gyogwaseoSectionOf, subjectOrderIdx } from '@/lib/gyogwaseo-key';
import type { TextbookLinkEntry } from '@/lib/useTextbookLinks';

/**
 * 교재 카드 — 카드 전체가 <button> 이라 키보드(Tab·Enter·Space)로 고를 수 있다.
 * 교재 확인·추가 링크는 버튼 안에 넣을 수 없어서(중첩 인터랙티브 금지) 카드 아래 줄로 뺀다.
 */
function TextbookPickCard({
  title,
  subtitle,
  link,
  onSelect,
}: {
  title: string;
  subtitle?: string;
  link?: TextbookLinkEntry;
  onSelect: () => void;
}) {
  const extraUrl = link?.extraUrl?.trim();
  const kyoboUrl = link?.kyoboUrl?.trim();
  return (
    <div className="flex h-full flex-col rounded-lg border border-gray-200 bg-white shadow-sm transition-all duration-200 hover:border-blue-300 hover:bg-blue-50 hover:shadow-md focus-within:border-blue-400">
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 rounded-lg p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <span className="block text-sm font-semibold leading-snug text-gray-900 break-keep">{title}</span>
        {subtitle && <span className="mt-0.5 block text-[13px] text-gray-700 break-keep">{subtitle}</span>}
        <span className="mt-1 block text-xs text-gray-600">선택하면 강 선택으로 넘어갑니다</span>
      </button>
      {(extraUrl || kyoboUrl) && (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
          {extraUrl && (
            <a
              href={extraUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="max-w-full truncate text-xs font-medium text-violet-800 underline underline-offset-2 hover:text-violet-950"
            >
              {link?.extraLabel?.trim() || '추가 링크'}
              <span className="sr-only"> (새 창)</span>
            </a>
          )}
          {kyoboUrl && (
            <a
              href={kyoboUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto rounded bg-blue-100 px-3 py-1.5 text-xs font-medium text-blue-800 hover:bg-blue-200"
              aria-label={`${title} 교재 정보 확인 (새 창)`}
            >
              📖 교재 확인
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** 워크북 주문 진입 카테고리. 미지정 시 부교재·교과서·모의고사 3섹션을 모두 노출. */
export type WorkbookCategory = 'textbook' | 'gyogwaseo' | 'mockexam';

interface WorkbookTextbookSelectionProps {
  onTextbookSelect: (textbook: string) => void;
  onBack: () => void;
  /** 지정 시 해당 카테고리 한 섹션만 노출 */
  category?: WorkbookCategory;
}

const CATEGORY_HEADINGS: Record<WorkbookCategory, { appBar: string; title: string; subtitle: string }> = {
  textbook: {
    appBar: '부교재 워크북 교재 선택',
    title: '부교재 워크북 교재 선택',
    subtitle: '워크북을 제작할 부교재를 선택해주세요',
  },
  gyogwaseo: {
    appBar: '교과서 워크북 교재 선택',
    title: '교과서 워크북 교재 선택',
    subtitle: '워크북을 제작할 교과서를 선택해주세요',
  },
  mockexam: {
    appBar: '모의고사 워크북 선택',
    title: '모의고사 워크북 선택',
    subtitle: '워크북을 제작할 모의고사를 선택해주세요',
  },
};

const WorkbookTextbookSelection = ({ onTextbookSelect, onBack, category }: WorkbookTextbookSelectionProps) => {
  const showTextbook = !category || category === 'textbook';
  const showGyogwaseo = !category || category === 'gyogwaseo';
  const showMockExam = !category || category === 'mockexam';
  const headings = category
    ? CATEGORY_HEADINGS[category]
    : { appBar: '워크북 교재 선택', title: '워크북 교재 선택', subtitle: '워크북을 제작할 교재를 선택해주세요' };
  const { data: convertedData, loading: dataLoading, error: dataError } = useTextbooksData();
  const currentUser = useCurrentUser();
  const { links: textbookLinks } = useTextbookLinks();
  const [defaultTextbooks, setDefaultTextbooks] = useState<string[]>([]);
  const [defaultTextbooksLoaded, setDefaultTextbooksLoaded] = useState(false);
  const [workbookTextbooks, setWorkbookTextbooks] = useState<string[]>([]);
  const [filteredTextbooks, setFilteredTextbooks] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [selectedGrade, setSelectedGrade] = useState<string>('');
  const [selectedYear, setSelectedYear] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  
  const [isTextbookExpanded, setIsTextbookExpanded] = useState<boolean>(true);
  const [isGyogwaseoExpanded, setIsGyogwaseoExpanded] = useState<boolean>(true);
  const [isMockExamExpanded, setIsMockExamExpanded] = useState<boolean>(true);

  /** /api/settings/variant-solbook 의 교과서Keys — LessonSelection 과 동일한 분류 기준
   *  (변형문제 화면의 「교과서」 카드와 같은 풀을 워크북에도 노출). */
  const [gyogwaseoKeys, setGyogwaseoKeys] = useState<string[]>([]);
  const [gyogwaseoLoaded, setGyogwaseoLoaded] = useState(false);
  /* 학교 교과서(관리자 「교과서」 폴더 배정분) — 교과서 주문 권한 회원에게만 내려온다.
     쏠북 교과서Keys 가 비어 있으면 교과서 섹션이 통째로 안 뜨는데, 실제로 비어 있어서
     교과서 워크북을 아무도 주문할 수 없었다(2026-09-10). 변형문제 화면과 같이 합집합으로 쓴다. */
  const [schoolTextbookKeys, setSchoolTextbookKeys] = useState<string[]>([]);
  const [schoolLoaded, setSchoolLoaded] = useState(false);
  /** 교과서 검색·과목 필터 — /gyogwaseo 주문 화면과 같은 구성 */
  const [gyoSearch, setGyoSearch] = useState('');
  const [gyoSubject, setGyoSubject] = useState('');

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
      .then((data) => {
        const keys = Array.isArray(data?.교과서Keys)
          ? (data.교과서Keys as unknown[]).filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
          : [];
        setGyogwaseoKeys(keys);
      })
      .catch(() => setGyogwaseoKeys([]))
      .finally(() => setGyogwaseoLoaded(true));
  }, []);

  useEffect(() => {
    fetch('/api/textbooks/school')
      .then((res) => res.json())
      .then((d) => {
        const keys = Array.isArray(d?.keys)
          ? (d.keys as unknown[]).filter((k): k is string => typeof k === 'string' && k.trim() !== '')
          : [];
        setSchoolTextbookKeys(keys);
      })
      .catch(() => setSchoolTextbookKeys([]))
      .finally(() => setSchoolLoaded(true));
  }, []);

  /** 교과서 섹션에 보일 전체 — 쏠북 등록분 ∪ 학교 교과서(권한 회원) */
  const gyogwaseoAllKeys = useMemo(
    () => [...new Set([...gyogwaseoKeys, ...schoolTextbookKeys])],
    [gyogwaseoKeys, schoolTextbookKeys],
  );

  /* 교과서 — 과목 순 → 표시 이름 순. 표시만 바꾸고 선택 값은 원래 키 그대로 넘긴다. */
  const gyoSorted = useMemo(
    () =>
      [...gyogwaseoAllKeys].sort((a, b) => {
        const d = subjectOrderIdx(gyogwaseoSectionOf(a)) - subjectOrderIdx(gyogwaseoSectionOf(b));
        return d || gyogwaseoDisplay(a).label.localeCompare(gyogwaseoDisplay(b).label, 'ko', { numeric: true });
      }),
    [gyogwaseoAllKeys],
  );
  const gyoSearched = useMemo(
    () => (gyoSearch.trim() ? filterTextbooksBySearch(gyoSorted, gyoSearch) : gyoSorted),
    [gyoSorted, gyoSearch],
  );
  const gyoSubjects = useMemo(
    () =>
      Array.from(new Set(gyoSearched.map(gyogwaseoSectionOf))).sort(
        (a, b) => subjectOrderIdx(a) - subjectOrderIdx(b) || a.localeCompare(b, 'ko'),
      ),
    [gyoSearched],
  );
  /* 검색 결과에서 고른 과목이 사라지면 「전체」로 본다 */
  const gyoActiveSubject = gyoSubjects.includes(gyoSubject) ? gyoSubject : '';
  const gyoVisible = gyoActiveSubject ? gyoSearched.filter((k) => gyogwaseoSectionOf(k) === gyoActiveSubject) : gyoSearched;
  const gyoListLoading = !gyogwaseoLoaded || !schoolLoaded;

  useEffect(() => {
    if (!convertedData || !defaultTextbooksLoaded || !gyogwaseoLoaded) return;
    const allKeys = Object.keys(convertedData as Record<string, unknown>);
    const textbookNames = filterWorkbookSupplementaryTextbookKeys(allKeys, {
      allowedTextbooks: currentUser?.allowedTextbooks,
      allowedTextbooksWorkbook: currentUser?.allowedTextbooksWorkbook,
      defaultTextbooksForGuests: defaultTextbooks,
      isGuest: !currentUser,
    });
    /** 교과서 set 은 부교재 목록에서 제외 (교과서 전용 섹션에서 따로 노출) */
    const gyoSet = new Set(gyogwaseoAllKeys);
    const supplementaryOnly = textbookNames.filter((k) => !gyoSet.has(k));
    setWorkbookTextbooks(supplementaryOnly);
    setFilteredTextbooks(supplementaryOnly);
  }, [convertedData, defaultTextbooksLoaded, defaultTextbooks, gyogwaseoLoaded, gyogwaseoAllKeys, currentUser]);

  // 검색 필터링 로직
  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredTextbooks(workbookTextbooks);
    } else {
      setFilteredTextbooks(filterTextbooksBySearch(workbookTextbooks, searchTerm));
    }
  }, [searchTerm, workbookTextbooks]);

  // 학년 선택 시 연도 목록 업데이트
  useEffect(() => {
    if (selectedGrade) {
      const gradeKey = `${selectedGrade}모의고사` as keyof typeof mockExamsData;
      const exams = mockExamsData[gradeKey] || [];

      const years = Array.from(
        new Set(
          exams
            .map((exam) => parseMockExamKey(exam)?.year)
            .filter((y): y is number => typeof y === 'number')
            .map((y) => String(y))
        )
      ).sort((a, b) => Number(b) - Number(a));

      setAvailableYears(years);
      setSelectedYear('');
      setSelectedMonth('');
      setAvailableMonths([]);
    } else {
      setAvailableYears([]);
      setSelectedYear('');
      setSelectedMonth('');
      setAvailableMonths([]);
    }
  }, [selectedGrade]);

  // 연도 선택 시 월(시험) 목록 업데이트 — 라벨은 "M월 [형] [(메모)]", 값은 mock-exams.json 의 원본 키
  useEffect(() => {
    if (selectedGrade && selectedYear) {
      const gradeKey = `${selectedGrade}모의고사` as keyof typeof mockExamsData;
      const exams = mockExamsData[gradeKey] || [];

      const months = exams
        .map((exam) => {
          const p = parseMockExamKey(exam);
          if (!p || p.year == null || String(p.year) !== selectedYear) return null;
          const monthLabel = p.month != null ? `${p.month}월` : exam;
          const variant = p.variant ? ` ${p.variant}` : '';
          const note = p.note ? ` (${p.note})` : p.bracketNote ? ` (${p.bracketNote})` : '';
          return `${monthLabel}${variant}${note}|||${exam}`;
        })
        .filter((s): s is string => s !== null);

      setAvailableMonths(months);
      setSelectedMonth('');
    } else {
      setAvailableMonths([]);
      setSelectedMonth('');
    }
  }, [selectedGrade, selectedYear]);

  // 모의고사 선택 완료 처리 — selectedMonth 는 "라벨|||원본키" 형식
  const handleMockExamSelect = () => {
    if (selectedGrade && selectedYear && selectedMonth) {
      const sep = selectedMonth.indexOf('|||');
      const examName = sep >= 0 ? selectedMonth.slice(sep + 3) : selectedMonth;
      onTextbookSelect(examName);
    }
  };

  return (
    <>
      <AppBar 
        showBackButton={true} 
        onBackClick={onBack}
        title={headings.appBar}
      />
      <div className="min-h-screen py-8" style={{ backgroundColor: '#F5F5F5' }}>
      <div className="container mx-auto px-4">
        {/* 헤더 */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ color: '#101820' }}>
            {headings.title}
          </h1>
          <p className="text-lg" style={{ color: '#888B8D' }}>
            {headings.subtitle}
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
          {dataLoading ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-gray-600">교재 목록을 불러오는 중...</p>
            </div>
          ) : dataError || !convertedData ? (
            <div className="text-center py-16">
              <p className="text-red-600">교재 데이터를 불러올 수 없습니다.</p>
            </div>
          ) : showTextbook ? (
            <div>
              <div className="text-center mb-6">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <h2 className="text-2xl font-bold" style={{ color: '#00A9E0' }}>
                    부교재
                  </h2>
                  <button
                    onClick={() => setIsTextbookExpanded(!isTextbookExpanded)}
                    className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition-colors"
                    title={isTextbookExpanded ? "접기" : "펼치기"}
                  >
                    {isTextbookExpanded ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="text-gray-600">워크북 제작에 사용할 부교재를 선택해주세요</p>
              </div>
              
              {isTextbookExpanded && (
                <>
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
                <div className="space-y-8">
                  {(() => {
                    const commonSet = new Set(WORKBOOK_SUPPLEMENTARY_COMMON_KEYS);
                    const commonTextbooks = filteredTextbooks.filter((k) => commonSet.has(k));
                    const nonCommon = filteredTextbooks.filter((k) => !commonSet.has(k));
                    const { ebs, revised, other } = groupTextbooksByRevised(nonCommon);
                    const renderCard = (textbook: string) => (
                      <TextbookPickCard
                        key={textbook}
                        title={textbook}
                        link={textbookLinks[textbook]}
                        onSelect={() => onTextbookSelect(textbook)}
                      />
                    );
                    return (
                      <>
                        {commonTextbooks.length > 0 && (
                          <div>
                            <h3 className="text-lg font-semibold text-gray-800 mb-3 pb-2 border-b-2 border-emerald-600">
                              공통
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {commonTextbooks.map(renderCard)}
                            </div>
                          </div>
                        )}
                        {ebs.length > 0 && (
                          <div>
                            <h3 className="text-lg font-semibold text-gray-800 mb-3 pb-2 border-b-2 border-emerald-200">
                              EBS
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {ebs.map(renderCard)}
                            </div>
                          </div>
                        )}
                        {revised.length > 0 && (
                          <div>
                            <h3 className="text-lg font-semibold text-gray-800 mb-3 pb-2 border-b-2 border-blue-200">
                              개정판
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {revised.map(renderCard)}
                            </div>
                          </div>
                        )}
                        {other.length > 0 && (
                          <div>
                            {(commonTextbooks.length > 0 || ebs.length > 0 || revised.length > 0) && (
                              <h3 className="text-lg font-semibold text-gray-800 mb-3 pb-2 border-b-2 border-gray-200">
                                기타 교재
                              </h3>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {other.map(renderCard)}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
                </>
              )}
            </div>
          ) : null}

          {/* 교과서 섹션 — 쏠북 교과서Keys ∪ 학교 교과서(권한 회원). 변형문제 화면과 같은 풀.
              교과서 전용 진입(category=gyogwaseo)에서는 로딩·빈 목록도 보여 준다(아무것도 안 뜨면 고장처럼 보인다). */}
          {showGyogwaseo && !dataLoading && !dataError && convertedData && (category === 'gyogwaseo' || gyogwaseoAllKeys.length > 0) && (
            <div className={category ? '' : 'mt-16'}>
              <div className="text-center mb-6">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <h2 className="text-2xl font-bold" style={{ color: '#00A9E0' }}>
                    교과서
                  </h2>
                  <button
                    type="button"
                    onClick={() => setIsGyogwaseoExpanded(!isGyogwaseoExpanded)}
                    className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition-colors"
                    aria-expanded={isGyogwaseoExpanded}
                    aria-label={isGyogwaseoExpanded ? '교과서 목록 접기' : '교과서 목록 펼치기'}
                  >
                    {isGyogwaseoExpanded ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="text-gray-700">워크북 제작에 사용할 교과서를 선택해주세요</p>
              </div>

              {isGyogwaseoExpanded &&
                (gyoListLoading ? (
                  <div className="py-12 text-center" role="status">
                    <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-4 border-blue-200 border-t-blue-600" aria-hidden />
                    <p className="text-gray-700">교과서 목록을 불러오는 중...</p>
                  </div>
                ) : gyogwaseoAllKeys.length === 0 ? (
                  <div className="mx-auto max-w-lg rounded-xl border border-gray-200 bg-white px-5 py-8 text-center">
                    <p className="font-semibold text-gray-900">지금 워크북으로 주문할 수 있는 교과서가 없습니다.</p>
                    <p className="mt-1 text-sm text-gray-700">
                      교과서 변형문제는{' '}
                      <a href="/gyogwaseo" className="font-semibold text-blue-700 underline">교과서 자료 주문</a>
                      에서 확인해 주세요.
                    </p>
                  </div>
                ) : (
                  <div>
                    {/* 검색 — /gyogwaseo 와 같은 모양 */}
                    <div className="max-w-md mx-auto mb-4">
                      <label htmlFor="gyo-workbook-search" className="sr-only">교과서 검색</label>
                      <div className="relative">
                        <input
                          id="gyo-workbook-search"
                          type="search"
                          placeholder="교재명·출판사·저자로 검색..."
                          value={gyoSearch}
                          onChange={(e) => setGyoSearch(e.target.value)}
                          className="w-full px-4 py-3 pl-12 pr-11 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition-colors text-gray-800 placeholder-gray-500"
                        />
                        <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2">
                          <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                        {gyoSearch && (
                          <button
                            type="button"
                            onClick={() => setGyoSearch('')}
                            aria-label="검색어 지우기"
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-gray-500 hover:text-gray-800"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <p className="mt-2 text-center text-sm text-gray-700" role="status">
                        {gyoSearch || gyoActiveSubject
                          ? `${gyoVisible.length}개 교과서 (전체 ${gyogwaseoAllKeys.length}개)`
                          : `전체 ${gyogwaseoAllKeys.length}개 교과서`}
                      </p>
                    </div>

                    {/* 과목 칩 */}
                    {gyoSubjects.length > 1 && (
                      <div className="mb-5 flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label="과목 필터">
                        <span className="mr-1 text-xs font-bold text-slate-600">과목</span>
                        <button
                          type="button"
                          aria-pressed={gyoActiveSubject === ''}
                          onClick={() => setGyoSubject('')}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            gyoActiveSubject === '' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-500'
                          }`}
                        >
                          전체 <span className="ml-0.5">{gyoSearched.length}</span>
                        </button>
                        {gyoSubjects.map((sub) => {
                          const active = gyoActiveSubject === sub;
                          const count = gyoSearched.filter((k) => gyogwaseoSectionOf(k) === sub).length;
                          return (
                            <button
                              key={sub}
                              type="button"
                              aria-pressed={active}
                              onClick={() => setGyoSubject(active ? '' : sub)}
                              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                                active ? 'border-[#13294B] bg-[#13294B] text-white' : 'border-slate-300 bg-white text-slate-800 hover:border-slate-500'
                              }`}
                            >
                              {active && <span aria-hidden>✓ </span>}
                              {sub} <span className="ml-0.5">{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {gyoVisible.length === 0 ? (
                      <div className="py-12 text-center">
                        <h3 className="mb-2 text-lg font-semibold text-gray-800">검색 결과가 없습니다</h3>
                        <p className="mb-4 text-gray-700">&apos;{gyoSearch}&apos;에 해당하는 교과서를 찾을 수 없습니다</p>
                        <button
                          type="button"
                          onClick={() => {
                            setGyoSearch('');
                            setGyoSubject('');
                          }}
                          className="rounded-lg bg-[#13294B] px-4 py-2 text-white hover:bg-[#0c1c36]"
                        >
                          검색 초기화
                        </button>
                      </div>
                    ) : (
                      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {gyoVisible.map((textbook) => {
                          const d = gyogwaseoDisplay(textbook);
                          return (
                            <li key={textbook}>
                              <TextbookPickCard
                                title={[d.subject, d.publisher].filter(Boolean).join(' · ')}
                                subtitle={[d.author ? `${d.author} 저` : '', d.extra].filter(Boolean).join(' · ') || undefined}
                                link={textbookLinks[textbook]}
                                onSelect={() => onTextbookSelect(textbook)}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ))}
            </div>
          )}

          {/* 모의고사 섹션 */}
          {showMockExam && !dataLoading && !dataError && convertedData && (
            <div className={category ? '' : 'mt-16'}>
              <div className="text-center mb-6">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <h2 className="text-2xl font-bold" style={{ color: '#00A9E0' }}>
                    모의고사
                  </h2>
                  <button
                    onClick={() => setIsMockExamExpanded(!isMockExamExpanded)}
                    className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition-colors"
                    title={isMockExamExpanded ? "접기" : "펼치기"}
                  >
                    {isMockExamExpanded ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="text-gray-600">워크북 제작에 사용할 모의고사를 선택해주세요</p>
              </div>

              {isMockExamExpanded && (
              <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md p-6 border-2 border-gray-200">
                {/* 학년 선택 */}
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    1단계: 학년 선택
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {['고1', '고2', '고3'].map((grade) => (
                      <button
                        key={grade}
                        onClick={() => setSelectedGrade(grade)}
                        className={`py-3 px-4 rounded-lg font-semibold transition-all duration-200 ${
                          selectedGrade === grade
                            ? 'bg-blue-600 text-white shadow-md scale-105'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:shadow'
                        }`}
                      >
                        {grade}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 연도 선택 */}
                <div className="mb-4">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    2단계: 연도 선택
                  </label>
                  <select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    disabled={!selectedGrade}
                    className={`w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none transition-colors text-gray-700 ${
                      !selectedGrade ? 'bg-gray-100 cursor-not-allowed' : ''
                    }`}
                  >
                    <option value="">연도를 선택하세요</option>
                    {availableYears.map(year => (
                      <option key={year} value={year}>{year}년</option>
                    ))}
                  </select>
                </div>

                {/* 월 선택 */}
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    3단계: 시험 선택
                  </label>
                  {!selectedYear ? (
                    <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                      <p className="text-gray-400">먼저 연도를 선택해주세요</p>
                    </div>
                  ) : availableMonths.length === 0 ? (
                    /* 시험 목록은 정적 JSON 이라 기다릴 게 없다 — 「불러오는 중」이 아니라 없음 */
                    <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                      <p className="text-gray-700">이 연도에 등록된 시험이 없습니다</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {availableMonths.map((month) => {
                        const sep = month.indexOf('|||');
                        const label = sep >= 0 ? month.slice(0, sep) : month;
                        return (
                          <button
                            key={month}
                            onClick={() => setSelectedMonth(month)}
                            className={`py-3 px-4 rounded-lg font-medium transition-all duration-200 text-sm ${
                              selectedMonth === month
                                ? 'bg-blue-600 text-white shadow-md scale-105'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:shadow'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 선택 완료 버튼 */}
                <button
                  onClick={handleMockExamSelect}
                  disabled={!selectedGrade || !selectedYear || !selectedMonth}
                  className={`w-full py-3 rounded-lg font-semibold transition-all duration-200 ${
                    selectedGrade && selectedYear && selectedMonth
                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {selectedGrade && selectedYear && selectedMonth
                    ? `${selectedGrade} ${selectedYear}년 ${(() => {
                        const sep = selectedMonth.indexOf('|||');
                        return sep >= 0 ? selectedMonth.slice(0, sep) : selectedMonth;
                      })()} 선택`
                    : '학년, 연도, 시험을 모두 선택해주세요'}
                </button>
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