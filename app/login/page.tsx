'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { DEFAULT_APP_BAR_TITLE, SOLVOOK_BRAND_PAGE_URL } from '@/lib/site-branding';
import { getSafeUserLoginRedirect } from '@/lib/post-login-redirect';

const KAKAO_INQUIRY_URL =
  process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';
const INQUIRY_PHONE_DISPLAY = '010-7927-0806';
const INQUIRY_PHONE_TEL = 'tel:01079270806';

function LoginForm() {
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
      const dest = getSafeUserLoginRedirect(searchParams.get('from'), data?.mustChangePassword === true, data?.role);
      window.location.assign(dest);
    } catch {
      setError('로그인 요청 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/50">
      <div className="w-full max-w-md">
        {/* 카드 */}
        <div className="bg-white/90 backdrop-blur rounded-3xl shadow-xl shadow-slate-200/50 border border-white/80 overflow-hidden">
          {/* 상단 브랜드 영역 */}
          <div
            className="px-8 pt-10 pb-6 text-center"
            style={{ backgroundColor: '#13294B' }}
          >
            <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-white/15 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.8}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              {DEFAULT_APP_BAR_TITLE}
            </h1>
            <p className="text-blue-100/90 text-sm mt-1">
              계정으로 로그인
            </p>
            <a
              href={SOLVOOK_BRAND_PAGE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-xs font-medium text-amber-200/95 hover:text-amber-100 underline underline-offset-2"
            >
              쏠북 브랜드 페이지 →
            </a>
          </div>

          {/* 폼 영역 */}
          <div className="px-8 py-8">
            <p className="text-slate-600 text-sm text-center mb-6">
              관리자가 안내한 아이디와 비밀번호를 입력해주세요.
            </p>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="loginId"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  아이디
                </label>
                <input
                  id="loginId"
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 outline-none transition-all text-slate-800 placeholder-slate-400"
                  placeholder="아이디 입력"
                  autoComplete="username"
                  required
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-slate-700 mb-1.5"
                >
                  비밀번호
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 outline-none transition-all text-slate-800 placeholder-slate-400"
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
                className="w-full py-3.5 rounded-xl font-semibold text-white transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-900/30 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                style={{ backgroundColor: '#13294B' }}
              >
                {loading ? '로그인 중...' : '로그인'}
              </button>
            </form>
            <p className="text-center mt-6">
              <Link
                href="/"
                className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                ← 메인으로 돌아가기
              </Link>
            </p>
            <p className="text-center mt-3 text-sm text-slate-400">
              학생이신가요?{' '}
              <Link href="/student-login" className="text-indigo-500 hover:underline font-medium">
                학생 로그인 →
              </Link>
            </p>
          </div>
        </div>
        <p className="text-center text-slate-500 text-sm mt-6 leading-relaxed px-1">
          계정이 없으시면{' '}
          <a
            href={KAKAO_INQUIRY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline font-semibold"
          >
            카카오톡 오픈채팅
          </a>
          을 눌러 문의하시거나,
          <br />
          전화{' '}
          <a href={INQUIRY_PHONE_TEL} className="text-blue-600 hover:underline font-semibold">
            {INQUIRY_PHONE_DISPLAY}
          </a>
          으로 연락해 주세요.
          <span className="block text-slate-400 text-xs mt-1.5 font-normal">
            (오픈채팅 링크 클릭 시 카카오톡 채팅방으로 이동합니다)
          </span>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
