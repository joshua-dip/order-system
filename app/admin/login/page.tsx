'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { getSafeAdminLoginRedirect } from '@/lib/post-login-redirect';

function AdminLoginForm() {
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
      const dest = getSafeAdminLoginRedirect(searchParams.get('from'));
      window.location.assign(dest);
    } catch {
      setError('로그인 요청 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-900">
      <div className="w-full max-w-sm bg-slate-800 rounded-xl border border-slate-700 shadow-2xl p-8">
        <div className="text-center mb-6">
          <span className="inline-block text-xs font-medium text-amber-400/90 bg-amber-400/10 px-2.5 py-1 rounded mb-3">
            관리자 전용
          </span>
          <h1 className="text-xl font-bold text-slate-100">
            관리자 로그인
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            /admin 접근용
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="admin-loginId" className="block text-sm font-medium text-slate-400 mb-1">
              아이디
            </label>
            <input
              id="admin-loginId"
              type="text"
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-700/50 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
              placeholder="admin"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label htmlFor="admin-password" className="block text-sm font-medium text-slate-400 mb-1">
              비밀번호
            </label>
            <input
              id="admin-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-slate-700/50 border border-slate-600 rounded-lg text-slate-100 placeholder-slate-500 focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <p className="text-sm text-red-400 bg-red-900/20 border border-red-800/50 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-amber-600 hover:bg-amber-500 text-slate-900 font-semibold rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    }>
      <AdminLoginForm />
    </Suspense>
  );
}
