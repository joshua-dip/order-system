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
  phone: string;
  dropboxFolderPath: string;
  dropboxSharedLink: string;
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

const STATUS_LABELS: Record<string, string> = {
  pending: '주문 접수',
  accepted: '제작 수락',
  payment_confirmed: '입금 확인',
  in_progress: '제작 중',
  completed: '완료',
  cancelled: '취소됨',
};

const AVATAR_COLORS = [
  'from-[#00A9E0] to-[#0070b8]',
  'from-[#7c6ff7] to-[#5b52d4]',
  'from-[#22c55e] to-[#16a34a]',
  'from-[#f59e0b] to-[#d97706]',
  'from-[#ef4444] to-[#dc2626]',
];

function getDropboxFolderUrl(path: string): string {
  const pathEnc = path.trim().slice(1).split('/').filter(Boolean).map((s) => encodeURIComponent(s)).join('/');
  const workSpace = typeof process.env.NEXT_PUBLIC_DROPBOX_WORK_SPACE === 'string' && process.env.NEXT_PUBLIC_DROPBOX_WORK_SPACE.trim();
  return workSpace ? `https://www.dropbox.com/work/${encodeURIComponent(workSpace)}/앱/${pathEnc}` : `https://www.dropbox.com/work/Apps/${pathEnc}`;
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  pending: 'bg-blue-100 text-blue-800',
  accepted: 'bg-blue-100 text-blue-800',
  payment_confirmed: 'bg-indigo-100 text-indigo-800',
  in_progress: 'bg-amber-100 text-amber-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-600',
};

type SectionType = 'dashboard' | 'orders' | 'members';

