'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppBar from '../components/AppBar';
import CategorySelector, { type CategoryItem } from '../components/CategorySelector';
import { useTextbooksData } from '@/lib/useTextbooksData';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { isEbsTextbook } from '@/lib/textbookSort';
import { saveOrderToDb } from '@/lib/orders';
import { ORDER_PREFIX } from '@/lib/orderPrefix';
const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';
const MOCK_PASSAGE_KEY = '번호';

interface EssayTypeItem {
  id: string;
  대분류: string;
  소분류: string;
  typeCode?: string;
  문제?: string;
  태그?: string[];
  조건?: string;
  price?: number;
  exampleFile?: { originalName: string };
}

interface LessonItem {
  번호: string;
}
interface TextbookContent {
  [lessonKey: string]: LessonItem[];
}
interface TextbookStructure {
  Sheet1?: { 부교재?: Record<string, TextbookContent> };
  '지문 데이터'?: { 부교재?: Record<string, TextbookContent> };
  부교재?: Record<string, TextbookContent>;
}

export default function EssayPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);

  const { data: textbooksData, loading: dataLoading, error: dataError } = useTextbooksData();
  const currentUser = useCurrentUser();

  const [selected대분류List, setSelected대분류List] = useState<string[]>([]);
  const [selectedTextbook, setSelectedTextbook] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pastExamUploads, setPastExamUploads] = useState<{ id: string; school: string; grade: string; examYear: string; examType: string; examScope: string; adminCategories: string[] }[]>([]);
  const [selectedPastExamId, setSelectedPastExamId] = useState<string | null>(null);
  const [essayTypes, setEssayTypes] = useState<EssayTypeItem[]>([]);
  const [lessonGroups, setLessonGroups] = useState<Record<string, string[]>>({});
  const [selectedPassages, setSelectedPassages] = useState<string[]>([]);
  const [expandedLessons, setExpandedLessons] = useState<string[]>([]);
  const [manualPassageCount, setManualPassageCount] = useState<number>(0);
  const [mockExamKeys, setMockExamKeys] = useState<string[]>([]);
  const [mockExamsByGrade, setMockExamsByGrade] = useState<Record<string, string[]>>({});
  const [textbookTab, setTextbookTab] = useState<'EBS' | '모의고사' | '부교재'>('EBS');
  const [mockGrade, setMockGrade] = useState('');
  const [mockYear, setMockYear] = useState('');

  useEffect(() => {
    import('@/app/data/mock-exams.json')
      .then((data: { 고1모의고사?: string[]; 고2모의고사?: string[]; 고3모의고사?: string[] }) => {
        const byGrade: Record<string, string[]> = {
          '고1': data.고1모의고사 ?? [],
          '고2': data.고2모의고사 ?? [],
          '고3': data.고3모의고사 ?? [],
        };
        setMockExamsByGrade(byGrade);
        const list = [...(data.고1모의고사 ?? []), ...(data.고2모의고사 ?? []), ...(data.고3모의고사 ?? [])];
        setMockExamKeys(list);
      })
      .catch(() => { setMockExamKeys([]); setMockExamsByGrade({}); });
  }, []);

  const allowedTextbooksEssay = currentUser?.allowedTextbooksEssay;
  const { ebsTextbooks, mockTextbooks, 부교재Textbooks } = useMemo(() => {
    const allKeys = textbooksData ? Object.keys(textbooksData) : [];
    const ebs = allKeys.filter((k) => isEbsTextbook(k));
    const mock = mockExamKeys;
    const 부교재All = allKeys.filter(
      (k) => !isEbsTextbook(k) && !k.startsWith('고1_') && !k.startsWith('고2_') && !k.startsWith('고3_')
    );
    const 부교재 =
      allowedTextbooksEssay !== undefined
        ? 부교재All.filter((k) => allowedTextbooksEssay.includes(k))
        : [];
    return {
      ebsTextbooks: ebs,
      mockTextbooks: mock,
      부교재Textbooks: 부교재,
    };
  }, [textbooksData, allowedTextbooksEssay, mockExamKeys]);

  // 모의고사 단계별 파생 데이터
  const mockYears = useMemo(() => {
    if (!mockGrade || !mockExamsByGrade[mockGrade]) return [];
    const years = new Set(
      mockExamsByGrade[mockGrade].map((k) => k.split('_')[1]).filter(Boolean)
    );
    return [...years].sort((a, b) => Number(b) - Number(a));
  }, [mockGrade, mockExamsByGrade]);

  const mockMonths = useMemo(() => {
    if (!mockGrade || !mockYear || !mockExamsByGrade[mockGrade]) return [];
    return mockExamsByGrade[mockGrade]
      .filter((k) => k.split('_')[1] === mockYear)
      .map((k) => ({ key: k, label: k.split('_').slice(2).join('_') }));
  }, [mockGrade, mockYear, mockExamsByGrade]);

  const sortTypesWithTypeCodeFirst = (types: EssayTypeItem[]) => {
    return [...types].sort((a, b) => {
      const aCode = (a.typeCode || '').trim();
      const bCode = (b.typeCode || '').trim();
      const aHas = !!aCode;
      const bHas = !!bCode;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && bHas) return aCode.localeCompare(bCode, undefined, { numeric: true });
      return 0;
    });
  };

  // 관리자가 주문서 노출한 유형만 표시. 대분류는 우선 '빈칸재배열형'만 사용.
  const ONLY_대분류 = '빈칸재배열형';
  const essayTypesGrouped = useMemo(() => {
    if (essayTypes.length === 0) return [];
    const grouped = Object.entries(essayTypes.reduce<Record<string, EssayTypeItem[]>>((acc, t) => {
      const key = t.대분류 || '(미분류)';
      if (!acc[key]) acc[key] = [];
      acc[key].push(t);
      return acc;
    }, {}))
      .map(([대분류, types]) => ({ 대분류, types: sortTypesWithTypeCodeFirst(types) }))
      .filter((g) => g.대분류 === ONLY_대분류);
    return grouped;
  }, [essayTypes]);

  // 선택된 대분류 = 해당 대분류 하위 소분류 전부 포함
  const selectedTypePrices = selected대분류List.length > 0
    ? essayTypesGrouped.flatMap((g) =>
        selected대분류List.includes(g.대분류)
          ? g.types.map((t) => ({ 대분류: g.대분류, 소분류: t.소분류, typeCode: t.typeCode, price: t.price ?? 0 }))
          : []
      )
    : [];
  const selectedCountBy대분류 = essayTypesGrouped.reduce<Record<string, number>>((acc, g) => {
    if (selected대분류List.includes(g.대분류)) acc[g.대분류] = g.types.length;
    return acc;
  }, {});
  const priceSummaryBy대분류 = essayTypesGrouped
    .filter((g) => selected대분류List.includes(g.대분류))
    .map((g) => ({ 대분류: g.대분류, price: g.types[0]?.price ?? 0 }));
  const sumPerPassage = priceSummaryBy대분류.reduce((sum, x) => sum + x.price, 0);

  const categorySelectorItems: CategoryItem[] = useMemo(
    () =>
      essayTypesGrouped.map((g) => ({
        id: g.대분류,
        name: g.대분류,
        subs: g.types.map((t) => ({
          id: t.id,
          name: t.소분류,
          typeCode: t.typeCode,
          exampleFile: t.exampleFile,
        })),
      })),
    [essayTypesGrouped]
  );
  const hasLessonData = Object.keys(lessonGroups).length > 0;
  const passageCount = hasLessonData ? selectedPassages.length : Math.max(0, manualPassageCount);
  const totalPrice = sumPerPassage * passageCount;

  const allTypeKeys = essayTypes.length > 0
    ? new Set(essayTypes.map((t) => `${t.대분류} > ${t.소분류}`))
    : new Set<string>();

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        const isMember = !!data?.user;
        setAuthorized(isMember);
        setHasAccess(isMember && !!data?.user?.canAccessEssay);
      })
      .catch(() => {
        setAuthorized(false);
        setHasAccess(false);
      })
      .finally(() => setChecking(false));
  }, []);

  // 업로드한 기출문제 목록 조회 (관리자 분류 유형으로 추천용)
  useEffect(() => {
    if (!authorized || !hasAccess) {
      setPastExamUploads([]);
      setSelectedPastExamId(null);
      return;
    }
    fetch('/api/my/past-exam-upload', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        const uploads = (data?.uploads ?? []).map((u: { id: string; school?: string; grade?: string; examYear?: string; examType?: string; examScope?: string; adminCategories?: string[] }) => ({
          id: u.id,
          school: u.school ?? '',
          grade: u.grade ?? '',
          examYear: u.examYear ?? '',
          examType: u.examType ?? '',
          examScope: u.examScope ?? '',
          adminCategories: Array.isArray(u.adminCategories) ? u.adminCategories : [],
        }));
        setPastExamUploads(uploads);
      })
      .catch(() => setPastExamUploads([]));
  }, [authorized, hasAccess]);

  const recommendedFromPastExams = (() => {
    const toValidate = (cats: string[]) => {
      const valid: string[] = [];
      for (const cat of cats) {
        if (typeof cat !== 'string' || !cat.includes(' > ')) continue;
        if (allTypeKeys.has(cat)) valid.push(cat);
      }
      return valid;
    };
    if (selectedPastExamId) {
      const one = pastExamUploads.find((u) => u.id === selectedPastExamId);
      return one ? toValidate(one.adminCategories) : [];
    }
    const set = new Set<string>();
    for (const u of pastExamUploads) {
      for (const c of toValidate(u.adminCategories)) set.add(c);
    }
    return Array.from(set);
  })();

  useEffect(() => {
    if (!authorized || !hasAccess) return;
    fetch('/api/essay-types', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setEssayTypes(Array.isArray(d?.types) ? d.types : []))
      .catch(() => setEssayTypes([]));
  }, [authorized, hasAccess]);

  // 대분류가 하나뿐이면 자동 선택 (로드 시 1회)
  useEffect(() => {
    if (essayTypesGrouped.length === 1) {
      setSelected대분류List((prev) => (prev.includes(essayTypesGrouped[0].대분류) ? prev : [essayTypesGrouped[0].대분류]));
    }
  }, [essayTypesGrouped]);

  const isMockExam = !!selectedTextbook && mockExamKeys.includes(selectedTextbook);

  // 교재 선택 시 지문(강·번호) 목록 로드
  useEffect(() => {
    if (!selectedTextbook) {
      setLessonGroups({});
      setSelectedPassages([]);
      setExpandedLessons([]);
      setManualPassageCount(0);
      return;
    }
    // 모의고사: converted_data에 없으므로 표준 번호 자동 생성
    if (!textbooksData?.[selectedTextbook] && mockExamKeys.includes(selectedTextbook)) {
      const passages: string[] = [];
      for (let i = 18; i <= 45; i++) passages.push(`${i}번`);
      setLessonGroups({ [MOCK_PASSAGE_KEY]: passages });
      setSelectedPassages([]);
      setExpandedLessons([]);
      setManualPassageCount(0);
      return;
    }
    if (!textbooksData?.[selectedTextbook]) {
      setLessonGroups({});
      setSelectedPassages([]);
      return;
    }
    const textbookData = textbooksData[selectedTextbook] as TextbookStructure;
    const pickFirst = (sub: Record<string, TextbookContent> | undefined) => {
      if (!sub) return null;
      if (sub[selectedTextbook]) return sub[selectedTextbook];
      const keys = Object.keys(sub);
      return keys.length > 0 ? sub[keys[0]] : null;
    };
    const actualData =
      pickFirst(textbookData.Sheet1?.부교재) ??
      pickFirst((textbookData as TextbookStructure)['지문 데이터']?.부교재) ??
      pickFirst(textbookData.부교재);
    if (actualData) {
      const groups: Record<string, string[]> = {};
      Object.keys(actualData).forEach((lessonKey) => {
        const arr = actualData[lessonKey];
        if (Array.isArray(arr)) {
          groups[lessonKey] = arr.map((item: LessonItem) => `${lessonKey} ${item.번호}`);
        }
      });
      setLessonGroups(groups);
    } else {
      setLessonGroups({});
    }
    setSelectedPassages([]);
    setExpandedLessons([]);
    setManualPassageCount(0);
  }, [selectedTextbook, textbooksData, mockExamKeys]);

  const togglePassage = (passage: string) => {
    setSelectedPassages((prev) => (prev.includes(passage) ? prev.filter((p) => p !== passage) : [...prev, passage]));
  };
  const toggleLessonGroup = (lessonKey: string) => {
    const group = lessonGroups[lessonKey] ?? [];
    const allSelected = group.every((p) => selectedPassages.includes(p));
    setSelectedPassages((prev) =>
      allSelected ? prev.filter((p) => !group.includes(p)) : [...new Set([...prev, ...group])]
    );
  };
  const toggleExpandLesson = (lessonKey: string) => {
    setExpandedLessons((prev) => (prev.includes(lessonKey) ? prev.filter((k) => k !== lessonKey) : [...prev, lessonKey]));
  };
  const handlePassageAllToggle = () => {
    const all = Object.values(lessonGroups).flat();
    const allSelected = all.every((p) => selectedPassages.includes(p));
    setSelectedPassages(allSelected ? [] : all);
  };

  const recommended대분류Set = useMemo(() => {
    const set = new Set<string>();
    recommendedFromPastExams.forEach((label) => {
      const [대] = label.split(' > ').map((s) => s.trim());
      if (대 && essayTypesGrouped.some((g) => g.대분류 === 대)) set.add(대);
    });
    return set;
  }, [recommendedFromPastExams, essayTypesGrouped]);

  const selectAllRecommended = () => {
    const toAdd = [...recommended대분류Set].filter((대) => !selected대분류List.includes(대));
    if (toAdd.length > 0) setSelected대분류List((prev) => [...new Set([...prev, ...toAdd])]);
  };
  const clearAllRecommended = () => {
    setSelected대분류List((prev) => prev.filter((대) => !recommended대분류Set.has(대)));
  };
  const toggleRecommended대분류 = (대분류: string) => {
    setSelected대분류List((prev) =>
      prev.includes(대분류) ? prev.filter((대) => 대 !== 대분류) : [...prev, 대분류]
    );
  };

  const handleSubmitOrder = async () => {
    if (selected대분류List.length === 0) {
      alert('대분류를 1개 이상 선택해주세요.');
      return;
    }
    if (!selectedTextbook) {
      alert('교재를 선택해주세요.');
      return;
    }
    if (passageCount <= 0) {
      alert('지문을 선택하거나 지문 수를 입력해주세요.');
      return;
    }

    const prefix =
      selectedTextbook.startsWith('고1_') ||
      selectedTextbook.startsWith('고2_') ||
      selectedTextbook.startsWith('고3_')
        ? ORDER_PREFIX.MOCK_ESSAY
        : ORDER_PREFIX.BOOK_ESSAY;

    const by대분류 = selectedTypePrices.reduce<Record<string, typeof selectedTypePrices>>((acc, t) => {
      if (!acc[t.대분류]) acc[t.대분류] = [];
      acc[t.대분류].push(t);
      return acc;
    }, {});
    const orderLines = priceSummaryBy대분류.flatMap(({ 대분류, price }) => {
      const items = by대분류[대분류] ?? [];
      return [
        `[${대분류}] 지문당 ${price.toLocaleString()}원`,
        ...items.map((t) => `   - ${t.typeCode ? `[${t.typeCode}] ` : ''}${t.소분류}`),
      ];
    });

    const passageListSection =
      hasLessonData && selectedPassages.length > 0
        ? (() => {
            if (isMockExam) {
              // 모의고사: "번호 18번" → "18번" 으로 표시
              const nums = selectedPassages
                .map((p) => (p.startsWith(MOCK_PASSAGE_KEY + ' ') ? p.slice(MOCK_PASSAGE_KEY.length + 1) : p))
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
              return `\n2-1. 선택 지문 (번호):\n   ${nums.join(', ')}`;
            }
            const byLesson: Record<string, string[]> = {};
            selectedPassages.forEach((p) => {
              const spaceIdx = p.indexOf(' ');
              const lesson = spaceIdx >= 0 ? p.slice(0, spaceIdx) : p;
              const num = spaceIdx >= 0 ? p.slice(spaceIdx + 1) : '';
              if (!byLesson[lesson]) byLesson[lesson] = [];
              byLesson[lesson].push(num);
            });
            const sortedLessons = Object.keys(byLesson).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
            const lines = sortedLessons.map((lesson) => `   ${lesson}: ${(byLesson[lesson] ?? []).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', ')}`);
            return `\n2-1. 선택 지문 (강·번호):\n${lines.join('\n')}`;
          })()
        : '';

    const orderText = `서술형 주문서

1. 대분류별 지문당 금액 및 선택 소분류:\n${orderLines.join('\n')}
2. 선택 지문 수: ${passageCount}개${passageListSection}

3. 지문당 합계: ${sumPerPassage.toLocaleString()}원 × ${passageCount}개 = 총 금액: ${totalPrice.toLocaleString()}원
4. 교재: ${selectedTextbook}`;

    setSubmitting(true);
    try {
      const res = await saveOrderToDb(orderText, prefix);
      if (res.ok && res.id) {
        router.push('/order/done?id=' + res.id);
      } else {
        alert(res.error || '주문 저장에 실패했습니다.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <>
        <AppBar title="커스터마이징 서비스" />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar title="커스터마이징 서비스" />
      <div className="min-h-screen py-8 px-4" style={{ backgroundColor: '#F5F5F5' }}>
        <div className="max-w-5xl mx-auto">
          <p className="mb-4">
            <Link href="/" className="text-sm font-medium text-blue-600 hover:underline">
              ← 메인 화면으로
            </Link>
          </p>

          {!authorized ? (
            <div className="text-center bg-white rounded-xl shadow p-8">
              <h1 className="text-2xl font-bold text-gray-800 mb-2">서술형문제 주문제작</h1>
              <p className="text-gray-600 mb-6">서술형문제 주문제작은 회원 전용 서비스입니다.</p>
              <a
                href={KAKAO_INQUIRY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-[#FEE500] text-gray-800 rounded-lg hover:bg-[#FDD835] transition-colors font-medium border border-gray-300"
              >
                회원가입 문의하러 가기
              </a>
              <p className="mt-6">
                <Link href="/" className="text-sm text-gray-500 hover:underline">
                  메인으로 돌아가기
                </Link>
              </p>
            </div>
          ) : !hasAccess ? (
            <div className="text-center bg-white rounded-xl shadow p-8">
              <h1 className="text-2xl font-bold text-gray-800 mb-2">서술형문제 주문제작</h1>
              <p className="text-gray-600 mb-6">이 메뉴 이용 권한이 없습니다. 관리자에게 문의해 주세요.</p>
              <Link
                href="/"
                className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                메인으로
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[1fr,300px] gap-6 items-start">
              {/* 메인: 주문 폼 */}
              <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                <div className="p-6 border-b bg-gray-50">
                  <h1 className="text-2xl font-bold text-gray-800 mb-2">서술형문제 주문제작</h1>
                  <p className="text-gray-600 text-sm">
                    대분류를 선택하면 해당 유형의 소분류가 모두 포함됩니다. 교재를 선택한 뒤 주문하세요.
                  </p>
                </div>

                {/* 안내문 */}
                <div className="mx-6 mt-6 p-4 rounded-xl bg-[#fffbeb] border border-[#fde68a]">
                  <p className="text-[13px] font-bold text-[#92400e] mb-2">📌 주문 전 꼭 읽어주세요</p>
                  <ul className="text-[12.5px] text-[#78350f] space-y-1.5 leading-relaxed list-disc list-inside">
                    <li>개별 맞춤 주문 제작 시스템으로, 제작에 시간이 소요되는 점 양해 부탁드립니다.</li>
                    <li>
                      주문서 작성 전 <strong>카카오톡 상담</strong>을 먼저 해주시면 서술형 문제 제작에 대해 정성스럽게 답변 드리겠습니다.
                    </li>
                    <li>
                      원하시는 학교의 출제 스타일에 맞춘 맞춤 제작도 가능합니다.<br />
                      상담 전 <strong>해당 학교 기출문제 사진</strong>을 미리 준비해 주시면 더욱 정확한 안내가 가능합니다.
                    </li>
                  </ul>
                  <a
                    href={KAKAO_INQUIRY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 mt-3 px-4 py-2.5 bg-[#FEE500] text-[#3B1E1E] rounded-lg text-[13px] font-bold hover:bg-[#FDD835] transition-colors border border-[#e5cc00] no-underline"
                  >
                    💬 카카오톡 상담하기
                  </a>
                </div>

                <div className="p-6 space-y-6">
                {essayTypesGrouped.length === 0 ? (
                  <div className="py-8 px-4 rounded-xl bg-gray-100 border border-gray-200 text-center">
                    <p className="text-gray-700 font-medium mb-2">선택 가능한 유형이 없습니다.</p>
                    <p className="text-gray-600 text-sm mb-4">관리자가 주문서에 노출할 유형을 설정하면 여기에 표시됩니다. 문의가 필요하시면 카카오톡으로 연락해 주세요.</p>
                    <a
                      href={KAKAO_INQUIRY_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#FEE500] text-[#3B1E1E] rounded-lg text-sm font-bold hover:bg-[#FDD835] transition-colors border border-[#e5cc00] no-underline"
                    >
                      💬 카카오톡 문의
                    </a>
                  </div>
                ) : (
                  <>
                {/* 1. 대분류 선택 (CategorySelector UI) */}
                <CategorySelector
                  categories={categorySelectorItems}
                  selectedIds={selected대분류List}
                  onToggle={(id) =>
                    setSelected대분류List((prev) =>
                      prev.includes(id) ? prev.filter((대) => 대 !== id) : [...prev, id]
                    )
                  }
                  exampleFileBaseUrl="/api/essay-types/example-file"
                />

                {/* 2. 교재 선택 (EBS / 모의고사 / 부교재) */}
                {dataLoading ? (
                  <p className="text-gray-500 text-sm">교재 목록 불러오는 중…</p>
                ) : (ebsTextbooks.length + mockTextbooks.length + 부교재Textbooks.length) === 0 ? (
                  <p className="text-gray-600 text-sm">선택 가능한 교재가 없습니다. 문의가 필요하시면 카카오톡으로 연락해 주세요.</p>
                ) : (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">2. 교재 선택</label>

                    {/* 탭 */}
                    <div className="flex rounded-xl border border-gray-200 overflow-hidden mb-4 bg-gray-50">
                      {(['EBS', '모의고사', '부교재'] as const).map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => { setTextbookTab(tab); setSelectedTextbook(''); setMockGrade(''); setMockYear(''); }}
                          className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${
                            textbookTab === tab
                              ? 'bg-blue-600 text-white'
                              : 'text-gray-500 hover:bg-gray-100'
                          }`}
                        >
                          {tab}
                        </button>
                      ))}
                    </div>

                    {/* EBS 패널 */}
                    {textbookTab === 'EBS' && (
                      <div className="grid grid-cols-2 gap-2">
                        {ebsTextbooks.map((key) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setSelectedTextbook(key)}
                            className={`text-left px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                              selectedTextbook === key
                                ? 'border-blue-500 bg-blue-50 text-blue-800'
                                : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                            }`}
                          >
                            {key}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* 모의고사 패널 */}
                    {textbookTab === '모의고사' && (
                      <div className="space-y-3">
                        {/* 학년 선택 */}
                        <div>
                          <p className="text-xs text-gray-500 mb-2 font-medium">학년 선택</p>
                          <div className="flex gap-2">
                            {['고1', '고2', '고3'].map((g) => (
                              <button
                                key={g}
                                type="button"
                                onClick={() => { setMockGrade(g); setMockYear(''); setSelectedTextbook(''); }}
                                className={`flex-1 py-2.5 rounded-lg border-2 text-sm font-semibold transition-colors ${
                                  mockGrade === g
                                    ? 'border-blue-500 bg-blue-600 text-white'
                                    : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
                                }`}
                              >
                                {g}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* 연도 선택 */}
                        {mockGrade && mockYears.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 mb-2 font-medium">연도 선택</p>
                            <div className="flex flex-wrap gap-2">
                              {mockYears.map((y) => (
                                <button
                                  key={y}
                                  type="button"
                                  onClick={() => { setMockYear(y); setSelectedTextbook(''); }}
                                  className={`px-4 py-2 rounded-lg border-2 text-sm font-semibold transition-colors ${
                                    mockYear === y
                                      ? 'border-blue-500 bg-blue-600 text-white'
                                      : 'border-gray-200 bg-white text-gray-600 hover:border-blue-300'
                                  }`}
                                >
                                  {y}년
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 월/시행 선택 */}
                        {mockGrade && mockYear && mockMonths.length > 0 && (
                          <div>
                            <p className="text-xs text-gray-500 mb-2 font-medium">시행 선택</p>
                            <div className="grid grid-cols-2 gap-2">
                              {mockMonths.map(({ key, label }) => (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() => setSelectedTextbook(key)}
                                  className={`text-left px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                                    selectedTextbook === key
                                      ? 'border-blue-500 bg-blue-50 text-blue-800'
                                      : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 부교재 패널 */}
                    {textbookTab === '부교재' && (
                      <div className="space-y-3">
                        {부교재Textbooks.length > 0 ? (
                          <div className="grid grid-cols-2 gap-2">
                            {부교재Textbooks.map((key) => (
                              <button
                                key={key}
                                type="button"
                                onClick={() => setSelectedTextbook(key)}
                                className={`text-left px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                                  selectedTextbook === key
                                    ? 'border-blue-500 bg-blue-50 text-blue-800'
                                    : 'border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50'
                                }`}
                              >
                                {key}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-gray-500 text-center py-4">배정된 부교재가 없습니다.</p>
                        )}
                        <div className="p-3 rounded-xl bg-sky-50 border border-sky-200">
                          <p className="text-xs text-sky-800 mb-1 font-medium">원하는 부교재가 목록에 없으신가요?</p>
                          <p className="text-xs text-sky-700 mb-2">부교재는 배정된 교재만 표시됩니다. 추가 이용은 카카오톡으로 문의해 주세요.</p>
                          <a
                            href={KAKAO_INQUIRY_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 px-4 py-2 bg-[#FEE500] text-[#3B1E1E] rounded-lg text-sm font-bold hover:bg-[#FDD835] transition-colors border border-[#e5cc00] no-underline"
                          >
                            💬 카카오톡 문의하기
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 3. 지문 선택 (교재 선택 후) */}
                {selectedTextbook && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">3. 지문 선택</label>
                    {hasLessonData ? (
                      <>
                        {isMockExam ? (
                          /* 모의고사: 강 없이 번호 그리드 */
                          <>
                            <p className="text-xs text-gray-500 mb-3">번호를 클릭해 선택하세요. (18번~45번)</p>
                            <button
                              type="button"
                              onClick={handlePassageAllToggle}
                              className="w-full py-2 px-4 rounded-lg border-2 border-blue-200 bg-blue-50 text-blue-800 text-sm font-medium mb-3 hover:bg-blue-100"
                            >
                              {Object.values(lessonGroups).flat().every((p) => selectedPassages.includes(p)) ? '전체 해제' : '전체 선택'}
                            </button>
                            <div className="flex flex-wrap gap-2">
                              {(lessonGroups[MOCK_PASSAGE_KEY] ?? []).map((p) => {
                                const sel = selectedPassages.includes(p);
                                return (
                                  <button
                                    key={p}
                                    type="button"
                                    onClick={() => togglePassage(p)}
                                    className={`w-14 py-2 rounded-lg text-sm font-semibold border-2 transition-colors ${
                                      sel
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                                    }`}
                                  >
                                    {p}
                                  </button>
                                );
                              })}
                            </div>
                            <p className="text-sm text-gray-600 mt-3"><strong>선택 지문 수:</strong> {selectedPassages.length}개</p>
                          </>
                        ) : (
                          /* 일반 교재: 강별 아코디언 */
                          <>
                            <p className="text-xs text-gray-600 mb-2">강을 클릭하면 해당 강 전체 선택·해제됩니다. 오른쪽 + 로 개별 번호 선택 가능.</p>
                            <button
                              type="button"
                              onClick={handlePassageAllToggle}
                              className="w-full py-2 px-4 rounded-lg border-2 border-blue-200 bg-blue-50 text-blue-800 text-sm font-medium mb-3 hover:bg-blue-100"
                            >
                              {Object.values(lessonGroups).flat().every((p) => selectedPassages.includes(p)) ? '전체 해제' : '전체 선택'}
                            </button>
                            <div className="space-y-2">
                              {Object.entries(lessonGroups).map(([lessonKey, groupLessons]) => {
                                const allSelected = groupLessons.every((p) => selectedPassages.includes(p));
                                const someSelected = groupLessons.some((p) => selectedPassages.includes(p));
                                const isExpanded = expandedLessons.includes(lessonKey);
                                const selectedCount = groupLessons.filter((p) => selectedPassages.includes(p)).length;
                                return (
                                  <div key={lessonKey} className="border rounded-lg bg-gray-50 overflow-hidden">
                                    <div className="flex">
                                      <button
                                        type="button"
                                        onClick={() => toggleLessonGroup(lessonKey)}
                                        className={`flex-1 flex items-center justify-between px-3 py-2.5 text-sm font-medium ${
                                          allSelected ? 'bg-blue-600 text-white' : someSelected ? 'bg-blue-100 text-blue-800' : 'bg-white text-gray-700 hover:bg-gray-100'
                                        }`}
                                      >
                                        <span>{lessonKey}</span>
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-white/80 text-gray-700">{selectedCount}/{groupLessons.length}</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => toggleExpandLesson(lessonKey)}
                                        className="px-3 py-2 border-l border-gray-200 hover:bg-gray-100 text-gray-600"
                                        title="개별 번호"
                                      >
                                        {isExpanded ? '−' : '+'}
                                      </button>
                                    </div>
                                    {isExpanded && (
                                      <div className="px-3 pb-3 pt-1 border-t border-gray-200 bg-white flex flex-wrap gap-1.5">
                                        {groupLessons.map((p) => {
                                          const sel = selectedPassages.includes(p);
                                          return (
                                            <button
                                              key={p}
                                              type="button"
                                              onClick={() => togglePassage(p)}
                                              className={`px-2 py-1 rounded text-xs font-medium ${sel ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                                            >
                                              {p.replace(/^[^\s]+\s/, '')}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <p className="text-sm text-gray-600 mt-2"><strong>선택 지문 수:</strong> {selectedPassages.length}개</p>
                          </>
                        )}
                      </>
                    ) : (
                      <div>
                        <p className="text-xs text-gray-600 mb-2">이 교재는 강·번호 데이터가 없습니다. 지문 수를 직접 입력하세요.</p>
                        <input
                          type="number"
                          min={0}
                          value={manualPassageCount}
                          onChange={(e) => setManualPassageCount(Math.max(0, parseInt(e.target.value, 10) || 0))}
                          placeholder="지문 수"
                          className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="text-sm text-gray-600 mt-2"><strong>지문 수:</strong> {passageCount}개</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 주문하기 */}
                {selected대분류List.length > 0 && selectedTextbook && passageCount > 0 && (
                  <div className="pt-4 border-t">
                    <div className="p-4 rounded-xl bg-gray-50 text-sm text-gray-700 space-y-1 mb-4">
                      <p><strong>선택 대분류</strong> {selected대분류List.length}개 (해당 소분류 전부 포함)</p>
                      {Object.entries(selectedCountBy대분류).map(([대, n]) => (
                        <p key={대} className="text-gray-600"><strong>{대}</strong> 소분류 {n}개</p>
                      ))}
                      <ul className="list-disc list-inside text-gray-600 mt-1">
                        {selectedTypePrices.map((t) => (
                          <li key={`${t.대분류}-${t.소분류}`}>{t.typeCode ? `[${t.typeCode}] ` : ''}{t.소분류}</li>
                        ))}
                      </ul>
                      <p><strong>교재</strong> {selectedTextbook}</p>
                      <p><strong>선택 지문 수</strong> {passageCount}개</p>
                      {priceSummaryBy대분류.length > 0 && (
                        <>
                          <p className="mt-2 pt-2 border-t border-gray-200"><strong>대분류별 지문당 금액</strong> (선택한 상위 1개당 1회)</p>
                          <ul className="text-gray-600 mt-0.5">
                            {priceSummaryBy대분류.map((x) => (
                              <li key={x.대분류}>{x.대분류}: 지문당 {x.price.toLocaleString()}원</li>
                            ))}
                          </ul>
                          <p className="mt-1 text-gray-700">지문당 합계: {sumPerPassage.toLocaleString()}원 × {passageCount}개 지문</p>
                          <p className="mt-0.5 text-blue-700 font-semibold">총 금액: {totalPrice.toLocaleString()}원</p>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleSubmitOrder}
                      disabled={submitting}
                      className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50"
                    >
                      {submitting ? '주문 처리 중…' : '서술형 주문하기'}
                    </button>
                  </div>
                )}
                  </>
                )}
              </div>
            </div>

              {/* 오른쪽 사이드: 기출문제 기반 추천 */}
              {pastExamUploads.length > 0 && (
                <aside className="md:sticky md:top-4">
                  <div className="p-4 rounded-xl bg-sky-50 border border-sky-200 shadow-sm">
                    <p className="text-sm font-semibold text-sky-800 mb-1">★ 기출문제 기반 추천</p>
                    <p className="text-xs text-sky-700 mb-3">기출을 선택하면 해당 시험의 분류 유형을 추천합니다. 클릭 시 선택·다시 클릭 시 해제됩니다.</p>
                    <div className="mb-3">
                      <span className="text-xs font-medium text-sky-700 block mb-1.5">기출문제 선택</span>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedPastExamId(null)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0 ${
                            selectedPastExamId === null
                              ? 'bg-sky-600 text-white border border-sky-600'
                              : 'bg-white text-sky-700 border border-sky-300 hover:bg-sky-100'
                          }`}
                        >
                          전체
                        </button>
                        {pastExamUploads.map((u) => {
                          const name = [u.school, u.grade, u.examYear, u.examType].filter(Boolean).join(' · ') || '기출문제';
                          const isSelected = selectedPastExamId === u.id;
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => setSelectedPastExamId(u.id)}
                              title={u.examScope || name}
                              className={`max-w-[100%] sm:max-w-[240px] truncate px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                isSelected
                                  ? 'bg-sky-600 text-white border border-sky-600'
                                  : 'bg-white text-sky-700 border border-sky-300 hover:bg-sky-100'
                              }`}
                            >
                              {name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {recommended대분류Set.size > 0 ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-sky-700">추천 대분류</span>
                          <button
                            type="button"
                            onClick={selectAllRecommended}
                            className="px-2 py-1 rounded text-xs font-medium bg-sky-100 text-sky-800 hover:bg-sky-200 border border-sky-300"
                          >
                            전체선택
                          </button>
                          <button
                            type="button"
                            onClick={clearAllRecommended}
                            className="px-2 py-1 rounded text-xs font-medium bg-white text-sky-700 hover:bg-sky-50 border border-sky-300"
                          >
                            전체해제
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {[...recommended대분류Set].map((대분류) => {
                            const isApplied = selected대분류List.includes(대분류);
                            return (
                              <button
                                key={대분류}
                                type="button"
                                onClick={() => toggleRecommended대분류(대분류)}
                                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                                  isApplied
                                    ? 'bg-sky-600 text-white border-sky-600'
                                    : 'bg-white text-sky-700 border-sky-300 hover:bg-sky-100'
                                }`}
                              >
                                {대분류}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[11px] text-sky-600">클릭 시 해당 대분류 선택·해제 (소분류 전부 포함)</p>
                      </div>
                    ) : (
                      <p className="text-xs text-sky-600">
                        {selectedPastExamId
                          ? '이 기출문제에는 아직 관리자 분류 유형이 없습니다.'
                          : '관리자가 분류한 유형이 있는 기출문제를 선택해 주세요.'}
                      </p>
                    )}
                  </div>
                </aside>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
