'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Student {
  loginId: string;
  name: string;
  grade?: string;
  createdAt: string;
  lastPracticeAt?: string;
  totalAttempts: number;
  correctAttempts: number;
  correctRate: number | null;
  activeEnrollmentTitle: string | null;
  activeEnrollmentStatus: string | null;
}

const SORT_OPTIONS = [
  { value: 'createdAt', label: '가입일' },
  { value: 'lastPracticeAt', label: '마지막 학습일' },
  { value: 'totalAttempts', label: '풀이 수' },
];

export default function AdminStudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('createdAt');

  const load = useCallback(async () => {
    setLoading(true);
    const sp = new URLSearchParams({ search, sort });
    const res = await fetch(`/api/admin/students?${sp}`);
    const d = await res.json();
    setStudents(d.students ?? []);
    setLoading(false);
  }, [search, sort]);

  useEffect(() => { load(); }, [load]);

  const fmt = (d?: string) => d ? new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '-';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">학생 관리</h1>
        <p className="text-sm text-slate-500 mt-0.5">자가가입한 학생 목록과 학습 현황을 확인합니다.</p>
      </div>

      <div className="flex gap-3 mb-5">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="아이디 또는 이름 검색"
          className="flex-1 px-4 py-2 rounded-xl border border-slate-200 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none"
        />
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-indigo-400 outline-none"
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label} 순</option>)}
        </select>
      </div>

      {loading ? <p className="text-slate-400 text-center py-10">불러오는 중...</p> : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">학생</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 hidden sm:table-cell">학년</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600">풀이/정답률</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 hidden md:table-cell">사이클</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-600 hidden md:table-cell">마지막 학습</th>
              </tr>
            </thead>
            <tbody>
              {students.map(s => (
                <tr key={s.loginId} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/admin/students/${s.loginId}`} className="hover:underline">
                      <p className="font-semibold text-slate-800">{s.name}</p>
                      <p className="text-xs text-slate-400">{s.loginId}</p>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{s.grade ?? '-'}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-700">{s.totalAttempts}회</p>
                    {s.correctRate !== null && <p className="text-xs text-slate-400">{s.correctRate}% 정답</p>}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {s.activeEnrollmentTitle ? (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${s.activeEnrollmentStatus === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                        {s.activeEnrollmentTitle}
                      </span>
                    ) : <span className="text-xs text-slate-400">없음</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs hidden md:table-cell">{fmt(s.lastPracticeAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {students.length === 0 && (
            <div className="text-center py-12 text-slate-400">학생이 없습니다.</div>
          )}
        </div>
      )}
    </div>
  );
}