export default function AdminDashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<SectionType>('dashboard');

  const [stats, setStats] = useState<{ orderCountByLoginId: Record<string, number>; newMembersThisMonth: number; newOrdersThisWeek: number; dropboxConfigured?: boolean } | null>(null);
  const [loginId, setLoginId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dropboxFolderPath, setDropboxFolderPath] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [users, setUsers] = useState<ListUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [editUser, setEditUser] = useState<ListUser | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editDropboxFolderPath, setEditDropboxFolderPath] = useState('');
  const [editDropboxSharedLink, setEditDropboxSharedLink] = useState('');
  const [editResetPassword, setEditResetPassword] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editMessage, setEditMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [resetPasswordLoadingId, setResetPasswordLoadingId] = useState<string | null>(null);
  const [createDropboxFolderId, setCreateDropboxFolderId] = useState<string | null>(null);
  const [memberSearch, setMemberSearch] = useState('');
  const [editingPathId, setEditingPathId] = useState<string | null>(null);
  const [editingPathValue, setEditingPathValue] = useState('');
  const [pathSavingId, setPathSavingId] = useState<string | null>(null);
  const [ordersModalUser, setOrdersModalUser] = useState<ListUser | null>(null);
  const [userOrders, setUserOrders] = useState<AdminOrder[]>([]);
  const [userOrdersLoading, setUserOrdersLoading] = useState(false);

  const [recentOrders, setRecentOrders] = useState<AdminOrder[]>([]);
  const [recentOrdersLoading, setRecentOrdersLoading] = useState(false);
  const [orderFilter, setOrderFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [orderDetailModal, setOrderDetailModal] = useState<AdminOrder | null>(null);
  const [fileUrlInput, setFileUrlInput] = useState('');
  const [statusInput, setStatusInput] = useState('');
  const [fileUrlSavingId, setFileUrlSavingId] = useState<string | null>(null);
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null);
  const [assignLoginId, setAssignLoginId] = useState('');
  const [assignSavingId, setAssignSavingId] = useState<string | null>(null);
  const [deleteSavingId, setDeleteSavingId] = useState<string | null>(null);

  const fetchUsers = useCallback(() => {
    setUsersLoading(true);
    fetch('/api/admin/users')
      .then((res) => res.json())
      .then((data) => { if (data.users) setUsers(data.users); })
      .catch(() => setUsers([]))
      .finally(() => setUsersLoading(false));
  }, []);

  const fetchOrders = useCallback(() => {
    setRecentOrdersLoading(true);
    fetch('/api/admin/orders')
      .then((r) => r.json())
      .then((d) => { if (d.orders) setRecentOrders(d.orders); })
      .finally(() => setRecentOrdersLoading(false));
  }, []);

  const fetchStats = useCallback(() => {
    fetch('/api/admin/stats')
      .then((r) => r.json())
      .then((d) => {
        if (d.orderCountByLoginId != null) setStats({ orderCountByLoginId: d.orderCountByLoginId || {}, newMembersThisMonth: d.newMembersThisMonth ?? 0, newOrdersThisWeek: d.newOrdersThisWeek ?? 0, dropboxConfigured: !!d.dropboxConfigured });
      })
      .catch(() => setStats(null));
  }, []);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        setUser(data.user);
        if (!data.user) router.replace('/admin/login');
        else {
          fetchUsers();
          fetchOrders();
          fetchStats();
        }
      })
      .catch(() => router.replace('/admin/login'))
      .finally(() => setLoading(false));
  }, [router, fetchUsers, fetchOrders, fetchStats]);

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
        body: JSON.stringify({ loginId: loginId.trim(), name: name.trim(), email: email.trim(), phone: phone.trim(), dropboxFolderPath: dropboxFolderPath.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({ type: 'success', text: `계정이 생성되었습니다. (아이디: ${data.loginId}, 초기 비밀번호: 123456)` });
        setLoginId('');
        setName('');
        setEmail('');
        setPhone('');
        setDropboxFolderPath('');
        fetchUsers();
        fetchStats();
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
    setEditPhone(u.phone ?? '');
    setEditDropboxFolderPath(u.dropboxFolderPath ?? '');
    setEditDropboxSharedLink(u.dropboxSharedLink ?? '');
    setEditResetPassword(false);
    setEditMessage(null);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUser) return;
    setEditMessage(null);
    setEditSaving(true);
    try {
      const body: { name?: string; email?: string; phone?: string; dropboxFolderPath?: string; dropboxSharedLink?: string; resetPassword?: boolean } = {};
      if (editName !== editUser.name) body.name = editName;
      if (editEmail !== editUser.email) body.email = editEmail;
      if (editPhone !== (editUser.phone ?? '')) body.phone = editPhone;
      if (editDropboxFolderPath !== (editUser.dropboxFolderPath ?? '')) body.dropboxFolderPath = editDropboxFolderPath;
      if (editDropboxSharedLink !== (editUser.dropboxSharedLink ?? '')) body.dropboxSharedLink = editDropboxSharedLink;
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
        fetchStats();
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

  const daysAgo = (d: string) => {
    const diff = Math.floor((Date.now() - new Date(d).getTime()) / (24 * 60 * 60 * 1000));
    if (diff === 0) return '오늘';
    if (diff === 1) return '1일 전';
    return `${diff}일 전`;
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
      if (res.ok && data.ok) alert('비밀번호가 123456으로 초기화되었습니다.');
      else alert(data?.error || '초기화에 실패했습니다.');
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setResetPasswordLoadingId(null);
    }
  };

  const handleCreateDropboxFolder = async (u: ListUser) => {
    setCreateDropboxFolderId(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/create-dropbox-folder`, { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok && data.dropboxFolderPath) {
        setUsers((prev) => prev.map((user) => (user.id === u.id ? { ...user, dropboxFolderPath: data.dropboxFolderPath } : user)));
        if (editUser?.id === u.id) setEditUser((prev) => (prev ? { ...prev, dropboxFolderPath: data.dropboxFolderPath } : null));
        alert(`폴더를 만들었습니다: ${data.dropboxFolderPath}`);
      } else {
        alert(data?.error || '폴더 생성에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setCreateDropboxFolderId(null);
    }
  };

  const handlePathSave = async (userId: string, path: string) => {
    setPathSavingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropboxFolderPath: path.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, dropboxFolderPath: path.trim() } : u)));
        if (editUser?.id === userId) setEditUser((prev) => (prev ? { ...prev, dropboxFolderPath: path.trim() } : null));
        setEditingPathId(null);
      } else {
        alert(data?.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setPathSavingId(null);
    }
  };

  const handleResetPath = async (userId: string) => {
    if (!confirm('드롭박스 폴더 경로를 초기화할까요?')) return;
    setPathSavingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dropboxFolderPath: '' }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, dropboxFolderPath: '' } : u)));
        if (editUser?.id === userId) setEditUser((prev) => (prev ? { ...prev, dropboxFolderPath: '' } : null));
        setEditingPathId(null);
      } else {
        alert(data?.error || '초기화에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setPathSavingId(null);
    }
  };

  const openOrderDetail = (o: AdminOrder) => {
    setOrderDetailModal(o);
    setFileUrlInput(o.fileUrl ?? '');
    setStatusInput(o.status || 'pending');
    setAssignLoginId(users[0]?.loginId ?? '');
  };

  const handleSaveFileUrl = async () => {
    if (!orderDetailModal) return;
    setFileUrlSavingId(orderDetailModal.id);
    try {
      const res = await fetch(`/api/orders/${orderDetailModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setFileUrl', fileUrl: fileUrlInput }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const next = { ...orderDetailModal, fileUrl: fileUrlInput };
        setRecentOrders((prev) => prev.map((o) => (o.id === orderDetailModal.id ? next : o)));
        setUserOrders((prev) => prev.map((o) => (o.id === orderDetailModal.id ? next : o)));
        setOrderDetailModal(next);
      } else {
        alert(data?.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setFileUrlSavingId(null);
    }
  };

  const handleSaveStatus = async () => {
    if (!orderDetailModal) return;
    setStatusSavingId(orderDetailModal.id);
    try {
      const res = await fetch(`/api/orders/${orderDetailModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setStatus', status: statusInput }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const label = STATUS_LABELS[statusInput] || statusInput;
        const next = { ...orderDetailModal, status: statusInput, statusLabel: label };
        setRecentOrders((prev) => prev.map((o) => (o.id === orderDetailModal.id ? next : o)));
        setUserOrders((prev) => prev.map((o) => (o.id === orderDetailModal.id ? next : o)));
        setOrderDetailModal(next);
      } else {
        alert(data?.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setStatusSavingId(null);
    }
  };

  const handleAssignMember = async () => {
    if (!orderDetailModal || !assignLoginId.trim()) return;
    setAssignSavingId(orderDetailModal.id);
    try {
      const res = await fetch(`/api/orders/${orderDetailModal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assignMember', loginId: assignLoginId.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        const user = users.find((u) => u.loginId === assignLoginId);
        const next = { ...orderDetailModal, loginId: assignLoginId.trim() };
        setRecentOrders((prev) => prev.map((o) => (o.id === orderDetailModal.id ? next : o)));
        setUserOrders((prev) => prev.map((o) => (o.id === orderDetailModal.id ? next : o)));
        setOrderDetailModal(next);
      } else {
        alert(data?.error || '연결에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setAssignSavingId(null);
    }
  };

  const handleDeleteOrder = async () => {
    if (!orderDetailModal || !confirm('이 주문을 삭제할까요? 삭제 후에는 복구할 수 없습니다.')) return;
    setDeleteSavingId(orderDetailModal.id);
    try {
      const res = await fetch(`/api/orders/${orderDetailModal.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setRecentOrders((prev) => prev.filter((o) => o.id !== orderDetailModal.id));
        setUserOrders((prev) => prev.filter((o) => o.id !== orderDetailModal.id));
        setOrderDetailModal(null);
      } else {
        alert(data?.error || '삭제에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setDeleteSavingId(null);
    }
  };

  const openOrdersModal = (u: ListUser) => {
    setOrdersModalUser(u);
    setUserOrders([]);
    setUserOrdersLoading(true);
    fetch(`/api/admin/orders?loginId=${encodeURIComponent(u.loginId)}`)
      .then((r) => r.json())
      .then((d) => setUserOrders(d.orders || []))
      .finally(() => setUserOrdersLoading(false));
  };

  const today = new Date().toDateString();
  const todayOrders = recentOrders.filter((o) => new Date(o.createdAt).toDateString() === today);
  const needLinkOrders = recentOrders.filter((o) => (o.status || 'pending') !== 'cancelled' && !o.fileUrl);
  const needLinkCount = needLinkOrders.length;

  const filteredOrders = recentOrders.filter((o) => {
    if (orderFilter === 'pending' && (o.status || 'pending') !== 'pending') return false;
    if (orderFilter === 'completed' && (o.status || 'pending') !== 'completed') return false;
    const q = orderSearch.trim().toLowerCase();
    if (!q) return true;
    const num = (o.orderNumber ?? '').toLowerCase();
    const lid = (o.loginId ?? '').toLowerCase();
    return num.includes(q) || lid.includes(q);
  });

  const displayOrders = section === 'dashboard' ? recentOrders.slice(0, 8) : filteredOrders;
  const orderCountFor = (loginIdKey: string) => stats?.orderCountByLoginId?.[loginIdKey] ?? 0;

  const todayStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).replace(/\. /g, '.').replace('.', ' ');

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin w-10 h-10 border-4 border-slate-600 border-t-white rounded-full" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      {/* Sidebar */}
      <aside className="w-60 bg-slate-800 shrink-0 flex flex-col border-r border-slate-700">
        <div className="p-5 border-b border-slate-700">
          <h1 className="font-bold text-lg text-white">PAYPERIC ADMIN</h1>
        </div>
        <nav className="p-3 flex-1 text-sm">
          <p className="px-3 py-2 text-slate-500 uppercase tracking-wider text-xs">OVERVIEW</p>
          <button
            type="button"
            onClick={() => setSection('dashboard')}
            className={`w-full text-left px-4 py-2.5 rounded-lg font-medium transition-colors ${section === 'dashboard' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/50'}`}
          >
            대시보드
          </button>
          <p className="px-3 py-2 text-slate-500 uppercase tracking-wider text-xs mt-4">ORDERS</p>
          <button
            type="button"
            onClick={() => setSection('orders')}
            className={`w-full text-left px-4 py-2.5 rounded-lg font-medium transition-colors flex items-center justify-between ${section === 'orders' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/50'}`}
          >
            <span>전체 주문</span>
            {needLinkCount > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold min-w-[1.25rem] h-5 px-1.5 rounded-full flex items-center justify-center">
                {needLinkCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => { setSection('orders'); setOrderFilter('pending'); }}
            className="w-full text-left px-4 py-2.5 rounded-lg font-medium text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            미처리 주문
          </button>
          <p className="px-3 py-2 text-slate-500 uppercase tracking-wider text-xs mt-4">MEMBERS</p>
          <button
            type="button"
            onClick={() => setSection('members')}
            className={`w-full text-left px-4 py-2.5 rounded-lg font-medium transition-colors ${section === 'members' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-700/50'}`}
          >
            회원 관리
          </button>
          <button
            type="button"
            onClick={() => { setSection('members'); setTimeout(() => document.getElementById('quick-create')?.scrollIntoView({ behavior: 'smooth' }), 100); }}
            className="w-full text-left px-4 py-2.5 rounded-lg font-medium text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            + 계정 생성
          </button>
        </nav>
        <div className="p-4 border-t border-slate-700 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-slate-600 flex items-center justify-center text-sm font-bold text-white">
            {(user.loginId || 'A').charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-medium text-white text-sm">{user.loginId}</p>
            <p className="text-slate-400 text-xs">관리자</p>
          </div>
        </div>
        <div className="p-4 border-t border-slate-700">
          <Link href="/" className="text-slate-400 hover:text-white text-sm">← 메인으로</Link>
          <button type="button" onClick={handleLogout} className="block mt-2 text-slate-400 hover:text-white text-sm">로그아웃</button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-6xl mx-auto">
          <p className="text-slate-400 text-sm mb-6">{todayStr}</p>

          {/* Red alert: 미처리 주문 */}
          {needLinkCount > 0 && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-xl px-4 py-3 flex items-center justify-between mb-6">
              <span className="text-red-200 font-medium">
                미처리 주문 {needLinkCount}건이 있습니다 — 드롭박스 링크 등록이 필요해요
              </span>
              <button
                type="button"
                onClick={() => setSection('orders')}
                className="text-red-200 hover:text-white font-medium text-sm"
              >
                바로가기 →
              </button>
            </div>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
              <p className="text-slate-400 text-sm">오늘 주문</p>
              <p className="text-2xl font-bold text-white mt-1">{todayOrders.length}건</p>
              <p className="text-slate-500 text-xs mt-1">+{stats?.newOrdersThisWeek ?? 0}건 이번 주</p>
            </div>
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
              <p className="text-slate-400 text-sm">총 회원</p>
              <p className="text-2xl font-bold text-white mt-1">{users.length}명</p>
              <p className="text-slate-500 text-xs mt-1">+{stats?.newMembersThisMonth ?? 0}명 이번 달</p>
            </div>
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
              <p className="text-slate-400 text-sm">이번달 매출</p>
              <p className="text-2xl font-bold text-white mt-1">—</p>
              <p className="text-slate-500 text-xs mt-1">VAT 별도</p>
            </div>
            <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
              <p className="text-slate-400 text-sm">미처리 주문</p>
              <p className="text-2xl font-bold text-amber-400 mt-1 flex items-center gap-2">
                {needLinkCount}건
                {needLinkCount > 0 && (
                  <span className="text-amber-400" title="링크 등록 필요">⚠</span>
                )}
              </p>
              <p className="text-slate-500 text-xs mt-1">링크 등록 필요</p>
            </div>
          </div>

          {/* Recent orders (dashboard) or full orders (orders section) */}
          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden mb-8">
            <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
              <h2 className="font-bold text-lg text-white">최근 주문 요청</h2>
              {section === 'dashboard' && (
                <button type="button" onClick={() => setSection('orders')} className="text-slate-400 hover:text-white text-sm font-medium">
                  전체 보기 →
                </button>
              )}
            </div>
            {/* 주문번호 접두어 안내 (전체 주문 화면에서만 표시) */}
            {section === 'orders' && (
              <div className="px-5 py-4 bg-slate-700/40 border-b border-slate-700">
                <p className="text-slate-300 text-sm font-medium mb-2">주문번호 접두어 (플로우별)</p>
                <p className="text-slate-400 text-xs mb-3">접두어 2글자 = 재료(1글자) + 제품(1글자). 미지정·구버전 주문은 GJ로 표시됩니다.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-slate-500 shrink-0">재료:</span>
                    <span className="text-slate-300">M=모의고사, B=부교재, E=EBS</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-slate-500 shrink-0">제품:</span>
                    <span className="text-slate-300">V=변형문제, D=서술형, W=워크북, A=분석지</span>
                  </div>
                </div>
                <ul className="mt-3 text-xs text-slate-400 space-y-0.5">
                  <li><span className="font-mono text-cyan-300">BV</span> 부교재 + 변형문제 (교재·강 선택 후 문제 유형)</li>
                  <li><span className="font-mono text-cyan-300">MV</span> 모의고사 + 변형문제 (모의고사 설정·주문, 번호별 교재 제작)</li>
                  <li><span className="font-mono text-cyan-300">MW</span> 모의고사 + 워크북 (워크북 플로우에서 모의고사 교재 선택 시)</li>
                  <li><span className="font-mono text-cyan-300">BW</span> 부교재 + 워크북 (워크북 플로우에서 부교재 선택 시)</li>
                  <li><span className="font-mono text-slate-500">GJ</span> 구버전 또는 접두어 미지정</li>
                </ul>
              </div>
            )}
            {recentOrdersLoading ? (
              <div className="p-8 text-center text-slate-500">불러오는 중…</div>
            ) : displayOrders.length === 0 ? (
              <div className="p-8 text-center text-slate-500">주문이 없습니다.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      <th className="text-left py-3 px-5">주문번호</th>
                      <th className="text-left py-3 px-5">회원</th>
                      <th className="text-left py-3 px-5">주문 내용</th>
                      <th className="text-left py-3 px-5">금액</th>
                      <th className="text-left py-3 px-5">상태</th>
                      <th className="text-left py-3 px-5">드롭박스</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayOrders.map((o) => (
                      <tr key={o.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                        <td className="py-3 px-5 font-mono text-white">{o.orderNumber || '—'}</td>
                        <td className="py-3 px-5 text-slate-300">{o.loginId || '비회원'}</td>
                        <td className="py-3 px-5 text-slate-400 max-w-[200px] truncate" title={o.orderText?.slice(0, 200)}>
                          {o.orderText?.replace(/\s+/g, ' ').slice(0, 40) || '—'}
                          {(o.orderText?.length ?? 0) > 40 ? '…' : ''}
                        </td>
                        <td className="py-3 px-5 text-slate-500">—</td>
                        <td className="py-3 px-5">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${STATUS_BADGE_CLASS[o.status || 'pending'] || 'bg-gray-100 text-gray-700'}`} title={o.statusLabel}>
                            {o.statusLabel === '완료' ? '✓' : o.statusLabel === '제작 중' ? '◐' : '○'}
                          </span>
                          <span className="ml-1.5 text-slate-300 text-xs">{o.statusLabel}</span>
                        </td>
                        <td className="py-3 px-5">
                          <div className="flex flex-wrap items-center gap-2">
                            {o.fileUrl ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-medium">√ 링크 완료</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => openOrderDetail(o)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-600 hover:bg-slate-500 text-slate-200 text-xs font-medium"
                              >
                                🔗 링크 등록
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openOrderDetail(o)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-500 hover:bg-slate-600 text-slate-300 text-xs font-medium"
                            >
                              상태 변경
                            </button>
                            <a href={`/order/done?id=${o.id}`} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-white text-xs">보기</a>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {section === 'orders' && recentOrders.length > 0 && (
              <div className="px-5 py-3 border-t border-slate-700 flex flex-wrap items-center gap-3">
                <div className="flex rounded-lg overflow-hidden bg-slate-700">
                  {(['all', 'pending', 'completed'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setOrderFilter(f)}
                      className={`px-4 py-2 text-sm font-medium ${orderFilter === f ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}
                    >
                      {f === 'all' ? '전체' : f === 'pending' ? '미처리' : '완료'}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  placeholder="주문번호·아이디 검색"
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  className="px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 w-48 focus:ring-2 focus:ring-slate-500"
                />
              </div>
            )}
          </div>

          {/* Members section: reference MemberPanel style */}
          <div className="mb-8">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
              <h2 className="text-lg font-bold text-white tracking-tight">회원 관리</h2>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">🔍</span>
                  <input
                    type="text"
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    placeholder="회원 검색..."
                    className="pl-9 pr-3 py-2 w-48 bg-[#1a1d27] border border-[#2e3248] rounded-lg text-slate-200 text-sm outline-none focus:border-cyan-500"
                  />
                </div>
                <button type="button" onClick={() => document.getElementById('quick-create')?.scrollIntoView({ behavior: 'smooth' })} className="px-4 py-2 bg-[#00A9E0] text-white border-0 rounded-lg text-sm font-semibold hover:opacity-90">
                  ＋ 계정 추가
                </button>
              </div>
            </div>
            {!usersLoading && stats && !stats.dropboxConfigured && (
              <div className="mb-4 p-3 rounded-lg bg-amber-900/30 border border-amber-700/50 text-amber-200 text-sm">
                <strong>Dropbox 미설정.</strong> 회원별 폴더를 쓰려면 <code className="bg-slate-700 px-1 rounded">.env</code>에 DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN을 설정한 뒤 서버를 재시작하세요.
              </div>
            )}
            {!usersLoading && users.length > 0 && (
              <div className="flex gap-2.5 mb-5 flex-wrap">
                {[
                  { label: `전체 ${users.length}명`, color: 'bg-[#00A9E0]' },
                  { label: `드롭박스 연결 ${users.filter((u) => u.dropboxFolderPath?.trim()).length}명`, color: 'bg-[#22c55e]' },
                  { label: `미설정 ${users.filter((u) => !u.dropboxFolderPath?.trim()).length}명`, color: 'bg-[#f59e0b]' },
                ].map(({ label, color }) => (
                  <span key={label} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border border-[#2e3248] bg-[#1a1d27] text-slate-400">
                    <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
                    {label}
                  </span>
                ))}
              </div>
            )}
            {usersLoading ? (
              <div className="py-12 text-center text-slate-500">불러오는 중…</div>
            ) : (() => {
              const q = memberSearch.trim().toLowerCase();
              const filtered = q ? users.filter((u) => (u.loginId || '').toLowerCase().includes(q) || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q)) : users;
              if (filtered.length === 0) {
                return <div className="py-16 text-center text-slate-500">{q ? '검색 결과가 없습니다' : '등록된 회원이 없습니다.'}</div>;
              }
              return (
                <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))' }}>
                  {filtered.map((u, i) => {
                    const isUnset = !u.dropboxFolderPath?.trim();
                    const isEditingPath = editingPathId === u.id;
                    const pathVal = isEditingPath ? editingPathValue : (u.dropboxFolderPath ?? '');
                    return (
                      <div key={u.id} className={`rounded-2xl overflow-hidden border transition-colors ${isUnset ? 'border-amber-500/30 bg-[#1a1d27]' : 'border-[#2e3248] bg-[#1a1d27]'}`}>
                        <div className="p-4 flex items-start gap-3">
                          <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-base font-extrabold text-white shrink-0 bg-gradient-to-br ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                            {(u.name || u.loginId).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-white text-[15px] tracking-tight truncate">{u.name || u.loginId}</p>
                            <p className="text-slate-400 text-xs truncate mt-0.5">{u.email || u.loginId}</p>
                            <div className="flex gap-1.5 mt-1.5 flex-wrap">
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-cyan-500/10 text-cyan-400">주문 {orderCountFor(u.loginId)}건</span>
                              <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#22263a] text-slate-400" title={formatDate(u.createdAt)}>{daysAgo(u.createdAt)} 가입</span>
                            </div>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button type="button" onClick={() => openEdit(u)} title="수정" className="w-8 h-8 rounded-lg border border-[#2e3248] bg-transparent text-slate-400 flex items-center justify-center text-sm hover:border-slate-500 hover:text-white">✏️</button>
                            <button type="button" onClick={() => handleDelete(u.id)} disabled={deletingId === u.id} title="삭제" className="w-8 h-8 rounded-lg border border-[#2e3248] bg-transparent text-slate-400 flex items-center justify-center text-sm hover:border-red-400/50 hover:text-red-400 disabled:opacity-50">🗑️</button>
                          </div>
                        </div>
                        {/* Dropbox 섹션 */}
                        <div className={`mx-3 mb-3 rounded-xl overflow-hidden border ${isUnset ? 'border-amber-500/20 bg-[#22263a]' : 'border-[#2e3248] bg-[#22263a]'}`}>
                          <div className={`px-3 py-2 flex items-center gap-2 border-b ${isUnset ? 'border-amber-500/15' : 'border-[#2e3248]'}`}>
                            <span className="text-sm">📦</span>
                            <span className="text-[11px] font-semibold text-slate-400 flex-1">Dropbox 폴더</span>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${isUnset ? 'bg-amber-500/10 text-amber-400 border border-amber-500/25' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${isUnset ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                              {isUnset ? '미설정' : '연결됨'}
                            </span>
                          </div>
                          <div className="p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-slate-500 text-xs shrink-0">📁</span>
                              {isEditingPath ? (
                                <>
                                  <input
                                    type="text"
                                    value={editingPathValue}
                                    onChange={(e) => setEditingPathValue(e.target.value)}
                                    placeholder="예: /gomijoshua/이름_전화번호"
                                    className="flex-1 px-2 py-1.5 bg-[#1a1d27] border border-[#2e3248] rounded-lg text-slate-200 text-xs font-mono outline-none focus:border-cyan-500"
                                  />
                                  <button type="button" onClick={() => handlePathSave(u.id, editingPathValue)} disabled={pathSavingId === u.id} className="px-2.5 py-1.5 bg-[#00A9E0] text-white rounded-lg text-[11px] font-semibold shrink-0 disabled:opacity-70">
                                    {pathSavingId === u.id ? '저장 중…' : '저장'}
                                  </button>
                                  <button type="button" onClick={() => { setEditingPathId(null); setEditingPathValue(''); }} className="text-slate-500 text-xs shrink-0">취소</button>
                                </>
                              ) : (
                                <>
                                  <input
                                    type="text"
                                    readOnly
                                    value={pathVal || '—'}
                                    className="flex-1 px-2 py-1.5 bg-[#1a1d27] border border-[#2e3248] rounded-lg text-slate-400 text-xs font-mono truncate"
                                  />
                                  <button type="button" onClick={() => { setEditingPathId(u.id); setEditingPathValue(u.dropboxFolderPath ?? ''); }} className="px-2.5 py-1.5 border border-[#2e3248] text-slate-400 rounded-lg text-[11px] font-semibold shrink-0 hover:bg-slate-700/50">편집</button>
                                </>
                              )}
                            </div>
                            <div className="flex gap-1.5 flex-wrap">
                              {u.dropboxFolderPath?.trim() ? (
                                <>
                                  <a href={getDropboxFolderUrl(u.dropboxFolderPath)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#2e3248] text-slate-400 rounded-lg text-[11px] font-semibold hover:bg-slate-700/50 hover:text-slate-300">🔗 폴더 열기</a>
                                  <button type="button" onClick={() => handleCreateDropboxFolder(u)} disabled={createDropboxFolderId === u.id || !stats?.dropboxConfigured} className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#2e3248] text-slate-400 rounded-lg text-[11px] font-semibold hover:text-cyan-400 disabled:opacity-50">☁️ {createDropboxFolderId === u.id ? '생성 중…' : '다시 만들기'}</button>
                                  <button type="button" onClick={() => handleResetPath(u.id)} disabled={pathSavingId === u.id} className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#2e3248] text-slate-500 rounded-lg text-[11px] font-semibold hover:text-slate-400 disabled:opacity-50">✕ 경로 초기화</button>
                                </>
                              ) : (
                                <button type="button" onClick={() => handleCreateDropboxFolder(u)} disabled={createDropboxFolderId === u.id || !stats?.dropboxConfigured} className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-lg text-[11px] font-semibold hover:bg-blue-500/20 disabled:opacity-50">☁️ {createDropboxFolderId === u.id ? '생성 중…' : '폴더 자동 생성'}</button>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="px-4 pb-3">
                          <button type="button" onClick={() => openOrdersModal(u)} className="text-xs text-cyan-400 hover:underline bg-transparent border-0 cursor-pointer p-0">📋 주문 내역 보기 →</button>
                          <span className="text-slate-600 text-xs mx-2">·</span>
                          <button type="button" onClick={() => handleResetPassword(u.id)} disabled={resetPasswordLoadingId === u.id} className="text-xs text-amber-400 hover:underline bg-transparent border-0 cursor-pointer p-0 disabled:opacity-50">PW 초기화</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Quick account creation (bottom) */}
          <div id="quick-create" className="bg-slate-800 rounded-xl border border-slate-700 p-5">
            <h2 className="font-bold text-lg text-white mb-4">빠른 계정 생성</h2>
            <p className="text-slate-400 text-sm mb-4">초기 비밀번호는 <strong className="text-slate-300">123456</strong>으로 통일됩니다.</p>
            <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-end">
              <div>
                <label className="block text-slate-400 text-xs mb-1">아이디 *</label>
                <input
                  type="text"
                  value={loginId}
                  onChange={(e) => setLoginId(e.target.value)}
                  placeholder="예: student01"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm"
                  required
                  minLength={2}
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1">이름</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="이름"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1">이메일</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="이메일"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1">전화번호</label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01012345678 (폴더명에 사용)"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1">드롭박스 폴더 경로</label>
                <input
                  type="text"
                  value={dropboxFolderPath}
                  onChange={(e) => setDropboxFolderPath(e.target.value)}
                  placeholder="/gomijoshua/이름_전화번호"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm font-mono"
                />
              </div>
              <div>
                {message && <p className={`text-sm mb-2 ${message.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</p>}
                <button
                  type="submit"
                  disabled={submitLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {submitLoading ? '생성 중…' : '계정 생성'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>

      {/* Order detail modal */}
      {orderDetailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-700">
            <h3 className="font-bold text-white mb-1">주문 관리</h3>
            <p className="text-slate-400 text-sm mb-4 font-mono">{orderDetailModal.orderNumber} · {orderDetailModal.loginId || '비회원'}</p>

            {!orderDetailModal.loginId && users.length > 0 && (
              <div className="mb-4 p-4 rounded-lg bg-slate-700/50 border border-slate-600">
                <label className="block text-slate-300 text-sm font-medium mb-2">회원으로 연결 (가입 전 주문)</label>
                <p className="text-slate-500 text-xs mb-2">이 주문을 회원 계정에 연결하면, 해당 회원이 내정보에서 주문 이력을 볼 수 있습니다.</p>
                <select
                  value={assignLoginId}
                  onChange={(e) => setAssignLoginId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm mb-2"
                >
                  <option value="">회원 선택</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.loginId}>{u.loginId} ({u.name})</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAssignMember}
                  disabled={!assignLoginId.trim() || assignSavingId === orderDetailModal.id}
                  className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg disabled:opacity-50"
                >
                  {assignSavingId === orderDetailModal.id ? '연결 중…' : '이 주문을 회원으로 연결'}
                </button>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-slate-400 text-sm mb-1">상태 변경</label>
                <select value={statusInput} onChange={(e) => setStatusInput(e.target.value)} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm">
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <button type="button" onClick={handleSaveStatus} disabled={statusSavingId === orderDetailModal.id} className="mt-2 px-3 py-1.5 bg-slate-600 text-white text-sm rounded-lg hover:bg-slate-500 disabled:opacity-50">
                  {statusSavingId === orderDetailModal.id ? '저장 중…' : '상태 저장'}
                </button>
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">드롭박스 공유 링크</label>
                <input type="url" value={fileUrlInput} onChange={(e) => setFileUrlInput(e.target.value)} placeholder="https://..." className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500" />
                <button type="button" onClick={handleSaveFileUrl} disabled={fileUrlSavingId === orderDetailModal.id} className="mt-2 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-500 disabled:opacity-50">
                  {fileUrlSavingId === orderDetailModal.id ? '저장 중…' : '링크 저장'}
                </button>
              </div>
            </div>
            <div className="mt-6 flex gap-2">
              <a href={`/order/done?id=${orderDetailModal.id}`} target="_blank" rel="noopener noreferrer" className="flex-1 text-center px-4 py-2 border border-slate-600 rounded-lg text-sm font-medium text-slate-300 hover:bg-slate-700">주문서 보기</a>
              <button type="button" onClick={handleDeleteOrder} disabled={deleteSavingId === orderDetailModal.id} className="px-4 py-2 bg-red-600/80 text-white rounded-lg text-sm font-medium hover:bg-red-600 disabled:opacity-50">{deleteSavingId === orderDetailModal.id ? '삭제 중…' : '삭제'}</button>
              <button type="button" onClick={() => setOrderDetailModal(null)} className="px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* User orders modal */}
      {ordersModalUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col p-6 border border-slate-700">
            <h3 className="font-bold text-white mb-2">주문 이력 — {ordersModalUser.loginId} ({ordersModalUser.name})</h3>
            {userOrdersLoading ? (
              <p className="text-slate-500">불러오는 중…</p>
            ) : userOrders.length === 0 ? (
              <p className="text-slate-500">주문 이력이 없습니다.</p>
            ) : (
              <div className="overflow-y-auto flex-1 border border-slate-600 rounded-lg mt-2">
                <table className="w-full text-sm">
                  <thead><tr className="bg-slate-700/50 text-slate-400"><th className="text-left py-2 px-3">주문번호</th><th className="text-left py-2 px-3">일시</th><th className="text-left py-2 px-3">상태</th><th className="text-left py-2 px-3">보기</th></tr></thead>
                  <tbody>
                    {userOrders.map((o) => (
                      <tr key={o.id} className="border-t border-slate-700">
                        <td className="py-2 px-3 font-mono text-white">{o.orderNumber || '—'}</td>
                        <td className="py-2 px-3 text-slate-400">{formatDateTime(o.createdAt)}</td>
                        <td className="py-2 px-3"><span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE_CLASS[o.status || 'pending'] || ''}`}>{o.statusLabel}</span></td>
                        <td className="py-2 px-3">
                          <button type="button" onClick={() => { setOrdersModalUser(null); openOrderDetail(o); }} className="text-blue-400 hover:underline text-xs">관리</button>
                          <a href={`/order/done?id=${o.id}`} target="_blank" rel="noopener noreferrer" className="ml-2 text-blue-400 hover:underline text-xs">보기</a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button type="button" onClick={() => setOrdersModalUser(null)} className="mt-4 px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500">닫기</button>
          </div>
        </div>
      )}

      {/* Edit user modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6 border border-slate-700">
            <h3 className="font-bold text-white mb-4">계정 수정 — {editUser.loginId}</h3>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-slate-400 text-sm mb-1">이름</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">이메일</label>
                <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">전화번호</label>
                <input type="text" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="01012345678 (폴더명에 사용)" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm" />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">드롭박스 폴더 경로</label>
                <input type="text" value={editDropboxFolderPath} onChange={(e) => setEditDropboxFolderPath(e.target.value)} placeholder="/gomijoshua/이름_전화번호" className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm font-mono" />
              </div>
              <div>
                <label className="block text-slate-400 text-sm mb-1">Dropbox 공유 링크 (회원이 폴더 열 때 사용)</label>
                <input type="url" value={editDropboxSharedLink} onChange={(e) => setEditDropboxSharedLink(e.target.value)} placeholder="https://www.dropbox.com/scl/fo/..." className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500" />
                <p className="text-xs text-slate-500 mt-1">폴더 공유 후 링크를 붙여넣으면 회원이 내 페이지에서 폴더 열기가 됩니다.</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-slate-400 text-sm">
                <input type="checkbox" checked={editResetPassword} onChange={(e) => setEditResetPassword(e.target.checked)} className="rounded border-slate-500 text-slate-600 bg-slate-700" />
                비밀번호 123456으로 초기화
              </label>
              {editMessage && <p className={`text-sm ${editMessage.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>{editMessage.text}</p>}
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={editSaving} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-500 disabled:opacity-50">{editSaving ? '저장 중…' : '저장'}</button>
                <button type="button" onClick={() => setEditUser(null)} className="px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500">취소</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
