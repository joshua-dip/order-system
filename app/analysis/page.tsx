'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppBar from '../components/AppBar';
import { useTextbooksData } from '@/lib/useTextbooksData';
import { useCurrentUser, filterTextbooksByAllowed } from '@/lib/useCurrentUser';
import { saveOrderToDb } from '@/lib/orders';
import { ORDER_PREFIX } from '@/lib/orderPrefix';
import { isMockExamTextbookKey } from '@/lib/mock-exam-key';

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';
const PRICE_PER_ITEM = 500; // 지문당 500원

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

function pickFirstContent(
  textbookKey: string,
  data: TextbookStructure
): TextbookContent | null {
  const sub = data.Sheet1?.부교재 ?? data['지문 데이터']?.부교재 ?? data.부교재;
  if (!sub) return null;
  if (sub[textbookKey]) return sub[textbookKey];
  const keys = Object.keys(sub);
  return keys.length > 0 ? sub[keys[0]] : null;
}

export default function AnalysisPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);

  const { data: textbooksData, loading: dataLoading, error: dataError } = useTextbooksData();
  const currentUser = useCurrentUser();

  const [selectedTextbook, setSelectedTextbook] = useState('');
  const [lessonGroups, setLessonGroups] = useState<Record<string, string[]>>({});
  const [selectedLessons, setSelectedLessons] = useState<string[]>([]);
  const [expandedLessons, setExpandedLessons] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  /** 자료 받을 이메일 — 계정 이메일을 미리 채워 둔다(오타로 엉뚱한 데 가는 것을 막는다) */
  const [email, setEmail] = useState('');
  const [emailAutoFilled, setEmailAutoFilled] = useState(false);
  /** 사용할 포인트 — 다른 주문서(서술형·변형문제)와 같은 방식 */
  const [pointsToUse, setPointsToUse] = useState(0);

  const allowedTextbooksAnalysis = currentUser?.allowedTextbooksAnalysis;
  const textbookList =
    textbooksData && allowedTextbooksAnalysis !== undefined
      ? filterTextbooksByAllowed(Object.keys(textbooksData), allowedTextbooksAnalysis)
      : [];

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        const isMember = !!data?.user;
        setAuthorized(isMember);
        setHasAccess(isMember && !!data?.user?.canAccessAnalysis);
        /* 변형문제 주문서와 같은 방식 — 계정 이메일을 넣어 두되, 이미 적었으면 두지 않는다. */
        const accountEmail = typeof data?.user?.email === 'string' ? data.user.email.trim() : '';
        if (accountEmail) {
          setEmail((prev) => {
            if (prev.trim()) return prev;
            setEmailAutoFilled(true);
            return accountEmail;
          });
        }
      })
      .catch(() => {
        setAuthorized(false);
        setHasAccess(false);
      })
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!textbooksData || !selectedTextbook || !textbooksData[selectedTextbook]) {
      setLessonGroups({});
      setSelectedLessons([]);
      setExpandedLessons([]);
      return;
    }
    const textbookData = textbooksData[selectedTextbook] as TextbookStructure;
    const actualData = pickFirstContent(selectedTextbook, textbookData);
    if (actualData) {
      const groups: Record<string, string[]> = {};
      Object.keys(actualData).forEach((lessonKey) => {
        const lessonData = actualData[lessonKey];
        if (Array.isArray(lessonData)) {
          groups[lessonKey] = lessonData.map(
            (item: LessonItem) => `${lessonKey} ${item.번호}`
          );
        }
      });
      setLessonGroups(groups);
      setSelectedLessons([]);
      setExpandedLessons([]);
    } else {
      setLessonGroups({});
      setSelectedLessons([]);
    }
  }, [selectedTextbook, textbooksData]);

  const handleLessonChange = (lesson: string) => {
    setSelectedLessons((prev) =>
      prev.includes(lesson) ? prev.filter((l) => l !== lesson) : [...prev, lesson]
    );
  };

  const handleLessonGroupToggle = (lessonKey: string) => {
    const groupLessons = lessonGroups[lessonKey] || [];
    const allSelected = groupLessons.every((l) => selectedLessons.includes(l));
    if (allSelected) {
      setSelectedLessons((prev) => prev.filter((l) => !groupLessons.includes(l)));
    } else {
      setSelectedLessons((prev) => {
        const filtered = prev.filter((l) => !groupLessons.includes(l));
        return [...filtered, ...groupLessons];
      });
    }
  };

  const handleLessonExpand = (lessonKey: string) => {
    setExpandedLessons((prev) =>
      prev.includes(lessonKey) ? prev.filter((k) => k !== lessonKey) : [...prev, lessonKey]
    );
  };

  const handleSubmitOrder = async () => {
    if (!selectedTextbook) {
      alert('교재를 선택해주세요.');
      return;
    }
    if (selectedLessons.length === 0) {
      alert('강과 번호를 1개 이상 선택해주세요.');
      return;
    }
    /* 자료가 메일로 나가므로 주소가 없으면 주문을 받을 수 없다. */
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      alert('자료 받으실 이메일 주소를 정확히 입력해주세요.');
      return;
    }
    const totalPrice = selectedLessons.length * PRICE_PER_ITEM;
    const prefix = isMockExamTextbookKey(selectedTextbook)
      ? ORDER_PREFIX.MOCK_ANALYSIS
      : ORDER_PREFIX.BOOK_ANALYSIS;

    const userPoints =
      typeof currentUser?.points === 'number' && currentUser.points >= 0 ? currentUser.points : 0;
    const effectivePointsUsed = Math.min(pointsToUse, userPoints, totalPrice);
    const finalAmount = totalPrice - effectivePointsUsed;
    /* 포인트를 쓰면 「입금하실 금액」을 명시한다 — 매출 집계도 이 줄을 읽는다. */
    const pointLine =
      effectivePointsUsed > 0
        ? `\n5. 포인트 사용: ${effectivePointsUsed.toLocaleString()}원\n6. 입금하실 금액: ${finalAmount.toLocaleString()}원 (총 ${totalPrice.toLocaleString()}원 − 포인트 ${effectivePointsUsed.toLocaleString()}원)`
        : '';

    const orderText = `분석지 주문서 (PDF 제공)

교재: ${selectedTextbook}

자료 받으실 이메일 주소: ${email.trim()}

1. 강과 번호
: ${selectedLessons.join(', ')}

2. 지문 수: ${selectedLessons.length}개
3. 단가: 지문당 ${PRICE_PER_ITEM.toLocaleString()}원
4. 금액: ${totalPrice.toLocaleString()}원${pointLine}

※ 분석지는 PDF 파일로만 우선 제공합니다.`;

    setSubmitting(true);
    try {
      const res = await saveOrderToDb(orderText, prefix, effectivePointsUsed || undefined);
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
        <AppBar />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar />
      <div className="min-h-screen py-8 px-4" style={{ backgroundColor: '#F5F5F5' }}>
        <div className="max-w-2xl mx-auto">
          <p className="mb-4">
            <Link href="/" className="text-sm font-medium text-blue-600 hover:underline">
              ← 메인 화면으로
            </Link>
          </p>

          {!authorized ? (
            <div className="text-center bg-white rounded-xl shadow p-8">
              <h1 className="text-2xl font-bold text-gray-800 mb-2">분석지 주문제작</h1>
              <p className="text-gray-600 mb-6">분석지 주문제작은 회원 전용 서비스입니다.</p>
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
              <h1 className="text-2xl font-bold text-gray-800 mb-2">분석지 주문제작</h1>
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
                <h1 className="text-2xl font-bold text-gray-800 mb-2">분석지 주문제작</h1>
                <p className="text-gray-600 text-sm mb-2">
                  허용된 교재 중에서 강과 번호별로 분석지를 주문할 수 있습니다.
                </p>
                <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm font-medium">
                  분석지는 PDF 파일로만 우선 제공합니다. · 지문당 {PRICE_PER_ITEM.toLocaleString()}원
                </p>
              </div>

              {dataLoading ? (
                <div className="p-8 text-center text-gray-500">교재 목록 불러오는 중…</div>
              ) : dataError || !textbooksData ? (
                <div className="p-8 text-center text-red-600">교재 데이터를 불러올 수 없습니다.</div>
              ) : textbookList.length === 0 ? (
                <div className="p-8 text-center text-gray-600">
                  허용된 교재가 없습니다. 관리자에게 교재 허용 목록을 요청해 주세요.
                </div>
              ) : (
                <div className="p-6 space-y-6">
                  {/* 1. 교재 선택 */}
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">1. 교재 선택</label>
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

                  {/* 2. 강과 번호 선택 */}
                  {selectedTextbook && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        2. 강과 번호 선택 (지문당 {PRICE_PER_ITEM.toLocaleString()}원)
                      </label>
                      <p className="text-xs text-gray-500 mb-3">
                        왼쪽 클릭: 강 전체 선택/해제 · + 버튼: 개별 번호 선택
                      </p>
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {Object.entries(lessonGroups).map(([lessonKey, groupLessons]) => {
                          const allSelected = groupLessons.every((l) => selectedLessons.includes(l));
                          const someSelected = groupLessons.some((l) => selectedLessons.includes(l));
                          const selectedCount = groupLessons.filter((l) => selectedLessons.includes(l)).length;
                          const isExpanded = expandedLessons.includes(lessonKey);
                          return (
                            <div key={lessonKey} className="border rounded-xl bg-gray-50 overflow-hidden">
                              <div className="flex">
                                <button
                                  type="button"
                                  onClick={() => handleLessonGroupToggle(lessonKey)}
                                  className={`flex-1 flex items-center justify-between px-4 py-3 text-left font-medium rounded-l-xl ${
                                    allSelected
                                      ? 'bg-blue-600 text-white'
                                      : someSelected
                                        ? 'bg-blue-100 text-blue-800'
                                        : 'bg-white text-gray-700 hover:bg-gray-100'
                                  }`}
                                >
                                  <span className="font-bold">{lessonKey}</span>
                                  <span className="text-sm">
                                    {selectedCount}/{groupLessons.length}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleLessonExpand(lessonKey)}
                                  className={`px-3 py-3 border-l ${
                                    isExpanded ? 'bg-indigo-100 text-indigo-700' : 'bg-white text-gray-500 hover:bg-gray-100'
                                  }`}
                                >
                                  {isExpanded ? '−' : '+'}
                                </button>
                              </div>
                              {isExpanded && (
                                <div className="px-4 pb-3 pt-1 border-t bg-white grid grid-cols-4 gap-2">
                                  {groupLessons.map((lesson) => (
                                    <label key={lesson} className="flex items-center gap-2 cursor-pointer text-sm text-black">
                                      <input
                                        type="checkbox"
                                        checked={selectedLessons.includes(lesson)}
                                        onChange={() => handleLessonChange(lesson)}
                                        className="rounded text-blue-600"
                                      />
                                      <span className="text-black">{lesson.split(' ')[1]}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 요약 및 주문 */}
                  {selectedLessons.length > 0 && (
                    <div className="pt-4 border-t">
                      <p className="text-gray-700 font-medium mb-1">
                        선택 지문 {selectedLessons.length}개 × {PRICE_PER_ITEM.toLocaleString()}원 ={' '}
                        <span className="text-blue-600 font-bold">
                          {(selectedLessons.length * PRICE_PER_ITEM).toLocaleString()}원
                        </span>
                      </p>
                      {/* 포인트 사용 — 다른 주문서와 같은 방식(보유분·주문금액 안에서만) */}
                      {(currentUser?.points ?? 0) > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <label className="block text-sm text-gray-700 font-medium mb-1">
                            포인트 사용 (보유: {(currentUser?.points ?? 0).toLocaleString()} P)
                          </label>
                          <input
                            type="number"
                            min={0}
                            max={Math.min(currentUser?.points ?? 0, selectedLessons.length * PRICE_PER_ITEM)}
                            value={pointsToUse || ''}
                            onChange={(e) => setPointsToUse(Math.max(0, parseInt(e.target.value, 10) || 0))}
                            placeholder="0"
                            className="w-32 border border-gray-300 rounded-lg px-3 py-2 text-gray-800 text-sm"
                          />
                          <span className="ml-2 text-gray-500 text-sm">원</span>
                          {pointsToUse > 0 && (
                            <p className="mt-1.5 text-green-700 font-semibold text-sm">
                              입금하실 금액:{' '}
                              {(
                                selectedLessons.length * PRICE_PER_ITEM -
                                Math.min(
                                  pointsToUse,
                                  currentUser?.points ?? 0,
                                  selectedLessons.length * PRICE_PER_ITEM,
                                )
                              ).toLocaleString()}
                              원
                            </p>
                          )}
                        </div>
                      )}
                      <div className="mt-3">
                        <label className="block text-sm font-medium text-gray-800 mb-1">
                          자료 받으실 이메일 <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            setEmailAutoFilled(false);   // 직접 고치기 시작하면 안내는 내린다
                          }}
                          placeholder="example@email.com"
                          className="w-full border-2 border-gray-300 rounded-lg px-4 py-2.5 text-black focus:outline-none focus:ring-4 focus:ring-blue-200 focus:border-blue-500"
                          required
                        />
                        {emailAutoFilled && email.trim() ? (
                          <p className="text-[11px] text-blue-700 mt-1.5">
                            가입하신 주소를 넣어뒀어요. 다른 주소로 받으시려면 고쳐 주세요.
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={handleSubmitOrder}
                        disabled={submitting}
                        className="mt-3 w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 disabled:opacity-50"
                      >
                        {submitting ? '주문 처리 중…' : '분석지 주문하기'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
