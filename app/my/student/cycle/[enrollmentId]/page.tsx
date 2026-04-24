'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Enrollment {
  id: string;
  cycleId: string;
  cycleSnapshot: { title: string; targetGrade: string; totalWeeks: number; priceWon: number };
  status: string;
  depositorName?: string;
  appliedAt: string;
  paidAt?: string;
  activatedAt?: string;
  adminMemo?: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  pending_payment: { label: '입금 대기', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  active: { label: '진행 중', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  completed: { label: '완료', color: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' },
  cancelled: { label: '취소됨', color: 'text-red-600', bg: 'bg-red-50 border-red-200' },
};

const BANK_ACCOUNT_INFO = process.env.NEXT_PUBLIC_BANK_ACCOUNT_INFO ?? '계좌 정보를 확인 중입니다.';

export default function EnrollmentDetailPage() {
  const params = useParams();
  const enrollmentId = params.enrollmentId as string;

  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [loading, setLoading] = useState(true);
  const [depositorName, setDepositorName] = useState('');
  const [markingPaid, setMarkingPaid] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const fetchEnrollment = async () => {
    const res = await fetch(`/api/my/student/enrollments/${enrollmentId}`);
    if (res.ok) {
      const d = await res.json();
      setEnrollment(d);
      setDepositorName(d.depositorName ?? '');
    }
    setLoading(false);
  };

  useEffect(() => { fetchEnrollment(); }, [enrollmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleMarkPaid = async () => {
    setMarkingPaid(true);
    const res = await fetch(`/api/my/student/enrollments/${enrollmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depositorName, markPaid: true }),
    });
    const data = await res.json();
    if (data.ok) {
      setSavedMsg('입금 완료 신고가 접수됐습니다.');
      fetchEnrollment();
    }
    setMarkingPaid(false);
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">불러오는 중...</div>;
  if (!enrollment) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3">
      <p className="text-slate-500">신청 정보를 찾을 수 없습니다.</p>
      <Link href="/my/student" className="text-indigo-600 hover:underline text-sm">대시보드로</Link>
    </div>
  );

  const statusInfo = STATUS_LABELS[enrollment.status] ?? { label: enrollment.status, color: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' };

  return (
    <div className="min-h-screen bg-slate-50 pb-6">
      <div className="bg-gradient-to-br from-indigo-600 to-violet-600 px-5 pt-6 pb-5">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/my/student" className="text-white/70 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-white font-bold text-lg">내 사이클</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 mt-5 space-y-4">
        {/* 상태 카드 */}
        <div className={`rounded-2xl border p-5 ${statusInfo.bg}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-white border ${statusInfo.color} border-current/20`}>
              {statusInfo.label}
            </span>
          </div>
          <h2 className="font-bold text-slate-800 text-lg">{enrollment.cycleSnapshot.title}</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {enrollment.cycleSnapshot.targetGrade} · {enrollment.cycleSnapshot.totalWeeks}주 과정 · {enrollment.cycleSnapshot.priceWon.toLocaleString()}원
          </p>
          {enrollment.activatedAt && (
            <p className="text-xs text-emerald-600 mt-1">
              활성화: {new Date(enrollment.activatedAt).toLocaleDateString('ko-KR')}
            </p>
          )}
          {enrollment.adminMemo && (
            <div className="mt-3 bg-white rounded-xl px-3 py-2 text-sm text-slate-700">
              {enrollment.adminMemo}
            </div>
          )}
        </div>

        {/* 활성화된 경우 */}
        {enrollment.status === 'active' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 text-center">
            <p className="font-semibold text-slate-800 mb-1">사이클이 활성화됐습니다!</p>
            <p className="text-sm text-slate-500">주차별 학습 계획이 곧 등록될 예정이에요. AI 자유 연습으로 먼저 시작해보세요.</p>
            <Link href="/my/student/practice" className="mt-3 inline-block px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-colors">
              AI 자유 연습하기 →
            </Link>
          </div>
        )}

        {/* 입금 안내 (pending_payment) */}
        {enrollment.status === 'pending_payment' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <p className="font-bold text-slate-800 mb-4">입금 안내</p>

            <div className="space-y-3">
              <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-xs text-slate-500">입금 금액</p>
                  <p className="font-bold text-slate-800 text-lg">{enrollment.cycleSnapshot.priceWon.toLocaleString()}원</p>
                </div>
                <button
                  type="button"
                  onClick={() => copyText(enrollment.cycleSnapshot.priceWon.toString())}
                  className="text-xs text-indigo-600 border border-indigo-200 rounded-lg px-2.5 py-1 hover:bg-indigo-50 transition-colors"
                >
                  복사
                </button>
              </div>

              <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3">
                <div>
                  <p className="text-xs text-slate-500">계좌</p>
                  <p className="font-medium text-slate-800 text-sm">{BANK_ACCOUNT_INFO}</p>
                </div>
                <button
                  type="button"
                  onClick={() => copyText(BANK_ACCOUNT_INFO)}
                  className="text-xs text-indigo-600 border border-indigo-200 rounded-lg px-2.5 py-1 hover:bg-indigo-50 transition-colors flex-shrink-0 ml-2"
                >
                  복사
                </button>
              </div>

              <div className="bg-amber-50 rounded-xl px-4 py-3 text-sm text-amber-700">
                입금자명에 <span className="font-bold">이름 + 학교 첫 글자</span>를 써주세요.<br />
                예: &quot;홍길동선&quot; (홍길동 + 선OO고)
              </div>
            </div>

            {!enrollment.paidAt && (
              <div className="mt-4 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">입금자명 (직접 입력)</label>
                  <input
                    type="text"
                    value={depositorName}
                    onChange={e => setDepositorName(e.target.value)}
                    placeholder="홍길동선"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none text-sm"
                  />
                </div>
                {savedMsg && <p className="text-sm text-emerald-600">{savedMsg}</p>}
                <button
                  type="button"
                  onClick={handleMarkPaid}
                  disabled={markingPaid || !depositorName.trim()}
                  className="w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {markingPaid ? '처리 중...' : '입금 완료했어요'}
                </button>
              </div>
            )}

            {enrollment.paidAt && (
              <div className="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-sm text-emerald-700">
                입금 완료 신고됨. 관리자가 확인 후 활성화해드릴게요. (보통 영업일 기준 1~2시간 내)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
