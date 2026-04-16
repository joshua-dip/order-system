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

/** UI 안내용 — 가격은 VOCABULARY_PACKAGES와 동일하게 유지 */
const VOCABULARY_PACKAGE_GUIDE: Record<
  (typeof VOCABULARY_PACKAGES)[number]['id'],
  {
    oneLine: string;
    bullets: string[];
    recommend: string;
    note?: string;
  }
> = {
  basic: {
    oneLine: '지문에 나온 핵심 단어와 뜻만 정리해, 빠른 암기·복습에 맞춘 구성입니다.',
    bullets: [
      '표제어(영단어)와 한국어 뜻(의미) 중심',
      '열 수를 줄여 한눈에 훑기 좋은 단어장',
      '동의어·반의어는 별도 열로 넣지 않습니다',
    ],
    recommend: '시험 직전 요약, 숙제용 단어 목록, 짧은 시간에 양을 많이 돌리고 싶을 때',
  },
  detailed: {
    oneLine: '뜻에 더해 동의어·반의어까지 넣어, 어휘를 넓히고 시험 대비 폭을 넓힙니다.',
    bullets: [
      '표제어 + 한국어 뜻',
      '동의어(synonym) — 비슷한 말뜻의 단어·표현',
      '반의어(antonym) — 반대말뜻·대비되는 표현(지문·사전 데이터에 있을 때)',
      '기본형보다 열이 많아 한 단어당 정보가 풍부합니다',
    ],
    recommend: '내신·수능식 어휘 문제, 빈칸·유의어 고르기 대비, 단어를 깊게 익히고 싶을 때',
    note: '동의어·반의어는 지문 분석 DB에 해당 정보가 있을 때 반영됩니다. 없는 단어는 뜻만 표시될 수 있어요.',
  },
};

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
            <div className="mt-3 flex flex-wrap gap-2 text-sm text-gray-600">
              <span className="bg-teal-50 text-teal-700 rounded-lg px-3 py-1 font-medium">기본형 300원/지문</span>
              <span className="bg-teal-50 text-teal-700 rounded-lg px-3 py-1 font-medium">상세형 500원/지문</span>
            </div>

            {/* 기본형 vs 상세형 비교 */}
            <div className="mt-4 rounded-xl border border-gray-200 bg-slate-50/90 p-4 sm:p-5">
              <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                <span className="text-teal-600" aria-hidden>📋</span>
                기본형과 상세형, 이렇게 다릅니다
              </h3>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full min-w-[280px] text-left text-xs sm:text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 bg-white/80">
                      <th className="py-2.5 px-2 font-semibold text-gray-600 w-[28%]">구분</th>
                      <th className="py-2.5 px-2 font-semibold text-teal-800">기본형</th>
                      <th className="py-2.5 px-2 font-semibold text-teal-900">상세형</th>
                    </tr>
                  </thead>
                  <tbody className="text-gray-700">
                    <tr className="border-b border-gray-100 align-top">
                      <td className="py-2.5 px-2 font-medium text-gray-600">포함 내용</td>
                      <td className="py-2.5 px-2">단어(표제어) + 뜻</td>
                      <td className="py-2.5 px-2">단어 + 뜻 + 동의어 + 반의어</td>
                    </tr>
                    <tr className="border-b border-gray-100 align-top">
                      <td className="py-2.5 px-2 font-medium text-gray-600">동의어·반의어</td>
                      <td className="py-2.5 px-2 text-gray-500">없음 (뜻 중심)</td>
                      <td className="py-2.5 px-2">있음 (데이터가 있을 때)</td>
                    </tr>
                    <tr className="border-b border-gray-100 align-top">
                      <td className="py-2.5 px-2 font-medium text-gray-600">가격</td>
                      <td className="py-2.5 px-2 font-semibold text-teal-700">300원/지문</td>
                      <td className="py-2.5 px-2 font-semibold text-teal-800">500원/지문</td>
                    </tr>
                    <tr className="align-top">
                      <td className="py-2.5 px-2 font-medium text-gray-600">이럴 때</td>
                      <td className="py-2.5 px-2 text-gray-600 leading-snug">{VOCABULARY_PACKAGE_GUIDE.basic.recommend}</td>
                      <td className="py-2.5 px-2 text-gray-600 leading-snug">{VOCABULARY_PACKAGE_GUIDE.detailed.recommend}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] sm:text-xs text-gray-500 leading-relaxed">
                지문 1개(번호 1개)마다 위 금액이 부과됩니다. 상세형은 열이 많아 제작·검수에 더 들어가 200원이 추가됩니다.
              </p>
            </div>

            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/95 px-4 py-3 text-sm leading-relaxed text-emerald-950">
              <strong className="font-semibold text-emerald-900">모의고사 단어장</strong>은 이 유료 주문과 별도로{' '}
              <strong className="font-semibold text-emerald-900">무료</strong>로 제공하고 있습니다. 공식 영어 모의고사
              지문을 대상으로 한 단어장·시험지는 마이페이지의 단어장에서 받으실 수 있어요.{' '}
              <Link href="/my" className="font-semibold text-teal-700 underline decoration-teal-300 underline-offset-2 hover:text-teal-900">
                마이페이지 → 단어장
              </Link>
            </div>
            <p className="mt-2 text-xs text-gray-500">
              이 화면의 주문은 <strong className="text-gray-700">부교재</strong> 등 허용된 교재 지문에 대한 제작 의뢰입니다.
            </p>
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
              <p className="text-xs text-gray-500 -mt-2">
                아래 카드에도 요약이 있습니다. 위쪽 &quot;기본형과 상세형&quot; 표와 함께 보시면 선택이 쉬워요.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {VOCABULARY_PACKAGES.map((p) => {
                  const g = VOCABULARY_PACKAGE_GUIDE[p.id];
                  return (
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
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-bold text-gray-800">{p.name}</span>
                        <span className="text-sm font-semibold text-teal-600 shrink-0">{p.price.toLocaleString()}원/지문</span>
                      </div>
                      <p className="text-xs font-medium text-gray-600 mb-2">{p.description}</p>
                      <p className="text-[11px] text-gray-600 leading-relaxed mb-2">{g.oneLine}</p>
                      <ul className="text-[11px] text-gray-600 space-y-1 list-disc list-inside leading-relaxed">
                        {g.bullets.map((line, idx) => (
                          <li key={`${p.id}-${idx}`}>{line}</li>
                        ))}
                      </ul>
                      {g.note ? (
                        <p className="mt-2 text-[10px] text-gray-500 leading-relaxed border-t border-gray-200/80 pt-2">{g.note}</p>
                      ) : null}
                    </button>
                  );
                })}
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
