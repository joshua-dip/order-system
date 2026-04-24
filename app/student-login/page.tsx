'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { DEFAULT_APP_BAR_TITLE } from '@/lib/site-branding';

function StudentLoginForm() {
  const searchParams = useSearchParams();
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ loginId, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || '로그인에 실패했습니다.');
        return;
      }
      const role = data?.role;
      const from = searchParams.get('from');
      if (role === 'student') {
        window.location.assign(from?.startsWith('/my/student') ? from : '/my/student');
      } else {
        window.location.assign('/');
      }
    } catch {
      setError('로그인 요청 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-violet-50/40 to-purple-50/30 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-white/80 overflow-hidden">
          {/* 상단 브랜드 */}
          <div className="px-8 pt-10 pb-6 text-center bg-gradient-to-br from-indigo-600 to-violet-600">
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-white/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-white">{DEFAULT_APP_BAR_TITLE}</h1>
            <p className="text-indigo-100 text-sm mt-1">학생 로그인</p>
          </div>

          {/* 폼 */}
          <div className="px-8 py-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label htmlFor="loginId" className="block text-sm font-medium text-slate-700 mb-1.5">
                  아이디
                </label>
                <input
                  id="loginId"
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none transition-all text-slate-800 placeholder-slate-400"
                  placeholder="아이디 입력"
                  autoComplete="username"
                  required
                />
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1.5">
                  비밀번호
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none transition-all text-slate-800 placeholder-slate-400"
                  placeholder="비밀번호 입력"
                  autoComplete="current-password"
                  required
                />
              </div>
              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? '로그인 중...' : '로그인'}
              </button>
            </form>

            <div className="flex justify-center gap-4 mt-5 text-sm">
              <Link href="/student-signup" className="text-indigo-600 hover:underline font-medium">
                회원가입
              </Link>
              <span className="text-slate-300">|</span>
              <span className="text-slate-400">비밀번호 찾기 (준비 중)</span>
            </div>

            <p className="text-center text-xs text-slate-400 mt-5">
              선생님/관리자는{' '}
              <Link href="/login" className="text-slate-500 hover:underline">
                여기
              </Link>
              에서 로그인하세요.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function StudentLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    }>
      <StudentLoginForm />
    </Suspense>
  );
}
