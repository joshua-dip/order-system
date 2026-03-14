'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppBar from '../components/AppBar';
import { useTextbooksData } from '@/lib/useTextbooksData';
import { useCurrentUser, filterTextbooksByAllowed } from '@/lib/useCurrentUser';
import { saveOrderToDb } from '@/lib/orders';
import { ORDER_PREFIX } from '@/lib/orderPrefix';
import { ESSAY_CATEGORIES } from '../data/essay-categories';

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

interface EssayTypeItem {
  id: string;
  대분류: string;
  소분류: string;
  typeCode?: string;
  문제?: string;
  태그?: string[];
  조건?: string;
  price?: number;
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

  const [selected대분류, setSelected대분류] = useState('');
  const [selected소분류, setSelected소분류] = useState<string[]>([]);
  const [selectedTextbook, setSelectedTextbook] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [pastExamUploads, setPastExamUploads] = useState<{ id: string; school: string; grade: string; examYear: string; examType: string; examScope: string; adminCategories: string[] }[]>([]);
  const [selectedPastExamId, setSelectedPastExamId] = useState<string | null>(null);
  const [essayTypes, setEssayTypes] = useState<EssayTypeItem[]>([]);
  const [lessonGroups, setLessonGroups] = useState<Record<string, string[]>>({});
  const [selectedPassages, setSelectedPassages] = useState<string[]>([]);
  const [expandedLessons, setExpandedLessons] = useState<string[]>([]);
  const [manualPassageCount, setManualPassageCount] = useState<number>(0);

  const allowedTextbooksEssay = currentUser?.allowedTextbooksEssay;
  const textbookList =
    textbooksData && allowedTextbooksEssay !== undefined
      ? filterTextbooksByAllowed(Object.keys(textbooksData), allowedTextbooksEssay)
      : [];

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

  const essayTypesGrouped = essayTypes.length > 0
    ? Object.entries(essayTypes.reduce<Record<string, EssayTypeItem[]>>((acc, t) => {
        const key = t.대분류 || '(미분류)';
        if (!acc[key]) acc[key] = [];
        acc[key].push(t);
        return acc;
      }, {})).map(([대분류, types]) => ({ 대분류, types: sortTypesWithTypeCodeFirst(types) }))
    : ESSAY_CATEGORIES.map((c) => ({ 대분류: c.대분류, types: c.소분류.map((소) => ({ id: '', 대분류: c.대분류, 소분류: 소 } as EssayTypeItem)) }));

  const subCategories = selected대분류
    ? (essayTypesGrouped.find((g) => g.대분류 === selected대분류)?.types ?? [])
    : [];

  // 대분류별 선택된 소분류 개수 (다른 대분류 선택해도 기존 선택 개수 표시용)
  const selectedCountBy대분류 = essayTypesGrouped.reduce<Record<string, number>>((acc, g) => {
    const count = g.types.filter((t) => selected소분류.includes(t.소분류)).length;
    if (count > 0) acc[g.대분류] = count;
    return acc;
  }, {});

  // 선택된 모든 소분류에 대해 유형·지문당 금액 계산 (price = 지문당 금액)
  const selectedTypePrices = selected소분류.length > 0
    ? essayTypesGrouped.flatMap((g) =>
        g.types.filter((t) => selected소분류.includes(t.소분류)).map((t) => ({ 대분류: g.대분류, 소분류: t.소분류, typeCode: t.typeCode, price: t.price ?? 0 }))
      )
    : [];
  const sumPerPassage = selectedTypePrices.reduce((sum, t) => sum + t.price, 0);
  const hasLessonData = Object.keys(lessonGroups).length > 0;
  const passageCount = hasLessonData ? selectedPassages.length : Math.max(0, manualPassageCount);
  const totalPrice = sumPerPassage * passageCount;

  const allTypeKeys = essayTypes.length > 0
    ? new Set(essayTypes.map((t) => `${t.대분류} > ${t.소분류}`))
    : new Set(ESSAY_CATEGORIES.flatMap((c) => c.소분류.map((s) => `${c.대분류} > ${s}`)));

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

  useEffect(() => {
    if (!selected대분류) setSelected소분류([]);
  }, [selected대분류]);

