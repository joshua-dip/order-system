'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppBar from '../components/AppBar';
import { useTextbooksData } from '@/lib/useTextbooksData';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { saveOrderToDb, MEMBER_DEPOSIT_ACCOUNT, ORDER_FOOTER_MESSAGE } from '@/lib/orders';
import { ORDER_PREFIX } from '@/lib/orderPrefix';

/* ────────── 타입 ────────── */

interface LessonItem { 번호: string }
interface TextbookContent { [lessonKey: string]: LessonItem[] }
interface TextbookStructure {
  Sheet1?: { 부교재?: Record<string, TextbookContent> };
  '지문 데이터'?: { 부교재?: Record<string, TextbookContent> };
  부교재?: Record<string, TextbookContent>;
}

/* ────────── 상수 ────────── */

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

const VOCABULARY_PACKAGES = [
  {
    id: 'basic',
    name: '기본형',
    description: '단어 + 뜻',
    price: 300,
  },
  {
    id: 'detailed',
    name: '상세형',
    description: '단어 + 뜻 + 동의어 + 반의어',
    price: 500,
  },
] as const;

/* ────────── 유틸 ────────── */

function pickFirstContent(key: string, data: TextbookStructure): TextbookContent | null {
  const sub = data.Sheet1?.부교재 ?? data['지문 데이터']?.부교재 ?? data.부교재;
  if (!sub) return null;
  if (sub[key]) return sub[key];
  const keys = Object.keys(sub);
  return keys.length > 0 ? sub[keys[0]] : null;
}

/* ────────── 페이지 ────────── */

