'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface DashboardStats {
  studentCount: number;
  schoolCount: number;
  examCount: number;
  recentExams: { id: string; schoolName: string; examType: string; grade: number; academicYear: number }[];
}

const QUICK_ACTIONS = [
  { href: '/my/vip/students', label: '학생 등록', desc: '새 학생을 추가하고 시험 범위를 설정합니다', icon: 'M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z', color: '#60a5fa' },
  { href: '/my/vip/exams', label: '기출 입력', desc: '학교 시험 정보와 기출문제를 등록합니다', icon: 'M12 10.5v6m3-3H9m4.06-7.19l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z', color: '#a78bfa' },
  { href: '/my/vip/generate', label: '변형문제 생성', desc: '시험 범위에 맞는 문제를 자동 생성합니다', icon: 'M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z', color: '#c9a44e' },
  { href: '/my/vip/scores', label: '성적 입력', desc: '학생들의 시험 성적을 기록하고 관리합니다', icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z', color: '#34d399' },
  { href: '/my/vip/analysis', label: '시험 분석', desc: '출제 유형, 배점 분포, 학생 성적을 분석합니다', icon: 'M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z', color: '#f472b6' },
];

export default function VipDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    studentCount: 0,
    schoolCount: 0,
    examCount: 0,
    recentExams: [],
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/my/vip/dashboard', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (d.ok) setStats(d.stats); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const hasData = stats.studentCount > 0 || stats.schoolCount > 0;

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <h1 className="text-[22px] font-semibold text-zinc-100 tracking-[-0.02em]">
          대시보드
        </h1>
        <p className="text-[14px] text-zinc-500 mt-1">학생 관리부터 시험 분석까지, 모든 기능을 한 곳에서</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: '등록 학생', value: stats.studentCount, icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z', color: '#60a5fa' },
          { label: '등록 학교', value: stats.schoolCount, icon: 'M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5', color: '#a78bfa' },
          { label: '등록 시험', value: stats.examCount, icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z', color: '#c9a44e' },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 hover:border-zinc-700/80 transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[12px] text-zinc-500 font-medium">{stat.label}</p>
                <p className="text-[28px] font-semibold mt-1 text-zinc-100 tracking-tight">
                  {loading ? <span className="inline-block w-8 h-7 bg-zinc-800 rounded animate-pulse" /> : hasData ? stat.value : '—'}
                </p>
              </div>
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${stat.color}10` }}>
                <svg className="w-5 h-5" style={{ color: stat.color }} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d={stat.icon} />
                </svg>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-[15px] font-semibold text-zinc-200 mb-4">빠른 시작</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="group rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 hover:border-zinc-700/60 hover:bg-zinc-900/80 transition-all duration-200"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                style={{ backgroundColor: `${action.color}12` }}
              >
                <svg className="w-[18px] h-[18px]" style={{ color: action.color }} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d={action.icon} />
                </svg>
              </div>
              <h3 className="text-[13px] font-medium text-zinc-200 group-hover:text-zinc-100">{action.label}</h3>
              <p className="text-[12px] text-zinc-600 mt-1 leading-relaxed">{action.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Exams */}
      {stats.recentExams.length > 0 && (
        <div>
          <h2 className="text-[15px] font-semibold text-zinc-200 mb-4">최근 시험</h2>
          <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden">
            {stats.recentExams.map((exam, i) => (
              <div key={exam.id} className={`flex items-center justify-between px-5 py-3 ${i > 0 ? 'border-t border-zinc-800/60' : ''} hover:bg-zinc-800/20 transition-colors`}>
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                  <span className="text-[13px] text-zinc-300">{exam.schoolName}</span>
                  <span className="text-[12px] text-zinc-600">{exam.academicYear}년 {exam.grade}학년 {exam.examType}</span>
                </div>
                <Link href={`/my/vip/exams?school=${exam.id}`} className="text-[12px] text-zinc-500 hover:text-zinc-300 transition-colors">
                  상세 →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
