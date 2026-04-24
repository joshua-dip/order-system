'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { STUDENT_GRADE_OPTIONS } from '@/lib/student-grade';

interface StudentDetail {
  loginId: string;
  name: string;
  email?: string;
  grade?: string;
  subjectMemo?: string;
  totalAttempts: number;
  correctAttempts: number;
  streak?: { count: number; lastVisitedAt: string };
  lastPracticeAt?: string;
  createdAt: string;
  enrollments: Array<{
    id: string;
    cycleSnapshot: { title: string; targetGrade: string; priceWon: number };
    status: string;
    appliedAt: string;
    activatedAt?: string;
    adminMemo?: string;
  }>;
  attempts: Array<{
    questionType: string;
    isCorrect: boolean;
    studentAnswer: string;
    aiFeedback: string;
    attemptAt: string;
  }>;
  aiUsage: { today: number; thisWeek: number };
}

export default function StudentDetailPage() {
  const params = useParams();
  const loginId = params.loginId as string;

  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [memo, setMemo] = useState('');
  const [grade, setGrade] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/students/${loginId}`);
    if (res.ok) {
      const d = await res.json();
      setStudent(d);
      setMemo(d.subjectMemo ?? '');
      setGrade(d.grade ?? '');
    }
    setLoading(false);
  }, [loginId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    await fetch(`/api/admin/students/${loginId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subjectMemo: memo, grade }),
    });
    setSavedMsg('저장됐습니다.');
    setTimeout(() => setSavedMsg(''), 2000);
    setSaving(false);
  };

  const fmt = (d?: string) => d ? new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';
  const fmtFull = (d?: string) => d ? new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">불러오는 중...</div>;
  if (!student) return <div className="p-6 text-slate-500">학생을 찾을 수 없습니다. <Link href="/admin/students" className="text-indigo-600 hover:underline">목록으로</Link></div>;

  const correctRate = student.totalAttempts > 0 ? Math.round((student.correctAttempts / student.totalAttempts) * 100) : null;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/students" className="text-slate-400 hover:text-slate-600 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-slate-800">{student.name} 학생 상세</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 프로필 */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-bold text-slate-800 mb-3">프로필</h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">아이디</span><span className="font-medium">{student.loginId}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">이름</span><span className="font-medium">{student.name}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">학년</span><span className="font-medium">{student.grade ?? '-'}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">가입일</span><span className="font-medium">{fmt(student.createdAt)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">마지막 학습</span><span className="font-medium">{fmtFull(student.lastPracticeAt)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">스트릭</span><span className="font-medium">{student.streak?.count ?? 0}일</span></div>
          </div>
        </div>

        {/* 통계 */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-bold text-slate-800 mb-3">학습 통계</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="text-center bg-slate-50 rounded-xl py-3">
              <p className="text-2xl font-bold text-indigo-600">{student.totalAttempts}</p>
              <p className="text-xs text-slate-500 mt-0.5">총 풀이</p>
            </div>
            <div className="text-center bg-slate-50 rounded-xl py-3">
              <p className="text-2xl font-bold text-emerald-600">{correctRate !== null ? `${correctRate}%` : '-'}</p>
              <p className="text-xs text-slate-500 mt-0.5">정답률</p>
            </div>
            <div className="text-center bg-slate-50 rounded-xl py-3">
              <p className="text-2xl font-bold text-slate-700">{student.aiUsage.today}</p>
              <p className="text-xs text-slate-500 mt-0.5">오늘 AI 사용</p>
            </div>
            <div className="text-center bg-slate-50 rounded-xl py-3">
              <p className="text-2xl font-bold text-slate-700">{student.aiUsage.thisWeek}</p>
              <p className="text-xs text-slate-500 mt-0.5">이번 주 AI</p>
            </div>
          </div>
        </div>

        {/* 관리자 메모 + 학년 수정 */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-bold text-slate-800 mb-3">관리자 설정</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">학년 (수정)</label>
              <div className="grid grid-cols-3 gap-1.5">
                {STUDENT_GRADE_OPTIONS.map(g => (
                  <button key={g.value} type="button" onClick={() => setGrade(g.value)}
                    className={`py-1.5 rounded-lg border text-xs font-medium transition-all ${grade === g.value ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 text-slate-700 hover:border-indigo-300'}`}>
                    {g.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">특이사항 메모</label>
              <textarea
                value={memo}
                onChange={e => setMemo(e.target.value)}
                rows={3}
                placeholder="학생 특이사항, 학습 방향 등..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none resize-none"
              />
            </div>
            {savedMsg && <p className="text-sm text-emerald-600">{savedMsg}</p>}
            <button type="button" onClick={handleSave} disabled={saving}
              className="w-full py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>

        {/* 등록 목록 */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="font-bold text-slate-800 mb-3">사이클 등록</h2>
          {student.enrollments.length === 0 ? (
            <p className="text-sm text-slate-400">등록 내역이 없습니다.</p>
          ) : (
            <div className="space-y-2">
              {student.enrollments.map((e, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{e.cycleSnapshot.title}</p>
                    <p className="text-xs text-slate-400">{fmtFull(e.appliedAt)}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                    e.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                    e.status === 'pending_payment' ? 'bg-amber-100 text-amber-700' :
                    e.status === 'completed' ? 'bg-slate-100 text-slate-600' : 'bg-red-100 text-red-600'
                  }`}>
                    {e.status === 'pending_payment' ? '입금대기' : e.status === 'active' ? '진행중' : e.status === 'completed' ? '완료' : '취소'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 최근 풀이 기록 */}
      {student.attempts.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 mt-4">
          <h2 className="font-bold text-slate-800 mb-3">최근 풀이 기록 (최대 30개)</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-3 py-2 text-xs text-slate-600">유형</th>
                  <th className="text-left px-3 py-2 text-xs text-slate-600">정오</th>
                  <th className="text-left px-3 py-2 text-xs text-slate-600">학생 답안</th>
                  <th className="text-left px-3 py-2 text-xs text-slate-600">시도일</th>
                </tr>
              </thead>
              <tbody>
                {student.attempts.map((a, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-xs text-slate-600">{a.questionType}</td>
                    <td className="px-3 py-2">
                      <span className={`text-xs font-bold ${a.isCorrect ? 'text-emerald-600' : 'text-red-500'}`}>
                        {a.isCorrect ? '정답' : '오답'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600 max-w-[180px] truncate">{a.studentAnswer}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{fmtFull(a.attemptAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