export default function VocabularyOrderPage() {
  const router = useRouter();
  const { data: textbooksData, loading: dataLoading, error: dataError } = useTextbooksData();
  const currentUser = useCurrentUser();

  /* ── auth ── */
  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setAuthorized(!!d?.user))
      .catch(() => setAuthorized(false))
      .finally(() => setChecking(false));
  }, []);

  /* ── 교재 목록 ── */
  const textbookList = useMemo(() => {
    if (!textbooksData || !currentUser) return [];
    const allKeys = Object.keys(textbooksData).filter(
      (k) => !k.startsWith('고1_') && !k.startsWith('고2_') && !k.startsWith('고3_'),
    );
    const allowed = currentUser.allowedTextbooks;
    if (!allowed || allowed.length === 0) return allKeys;
    const set = new Set(allowed);
    return allKeys.filter((k) => set.has(k));
  }, [textbooksData, currentUser]);

  /* ── 교재·강·번호 선택 ── */
  const [selectedTextbook, setSelectedTextbook] = useState('');
  const [lessonGroups, setLessonGroups] = useState<Record<string, string[]>>({});
  const [selectedLessons, setSelectedLessons] = useState<string[]>([]);
  const [expandedLessons, setExpandedLessons] = useState<string[]>([]);

  useEffect(() => {
    if (!textbooksData || !selectedTextbook || !textbooksData[selectedTextbook]) {
      setLessonGroups({});
      setSelectedLessons([]);
      setExpandedLessons([]);
      return;
    }
    const td = textbooksData[selectedTextbook] as TextbookStructure;
    const content = pickFirstContent(selectedTextbook, td);
    if (!content) { setLessonGroups({}); return; }
    const groups: Record<string, string[]> = {};
    Object.keys(content).forEach((lk) => {
      const arr = content[lk];
      if (Array.isArray(arr)) groups[lk] = arr.map((it) => `${lk} ${it.번호}`);
    });
    setLessonGroups(groups);
    setSelectedLessons([]);
    setExpandedLessons([]);
  }, [selectedTextbook, textbooksData]);

  const allLessonsFlat = useMemo(() => Object.values(lessonGroups).flat(), [lessonGroups]);

  const handleLessonChange = (l: string) =>
    setSelectedLessons((p) => p.includes(l) ? p.filter((x) => x !== l) : [...p, l]);

  const handleLessonGroupToggle = (lk: string) => {
    const group = lessonGroups[lk] || [];
    const allSel = group.every((l) => selectedLessons.includes(l));
    if (allSel) setSelectedLessons((p) => p.filter((l) => !group.includes(l)));
    else setSelectedLessons((p) => { const s = new Set(p); group.forEach((l) => s.add(l)); return [...s]; });
  };

  const handleLessonExpand = (lk: string) =>
    setExpandedLessons((p) => p.includes(lk) ? p.filter((k) => k !== lk) : [...p, lk]);

  const handleAllLessonsToggle = () => {
    if (selectedLessons.length === allLessonsFlat.length) setSelectedLessons([]);
    else setSelectedLessons([...allLessonsFlat]);
  };

  /* ── 패키지·이메일·주문 ── */
  const [selectedPackage, setSelectedPackage] = useState<'basic' | 'detailed'>('basic');
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const pkg = VOCABULARY_PACKAGES.find((p) => p.id === selectedPackage)!;
  const totalPrice = selectedLessons.length * pkg.price;

  const handleSubmit = async () => {
    if (!selectedTextbook) { alert('교재를 선택해주세요.'); return; }
    if (selectedLessons.length === 0) { alert('강과 번호를 1개 이상 선택해주세요.'); return; }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      alert('올바른 이메일 주소를 입력해주세요.'); return;
    }

    const lines = [
      `단어장 주문서`,
      ``,
      `교재: ${selectedTextbook}`,
      `이메일: ${email.trim()}`,
      ``,
      `1. 강과 번호 (${selectedLessons.length}개)`,
      `: ${selectedLessons.join(', ')}`,
      ``,
      `2. 단어장 유형`,
      `: ${pkg.name} — ${pkg.description} (지문당 ${pkg.price.toLocaleString()}원)`,
      ``,
      `3. 가격`,
      `: ${selectedLessons.length}지문 × ${pkg.price.toLocaleString()}원 = ${totalPrice.toLocaleString()}원`,
    ];

    if (authorized) {
      lines.push(``, `입금 계좌: ${MEMBER_DEPOSIT_ACCOUNT}`, ``, ORDER_FOOTER_MESSAGE);
    }

    const orderText = lines.join('\n');
    const orderMeta = {
      flow: 'vocabulary',
      version: 1,
      selectedTextbook,
      selectedLessons,
      packageType: selectedPackage,
      email: email.trim(),
      totalPrice,
    };

    setSubmitting(true);
    try {
      const res = await saveOrderToDb(orderText, ORDER_PREFIX.BOOK_VOCABULARY, undefined, orderMeta);
      if (res.ok && res.id) {
        router.push('/order/done?id=' + res.id);
      } else {
        alert(res.error || '주문 저장에 실패했습니다.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /* ── 로딩·인증 분기 ── */
  if (checking) {
    return (
      <>
        <AppBar title="단어장 주문 제작" showBackButton onBackClick={() => router.push('/')} />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  if (!authorized) {
    return (
      <>
        <AppBar title="단어장 주문 제작" showBackButton onBackClick={() => router.push('/')} />
        <div className="min-h-screen py-12 px-4 bg-gray-50">
          <div className="max-w-md mx-auto text-center bg-white rounded-2xl shadow-lg p-8">
            <h1 className="text-2xl font-bold text-gray-800 mb-3">단어장 주문 제작</h1>
            <p className="text-gray-600 mb-6">회원 전용 서비스입니다. 로그인 후 이용해 주세요.</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/login" className="inline-block px-6 py-3 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors font-semibold">
                로그인
              </Link>
              <a
                href={KAKAO_INQUIRY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex justify-center items-center px-5 py-3 rounded-xl text-sm font-semibold bg-[#FEE500] text-gray-900 hover:bg-[#FDD835] transition-colors"
              >
                카카오톡 문의
              </a>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ── 메인 렌더 ── */
  return (
    <>
      <AppBar title="단어장 주문 제작" showBackButton onBackClick={() => router.push('/')} />
      <div className="min-h-screen py-8 px-4" style={{ backgroundColor: '#F5F5F5' }}>
        <div className="max-w-2xl mx-auto space-y-5">
          <p>
            <Link href="/" className="text-sm font-medium text-teal-600 hover:underline">← 메인 화면으로</Link>
          </p>

          {/* 헤더 */}
          <div className="bg-white rounded-2xl shadow-lg p-6">
            <h1 className="text-2xl font-bold text-gray-800">단어장 주문 제작</h1>
            <p className="text-gray-500 text-sm mt-1">교재·지문별 맞춤 단어장을 제작 주문합니다.</p>
            <div className="mt-3 flex gap-4 text-sm text-gray-600">
              <span className="bg-teal-50 text-teal-700 rounded-lg px-3 py-1 font-medium">기본형 300원/지문</span>
              <span className="bg-teal-50 text-teal-700 rounded-lg px-3 py-1 font-medium">상세형 500원/지문</span>
            </div>
          </div>

          {/* 1. 교재 선택 */}
          <div className="bg-white rounded-2xl shadow p-6 space-y-3">
            <h2 className="font-bold text-gray-800">1. 교재 선택</h2>
            {dataLoading ? (
              <p className="text-gray-400 text-sm">교재 목록 로딩 중…</p>
            ) : dataError || !textbooksData ? (
              <p className="text-red-500 text-sm">교재 데이터를 불러올 수 없습니다.</p>
            ) : textbookList.length === 0 ? (
              <p className="text-gray-500 text-sm">허용된 교재가 없습니다. 관리자에게 문의해 주세요.</p>
            ) : (
              <select
                value={selectedTextbook}
                onChange={(e) => setSelectedTextbook(e.target.value)}
                className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-gray-800 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                <option value="">교재를 선택하세요</option>
                {textbookList.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            )}
          </div>

          {/* 2. 강·번호 선택 */}
          {selectedTextbook && Object.keys(lessonGroups).length > 0 && (
            <div className="bg-white rounded-2xl shadow p-6 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-gray-800">2. 강·번호 선택</h2>
                <button type="button" onClick={handleAllLessonsToggle} className="text-xs text-teal-600 hover:underline font-medium">
                  {selectedLessons.length === allLessonsFlat.length ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <p className="text-xs text-gray-500">왼쪽 클릭: 강 전체 선택/해제 · + 버튼: 개별 번호 선택</p>
              {selectedLessons.length > 0 && (
                <p className="text-sm font-semibold text-teal-600">{selectedLessons.length}개 선택됨</p>
              )}
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {Object.entries(lessonGroups).map(([lk, group]) => {
                  const allSel = group.every((l) => selectedLessons.includes(l));
                  const someSel = group.some((l) => selectedLessons.includes(l));
                  const count = group.filter((l) => selectedLessons.includes(l)).length;
                  const expanded = expandedLessons.includes(lk);
                  return (
                    <div key={lk} className="border rounded-xl bg-gray-50 overflow-hidden">
                      <div className="flex">
                        <button
                          type="button"
                          onClick={() => handleLessonGroupToggle(lk)}
                          className={`flex-1 flex items-center justify-between px-4 py-3 text-left font-medium rounded-l-xl ${
                            allSel ? 'bg-teal-600 text-white' : someSel ? 'bg-teal-100 text-teal-800' : 'bg-white text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          <span className="font-bold">{lk}</span>
                          <span className="text-sm">{count}/{group.length}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleLessonExpand(lk)}
                          className={`px-3 py-3 border-l ${expanded ? 'bg-teal-100 text-teal-700' : 'bg-white text-gray-500 hover:bg-gray-100'}`}
                        >
                          {expanded ? '−' : '+'}
                        </button>
                      </div>
                      {expanded && (
                        <div className="px-4 pb-3 pt-1 border-t bg-white grid grid-cols-4 gap-2">
                          {group.map((lesson) => (
                            <label key={lesson} className="flex items-center gap-2 cursor-pointer text-sm text-gray-800">
                              <input type="checkbox" checked={selectedLessons.includes(lesson)} onChange={() => handleLessonChange(lesson)} className="rounded text-teal-600" />
                              <span>{lesson.split(' ').slice(1).join(' ')}</span>
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

          {/* 3. 단어장 유형 */}
          {selectedLessons.length > 0 && (
            <div className="bg-white rounded-2xl shadow p-6 space-y-4">
              <h2 className="font-bold text-gray-800">3. 단어장 유형</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {VOCABULARY_PACKAGES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPackage(p.id as 'basic' | 'detailed')}
                    className={`p-4 rounded-xl border-2 text-left transition-colors ${
                      selectedPackage === p.id
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-gray-800">{p.name}</span>
                      <span className="text-sm font-semibold text-teal-600">{p.price.toLocaleString()}원/지문</span>
                    </div>
                    <p className="text-xs text-gray-500">{p.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 4. 이메일 */}
          {selectedLessons.length > 0 && (
            <div className="bg-white rounded-2xl shadow p-6 space-y-3">
              <h2 className="font-bold text-gray-800">4. 이메일</h2>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="자료 받으실 이메일 주소"
                className="w-full border-2 border-gray-300 rounded-xl px-4 py-3 text-gray-800 focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              />
            </div>
          )}

          {/* 5. 가격 요약 + 주문 */}
          {selectedLessons.length > 0 && (
            <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
              <h2 className="font-bold text-gray-800">5. 주문 요약</h2>
              <div className="space-y-2 text-sm text-gray-700">
                <div className="flex justify-between"><span>교재</span><span className="font-medium text-gray-900">{selectedTextbook}</span></div>
                <div className="flex justify-between"><span>선택 지문</span><span>{selectedLessons.length}개</span></div>
                <div className="flex justify-between"><span>유형</span><span>{pkg.name} ({pkg.description})</span></div>
                <div className="flex justify-between"><span>단가</span><span>{pkg.price.toLocaleString()}원/지문</span></div>
                <hr />
                <div className="flex justify-between font-bold text-base text-gray-900">
                  <span>합계</span>
                  <span className="text-teal-600">{totalPrice.toLocaleString()}원</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full py-4 bg-teal-600 text-white font-bold text-lg rounded-xl hover:bg-teal-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? '주문 처리 중…' : `단어장 주문하기 (${totalPrice.toLocaleString()}원)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
