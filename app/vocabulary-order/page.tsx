'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppBar from '../components/AppBar';
import PointChargeModal from '../components/PointChargeModal';
import { useTextbooksData } from '@/lib/useTextbooksData';
import { useCurrentUser } from '@/lib/useCurrentUser';
import {
  isMockExamTextbookKey,
  isFreeVocabularyMockExamTextbook,
  parseMockExamKey,
} from '@/lib/mock-exam-key';
import { VOCABULARY_POINTS_PER_PASSAGE } from '@/lib/vocabulary-library-types';
import type { UserVocabularySerialized } from '@/lib/vocabulary-library-types';

/* ────────── 타입 ────────── */

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

/* ────────── 유틸 ────────── */

function pickFirstContent(key: string, data: TextbookStructure): TextbookContent | null {
  const sub = data.Sheet1?.부교재 ?? data['지문 데이터']?.부교재 ?? data.부교재;
  if (!sub) return null;
  if (sub[key]) return sub[key];
  const keys = Object.keys(sub);
  return keys.length > 0 ? sub[keys[0]] : null;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

/* ────────── 내 단어장 카드 ────────── */

function LibraryCard({ item }: { item: UserVocabularySerialized }) {
  const router = useRouter();
  const wordCount = item.vocabulary_list.length;
  const pts = typeof item.points_used === 'number' ? item.points_used : VOCABULARY_POINTS_PER_PASSAGE;

  return (
    <button
      type="button"
      onClick={() => router.push(`/vocabulary-order/${item._id}/edit`)}
      className="group text-left bg-white border border-slate-200 rounded-2xl p-4 hover:border-teal-400 hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-xs font-medium text-teal-600 mb-0.5">{item.textbook}</p>
          <p className="font-bold text-slate-800 text-sm leading-tight">{item.display_label}</p>
        </div>
        <span
          className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
            pts === 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-teal-100 text-teal-800'
          }`}
        >
          {pts === 0 ? '무료' : `${pts}P`}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span>{wordCount}개 단어</span>
        <span>·</span>
        <span>{formatDate(item.last_edited_at)}</span>
      </div>
      <div className="mt-3 text-xs text-teal-600 font-medium group-hover:text-teal-800 transition-colors">
        편집·다운로드 →
      </div>
    </button>
  );
}

/* ────────── 메인 페이지 ────────── */

export default function VocabularyOrderPage() {
  const router = useRouter();
  const { data: textbooksData, loading: dataLoading } = useTextbooksData({ vocabularyEnrich: true });
  const currentUser = useCurrentUser();

  const [checking, setChecking] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [userPoints, setUserPoints] = useState(0);
  const [customerKey, setCustomerKey] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.user) {
          setAuthorized(true);
          setUserPoints(typeof d.user.points === 'number' ? d.user.points : 0);
          setCustomerKey(d.user.loginId || '');
          setCustomerName(d.user.name || d.user.loginId || '');
          setCustomerEmail(d.user.email || '');
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const [library, setLibrary] = useState<UserVocabularySerialized[]>([]);
  const [libLoading, setLibLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'library' | 'buy'>('library');

  const fetchLibrary = useCallback(async () => {
    if (!authorized) return;
    setLibLoading(true);
    try {
      const r = await fetch('/api/my/vocabulary/library');
      if (r.ok) {
        const d = await r.json();
        setLibrary(d.items || []);
      }
    } finally {
      setLibLoading(false);
    }
  }, [authorized]);

  useEffect(() => {
    fetchLibrary();
  }, [fetchLibrary]);

  /** 단어장 구매: 허용 교재와 무관하게 병합 converted_data 의 전체 교재 키 노출 */
  const textbookList = useMemo(() => {
    if (!textbooksData) return [];
    return Object.keys(textbooksData).sort((a, b) => a.localeCompare(b, 'ko'));
  }, [textbooksData]);

  const ownedLabels = useMemo(() => new Set(library.map((l) => l.display_label)), [library]);

  const [selectedTextbook, setSelectedTextbook] = useState('');
  const [textbookQuery, setTextbookQuery] = useState('');
  const [lessonGroups, setLessonGroups] = useState<Record<string, string[]>>({});
  const [selectedLessons, setSelectedLessons] = useState<Set<string>>(new Set());
  const [expandedLessons, setExpandedLessons] = useState<Set<string>>(new Set());
  /** null: 로딩 중 — 단어장(passage_analyses) 있는 번호만 선택 허용 */
  const [lessonLabelsWithVocab, setLessonLabelsWithVocab] = useState<Set<string> | null>(null);
  const [vocabAvailabilityError, setVocabAvailabilityError] = useState(false);

  useEffect(() => {
    if (!textbooksData || !selectedTextbook || !textbooksData[selectedTextbook]) {
      setLessonGroups({});
      setSelectedLessons(new Set());
      setExpandedLessons(new Set());
      return;
    }
    const td = textbooksData[selectedTextbook] as TextbookStructure;
    const content = pickFirstContent(selectedTextbook, td);
    if (!content) {
      setLessonGroups({});
      return;
    }
    const groups: Record<string, string[]> = {};
    Object.keys(content).forEach((lk) => {
      const arr = content[lk];
      if (Array.isArray(arr)) groups[lk] = arr.map((it) => `${lk} ${it.번호}`);
    });
    setLessonGroups(groups);
    setSelectedLessons(new Set());
    setExpandedLessons(new Set(Object.keys(groups)));
    setLessonLabelsWithVocab(null);
    setVocabAvailabilityError(false);
  }, [selectedTextbook, textbooksData]);

  useEffect(() => {
    if (!authorized || !selectedTextbook) {
      setLessonLabelsWithVocab(null);
      setVocabAvailabilityError(false);
      return;
    }
    let cancelled = false;
    setLessonLabelsWithVocab(null);
    setVocabAvailabilityError(false);
    fetch(
      `/api/my/vocabulary/passage-availability?textbook=${encodeURIComponent(selectedTextbook)}`,
      { credentials: 'include' },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error('bad');
        return r.json() as Promise<{ lessonLabelsWithVocabulary?: string[] }>;
      })
      .then((d) => {
        if (cancelled) return;
        const arr = Array.isArray(d.lessonLabelsWithVocabulary) ? d.lessonLabelsWithVocabulary : [];
        setLessonLabelsWithVocab(new Set(arr));
      })
      .catch(() => {
        if (!cancelled) {
          setLessonLabelsWithVocab(new Set());
          setVocabAvailabilityError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authorized, selectedTextbook]);

  useEffect(() => {
    if (lessonLabelsWithVocab === null) return;
    setSelectedLessons((prev) => {
      const next = new Set<string>();
      for (const l of prev) {
        if (lessonLabelsWithVocab.has(l)) next.add(l);
      }
      return next;
    });
  }, [lessonLabelsWithVocab]);

  const filteredTextbooks = useMemo(() => {
    const q = textbookQuery.trim().toLowerCase();
    if (!q) return textbookList;
    return textbookList.filter((k) => k.toLowerCase().includes(q));
  }, [textbookList, textbookQuery]);

  /** 목록 UI: 모의고사 / EBS·부교재 구분 (검색 필터 유지) */
  const filteredMockExams = useMemo(
    () =>
      [...filteredTextbooks]
        .filter((k) => isMockExamTextbookKey(k))
        .sort((a, b) => a.localeCompare(b, 'ko')),
    [filteredTextbooks],
  );
  const filteredEbsSupplementary = useMemo(
    () =>
      [...filteredTextbooks]
        .filter((k) => !isMockExamTextbookKey(k))
        .sort((a, b) => a.localeCompare(b, 'ko')),
    [filteredTextbooks],
  );

  const mockExamsByGrade = useMemo(() => {
    const buckets: Record<'고1' | '고2' | '고3' | '기타', string[]> = {
      고1: [],
      고2: [],
      고3: [],
      기타: [],
    };
    for (const k of filteredMockExams) {
      const p = parseMockExamKey(k);
      if (p?.grade === '고1' || p?.grade === '고2' || p?.grade === '고3') {
        buckets[p.grade].push(k);
      } else {
        buckets.기타.push(k);
      }
    }
    for (const g of ['고1', '고2', '고3', '기타'] as const) {
      buckets[g].sort((a, b) => a.localeCompare(b, 'ko'));
    }
    return buckets;
  }, [filteredMockExams]);

  const scrollToTextbookSection = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const allLessonsFlat = useMemo(() => Object.values(lessonGroups).flat(), [lessonGroups]);

  const handleLessonChange = (l: string) =>
    setSelectedLessons((p) => {
      const s = new Set(p);
      if (s.has(l)) s.delete(l);
      else s.add(l);
      return s;
    });

  const lessonHasVocabularyData = useCallback(
    (lesson: string) => lessonLabelsWithVocab !== null && lessonLabelsWithVocab.has(lesson),
    [lessonLabelsWithVocab],
  );

  const handleGroupToggle = (lk: string) => {
    const group = lessonGroups[lk] || [];
    const selectable = group.filter((l) => !ownedLabels.has(l) && lessonHasVocabularyData(l));
    if (selectable.length === 0) return;
    const allSel = selectable.every((l) => selectedLessons.has(l));
    setSelectedLessons((p) => {
      const s = new Set(p);
      if (allSel) selectable.forEach((l) => s.delete(l));
      else selectable.forEach((l) => s.add(l));
      return s;
    });
  };

  const handleAllToggle = () => {
    const selectable = allLessonsFlat.filter((l) => !ownedLabels.has(l) && lessonHasVocabularyData(l));
    if (selectable.length === 0) return;
    const allChosen = selectable.every((l) => selectedLessons.has(l));
    if (allChosen) setSelectedLessons(new Set());
    else setSelectedLessons(new Set(selectable));
  };

  const toggleExpand = (lk: string) =>
    setExpandedLessons((p) => {
      const s = new Set(p);
      if (s.has(lk)) s.delete(lk);
      else s.add(lk);
      return s;
    });

  const selectedLessonsArr = useMemo(() => [...selectedLessons], [selectedLessons]);
  const mockExamFree = selectedTextbook ? isFreeVocabularyMockExamTextbook(selectedTextbook) : false;
  const perPassagePoints = mockExamFree ? 0 : VOCABULARY_POINTS_PER_PASSAGE;
  const totalPoints = selectedLessonsArr.length * perPassagePoints;
  const pointsShort = Math.max(0, totalPoints - userPoints);

  const [chargeOpen, setChargeOpen] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState('');

  const handlePurchase = async () => {
    if (selectedLessonsArr.length === 0) {
      alert('지문(강·번호)을 선택해주세요.');
      return;
    }
    if (pointsShort > 0) {
      setChargeOpen(true);
      return;
    }

    const items = selectedLessonsArr.map((label) => ({
      lesson_label: label,
      package_type: 'basic' as const,
    }));

    setPurchasing(true);
    setPurchaseError('');
    try {
      const r = await fetch('/api/my/vocabulary/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textbook: selectedTextbook, items }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        await fetchLibrary();
        if (d.first_id) {
          router.push(`/vocabulary-order/${d.first_id}/edit`);
        } else {
          setActiveTab('library');
        }
      } else {
        setPurchaseError(d.error || '구매에 실패했습니다.');
      }
    } catch {
      setPurchaseError('네트워크 오류가 발생했습니다.');
    } finally {
      setPurchasing(false);
    }
  };

  const buyStep1Done = !!selectedTextbook;
  const buyStep2Done = selectedLessons.size > 0;
  /** 1: 교재 선택 중 → 2: 강·번호 선택 중 → 3: 지문 선택 완료 */
  const buyPhase = !selectedTextbook ? 1 : selectedLessons.size === 0 ? 2 : 3;
  const progressBarPercent = buyPhase === 1 ? 12 : buyPhase === 2 ? 52 : 100;

  if (checking) {
    return (
      <>
        <AppBar title="단어장" showBackButton onBackClick={() => router.push('/')} />
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="animate-spin w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  if (!authorized) {
    return (
      <>
        <AppBar title="단어장" showBackButton onBackClick={() => router.push('/')} />
        <div className="min-h-screen py-16 px-4 bg-slate-50">
          <div className="max-w-md mx-auto text-center bg-white rounded-2xl shadow-lg p-10">
            <div className="text-5xl mb-4">📚</div>
            <h1 className="text-2xl font-bold text-slate-800 mb-2">단어장</h1>
            <p className="text-slate-500 mb-6 text-sm leading-relaxed">
              회원 전용 서비스입니다.
              <br />
              로그인 후 교재·지문을 고르고 포인트로 구매·편집·다운로드할 수 있어요.
            </p>
            <Link
              href="/login"
              className="inline-block px-6 py-3 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition-colors"
            >
              로그인
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar title="단어장" showBackButton onBackClick={() => router.push('/')} />

      <PointChargeModal
        open={chargeOpen}
        onClose={() => {
          setChargeOpen(false);
          fetch('/api/auth/me', { credentials: 'include' })
            .then((r) => r.json())
            .then((d) => {
              if (d?.user?.points != null) setUserPoints(d.user.points);
            })
            .catch(() => {});
        }}
        customerKey={customerKey}
        customerName={customerName}
        customerEmail={customerEmail}
      />

      <div className="min-h-screen bg-slate-50 pb-36">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
          {/* 헤더 */}
          <div className="rounded-2xl bg-gradient-to-br from-teal-600 to-teal-800 p-6 text-white shadow-md">
            <h1 className="text-2xl font-bold mb-1">내 단어장</h1>
            <p className="text-teal-100 text-sm leading-relaxed">
              교재를 고른 뒤 <strong className="text-white">강·번호(지문)</strong>를 선택하면 해당 지문 단어장을 내 라이브러리에 담을 수 있어요.
            </p>
            <p className="text-teal-200/90 text-xs mt-2">
              고1·고2·고3 <strong className="text-white">영어모의고사</strong> 지문은 <strong className="text-white">무료</strong> · 그 외 지문당{' '}
              <strong className="text-white">{VOCABULARY_POINTS_PER_PASSAGE.toLocaleString()}P</strong> · 구매 후 바로 편집·다운로드
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2 bg-white/10 rounded-xl px-4 py-2.5 w-fit">
              <span className="text-sm text-teal-100">보유 포인트</span>
              <span className="font-bold text-lg tabular-nums">{userPoints.toLocaleString()}P</span>
              <button
                type="button"
                onClick={() => setChargeOpen(true)}
                className="ml-1 text-xs bg-white/20 hover:bg-white/30 rounded-lg px-2.5 py-1 font-medium transition-colors"
              >
                충전
              </button>
            </div>
          </div>

          {/* 탭 */}
          <div className="flex gap-1 bg-white rounded-xl p-1 shadow-sm border border-slate-100">
            <button
              type="button"
              onClick={() => setActiveTab('library')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === 'library' ? 'bg-teal-600 text-white shadow' : 'text-slate-600 hover:text-teal-600'
              }`}
            >
              내 라이브러리 {library.length > 0 && `(${library.length})`}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('buy')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                activeTab === 'buy' ? 'bg-teal-600 text-white shadow' : 'text-slate-600 hover:text-teal-600'
              }`}
            >
              새로 구매하기
            </button>
          </div>

          {activeTab === 'library' && (
            <div>
              {libLoading ? (
                <div className="flex justify-center py-12">
                  <div className="animate-spin w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full" />
                </div>
              ) : library.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
                  <div className="text-4xl mb-3">📂</div>
                  <p className="text-slate-600 font-medium mb-1">아직 구매한 단어장이 없어요</p>
                  <p className="text-slate-400 text-sm mb-4">교재와 지문을 선택한 뒤 포인트로 구매해 보세요.</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('buy')}
                    className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 transition-colors"
                  >
                    구매하러 가기
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {library.map((item) => (
                    <LibraryCard key={item._id} item={item} />
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'buy' && (
            <div className="space-y-5">
              {/* 진행 상황 — 애니메이션 스테퍼 */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                <div
                  className={`pointer-events-none absolute inset-0 bg-gradient-to-br transition-opacity duration-700 ${
                    buyPhase === 1 ? 'from-teal-50/90 to-transparent opacity-100' : 'from-teal-50/40 to-transparent opacity-0'
                  }`}
                  aria-hidden
                />
                <div className="relative">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">진행 상황</p>
                    <span
                      key={buyPhase}
                      className="text-xs font-semibold text-teal-700 tabular-nums anim-vocab-order-phase"
                    >
                      {buyPhase === 1 && '① 교재'}
                      {buyPhase === 2 && '② 강·번호'}
                      {buyPhase === 3 && '선택 완료'}
                    </span>
                  </div>
                  <p
                    key={`hint-${buyPhase}-${selectedLessons.size}`}
                    className="text-sm text-slate-600 mb-4 min-h-[2.5rem] leading-snug anim-vocab-order-phase"
                  >
                    {buyPhase === 1 && '아래 목록에서 구매할 교재를 눌러 선택해 주세요.'}
                    {buyPhase === 2 && '강을 펼친 뒤, 구매할 지문(번호)을 체크해 주세요.'}
                    {buyPhase === 3 && (
                      <>
                        <span className="font-bold text-teal-700">{selectedLessons.size}개</span> 지문이 선택되었습니다.
                        {mockExamFree ? (
                          <> 하단에서 <strong className="text-teal-800">담기</strong>를 눌러 주세요.</>
                        ) : (
                          <> 하단에서 포인트를 확인한 뒤 구매를 눌러 주세요.</>
                        )}
                      </>
                    )}
                  </p>

                  {/* 연결선 + 채워지는 진행 바 */}
                  <div className="relative flex items-start justify-between gap-2 px-1 sm:px-4">
                    {/* Step 1 */}
                    <div className="flex flex-col items-center z-10 w-[4.5rem] shrink-0">
                      <div
                        className={`relative flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold shadow-md transition-all duration-500 ease-out ${
                          buyStep1Done
                            ? 'bg-teal-600 text-white ring-4 ring-teal-200/80 scale-100'
                            : buyPhase === 1
                              ? 'bg-teal-500 text-white ring-4 ring-teal-300 anim-vocab-order-pulse scale-110'
                              : 'bg-slate-200 text-slate-500 scale-100'
                        }`}
                      >
                        {buyStep1Done ? (
                          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          '1'
                        )}
                      </div>
                      <span className="mt-2 text-center text-[11px] font-bold leading-tight text-slate-700 sm:text-xs">
                        교재
                        <br className="sm:hidden" />
                        선택
                      </span>
                    </div>

                    <div className="relative flex-1 pt-[1.125rem] min-w-0">
                      <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-teal-500 via-teal-400 to-emerald-400 shadow-sm transition-[width] duration-[700ms] ease-out"
                          style={{ width: `${progressBarPercent}%` }}
                        />
                        {buyPhase < 3 && (
                          <div
                            className="pointer-events-none absolute inset-y-0 left-0 overflow-hidden rounded-full"
                            style={{ width: `${progressBarPercent}%` }}
                          >
                            <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent anim-vocab-order-shimmer" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="flex flex-col items-center z-10 w-[4.5rem] shrink-0">
                      <div
                        className={`relative flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold shadow-md transition-all duration-500 ease-out ${
                          buyStep2Done
                            ? 'bg-teal-600 text-white ring-4 ring-teal-200/80 scale-100'
                            : buyPhase === 2
                              ? 'bg-teal-500 text-white ring-4 ring-teal-300 anim-vocab-order-pulse scale-110'
                              : buyStep1Done
                                ? 'bg-teal-100 text-teal-800 ring-2 ring-teal-200'
                                : 'bg-slate-200 text-slate-400 scale-100'
                        }`}
                      >
                        {buyStep2Done ? (
                          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          '2'
                        )}
                      </div>
                      <span className="mt-2 text-center text-[11px] font-bold leading-tight text-slate-700 sm:text-xs">
                        강·번호
                      </span>
                    </div>
                  </div>
                </div>
              </div>


              {/* 요금 안내 */}
              <div className="rounded-2xl border border-teal-200 bg-teal-50/80 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  {mockExamFree ? (
                    <>
                      <p className="text-sm font-bold text-emerald-900">선택한 교재: 고1·2·3 영어모의고사 — 무료</p>
                      <p className="text-xs text-emerald-800/90">이 교재 지문 단어장은 포인트 없이 라이브러리에 추가됩니다.</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-bold text-teal-900">지문당 {VOCABULARY_POINTS_PER_PASSAGE.toLocaleString()}P</p>
                      <p className="text-xs text-teal-800/80">선택한 지문 수 × {VOCABULARY_POINTS_PER_PASSAGE.toLocaleString()}P가 차감됩니다.</p>
                    </>
                  )}
                </div>
              </div>

              {/* ① 교재 */}
              <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-600 text-white text-xs font-bold">
                      1
                    </span>
                    교재 선택
                  </h2>
                </div>
                <input
                  type="search"
                  value={textbookQuery}
                  onChange={(e) => setTextbookQuery(e.target.value)}
                  placeholder="교재명 검색…"
                  className="w-full mb-2 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                />
                {!dataLoading && filteredTextbooks.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="text-[10px] font-semibold text-slate-400 self-center mr-0.5">이동</span>
                    {filteredEbsSupplementary.length > 0 && (
                      <button
                        type="button"
                        onClick={() => scrollToTextbookSection('vocab-textbook-ebs')}
                        className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-200/90 text-slate-800 hover:bg-slate-300/90 transition-colors"
                      >
                        EBS·부교재
                      </button>
                    )}
                    {mockExamsByGrade.고1.length > 0 && (
                      <button
                        type="button"
                        onClick={() => scrollToTextbookSection('vocab-textbook-mock-g1')}
                        className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900 hover:bg-emerald-200/90 transition-colors"
                      >
                        고1 모의고사
                      </button>
                    )}
                    {mockExamsByGrade.고2.length > 0 && (
                      <button
                        type="button"
                        onClick={() => scrollToTextbookSection('vocab-textbook-mock-g2')}
                        className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900 hover:bg-emerald-200/90 transition-colors"
                      >
                        고2 모의고사
                      </button>
                    )}
                    {mockExamsByGrade.고3.length > 0 && (
                      <button
                        type="button"
                        onClick={() => scrollToTextbookSection('vocab-textbook-mock-g3')}
                        className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900 hover:bg-emerald-200/90 transition-colors"
                      >
                        고3 모의고사
                      </button>
                    )}
                    {mockExamsByGrade.기타.length > 0 && (
                      <button
                        type="button"
                        onClick={() => scrollToTextbookSection('vocab-textbook-mock-other')}
                        className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 hover:bg-amber-200/90 transition-colors"
                      >
                        기타
                      </button>
                    )}
                  </div>
                )}
                {dataLoading ? (
                  <p className="text-slate-400 text-sm py-6 text-center">교재 목록 불러오는 중…</p>
                ) : filteredTextbooks.length === 0 ? (
                  <p className="text-slate-500 text-sm py-6 text-center">
                    {textbookList.length === 0 ? '허용된 교재가 없습니다. 관리자에게 문의하세요.' : '검색 결과가 없습니다.'}
                  </p>
                ) : (
                  <div className="max-h-[22rem] overflow-y-auto rounded-xl border border-slate-100 bg-white shadow-inner scroll-smooth">
                    {filteredEbsSupplementary.length > 0 && (
                      <div id="vocab-textbook-ebs" className="border-b border-slate-100 scroll-mt-2">
                        <div className="sticky top-0 z-[1] flex flex-col gap-0.5 border-b border-slate-100 bg-gradient-to-b from-slate-50 to-slate-50/95 px-4 py-2.5 backdrop-blur-sm">
                          <span className="text-xs font-bold text-slate-700">EBS · 부교재</span>
                          <span className="text-[10px] font-medium leading-snug text-slate-500">
                            수능특강·실전 등 EBS 계열과 일반 부교재
                          </span>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {filteredEbsSupplementary.map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => setSelectedTextbook(k)}
                              className={`w-full text-left px-4 py-3 text-sm font-medium transition-colors flex items-center justify-between gap-2 ${
                                selectedTextbook === k
                                  ? 'bg-teal-50 text-teal-900 ring-2 ring-inset ring-teal-400'
                                  : 'text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <span className="min-w-0 break-words">{k}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {filteredMockExams.length > 0 && (
                      <div>
                        <div className="sticky top-0 z-[1] flex flex-col gap-0.5 border-b border-slate-100 bg-gradient-to-b from-emerald-50/90 to-emerald-50/80 px-4 py-2.5 backdrop-blur-sm">
                          <span className="text-xs font-bold text-emerald-900">모의고사</span>
                          <span className="text-[10px] font-medium leading-snug text-emerald-800/85">
                            학년별로 나뉘어 있으며, 고1·고2·고3 영어 모의고사는 무료입니다.
                          </span>
                        </div>
                        {(['고1', '고2', '고3'] as const).map((grade) => {
                          const list = mockExamsByGrade[grade];
                          if (list.length === 0) return null;
                          const anchorId =
                            grade === '고1'
                              ? 'vocab-textbook-mock-g1'
                              : grade === '고2'
                                ? 'vocab-textbook-mock-g2'
                                : 'vocab-textbook-mock-g3';
                          return (
                            <div key={grade} id={anchorId} className="scroll-mt-2">
                              <div className="sticky top-0 z-[1] border-b border-emerald-100/80 bg-emerald-50/95 px-4 py-1.5 backdrop-blur-sm">
                                <span className="text-[11px] font-bold text-emerald-800">{grade} 모의고사</span>
                                <span className="text-[10px] font-medium text-emerald-700/80 ml-2">
                                  {list.length}종
                                </span>
                              </div>
                              <div className="divide-y divide-slate-100">
                                {list.map((k) => (
                                  <button
                                    key={k}
                                    type="button"
                                    onClick={() => setSelectedTextbook(k)}
                                    className={`w-full text-left px-4 py-3 text-sm font-medium transition-colors flex items-center justify-between gap-2 ${
                                      selectedTextbook === k
                                        ? 'bg-teal-50 text-teal-900 ring-2 ring-inset ring-teal-400'
                                        : 'text-slate-700 hover:bg-slate-50'
                                    }`}
                                  >
                                    <span className="min-w-0 break-words">{k}</span>
                                    {isFreeVocabularyMockExamTextbook(k) && (
                                      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                        무료
                                      </span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                        {mockExamsByGrade.기타.length > 0 && (
                          <div id="vocab-textbook-mock-other" className="scroll-mt-2">
                            <div className="sticky top-0 z-[1] border-b border-amber-100/90 bg-amber-50/95 px-4 py-1.5 backdrop-blur-sm">
                              <span className="text-[11px] font-bold text-amber-900">기타 모의고사·수능 형식</span>
                              <span className="text-[10px] font-medium text-amber-800/85 ml-2">
                                {mockExamsByGrade.기타.length}종
                              </span>
                            </div>
                            <div className="divide-y divide-slate-100">
                              {mockExamsByGrade.기타.map((k) => (
                                <button
                                  key={k}
                                  type="button"
                                  onClick={() => setSelectedTextbook(k)}
                                  className={`w-full text-left px-4 py-3 text-sm font-medium transition-colors flex items-center justify-between gap-2 ${
                                    selectedTextbook === k
                                      ? 'bg-teal-50 text-teal-900 ring-2 ring-inset ring-teal-400'
                                      : 'text-slate-700 hover:bg-slate-50'
                                  }`}
                                >
                                  <span className="min-w-0 break-words">{k}</span>
                                  {isFreeVocabularyMockExamTextbook(k) && (
                                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                                      무료
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {selectedTextbook && (
                  <p className="mt-3 text-xs text-teal-700 font-medium">
                    선택됨: <span className="text-slate-800">{selectedTextbook}</span>
                  </p>
                )}
              </div>

              {/* ② 강·번호 */}
              {selectedTextbook && Object.keys(lessonGroups).length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                    <h2 className="font-bold text-slate-800 text-base flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-600 text-white text-xs font-bold">
                        2
                      </span>
                      강·번호 선택 (지문)
                    </h2>
                    <button
                      type="button"
                      onClick={handleAllToggle}
                      disabled={
                        lessonLabelsWithVocab === null ||
                        allLessonsFlat.filter((l) => !ownedLabels.has(l) && lessonHasVocabularyData(l)).length === 0
                      }
                      className="text-xs text-teal-600 hover:text-teal-800 font-semibold self-start sm:self-auto disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {(() => {
                        const sel = allLessonsFlat.filter((l) => !ownedLabels.has(l) && lessonHasVocabularyData(l));
                        const allOn = sel.length > 0 && sel.every((l) => selectedLessons.has(l));
                        return allOn ? '전체 해제' : '전체 선택';
                      })()}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 mb-3">
                    각 강(Lesson)을 펼쳐 번호를 고릅니다.{' '}
                    <strong className="text-slate-600">관리자 지문분석기에서 단어장이 저장된 지문</strong>만 선택할 수 있고, 이미
                    라이브러리에 담은 지문은 선택할 수 없습니다.
                  </p>
                  {lessonLabelsWithVocab === null && (
                    <p className="text-xs text-teal-700 font-medium mb-2">단어장 준비 여부를 확인하는 중…</p>
                  )}
                  {vocabAvailabilityError && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-2">
                      준비된 지문 목록을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.
                    </p>
                  )}
                  {selectedLessons.size > 0 && (
                    <p className="text-sm font-semibold text-teal-700 mb-3">
                      {selectedLessons.size}개 지문 · {totalPoints.toLocaleString()}P
                    </p>
                  )}
                  <div className="space-y-2 max-h-[min(70vh,28rem)] overflow-y-auto pr-1">
                    {Object.entries(lessonGroups).map(([lk, group]) => {
                      const selectable = group.filter((l) => !ownedLabels.has(l) && lessonHasVocabularyData(l));
                      const allSel = selectable.length > 0 && selectable.every((l) => selectedLessons.has(l));
                      const someSel = selectable.some((l) => selectedLessons.has(l));
                      const count = selectable.filter((l) => selectedLessons.has(l)).length;
                      const nPrepared = group.filter((l) => lessonHasVocabularyData(l)).length;
                      const expanded = expandedLessons.has(lk);
                      return (
                        <div key={lk} className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/30">
                          <div className="flex">
                            <button
                              type="button"
                              onClick={() => handleGroupToggle(lk)}
                              disabled={lessonLabelsWithVocab === null || selectable.length === 0}
                              className={`flex-1 flex items-center justify-between px-4 py-3 text-left text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                                allSel
                                  ? 'bg-teal-600 text-white'
                                  : someSel
                                    ? 'bg-teal-50 text-teal-900'
                                    : 'bg-white text-slate-800 hover:bg-slate-50'
                              }`}
                            >
                              <span>{lk}</span>
                              <span className="text-xs font-bold opacity-90 tabular-nums">
                                {lessonLabelsWithVocab === null ? (
                                  <>확인 중…</>
                                ) : (
                                  <>
                                    {count}/{selectable.length} 선택
                                    <span className="font-normal opacity-80 ml-1">· 준비 {nPrepared}/{group.length}</span>
                                  </>
                                )}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleExpand(lk)}
                              className={`px-3 border-l border-slate-200 text-sm font-bold transition-colors ${
                                expanded ? 'bg-teal-50 text-teal-800' : 'bg-white text-slate-400 hover:bg-slate-50'
                              }`}
                              aria-expanded={expanded}
                            >
                              {expanded ? '접기' : '펼치기'}
                            </button>
                          </div>
                          {expanded && (
                            <div className="px-4 pb-4 pt-3 border-t border-slate-100 bg-white grid grid-cols-2 sm:grid-cols-3 gap-2">
                              {group.map((lesson) => {
                                const owned = ownedLabels.has(lesson);
                                const hasVocab = lessonHasVocabularyData(lesson);
                                const loadingAvail = lessonLabelsWithVocab === null;
                                const noData = !loadingAvail && !hasVocab && !owned;
                                const disabled = owned || loadingAvail || noData;
                                const checked = selectedLessons.has(lesson);
                                const numLabel = lesson.split(' ').slice(1).join(' ') || lesson;
                                return (
                                  <label
                                    key={lesson}
                                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                                      disabled
                                        ? 'border-slate-100 bg-slate-50 text-slate-400 cursor-not-allowed'
                                        : checked
                                          ? 'border-teal-400 bg-teal-50/90 cursor-pointer'
                                          : 'border-slate-200 hover:border-teal-200 hover:bg-teal-50/40 cursor-pointer'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={disabled}
                                      onChange={() => !disabled && handleLessonChange(lesson)}
                                      className="rounded border-slate-300 text-teal-600 focus:ring-teal-500 disabled:opacity-40"
                                    />
                                    <span className={`font-medium truncate ${disabled ? 'text-slate-400' : 'text-slate-800'}`}>
                                      {numLabel}
                                    </span>
                                    {owned && (
                                      <span className="ml-auto text-[10px] font-semibold bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
                                        보유
                                      </span>
                                    )}
                                    {!owned && noData && (
                                      <span className="ml-auto text-[10px] font-semibold bg-slate-200/80 text-slate-500 px-1.5 py-0.5 rounded shrink-0">
                                        준비 전
                                      </span>
                                    )}
                                    {!owned && loadingAvail && (
                                      <span className="ml-auto text-[10px] font-medium text-slate-400 px-1 py-0.5 shrink-0">
                                        …
                                      </span>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {selectedTextbook && Object.keys(lessonGroups).length === 0 && !dataLoading && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  이 교재에 등록된 지문(강·번호) 구조를 찾을 수 없습니다. 다른 교재를 선택하거나 관리자에게 문의해 주세요.
                </div>
              )}

              {purchaseError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{purchaseError}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {activeTab === 'buy' && selectedLessons.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-sm border-t border-slate-200 shadow-[0_-8px_30px_rgba(0,0,0,0.08)] px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="max-w-3xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-xs text-slate-500">
                {mockExamFree
                  ? `${selectedLessons.size}개 지문 · 고1·2·3 영어모의고사 무료`
                  : `${selectedLessons.size}개 지문 × ${VOCABULARY_POINTS_PER_PASSAGE.toLocaleString()}P`}
              </div>
              <div className="flex items-baseline gap-2 flex-wrap">
                {mockExamFree ? (
                  <span className="font-bold text-xl text-emerald-700 tabular-nums">0P</span>
                ) : (
                  <>
                    <span className="font-bold text-xl text-slate-900 tabular-nums">{totalPoints.toLocaleString()}P</span>
                    {pointsShort > 0 && (
                      <span className="text-xs text-red-600 font-semibold">{pointsShort.toLocaleString()}P 부족</span>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {pointsShort > 0 && (
                <button
                  type="button"
                  onClick={() => setChargeOpen(true)}
                  className="px-4 py-3 border-2 border-teal-600 text-teal-700 rounded-xl text-sm font-bold hover:bg-teal-50 transition-colors"
                >
                  포인트 충전
                </button>
              )}
              <button
                type="button"
                onClick={handlePurchase}
                disabled={purchasing || pointsShort > 0}
                className="flex-1 sm:flex-none min-w-[8rem] px-6 py-3 bg-teal-600 text-white rounded-xl font-bold text-sm hover:bg-teal-700 disabled:opacity-50 transition-colors shadow-md"
              >
                {purchasing ? '처리 중…' : pointsShort > 0 ? '포인트 부족' : mockExamFree ? '무료로 담기' : '구매하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
