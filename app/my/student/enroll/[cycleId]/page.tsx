'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

interface Cycle {
  id: string;
  title: string;
  targetGrade: string;
  totalWeeks: number;
  priceWon: number;
  description: string;
  bulletPoints: string[];
  startAt?: string;
  endAt?: string;
}

export default function CycleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const cycleId = params.cycleId as string;

  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/my/student/cycles')
      .then(r => r.json())
      .then(d => {
        const found = (d.cycles as Cycle[] ?? []).find(c => c.id === cycleId);
        setCycle(found ?? null);
      })
      .finally(() => setLoading(false));
  }, [cycleId]);

  const handleApply = async () => {
    setApplying(true);
    setError('');
    const res = await fetch('/api/my/student/enrollments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cycleId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? '신청에 실패했습니다.');
      setApplying(false);
      return;
    }
    router.push(`/my/student/cycle/${data.enrollmentId}`);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">불러오는 중...</div>;
  if (!cycle) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3">
      <p className="text-slate-500">사이클을 찾을 수 없습니다.</p>
      <Link href="/my/student/enroll" className="text-indigo-600 hover:underline text-sm">목록으로</Link>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-6">
      <div className="bg-gradient-to-br from-indigo-600 to-violet-600 px-5 pt-6 pb-5">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/my/student/enroll" className="text-white/70 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-white font-bold text-lg">사이클 상세</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 mt-5 space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
          <div className="flex items-center gap-2 mb-2">
            {cycle.targetGrade && (
              <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">{cycle.targetGrade}</span>
            )}
            <span className="text-xs text-slate-400">{cycle.totalWeeks}주 과정</span>
          </div>
          <h2 className="font-bold text-slate-800 text-xl mb-1">{cycle.title}</h2>
          <p className="text-2xl font-bold text-indigo-600">{cycle.priceWon.toLocaleString()}원</p>
          {cycle.startAt && (
            <p className="text-xs text-slate-400 mt-1">
              시작: {new Date(cycle.startAt).toLocaleDateString('ko-KR')}
              {cycle.endAt && ` ~ ${new Date(cycle.endAt).toLocaleDateString('ko-KR')}`}
            </p>
          )}
        </div>

        {cycle.bulletPoints.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <p className="text-sm font-semibold text-slate-700 mb-3">이런 내용을 배워요</p>
            <ul className="space-y-2">
              {cycle.bulletPoints.map((bp, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <svg className="w-4 h-4 text-indigo-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {bp}
                </li>
              ))}
            </ul>
          </div>
        )}

        {cycle.description && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
            <p className="text-sm font-semibold text-slate-700 mb-2">상세 설명</p>
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">{cycle.description}</p>
          </div>
        )}

        <div className="bg-indigo-50 rounded-2xl border border-indigo-100 p-4">
          <p className="text-sm text-indigo-700 leading-relaxed">
            신청하면 <span className="font-semibold">무통장 입금 안내</span>가 표시됩니다. 입금 후 관리자가 확인하면 바로 시작됩니다. (보통 영업일 기준 1~2시간 내)
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl">{error}</div>
        )}

        <button
          type="button"
          onClick={handleApply}
          disabled={applying}
          className="w-full py-4 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-all text-base shadow-sm"
        >
          {applying ? '신청 중...' : '신청하기'}
        </button>
      </div>
    </div>
  );
}
