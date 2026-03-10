'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppBar from '../components/AppBar';

interface AuthUser {
  loginId: string;
  role: string;
  name: string;
  email: string;
}

interface MyOrder {
  id: string;
  orderText: string;
  createdAt: string;
  status: string;
  orderNumber: string | null;
  fileUrl: string | null;
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '주문 접수',
  accepted: '제작 수락',
  payment_confirmed: '입금 확인',
  in_progress: '제작 중',
  completed: '완료',
  cancelled: '취소됨',
};

export default function MyPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMessage, setEmailMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (!data.user) {
          router.replace('/login?from=/my');
          return;
        }
        setUser(data.user);
        setEditEmail(data.user.email ?? '');
      })
      .catch(() => router.replace('/login?from=/my'))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!user) return;
    fetch('/api/my/orders')
      .then((res) => res.json())
      .then((data) => setOrders(data.orders || []))
      .catch(() => setOrders([]));
  }, [user]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/');
    router.refresh();
  };

  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailMessage(null);
    setEmailSaving(true);
    try {
      const res = await fetch('/api/my/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: editEmail }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUser((u) => (u ? { ...u, email: editEmail } : null));
        setEmailMessage({ type: 'success', text: '이메일 주소가 저장되었습니다.' });
      } else {
        setEmailMessage({ type: 'error', text: data?.error || '저장에 실패했습니다.' });
      }
    } catch {
      setEmailMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setEmailSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);
    if (newPassword !== newPasswordConfirm) {
      setPasswordMessage({ type: 'error', text: '새 비밀번호가 일치하지 않습니다.' });
      return;
    }
    if (newPassword.length < 4) {
      setPasswordMessage({ type: 'error', text: '비밀번호는 4자 이상으로 입력해주세요.' });
      return;
    }
    setPasswordSaving(true);
    try {
      const res = await fetch('/api/my/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setNewPassword('');
        setNewPasswordConfirm('');
        setPasswordMessage({ type: 'success', text: '비밀번호가 변경되었습니다.' });
      } else {
        setPasswordMessage({ type: 'error', text: data?.error || '변경에 실패했습니다.' });
      }
    } catch {
      setPasswordMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!confirm('이 주문을 취소하시겠습니까?')) return;
    setCancellingId(orderId);
    try {
      const res = await fetch('/api/orders/' + orderId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status: 'cancelled' } : o))
        );
      } else {
        alert(data.error || '취소에 실패했습니다.');
      }
    } catch {
      alert('취소 요청 중 오류가 발생했습니다.');
    } finally {
      setCancellingId(null);
    }
  };

  if (loading) {
    return (
      <>
        <AppBar title="커스터마이징 서비스" />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  if (!user) return null;

  const formatDate = (d: string) => {
    try {
      const date = new Date(d);
      return date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return d;
    }
  };

  return (
    <>
      <AppBar title="커스터마이징 서비스" />
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-2xl mx-auto space-y-8">
          <p className="text-center">
            <Link
              href="/"
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              ← 메인 화면으로
            </Link>
          </p>
          {/* 내 정보 */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">내 정보</h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm text-gray-500">이름</dt>
                <dd className="font-medium text-gray-900">{user.name || user.loginId}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">아이디</dt>
                <dd className="font-medium text-gray-900">{user.loginId}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500 mb-1">이메일 주소</dt>
                <form onSubmit={handleSaveEmail} className="flex flex-wrap items-center gap-2">
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="이메일을 입력하세요"
                    className="flex-1 min-w-[200px] px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900 placeholder:text-gray-500 bg-white"
                  />
                  <button
                    type="submit"
                    disabled={emailSaving}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {emailSaving ? '저장 중…' : '저장'}
                  </button>
                </form>
                {emailMessage && (
                  <p className={`mt-1 text-sm ${emailMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                    {emailMessage.text}
                  </p>
                )}
              </div>
            </dl>
            <div className="mt-6 pt-4 border-t border-gray-100">
              <h3 className="text-sm font-bold text-gray-700 mb-2">비밀번호 변경</h3>
              <form onSubmit={handleChangePassword} className="space-y-2 max-w-sm">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="새 비밀번호"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900 placeholder:text-gray-500 bg-white"
                  minLength={4}
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  placeholder="새 비밀번호 확인"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm text-gray-900 placeholder:text-gray-500 bg-white"
                  minLength={4}
                  autoComplete="new-password"
                />
                <button
                  type="submit"
                  disabled={passwordSaving}
                  className="px-4 py-2 text-sm font-medium text-white bg-gray-700 rounded-lg hover:bg-gray-800 disabled:opacity-50"
                >
                  {passwordSaving ? '변경 중…' : '비밀번호 변경'}
                </button>
                {passwordMessage && (
                  <p className={`text-sm ${passwordMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                    {passwordMessage.text}
                  </p>
                )}
              </form>
            </div>
            <button
              onClick={handleLogout}
              className="mt-6 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              로그아웃
            </button>
          </section>

          {/* 내 포인트 */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-4">내 포인트</h2>
            <p className="text-2xl font-bold" style={{ color: '#13294B' }}>
              0 P
            </p>
            <p className="text-sm text-gray-500 mt-1">
              포인트 충전·사용 기능은 준비 중입니다.
            </p>
          </section>

          {/* 내 주문·자료 */}
          <section className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h2 className="text-lg font-bold text-gray-800 mb-2">내 주문·자료</h2>
            <p className="text-sm text-gray-600 mb-4">
              회원 로그인 시 제출한 주문서를 여기서 다시 확인할 수 있습니다. 제작 수락·입금 확인·제작 진행 상황도 아래에서 확인할 수 있습니다.
            </p>
            {orders.length === 0 ? (
              <p className="text-gray-500 text-sm">아직 제출한 주문이 없습니다.</p>
            ) : (
              <ul className="space-y-4">
                {orders.map((order) => (
                  <li
                    key={order.id}
                    className="border border-gray-200 rounded-xl p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div>
                        <span className="text-xs text-gray-500">{formatDate(order.createdAt)}</span>
                        {order.orderNumber && (
                          <span className="ml-2 text-xs font-mono text-gray-500">{order.orderNumber}</span>
                        )}
                      </div>
                      <span
                        className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                          order.status === 'cancelled'
                            ? 'bg-gray-200 text-gray-600'
                            : 'bg-blue-100 text-blue-800'
                        }`}
                      >
                        {ORDER_STATUS_LABELS[order.status] || order.status || '주문 접수'}
                      </span>
                    </div>
                    <Link
                      href={'/order/done?id=' + order.id}
                      className="block"
                    >
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap break-words font-sans line-clamp-4 hover:text-blue-600 transition-colors">
                        {order.orderText.slice(0, 300)}
                        {order.orderText.length > 300 ? '…' : ''}
                      </pre>
                    </Link>
                    {order.fileUrl && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <a
                          href={order.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-700 hover:underline transition-colors"
                        >
                          📥 자료 다운로드 (드롭박스)
                        </a>
                      </div>
                    )}
                    {order.status === 'pending' && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            handleCancelOrder(order.id);
                          }}
                          disabled={cancellingId === order.id}
                          className="text-sm text-red-600 hover:text-red-700 font-medium disabled:opacity-50 underline-offset-2 hover:underline transition-all duration-200 hover:scale-105 active:scale-100"
                        >
                          {cancellingId === order.id ? '취소 중…' : '주문 취소'}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
