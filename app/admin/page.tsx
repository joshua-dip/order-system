'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface AdminUser {
  loginId: string;
  role: string;
}

interface ListUser {
  id: string;
  loginId: string;
  name: string;
  email: string;
  createdAt: string;
}

interface AdminOrder {
  id: string;
  orderText: string;
  createdAt: string;
  status: string;
  statusLabel: string;
  loginId: string | null;
  orderNumber: string | null;
  fileUrl: string | null;
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

  const [users, setUsers] = useState<ListUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [editUser, setEditUser] = useState<ListUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editResetPassword, setEditResetPassword] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editMessage, setEditMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resetPasswordLoadingId, setResetPasswordLoadingId] = useState<string | null>(null);
  const [ordersModalUser, setOrdersModalUser] = useState<ListUser | null>(null);
  const [userOrders, setUserOrders] = useState<AdminOrder[]>([]);
  const [userOrdersLoading, setUserOrdersLoading] = useState(false);
  const [recentOrders, setRecentOrders] = useState<AdminOrder[]>([]);
  const [recentOrdersLoading, setRecentOrdersLoading] = useState(false);
  const [fileUrlInputs, setFileUrlInputs] = useState<Record<string, string>>({});
  const [fileUrlSavingId, setFileUrlSavingId] = useState<string | null>(null);

  const fetchUsers = useCallback(() => {
    setUsersLoading(true);
    fetch('/api/admin/users')
      .then((res) => res.json())
      .then((data) => {
        if (data.users) setUsers(data.users);
      })
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        setUser(data.user);
        if (!data.user) router.replace('/admin/login');
        else {
          fetchUsers();
          setRecentOrdersLoading(true);
          fetch('/api/admin/orders')
            .then((r) => r.json())
            .then((d) => { if (d.orders) setRecentOrders(d.orders); })
            .finally(() => setRecentOrdersLoading(false));
        }
      })
      .catch(() => router.replace('/admin/login'))
      .finally(() => setLoading(false));
  }, [router, fetchUsers]);

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
        fetchUsers();
      } else {
        setMessage({ type: 'error', text: data?.error || '계정 생성에 실패했습니다.' });
      }
    } catch {
      setMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setSubmitLoading(false);
    }
  };

  const openEdit = (u: ListUser) => {
    setEditUser(u);
    setEditName(u.name);
    setEditEmail(u.email);
    setEditResetPassword(false);
    setEditMessage(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditMessage(null);
    setEditSaving(true);
    try {
      const body: { name?: string; email?: string; resetPassword?: boolean } = {};
      if (editName !== editUser.name) body.name = editName;
      if (editEmail !== editUser.email) body.email = editEmail;
      if (editResetPassword) body.resetPassword = true;
      if (Object.keys(body).length === 0) {
        setEditMessage({ type: 'error', text: '변경할 내용이 없습니다.' });
        setEditSaving(false);
        return;
      }
      const res = await fetch(`/api/admin/users/${editUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setEditUser(null);
        fetchUsers();
      } else {
        setEditMessage({ type: 'error', text: data?.error || '수정에 실패했습니다.' });
      }
    } catch {
      setEditMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 계정을 삭제하시겠습니까? 삭제된 계정은 복구할 수 없습니다.')) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUsers((prev) => prev.filter((u) => u.id !== id));
        if (editUser?.id === id) setEditUser(null);
      } else {
        alert(data?.error || '삭제에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return d;
    }
  };

  const formatDateTime = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return d;
    }
  };

  const handleResetPassword = async (userId: string) => {
    if (!confirm('이 사용자의 비밀번호를 123456으로 초기화하시겠습니까?')) return;
    setResetPasswordLoadingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetPassword: true }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        alert('비밀번호가 123456으로 초기화되었습니다.');
      } else {
        alert(data?.error || '초기화에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setResetPasswordLoadingId(null);
    }
  };

  const handleSaveFileUrl = async (orderId: string, isRecentList = false) => {
    const url = fileUrlInputs[orderId] ?? '';
    setFileUrlSavingId(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setFileUrl', fileUrl: url }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const updater = (prev: AdminOrder[]) =>
          prev.map((o) => (o.id === orderId ? { ...o, fileUrl: url } : o));
        if (isRecentList) setRecentOrders(updater);
        else setUserOrders(updater);
      } else {
        alert(data?.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setFileUrlSavingId(null);
    }
  };

  const openOrdersModal = (u: ListUser) => {
    setOrdersModalUser(u);
    setUserOrders([]);
    setUserOrdersLoading(true);
    fetch(`/api/admin/orders?loginId=${encodeURIComponent(u.loginId)}`)
      .then((r) => r.json())
      .then((d) => { setUserOrders(d.orders || []); })
      .finally(() => setUserOrdersLoading(false));
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
      <div className="max-w-4xl mx-auto">
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

        <div className="bg-white rounded-xl shadow p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">일반 계정 관리</h2>
          {usersLoading ? (
            <p className="text-sm text-gray-500">목록 불러오는 중…</p>
          ) : users.length === 0 ? (
            <p className="text-sm text-gray-500">등록된 일반 계정이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-600">
                    <th className="py-2 pr-4">아이디</th>
                    <th className="py-2 pr-4">이름</th>
                    <th className="py-2 pr-4">이메일</th>
                    <th className="py-2 pr-4">생성일</th>
                    <th className="py-2">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-gray-100">
                      <td className="py-3 pr-4">
                        <button
                          type="button"
                          onClick={() => openOrdersModal(u)}
                          className="font-medium text-blue-600 hover:underline text-left"
                        >
                          {u.loginId}
                        </button>
                      </td>
                      <td className="py-3 pr-4 text-gray-700">{u.name}</td>
                      <td className="py-3 pr-4 text-gray-700">{u.email || '—'}</td>
                      <td className="py-3 pr-4 text-gray-500">{formatDate(u.createdAt)}</td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(u)}
                            className="text-blue-600 hover:underline text-sm font-medium"
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResetPassword(u.id)}
                            disabled={resetPasswordLoadingId === u.id}
                            className="text-amber-600 hover:underline text-sm font-medium disabled:opacity-50"
                          >
                            {resetPasswordLoadingId === u.id ? '초기화 중…' : '비밀번호 초기화'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(u.id)}
                            disabled={deletingId === u.id}
                            className="text-red-600 hover:underline text-sm font-medium disabled:opacity-50"
                          >
                            {deletingId === u.id ? '삭제 중…' : '삭제'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {ordersModalUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-2">
                주문 이력 — {ordersModalUser.loginId} ({ordersModalUser.name})
              </h3>
              {userOrdersLoading ? (
                <p className="text-sm text-gray-500">불러오는 중…</p>
              ) : userOrders.length === 0 ? (
                <p className="text-sm text-gray-500">주문 이력이 없습니다.</p>
              ) : (
                <div className="overflow-y-auto flex-1 border border-gray-200 rounded-lg bg-gray-50">
                  <div className="p-2 space-y-3">
                    {userOrders.map((o) => (
                      <div key={o.id} className="border border-gray-200 rounded-xl p-3">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          {o.orderNumber && (
                            <span className="font-mono text-sm font-semibold text-gray-800">{o.orderNumber}</span>
                          )}
                          <span className="text-xs text-gray-500">{formatDateTime(o.createdAt)}</span>
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                            {o.statusLabel}
                          </span>
                          <a
                            href={`/order/done?id=${o.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline text-xs"
                          >
                            주문서 보기 →
                          </a>
                        </div>
                        <div className="flex gap-2 items-center">
                          <input
                            type="url"
                            placeholder="드롭박스 공유 링크"
                            value={fileUrlInputs[o.id] ?? o.fileUrl ?? ''}
                            onChange={(e) => setFileUrlInputs((prev) => ({ ...prev, [o.id]: e.target.value }))}
                            className="flex-1 min-w-0 px-2 py-1 border border-gray-300 rounded-lg text-xs text-gray-900 placeholder:text-gray-400 bg-white focus:ring-2 focus:ring-indigo-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveFileUrl(o.id, false)}
                            disabled={fileUrlSavingId === o.id}
                            className="shrink-0 px-2 py-1 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
                          >
                            {fileUrlSavingId === o.id ? '…' : '저장'}
                          </button>
                          {o.fileUrl && (
                            <a href={o.fileUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline text-xs shrink-0">확인</a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setOrdersModalUser(null)}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-medium"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        )}

        {editUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
              <h3 className="text-lg font-bold text-gray-800 mb-4">계정 수정 — {editUser.loginId}</h3>
              <form onSubmit={handleSaveEdit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                  />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editResetPassword}
                    onChange={(e) => setEditResetPassword(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">비밀번호를 123456으로 초기화</span>
                </label>
                {editMessage && (
                  <p className={`text-sm ${editMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                    {editMessage.text}
                  </p>
                )}
                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={editSaving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                  >
                    {editSaving ? '저장 중…' : '저장'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditUser(null)}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-medium"
                  >
                    취소
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">최근 주문 요청</h2>
          {recentOrdersLoading ? (
            <p className="text-sm text-gray-500">불러오는 중…</p>
          ) : recentOrders.length === 0 ? (
            <p className="text-sm text-gray-500">최근 주문이 없습니다.</p>
          ) : (
            <div className="space-y-4">
              {recentOrders.map((o) => (
                <div key={o.id} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    {o.orderNumber && (
                      <span className="font-mono text-sm font-semibold text-gray-800">{o.orderNumber}</span>
                    )}
                    <span className="text-xs text-gray-500">{formatDateTime(o.createdAt)}</span>
                    <span className="text-xs font-medium text-gray-700">{o.loginId || '비회원'}</span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                      {o.statusLabel}
                    </span>
                    <a
                      href={`/order/done?id=${o.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline text-xs"
                    >
                      주문서 보기 →
                    </a>
                  </div>
                  <div className="flex gap-2 items-center">
                    <input
                      type="url"
                      placeholder="드롭박스 공유 링크 붙여넣기"
                      value={fileUrlInputs[o.id] ?? o.fileUrl ?? ''}
                      onChange={(e) => setFileUrlInputs((prev) => ({ ...prev, [o.id]: e.target.value }))}
                      className="flex-1 min-w-0 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => handleSaveFileUrl(o.id, true)}
                      disabled={fileUrlSavingId === o.id}
                      className="shrink-0 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
                    >
                      {fileUrlSavingId === o.id ? '저장 중…' : '링크 저장'}
                    </button>
                    {o.fileUrl && (
                      <a
                        href={o.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-indigo-600 hover:underline text-xs"
                      >
                        확인
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
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
