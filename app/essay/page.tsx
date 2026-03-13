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

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com';

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

  const selectedTypePrices = selected대분류 && selected소분류.length > 0
    ? subCategories.filter((t) => selected소분류.includes(t.소분류)).map((t) => ({ 소분류: t.소분류, typeCode: t.typeCode, price: t.price ?? 0 }))
    : [];
  const totalPrice = selectedTypePrices.reduce((sum, t) => sum + t.price, 0);

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

  const applyRecommendedCategory = (categoryLabel: string) => {
    const [대, 소] = categoryLabel.split(' > ').map((s) => s.trim());
    if (!대 || !소 || !allTypeKeys.has(categoryLabel)) return;
    setSelected대분류(대);
    setSelected소분류((prev) => (prev.includes(소) ? prev : [...prev, 소]));
  };

  const handleSubmitOrder = async () => {
    if (!selected대분류 || selected소분류.length === 0) {
      alert('대분류와 소분류를 모두 선택해주세요.');
      return;
    }
    if (!selectedTextbook) {
      alert('교재를 선택해주세요.');
      return;
    }

    const prefix =
      selectedTextbook.startsWith('고1_') ||
      selectedTextbook.startsWith('고2_') ||
      selectedTextbook.startsWith('고3_')
        ? ORDER_PREFIX.MOCK_ESSAY
        : ORDER_PREFIX.BOOK_ESSAY;

    const orderText = `서술형 주문서

1. 대분류: ${selected대분류}
2. 소분류:\n${selected소분류.map((s) => `   - ${s}`).join('\n')}
3. 교재: ${selectedTextbook}
4. 유형별 금액:\n${selectedTypePrices.map((t) => `   - ${t.typeCode ? `[${t.typeCode}] ` : ''}${t.소분류}: ${t.price.toLocaleString()}원`).join('\n')}
5. 총 금액: ${totalPrice.toLocaleString()}원`;

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
        <div className="max-w-2xl mx-auto">
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
                {/* 기출문제 기반 추천 (관리자 분류 유형) */}
                {pastExamUploads.length > 0 && (
                  <div className="p-4 rounded-xl bg-sky-50 border border-sky-200">
                    <p className="text-sm font-semibold text-sky-800 mb-2">📌 기출문제 기반 추천</p>
                    <p className="text-xs text-sky-700 mb-3">아래에서 기출문제를 선택하면, 해당 시험에서 관리자가 분류한 유형으로 추천받을 수 있습니다.</p>
                    <div className="mb-3">
                      <span className="text-xs font-medium text-sky-700 mr-2">기출문제 선택:</span>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedPastExamId(null)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
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
                              className={`max-w-full truncate px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
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
                      <div className="flex flex-wrap gap-2">
                        {recommendedFromPastExams.map((label) => {
                          const [대, 소] = label.split(' > ').map((s) => s.trim());
                          const isApplied = selected대분류 === 대 && selected소분류.includes(소);
                          return (
                            <button
                              key={label}
                              type="button"
                              onClick={() => applyRecommendedCategory(label)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                                isApplied
                                  ? 'bg-sky-600 text-white border border-sky-600'
                                  : 'bg-white text-sky-700 border border-sky-300 hover:bg-sky-100'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-sky-600">
                        {selectedPastExamId
                          ? '이 기출문제에는 아직 관리자 분류 유형이 없습니다.'
                          : '관리자가 분류한 유형이 있는 기출문제를 선택해 주세요.'}
                      </p>
                    )}
                  </div>
                )}

                {/* 1. 대분류 선택 */}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-3">1. 대분류 선택</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {essayTypesGrouped.map((g) => (
                      <button
                        key={g.대분류}
                        type="button"
                        onClick={() => setSelected대분류(g.대분류)}
                        className={`text-left px-4 py-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                          selected대분류 === g.대분류
                            ? 'border-blue-600 bg-blue-50 text-blue-800'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {g.대분류}
                      </button>
                    ))}
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

                {/* 주문하기 */}
                {selected대분류 && selected소분류.length > 0 && selectedTextbook && (
                  <div className="pt-4 border-t">
                    <div className="p-4 rounded-xl bg-gray-50 text-sm text-gray-700 space-y-1 mb-4">
                      <p><strong>대분류</strong> {selected대분류}</p>
                      <p><strong>소분류</strong> {selected소분류.length}개 선택</p>
                      <ul className="list-disc list-inside text-gray-600 mt-1">
                        {selected소분류.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                      <p><strong>교재</strong> {selectedTextbook}</p>
                      {selectedTypePrices.length > 0 && (
                        <>
                          <p className="mt-2 pt-2 border-t border-gray-200"><strong>유형별 금액</strong></p>
                          <ul className="text-gray-600 mt-0.5">
                            {selectedTypePrices.map((t) => (
                              <li key={t.소분류}>{t.typeCode ? `[${t.typeCode}] ` : ''}{t.소분류}: {t.price.toLocaleString()}원</li>
                            ))}
                          </ul>
                          <p className="mt-1 text-blue-700 font-semibold">총 금액: {totalPrice.toLocaleString()}원</p>
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
          )}
        </div>
      </div>
    </>
  );
}
