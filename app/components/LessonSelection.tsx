'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import AppBar from './AppBar';
import { useTextbooksData } from '@/lib/useTextbooksData';
import { useTextbookLinks } from '@/lib/useTextbookLinks';
import { groupTextbooksByRevised } from '@/lib/textbookSort';
import { filterVariantSupplementaryTextbookKeys, VARIANT_SUPPLEMENTARY_COMMON_KEYS } from '@/lib/variant-textbooks';
import { SOLVOOK_BRAND_PAGE_URL } from '@/lib/site-branding';

const KAKAO_INQUIRY_URL =
  process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

/** 교과서 키(`공통영어1_NE능률민병천`)를 학년·출판사·저자로 분해해 카드에 노출 */
type GyogwaseoKeyMeta = {
  subject: string;
  publisher: string;
  author: string;
  raw: string;
};

const PUBLISHER_KEYS = [
  'NE능률', 'YBM', '능률', '천재교육', '천재', '비상교육', '비상',
  '동아출판', '동아', '미래엔', '지학사', '금성', '교학사', '다락원', '천재교과서',
] as const;

const PUBLISHER_STYLE: Record<string, { stripe: string; badge: string }> = {
  'NE능률': { stripe: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  '능률':   { stripe: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'YBM':    { stripe: 'bg-sky-500',     badge: 'bg-sky-50 text-sky-700 border-sky-200' },
  '천재':   { stripe: 'bg-rose-500',    badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  '천재교육': { stripe: 'bg-rose-500',  badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  '천재교과서': { stripe: 'bg-rose-500', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  '비상':   { stripe: 'bg-orange-500',  badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  '비상교육': { stripe: 'bg-orange-500',badge: 'bg-orange-50 text-orange-700 border-orange-200' },
  '동아':   { stripe: 'bg-indigo-500',  badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  '동아출판': { stripe: 'bg-indigo-500',badge: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  '미래엔': { stripe: 'bg-cyan-500',    badge: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  '지학사': { stripe: 'bg-amber-500',   badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  '금성':   { stripe: 'bg-yellow-500',  badge: 'bg-yellow-50 text-yellow-800 border-yellow-200' },
  '교학사': { stripe: 'bg-lime-500',    badge: 'bg-lime-50 text-lime-700 border-lime-200' },
  '다락원': { stripe: 'bg-fuchsia-500', badge: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' },
  '기타':   { stripe: 'bg-slate-400',   badge: 'bg-slate-100 text-slate-700 border-slate-200' },
};

function parseGyogwaseoKey(raw: string): GyogwaseoKeyMeta {
  const idx = raw.indexOf('_');
  let subject = '';
  let rest = raw;
  if (idx > 0) {
    subject = raw.slice(0, idx).trim();
    rest = raw.slice(idx + 1).trim();
  }
  let publisher = '';
  let author = '';
  for (const p of PUBLISHER_KEYS) {
    if (rest.startsWith(p)) {
      publisher = p;
      author = rest.slice(p.length).trim();
      break;
    }
  }
  if (!publisher) {
    publisher = '기타';
    author = rest;
  }
  return { subject: subject || '교과서', publisher, author, raw };
}

/** 학년/과목 정렬: 공통영어1·2 → 영어I·II → 그 외 */
const SUBJECT_ORDER = [
  '공통영어1', '공통영어2',
  '영어', '영어I', '영어II',
  '영어 독해와 작문', '영어독해와작문',
  '영어 회화', '영어회화',
  '진로영어', '실용영어', '직무영어', '심화영어',
];
function subjectOrderIdx(s: string): number {
  const i = SUBJECT_ORDER.indexOf(s);
  return i === -1 ? 999 : i;
}

/** 교과서 목록: 쏠북·구매 안내 링크 우선(extra → kyobo → 쏠북 매장) */
function solbookPurchaseCta(links: {
  kyoboUrl?: string;
  extraUrl?: string;
  extraLabel?: string;
} | undefined): { primaryHref: string; primaryLabel: string; secondary?: { href: string; label: string } } {
  const extra = links?.extraUrl?.trim();
  const kyobo = links?.kyoboUrl?.trim();
  if (extra) {
    return {
      primaryHref: extra,
      primaryLabel: links?.extraLabel?.trim() || '쏠북 구매·안내 보기',
      ...(kyobo ? { secondary: { href: kyobo, label: '교재 정보 (YES24·교보)' } } : {}),
    };
  }
  if (kyobo) {
    return { primaryHref: kyobo, primaryLabel: '교재 구매·정보 보기' };
  }
  return { primaryHref: SOLVOOK_BRAND_PAGE_URL, primaryLabel: '쏠북 매장 바로가기' };
}

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
  /** 교과서 화면: 학년/과목 필터 (전체 = 빈 문자열) */
  const [gyogwaseoSubjectFilter, setGyogwaseoSubjectFilter] = useState<string>('');
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
  const listScreenTitle = listMode교과서 ? '교과서 자료 주문' : showTextbookList ? '부교재 선택' : '강과 번호 선택';
  const listScreenSubtitle = listMode교과서
    ? '쏠북 정식 교재·구매를 먼저 확인하신 뒤, 맞춤 자료는 아래에서 이어가 주세요'
    : showTextbookList
      ? '부교재를 선택해주세요'
      : selectedTextbook;

  const selectTextbookAndOpenLessons = (textbook: string) => {
    if (onTextbookSelect) {
      onTextbookSelect(textbook);
      setShowTextbookList(false);
    }
  };

  const renderGyogwaseoCard = (textbook: string) => {
    const links = textbookLinks[textbook];
    const cta = solbookPurchaseCta(links);
    const meta = parseGyogwaseoKey(textbook);
    const style = PUBLISHER_STYLE[meta.publisher] ?? PUBLISHER_STYLE['기타'];
    return (
      <div
        key={textbook}
        className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-lg"
      >
        <span className={`absolute inset-y-0 left-0 w-1.5 ${style.stripe}`} aria-hidden />
        <div className="flex flex-1 flex-col p-5 pl-6">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
              {meta.subject}
            </span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${style.badge}`}>
              {meta.publisher}
            </span>
          </div>
          <h3 className="mt-2.5 text-lg font-bold leading-tight text-slate-900">
            {meta.author || meta.subject}
            <span className="ml-1.5 text-xs font-medium text-slate-400">대표저자</span>
          </h3>
          <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
            정식 교재 본체는 <span className="font-semibold text-violet-700">쏠북</span>에서, 강·시험 범위 맞춤 자료는 여기서 받습니다.
          </p>

          <div className="mt-auto pt-4 space-y-2">
            <a
              href={cta.primaryHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-br from-violet-600 to-violet-700 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:from-violet-700 hover:to-violet-800 hover:shadow-md focus-visible:outline focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2"
            >
              <span>📘</span>
              <span>{cta.primaryLabel}</span>
              <span aria-hidden>→</span>
            </a>
            {cta.secondary ? (
              <a
                href={cta.secondary.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-[11px] font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900"
              >
                {cta.secondary.label}
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => selectTextbookAndOpenLessons(textbook)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:border-violet-400 hover:bg-violet-50 hover:text-violet-800"
            >
              <span>✂️</span>
              <span>이 교재로 맞춤 자료 주문</span>
            </button>
          </div>
        </div>
      </div>
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
        <div className={`${listMode교과서 ? 'max-w-5xl' : 'max-w-4xl'} mx-auto mb-8`}>
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
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-base font-medium text-gray-800 mb-1">
                              {textbook}
                            </h3>
                            <p className="text-xs text-gray-500">클릭하여 선택</p>
                            {textbookLinks[textbook]?.extraUrl?.trim() ? (
                              <a
                                href={textbookLinks[textbook].extraUrl!.trim()}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="mt-1.5 inline-block max-w-full truncate text-xs font-medium text-violet-700 hover:text-violet-900 underline underline-offset-2"
                                title={textbookLinks[textbook].extraLabel || '추가 링크'}
                              >
                                {textbookLinks[textbook].extraLabel?.trim() || '추가 링크'}
                              </a>
                            ) : null}
                          </div>
                          {textbookLinks[textbook]?.kyoboUrl?.trim() ? (
                            <div className="ml-auto shrink-0">
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
                          ) : null}
                        </div>
                      </div>
                    );

                    if (listMode교과서) {
                      const subjects = Array.from(
                        new Set(filteredTextbooks.map((k) => parseGyogwaseoKey(k).subject))
                      ).sort((a, b) => {
                        const oa = subjectOrderIdx(a);
                        const ob = subjectOrderIdx(b);
                        if (oa !== ob) return oa - ob;
                        return a.localeCompare(b, 'ko');
                      });

                      const visibleTextbooks = gyogwaseoSubjectFilter
                        ? filteredTextbooks.filter(
                            (k) => parseGyogwaseoKey(k).subject === gyogwaseoSubjectFilter
                          )
                        : filteredTextbooks;

                      const grouped = new Map<string, string[]>();
                      visibleTextbooks.forEach((k) => {
                        const s = parseGyogwaseoKey(k).subject;
                        if (!grouped.has(s)) grouped.set(s, []);
                        grouped.get(s)!.push(k);
                      });
                      const groupedSorted = [...grouped.entries()].sort((a, b) => {
                        const oa = subjectOrderIdx(a[0]);
                        const ob = subjectOrderIdx(b[0]);
                        if (oa !== ob) return oa - ob;
                        return a[0].localeCompare(b[0], 'ko');
                      });

                      return (
                        <>
                          {/* 두 갈래 안내: 컴팩트 히어로 카드 */}
                          <div className="mb-6 overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 shadow-sm">
                            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-violet-100">
                              <a
                                href={SOLVOOK_BRAND_PAGE_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group flex items-start gap-3 p-4 sm:p-5 hover:bg-violet-50/50 transition-colors"
                              >
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white text-lg shadow-md">
                                  📘
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-bold uppercase tracking-wider text-violet-700">step 1 · 우선</p>
                                  <p className="mt-0.5 text-sm font-bold text-slate-900">쏠북에서 정식 세트 보기</p>
                                  <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
                                    표준 구성이 필요하면 여기서 끝. 카드의 보라 버튼이 같은 동작입니다.
                                  </p>
                                  <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-violet-700 group-hover:text-violet-900">
                                    매장 전체 보기 <span aria-hidden>→</span>
                                  </span>
                                </div>
                              </a>
                              <Link
                                href="/bundle"
                                className="group flex items-start gap-3 p-4 sm:p-5 hover:bg-fuchsia-50/40 transition-colors"
                              >
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-white text-lg shadow-md">
                                  ✂️
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-700">step 2 · 맞춤</p>
                                  <p className="mt-0.5 text-sm font-bold text-slate-900">강·범위 맞춤 자료 만들기</p>
                                  <p className="mt-1 text-[12px] leading-relaxed text-slate-600">
                                    단어장·분석지·변형문제까지 한 번에 묶으려면 통합 주문으로.
                                  </p>
                                  <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-semibold text-slate-800 group-hover:text-slate-950">
                                    통합 주문 가기 <span aria-hidden>→</span>
                                  </span>
                                </div>
                              </Link>
                            </div>
                          </div>

                          {/* 학년/과목 필터 칩 */}
                          {subjects.length > 1 && (
                            <div className="mb-5 flex flex-wrap items-center gap-1.5">
                              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1">과목</span>
                              <button
                                type="button"
                                onClick={() => setGyogwaseoSubjectFilter('')}
                                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors border ${
                                  gyogwaseoSubjectFilter === ''
                                    ? 'border-slate-800 bg-slate-800 text-white'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                                }`}
                              >
                                전체 <span className="ml-0.5 opacity-70">{filteredTextbooks.length}</span>
                              </button>
                              {subjects.map((s) => {
                                const count = filteredTextbooks.filter((k) => parseGyogwaseoKey(k).subject === s).length;
                                const active = gyogwaseoSubjectFilter === s;
                                return (
                                  <button
                                    key={s}
                                    type="button"
                                    onClick={() => setGyogwaseoSubjectFilter(active ? '' : s)}
                                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors border ${
                                      active
                                        ? 'border-violet-700 bg-violet-700 text-white'
                                        : 'border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:text-violet-800'
                                    }`}
                                  >
                                    {s} <span className="ml-0.5 opacity-70">{count}</span>
                                  </button>
                                );
                              })}
                            </div>
                          )}

                          {/* 학년별 섹션 + 카드 그리드 */}
                          <div className="space-y-8">
                            {groupedSorted.map(([subject, keys]) => (
                              <section key={subject}>
                                <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-slate-200 pb-2">
                                  <h3 className="text-base font-bold text-slate-900">{subject}</h3>
                                  <span className="text-xs font-medium text-slate-500">{keys.length}종</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  {keys.map(renderGyogwaseoCard)}
                                </div>
                              </section>
                            ))}
                          </div>

                          {/* 도움이 필요할 때: 카카오 문의 */}
                          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <p className="text-xs text-slate-600">목록에 없는 교재 · 출판사가 필요하신가요?</p>
                            <a
                              href={KAKAO_INQUIRY_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#FEE500] px-3 py-1.5 text-xs font-bold text-[#191919] border border-[#e6d400] hover:opacity-95"
                            >
                              <span aria-hidden>💬</span>
                              카카오톡 문의
                            </a>
                          </div>
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
                              쏠북 교재의{' '}
                              <strong className="text-gray-800">본체</strong>는{' '}
                              <a
                                href={SOLVOOK_BRAND_PAGE_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-violet-800 underline decoration-violet-200 underline-offset-2 hover:text-violet-950"
                              >
                                쏠북 매장
                              </a>
                              에서 직접 구매하셔야 합니다. 매장에 올라와 있는 표준 구성을 먼저 둘러보시고, 원하는 형태가 없을 때만 이곳에서{' '}
                              <strong className="text-gray-800">맞춤(커스텀) 변형</strong> 주문을 진행해 주세요.{' '}
                              <strong className="text-gray-900">결제는 두 곳으로 나뉘어</strong>, 교재 본체 금액은 쏠북에서,{' '}
                              <strong className="text-gray-800">변형 제작·쏠북 커스텀 요금</strong>은 이곳에서 결제됩니다.{' '}
                              <span className="text-violet-800 font-medium">
                                월구독 회원·연회원은 쏠북 커스텀 비용이 면제됩니다.
                              </span>{' '}
                              쏠북 연계 주문에서는 포인트가 사용되지 않습니다.
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
