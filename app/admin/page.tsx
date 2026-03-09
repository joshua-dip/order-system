'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface AdminUser {
  loginId: string;
  role: string;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginId, setLoginId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        setUser(data.user);
        if (!data.user) router.replace('/admin/login');
      })
      .catch(() => router.replace('/admin/login'))
      .finally(() => setLoading(false));
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/admin/login');
    router.refresh();
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setSubmitLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId: loginId.trim(), name: name.trim(), email: email.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({ type: 'success', text: `계정이 생성되었습니다. (아이디: ${data.loginId}, 초기 비밀번호: 123456)` });
        setLoginId('');
        setName('');
        setEmail('');
      } else {
        setMessage({ type: 'error', text: data?.error || '계정 생성에 실패했습니다.' });
      }
    } catch {
      setMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setSubmitLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen py-8 px-4 bg-gray-50">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-gray-800">
            관리자 대시보드
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              {user.loginId}
            </span>
            <button
              onClick={handleLogout}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
            >
              로그아웃
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">일반 계정 생성</h2>
          <p className="text-sm text-gray-600 mb-4">
            새 회원용 아이디를 생성합니다. 초기 비밀번호는 <strong>123456</strong>으로 통일됩니다. 생성된 아이디와 비밀번호를 회원에게 전달해 주세요.
          </p>
          <form onSubmit={handleCreateUser} className="space-y-4">
            <div>
              <label htmlFor="new-loginId" className="block text-sm font-medium text-gray-700 mb-1">
                아이디
              </label>
              <input
                id="new-loginId"
                type="text"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="예: student01"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:text-gray-500 bg-white"
                required
                minLength={2}
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="new-name" className="block text-sm font-medium text-gray-700 mb-1">
                이름 (선택)
              </label>
              <input
                id="new-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="표시 이름"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:text-gray-500 bg-white"
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor="new-email" className="block text-sm font-medium text-gray-700 mb-1">
                이메일 주소 (선택)
              </label>
              <input
                id="new-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="예: user@example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder:text-gray-500 bg-white"
                autoComplete="email"
              />
            </div>
            {message && (
              <p
                className={`text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}
              >
                {message.text}
              </p>
            )}
            <button
              type="submit"
              disabled={submitLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
            >
              {submitLoading ? '생성 중…' : '계정 생성'}
            </button>
          </form>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <Link
            href="/"
            className="inline-block text-blue-600 hover:underline"
          >
            ← 메인(주문) 페이지로
          </Link>
        </div>
      </div>
    </div>
  );
}
