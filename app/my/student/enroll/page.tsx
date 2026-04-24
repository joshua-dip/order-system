'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

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

export default function StudentEnrollPage() {
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/my/student/cycles')
      .then(r => r.json())
      .then(d => setCycles(d.cycles ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 pb-6">
      <div className="bg-gradient-to-br from-indigo-600 to-violet-600 px-5 pt-6 pb-5">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/my/student" className="text-white/70 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-white font-bold text-lg">시험 대비 사이클</h1>
            <p className="text-indigo-100 text-xs">관리자가 설계한 맞춤 학습 패키지</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 mt-5 space-y-4">
        {loading && (
          <div className="text-center py-12 text-slate-400">불러오는 중...</div>
        )}
        {!loading && cycles.length === 0 && (
          <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-10 text-center">
            <svg className="w-8 h-8 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-slate-500 font-medium">현재 신청 가능한 사이클이 없습니다.</p>
            <p className="text-slate-400 text-sm mt-1">곧 새 패키지가 등록될 예정이에요.</p>
          </div>
        )}
        {cycles.map(cycle => (
          <Link
            key={cycle.id}
            href={`/my/student/enroll/${cycle.id}`}
            className="block bg-white rounded-2xl shadow-sm border border-slate-100 p-5 hover:border-indigo-200 hover:shadow-md transition-all"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {cycle.targetGrade && (
                    <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">{cycle.targetGrade}</span>
                  )}
                  <span className="text-xs text-slate-400">{cycle.totalWeeks}주 과정</span>
                </div>
                <h3 className="font-bold text-slate-800 leading-snug">{cycle.title}</h3>
              </div>
              <div className="text-right ml-3 flex-shrink-0">
                <p className="font-bold text-slate-800">{cycle.priceWon.toLocaleString()}원</p>
              </div>
            </div>
            {cycle.bulletPoints.length > 0 && (
              <ul className="mt-3 space-y-1">
                {cycle.bulletPoints.slice(0, 4).map((bp, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                    <svg className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    {bp}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-center justify-end mt-3">
              <span className="text-indigo-600 text-sm font-medium">자세히 보기 →</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
