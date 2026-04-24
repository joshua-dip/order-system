'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import StreakBadge from './_components/StreakBadge';
import QuotaGauge from './_components/QuotaGauge';

interface StudentProfile {
  loginId: string;
  name: string;
  studentMeta?: {
    grade?: string;
    avatarColor?: string;
    streak?: { count: number; lastVisitedAt: string };
    totalAttempts?: number;
    correctAttempts?: number;
  };
}

interface QuotaData {
  dayUsed: number;
  dailyLimit: number;
  dayRemaining: number;
  weekUsed: number;
  weeklyLimit: number;
}

interface EnrollmentItem {
  id: string;
  status: string;
  cycleSnapshot: { title: string; targetGrade: string; totalWeeks: number; priceWon: number };
  activatedAt?: string;
  adminMemo?: string;
}

interface DailyContent {
  en: string;
  ko: string;
  word: string;
  wordMeaning: string;
}

export default function StudentDashboardPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const didStreak = useRef(false);
  const [showWelcome, setShowWelcome] = useState(false);

  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [quota, setQuota] = useState<QuotaData | null>(null);
  const [enrollments, setEnrollments] = useState<EnrollmentItem[]>([]);
  const [daily, setDaily] = useState<DailyContent | null>(null);
  const [dailySeed, setDailySeed] = useState(0);

  useEffect(() => {
    if (searchParams.get('welcome') === '1') {
      setShowWelcome(true);
      const t = setTimeout(() => setShowWelcome(false), 3500);
      // 쿼리 파라미터 제거
      router.replace('/my/student');
      return () => clearTimeout(t);
    }
  }, [searchParams, router]);

  useEffect(() => {
    fetch('/api/my/student/profile').then(r => r.json()).then(d => setProfile(d)).catch(() => {});
    fetch('/api/my/student/quota').then(r => r.json()).then(d => setQuota(d)).catch(() => {});
    fetch('/api/my/student/enrollments').then(r => r.json()).then(d => setEnrollments(d.enrollments ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!didStreak.current) {
      didStreak.current = true;
      fetch('/api/my/student/streak', { method: 'POST' })
        .then(r => r.json())
        .then(d => {
          if (d.changed && profile) {
            setProfile(prev => prev ? {
              ...prev,
              studentMeta: { ...prev.studentMeta, streak: { count: d.streak, lastVisitedAt: new Date().toISOString() } }
            } : prev);
          }
        })
        .catch(() => {});
    }
  }, [profile]);

  useEffect(() => {
    const grade = profile?.studentMeta?.grade ?? '';
    import('@/lib/student-daily-content').then(m => {
      setDaily(m.getDailyContent(grade, dailySeed));
    });
  }, [profile, dailySeed]);

  const streak = profile?.studentMeta?.streak?.count ?? 0;
  const totalAttempts = profile?.studentMeta?.totalAttempts ?? 0;
  const correctAttempts = profile?.studentMeta?.correctAttempts ?? 0;
  const correctRate = totalAttempts > 0 ? Math.round((correctAttempts / totalAttempts) * 100) : null;
  const avatarColor = profile?.studentMeta?.avatarColor ?? '#6366f1';

  const activeEnrollment = enrollments.find(e => e.status === 'active');
  const pendingEnrollment = enrollments.find(e => e.status === 'pending_payment');

  return (
    <div className="min-h-screen bg-slate-50 pb-6">
      {/* 환영 토스트 */}
      {showWelcome && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-indigo-600 text-white px-6 py-3 rounded-2xl shadow-xl text-sm font-semibold animate-bounce">
          환영해요! AI와 영어 공부를 시작해볼까요?
        </div>
      )}

      {/* 헤더 카드 */}
      <div className="bg-gradient-to-br from-indigo-600 to-violet-600 px-5 pt-8 pb-6">
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-bold text-lg shadow-sm"
              style={{ backgroundColor: avatarColor }}
            >
              {profile?.name?.[0] ?? '?'}
            </div>
            <div>
              <p className="text-indigo-100 text-sm">안녕하세요</p>
              <p className="text-white font-bold text-lg leading-tight">
                {profile?.name ?? '...'}{profile?.studentMeta?.grade ? ` · ${profile.studentMeta.grade}` : ''}
              </p>
            </div>
          </div>
          <StreakBadge count={streak} />
        </div>
      </div>

      {/* 본문 */}
      <div className="max-w-lg mx-auto px-4 mt-5 space-y-4">

        {/* 활성 사이클 카드 */}
        {activeEnrollment ? (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">진행 중</span>
                  <span className="text-xs text-slate-400">{activeEnrollment.cycleSnapshot.totalWeeks}주 과정</span>
                </div>
                <h3 className="font-bold text-slate-800">{activeEnrollment.cycleSnapshot.title}</h3>
                {activeEnrollment.adminMemo && (
                  <p className="text-sm text-slate-500 mt-1">{activeEnrollment.adminMemo}</p>
                )}
                <p className="text-xs text-slate-400 mt-2">주차별 학습 계획이 곧 등록될 예정이에요.</p>
              </div>
              <svg className="w-5 h-5 text-emerald-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
          </div>
        ) : pendingEnrollment ? (
          <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">입금 확인 중</span>
            </div>
            <h3 className="font-bold text-slate-800">{pendingEnrollment.cycleSnapshot.title}</h3>
            <p className="text-sm text-slate-500 mt-1">관리자가 입금을 확인하면 바로 시작됩니다.</p>
            <Link
              href={`/my/student/cycle/${pendingEnrollment.id}`}
              className="mt-3 inline-block text-xs text-amber-700 font-medium hover:underline"
            >
              입금 안내 다시 보기 →
            </Link>
          </div>
        ) : (
          <Link
            href="/my/student/enroll"
            className="block bg-gradient-to-r from-indigo-500 to-violet-500 rounded-2xl p-5 text-white shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-indigo-100 text-xs mb-0.5">시험 대비 맞춤 학습</p>
                <p className="font-bold text-lg">6~7주 사이클 신청하기</p>
                <p className="text-indigo-100 text-sm mt-1">관리자가 직접 설계한 주차별 학습 플랜</p>
              </div>
              <svg className="w-6 h-6 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </Link>
        )}

        {/* AI 자유 연습 카드 */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span className="text-sm font-semibold text-slate-700">AI 자유 연습</span>
          </div>
          <p className="text-slate-500 text-sm">영어 지문을 붙여넣으면 AI가 변형문제를 만들어줘요.</p>
          <Link
            href="/my/student/practice"
            className="mt-3 flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            지금 AI와 공부하기
          </Link>
          {quota && (
            <QuotaGauge
              dayUsed={quota.dayUsed}
              dailyLimit={quota.dailyLimit}
              dayRemaining={quota.dayRemaining}
            />
          )}
        </div>

        {/* 오늘의 영어 */}
        {daily && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-semibold text-slate-700">오늘의 영어</span>
              </div>
              <button
                type="button"
                onClick={() => setDailySeed(s => s + 1)}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                다른 문장 보기
              </button>
            </div>
            <p className="text-slate-800 font-medium leading-relaxed">&quot;{daily.en}&quot;</p>
            <p className="text-slate-500 text-sm mt-1">{daily.ko}</p>
            <div className="mt-3 flex items-center gap-2">
              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded">
                {daily.word}
              </span>
              <span className="text-slate-400 text-xs">{daily.wordMeaning}</span>
            </div>
          </div>
        )}

        {/* 누적 통계 */}
        {totalAttempts > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <p className="text-sm font-semibold text-slate-700 mb-3">내 학습 기록</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-indigo-600">{totalAttempts}</p>
                <p className="text-xs text-slate-500 mt-0.5">누적 풀이 수</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-emerald-600">{correctRate ?? 0}%</p>
                <p className="text-xs text-slate-500 mt-0.5">정답률</p>
              </div>
            </div>
          </div>
        )}

        {/* Phase 2 Placeholder 카드들 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-4 flex flex-col items-center justify-center text-center gap-2 min-h-[90px]">
            <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-xs text-slate-400 font-medium">오답노트</p>
            <span className="text-[10px] text-indigo-400 bg-indigo-50 px-2 py-0.5 rounded-full font-medium">곧 만나요</span>
          </div>
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-4 flex flex-col items-center justify-center text-center gap-2 min-h-[90px]">
            <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-xs text-slate-400 font-medium">학습 통계</p>
            <span className="text-[10px] text-indigo-400 bg-indigo-50 px-2 py-0.5 rounded-full font-medium">곧 만나요</span>
          </div>
        </div>

        {/* 빠른 링크 */}
        <div className="flex items-center justify-between text-sm">
          <Link href="/my/student/profile" className="text-slate-500 hover:text-slate-700 transition-colors">
            내 정보 수정
          </Link>
          <button
            type="button"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              window.location.assign('/');
            }}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            로그아웃
          </button>
        </div>
      </div>
    </div>
  );
}