  // 교재 선택 시 지문(강·번호) 목록 로드
  useEffect(() => {
    if (!selectedTextbook || !textbooksData?.[selectedTextbook]) {
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
  }, [selectedTextbook, textbooksData]);

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

  const selectAllRecommended = () => {
    const toAdd = recommendedFromPastExams
      .map((label) => label.split(' > ').map((s) => s.trim()))
      .filter(([대, 소]) => 대 && 소 && allTypeKeys.has(`${대} > ${소}`))
      .map(([, 소]) => 소)
      .filter((소) => !selected소분류.includes(소));
    if (toAdd.length > 0) {
      setSelected소분류((prev) => [...new Set([...prev, ...toAdd])]);
      const first = recommendedFromPastExams[0]?.split(' > ').map((s) => s.trim());
      if (first?.[0]) setSelected대분류(first[0]);
    }
  };
  const clearAllRecommended = () => {
    const recommendedSet = new Set(recommendedFromPastExams.map((l) => l.split(' > ').map((s) => s.trim()).join(' > ')));
    const toRemove = essayTypesGrouped.flatMap((g) =>
      g.types.filter((t) => recommendedSet.has(`${g.대분류} > ${t.소분류}`)).map((t) => t.소분류)
    );
    setSelected소분류((prev) => prev.filter((s) => !toRemove.includes(s)));
    if (selected소분류.every((s) => toRemove.includes(s))) setSelected대분류('');
  };
  const selectAllInRecommendedCategory = (대분류: string) => {
    const 소분류들 = recommendedFromPastExams
      .map((label) => label.split(' > ').map((s) => s.trim()))
      .filter(([대]) => 대 === 대분류)
      .map(([, 소]) => 소)
      .filter((소): 소 is string => !!소);
    const toAdd = 소분류들.filter((소) => !selected소분류.includes(소));
    if (toAdd.length > 0) {
      setSelected소분류((prev) => [...new Set([...prev, ...toAdd])]);
      setSelected대분류(대분류);
    }
  };
  const clearAllInRecommendedCategory = (대분류: string) => {
    const 소분류들 = recommendedFromPastExams
      .map((label) => label.split(' > ').map((s) => s.trim()))
      .filter(([대]) => 대 === 대분류)
      .map(([, 소]) => 소)
      .filter((소): 소 is string => !!소);
    setSelected소분류((prev) => {
      const next = prev.filter((s) => !소분류들.includes(s));
      if (next.length === 0) setSelected대분류('');
      return next;
    });
  };

  const applyRecommendedCategory = (categoryLabel: string) => {
    const [대, 소] = categoryLabel.split(' > ').map((s) => s.trim());
    if (!대 || !소 || !allTypeKeys.has(categoryLabel)) return;
    const isCurrentlySelected = selected소분류.includes(소);
    if (isCurrentlySelected) {
      setSelected소분류((prev) => {
        const next = prev.filter((s) => s !== 소);
        if (next.length === 0) setSelected대분류('');
        return next;
      });
    } else {
      setSelected대분류(대);
      setSelected소분류((prev) => (prev.includes(소) ? prev : [...prev, 소]));
    }
  };

  const handleSubmitOrder = async () => {
    if (selected소분류.length === 0) {
      alert('소분류를 1개 이상 선택해주세요.');
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
    const orderLines = Object.entries(by대분류).flatMap(([대, items]) => [
      `[${대}]`,
      ...items.map((t) => `   - ${t.typeCode ? `[${t.typeCode}] ` : ''}${t.소분류}: 지문당 ${t.price.toLocaleString()}원`),
    ]);

    const orderText = `서술형 주문서

1. 대분류·소분류 및 유형별 지문당 금액:\n${orderLines.join('\n')}
2. 선택 지문 수: ${passageCount}개
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
                    카테고리(대분류·소분류)를 먼저 선택한 뒤, 교재를 선택해 주문하세요.
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
                {/* 1. 대분류 선택 */}
                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <label className="text-sm font-semibold text-gray-700">1. 대분류 선택</label>
                    {selected소분류.length > 0 && (
                      <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                        총 {selected소분류.length}개 유형 선택됨
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {essayTypesGrouped.map((g) => {
                      const count = selectedCountBy대분류[g.대분류] ?? 0;
                      return (
                        <button
                          key={g.대분류}
                          type="button"
                          onClick={() => setSelected대분류(g.대분류)}
                          className={`text-left px-4 py-3 rounded-xl border-2 text-sm font-medium transition-colors flex items-center justify-between gap-2 ${
                            selected대분류 === g.대분류
                              ? 'border-blue-600 bg-blue-50 text-blue-800'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                          }`}
                        >
                          <span>{g.대분류}</span>
                          {count > 0 && (
                            <span className={`shrink-0 min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-semibold flex items-center justify-center ${
                              selected대분류 === g.대분류 ? 'bg-blue-600 text-white' : 'bg-sky-100 text-sky-800'
                            }`}>
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. 소분류 선택 (복수 선택 가능) */}
                {selected대분류 && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-3">2. 소분류 선택 (원하는 항목을 모두 선택)</label>
                    <div className="space-y-3">
                      {subCategories.map((t) => {
                        const isSelected = selected소분류.includes(t.소분류);
                        return (
                          <button
                            key={t.id || t.소분류}
                            type="button"
                            onClick={() => {
                              setSelected소분류((prev) =>
                                isSelected ? prev.filter((s) => s !== t.소분류) : [...prev, t.소분류]
                              );
                            }}
                            className={`w-full text-left px-4 py-3 rounded-xl border-2 text-sm transition-colors ${
                              isSelected
                                ? 'border-blue-600 bg-blue-50 text-blue-800'
                                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex items-center gap-2 flex-wrap">
                              {t.typeCode && <span className="text-xs font-mono text-gray-500">{t.typeCode}</span>}
                              <span className="font-medium">{t.소분류}</span>
                            </div>
                            {t.문제 && <p className="text-gray-500 text-xs mt-1.5 leading-relaxed">{t.문제}</p>}
                            {t.태그?.length ? (
                              <p className="text-gray-400 text-xs mt-1 flex flex-wrap gap-1">
                                {t.태그.map((tag) => (
                                  <span key={tag} className="bg-gray-200 px-1.5 py-0.5 rounded">#{tag}</span>
                                ))}
                              </p>
                            ) : null}
                            {t.조건 && <p className="text-gray-500 text-xs mt-1 border-t border-gray-100 pt-1.5"><strong>&lt;조건&gt;</strong> {t.조건}</p>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 3. 교재 선택 */}
                {dataLoading ? (
                  <p className="text-gray-500 text-sm">교재 목록 불러오는 중…</p>
                ) : textbookList.length === 0 ? (
                  <p className="text-gray-600 text-sm">허용된 교재가 없습니다. 관리자에게 교재 허용 목록을 요청해 주세요.</p>
                ) : (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">3. 교재 선택</label>
                    <select
                      value={selectedTextbook}
                      onChange={(e) => setSelectedTextbook(e.target.value)}
                      className="w-full border-2 border-gray-300 rounded-lg px-4 py-3 text-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">교재를 선택하세요</option>
                      {textbookList.map((key) => (
                        <option key={key} value={key}>
                          {key}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* 4. 지문 선택 (교재 선택 후) */}
                {selectedTextbook && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">4. 지문 선택</label>
                    {hasLessonData ? (
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
                {selected소분류.length > 0 && selectedTextbook && passageCount > 0 && (
                  <div className="pt-4 border-t">
                    <div className="p-4 rounded-xl bg-gray-50 text-sm text-gray-700 space-y-1 mb-4">
                      <p><strong>선택 유형</strong> {selected소분류.length}개</p>
                      {Object.entries(selectedCountBy대분류).map(([대, n]) => (
                        <p key={대} className="text-gray-600"><strong>{대}</strong> {n}개</p>
                      ))}
                      <ul className="list-disc list-inside text-gray-600 mt-1">
                        {selectedTypePrices.map((t) => (
                          <li key={`${t.대분류}-${t.소분류}`}>{t.typeCode ? `[${t.typeCode}] ` : ''}{t.소분류}</li>
                        ))}
                      </ul>
                      <p><strong>교재</strong> {selectedTextbook}</p>
                      <p><strong>선택 지문 수</strong> {passageCount}개</p>
                      {selectedTypePrices.length > 0 && (
                        <>
                          <p className="mt-2 pt-2 border-t border-gray-200"><strong>유형별 지문당 금액</strong></p>
                          <ul className="text-gray-600 mt-0.5">
                            {selectedTypePrices.map((t) => (
                              <li key={`${t.대분류}-${t.소분류}`}>{t.typeCode ? `[${t.typeCode}] ` : ''}{t.소분류}: 지문당 {t.price.toLocaleString()}원</li>
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
                    {recommendedFromPastExams.length > 0 ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-sky-700">추천 유형</span>
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
                        {(() => {
                          const by대분류 = recommendedFromPastExams.reduce<Record<string, string[]>>((acc, label) => {
                            const [대, 소] = label.split(' > ').map((s) => s.trim());
                            if (!대 || !소) return acc;
                            if (!acc[대]) acc[대] = [];
                            if (!acc[대].includes(소)) acc[대].push(소);
                            return acc;
                          }, {});
                          return Object.entries(by대분류).map(([대분류, 소분류들]) => (
                            <div key={대분류} className="bg-white/70 rounded-lg p-2.5 border border-sky-200/80">
                              <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-1 border-b border-sky-200">
                                <p className="text-xs font-semibold text-sky-800">{대분류}</p>
                                <div className="flex gap-1">
                                  <button
                                    type="button"
                                    onClick={() => selectAllInRecommendedCategory(대분류)}
                                    className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-sky-100 text-sky-800 hover:bg-sky-200"
                                  >
                                    전체선택
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => clearAllInRecommendedCategory(대분류)}
                                    className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-white text-sky-600 hover:bg-sky-50 border border-sky-200"
                                  >
                                    전체해제
                                  </button>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {소분류들.map((소분류) => {
                                  const label = `${대분류} > ${소분류}`;
                                  const isApplied = selected소분류.includes(소분류);
                                  return (
                                    <button
                                      key={label}
                                      type="button"
                                      onClick={() => applyRecommendedCategory(label)}
                                      title={소분류}
                                      className={`text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                                        isApplied
                                          ? 'bg-sky-600 text-white border-sky-600'
                                          : 'bg-white text-sky-700 border-sky-300 hover:bg-sky-100'
                                      }`}
                                    >
                                      <span className="line-clamp-2 max-w-[240px]">{소분류}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ));
                        })()}
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
