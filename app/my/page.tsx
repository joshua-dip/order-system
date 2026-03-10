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
  dropboxFolderPath?: string;
  /** 회원이 폴더 열기로 사용할 Dropbox 공유 링크 (관리자가 등록) */
  dropboxSharedLink?: string;
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

function getDropboxFolderUrl(path: string): string {
  if (!path?.trim()) return '#';
  const trimmed = path.trim().replace(/^\/+/, '');
  const pathEnc = trimmed.split('/').filter(Boolean).map((s) => encodeURIComponent(s)).join('/');
  const workSpace = typeof process.env.NEXT_PUBLIC_DROPBOX_WORK_SPACE === 'string' && process.env.NEXT_PUBLIC_DROPBOX_WORK_SPACE.trim();
  return workSpace
    ? `https://www.dropbox.com/work/${encodeURIComponent(workSpace)}/앱/${pathEnc}`
    : `https://www.dropbox.com/work/Apps/${pathEnc}`;
}

function orderTitle(orderText: string): string {
  const first = orderText.split(/\r?\n/)[0]?.trim() || orderText.slice(0, 60);
  return first.length > 80 ? first.slice(0, 80) + '…' : first;
}

function statusVariant(status: string): 'new' | 'making' | 'done' | 'cancel' {
  if (status === 'completed') return 'done';
  if (status === 'cancelled') return 'cancel';
  if (['accepted', 'payment_confirmed', 'in_progress'].includes(status)) return 'making';
  return 'new';
}

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
        <AppBar title="페이퍼릭" />
        <div className="min-h-screen flex items-center justify-center bg-[#f1f5f9] font-['Noto_Sans_KR',sans-serif]">
          <div className="animate-spin w-10 h-10 border-4 border-[#2563eb] border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  if (!user) return null;

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      return d;
    }
  };

  const hasDropbox = !!user.dropboxFolderPath?.trim();

  return (
    <>
      <AppBar title="페이퍼릭" />
      <div className="min-h-screen flex flex-col bg-[#f1f5f9] text-[#0f172a] font-['Noto_Sans_KR',sans-serif]">
        <Link href="/" className="flex items-center gap-1.5 text-[#2563eb] text-[13px] font-medium py-3.5 px-7 hover:underline">
          ← 메인 화면으로
        </Link>

        <div className="max-w-[900px] w-full mx-auto px-6 pb-16 flex-1 grid gap-3.5 grid-cols-1 md:grid-cols-2 grid-rows-auto" style={{ gridTemplateRows: 'auto auto auto' }}>
          {/* ① 내 정보 */}
          <section className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden">
            <div className="p-5">
              <div className="flex items-center gap-3.5 mb-4">
                <div className="w-12 h-12 rounded-[13px] bg-gradient-to-br from-[#14213d] to-[#2563eb] flex items-center justify-center text-xl font-black text-white shrink-0">
                  {(user.name || user.loginId).charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="text-[17px] font-extrabold tracking-tight">{user.name || user.loginId}</div>
                  <div className="text-xs text-[#64748b] font-mono">{user.loginId}</div>
                </div>
              </div>
              <div className="text-[11px] text-[#94a3b8] font-medium mb-1">이메일 주소</div>
              <form onSubmit={handleSaveEmail} className="flex gap-2 items-center mb-3">
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="flex-1 px-3 py-2.5 border border-[#e2e8f0] rounded-lg text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb]"
                />
                <button type="submit" disabled={emailSaving} className="px-4 py-2.5 bg-[#2563eb] text-white rounded-lg text-[13px] font-semibold shrink-0 hover:bg-[#3b82f6] disabled:opacity-70">
                  {emailSaving ? '저장 중…' : '저장'}
                </button>
              </form>
              {emailMessage && (
                <p className={`text-sm mb-2 ${emailMessage.type === 'success' ? 'text-[#16a34a]' : 'text-red-600'}`}>{emailMessage.text}</p>
              )}
              <div className="h-px bg-[#e2e8f0] my-3.5" />
              <div className="text-xs font-bold text-[#64748b] mb-2.5 tracking-wide">비밀번호 변경</div>
              <form onSubmit={handleChangePassword} className="grid grid-cols-2 gap-2 mb-2.5">
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="새 비밀번호"
                  className="px-3 py-2 border border-[#e2e8f0] rounded-lg text-[13px] outline-none focus:border-[#2563eb]"
                  minLength={4}
                  autoComplete="new-password"
                />
                <input
                  type="password"
                  value={newPasswordConfirm}
                  onChange={(e) => setNewPasswordConfirm(e.target.value)}
                  placeholder="새 비밀번호 확인"
                  className="px-3 py-2 border border-[#e2e8f0] rounded-lg text-[13px] outline-none focus:border-[#2563eb]"
                  minLength={4}
                  autoComplete="new-password"
                />
              </form>
              <div className="flex items-center gap-2 flex-wrap">
                <button type="submit" disabled={passwordSaving} className="px-4 py-2 bg-[#14213d] text-white rounded-lg text-[13px] font-semibold hover:opacity-90 disabled:opacity-70">
                  비밀번호 변경
                </button>
                <button type="button" onClick={handleLogout} className="px-3.5 py-2 text-[13px] text-[#64748b] border border-[#e2e8f0] rounded-lg hover:bg-gray-50 ml-auto">
                  로그아웃
                </button>
              </div>
              {passwordMessage && (
                <p className={`text-sm mt-2 ${passwordMessage.type === 'success' ? 'text-[#16a34a]' : 'text-red-600'}`}>{passwordMessage.text}</p>
              )}
            </div>
          </section>

          {/* ② 내 Dropbox 폴더 */}
          <section className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#e2e8f0] flex items-center gap-3">
              <div className="w-10 h-10 rounded-[11px] bg-[rgba(0,97,255,0.07)] border border-[rgba(0,97,255,0.15)] flex items-center justify-center text-lg">
                📦
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold tracking-tight">내 Dropbox 폴더</div>
                <div className="text-[11px] text-[#64748b]">주문 자료가 여기로 자동 전달돼요</div>
              </div>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 ${hasDropbox ? 'bg-[rgba(22,163,74,0.09)] text-[#16a34a] border border-[rgba(22,163,74,0.2)]' : 'bg-[rgba(217,119,6,0.09)] text-[#d97706] border border-[rgba(217,119,6,0.2)]'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${hasDropbox ? 'bg-[#16a34a]' : 'bg-[#d97706]'}`} />
                {hasDropbox ? '연결됨' : '미설정'}
              </span>
            </div>
            <div className="p-4">
              {hasDropbox ? (
                <>
                  <div className="flex items-center gap-2.5 p-3 bg-[#f8fafc] border border-[#e2e8f0] rounded-xl mb-3">
                    <span className="text-base shrink-0">📁</span>
                    <span className="flex-1 text-[13px] font-mono font-medium text-[#14213d] break-all">{user.dropboxFolderPath?.replace(/^\/+/, '')}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-xs text-[#94a3b8]">주문 완료 시 자료가 폴더로 전달돼요</span>
                    <a href={user.dropboxSharedLink?.trim() || getDropboxFolderUrl(user.dropboxFolderPath!)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#0061ff] text-white rounded-lg text-[13px] font-bold hover:bg-[#0052d9] no-underline">
                      🔗 폴더 열기
                    </a>
                  </div>
                  {!user.dropboxSharedLink?.trim() && (
                    <p className="text-[11px] text-[#94a3b8] mt-2">관리자가 Dropbox 폴더 공유 링크를 등록하면, 회원이 이 버튼으로 폴더를 열 수 있어요.</p>
                  )}
                </>
              ) : (
                <div className="p-5 text-center rounded-xl bg-[rgba(217,119,6,0.04)] border border-dashed border-[rgba(217,119,6,0.3)]">
                  <div className="text-2xl mb-2">📂</div>
                  <div className="text-[13px] font-semibold text-[#d97706] mb-1">Dropbox 폴더가 연결되지 않았어요</div>
                  <div className="text-xs text-[#94a3b8]">관리자가 연결하면 주문 자료를 받을 수 있어요</div>
                </div>
              )}
            </div>
          </section>

          {/* ③ 주문 내역 */}
          <section className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden md:col-span-2">
            <div className="px-5 py-4 border-b border-[#e2e8f0] flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm font-bold tracking-tight">내 주문·자료</span>
              <span className="text-xs text-[#94a3b8]">제작 수락·입금 확인·제작 진행 상황을 확인할 수 있어요</span>
            </div>
            {orders.length === 0 ? (
              <div className="py-14 px-6 text-center">
                <div className="text-4xl mb-2">📋</div>
                <p className="text-sm text-[#94a3b8]">아직 제출한 주문이 없습니다</p>
              </div>
            ) : (
              <ul>
                {orders.map((order) => {
                  const variant = statusVariant(order.status);
                  const statusLabel = ORDER_STATUS_LABELS[order.status] || order.status;
                  const canDownload = !!order.fileUrl;
                  return (
                    <li key={order.id} className="px-5 py-4 border-b border-[#e2e8f0] flex items-start gap-3.5 hover:bg-[#f8fafc] transition-colors last:border-b-0">
                      <div className="px-2.5 py-1 bg-[#14213d] text-white rounded-md text-[11px] font-bold font-mono shrink-0 mt-0.5">
                        {order.orderNumber || order.id.slice(-8)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[#0f172a] truncate">{orderTitle(order.orderText)}</div>
                        <div className="flex items-center gap-2 flex-wrap mt-1">
                          <span className="text-xs text-[#94a3b8]">{formatDate(order.createdAt)}</span>
                          <span
                            className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              variant === 'done' ? 'bg-[rgba(22,163,74,0.09)] text-[#16a34a]' :
                              variant === 'making' ? 'bg-[rgba(217,119,6,0.09)] text-[#d97706]' :
                              variant === 'cancel' ? 'bg-gray-100 text-gray-500' :
                              'bg-[rgba(37,99,235,0.08)] text-[#2563eb]'
                            }`}
                          >
                            {variant === 'done' && '✓ '}
                            {variant === 'making' && '⏳ '}
                            {variant === 'new' && '📋 '}
                            {statusLabel}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="flex gap-1.5">
                          <Link href={`/order/done?id=${order.id}`} className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-[#e2e8f0] rounded-lg text-xs font-semibold text-[#64748b] hover:border-[#3b82f6] hover:text-[#2563eb] no-underline">
                            📄 주문서
                          </Link>
                          {canDownload ? (
                            <a href={order.fileUrl!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[rgba(0,97,255,0.07)] border border-[rgba(0,97,255,0.2)] text-[#0061ff] hover:bg-[rgba(0,97,255,0.13)] no-underline">
                              📦 자료 받기
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-[#e2e8f0] text-[#94a3b8] opacity-60 cursor-not-allowed">
                              📦 자료 받기
                            </span>
                          )}
                        </div>
                        {order.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => handleCancelOrder(order.id)}
                            disabled={cancellingId === order.id}
                            className="text-xs text-red-600 hover:underline disabled:opacity-50"
                          >
                            {cancellingId === order.id ? '취소 중…' : '주문 취소'}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ④ 포인트 */}
          <section className="bg-white border border-[#e2e8f0] rounded-2xl overflow-hidden md:col-span-2">
            <div className="px-5 py-4 border-b border-[#e2e8f0]">
              <span className="text-sm font-bold tracking-tight">내 포인트</span>
            </div>
            <div className="px-5 py-4 flex items-center gap-3.5">
              <span className="text-[26px] font-black tracking-tight">0 <sub className="text-sm font-medium text-[#64748b] ml-0.5">P</sub></span>
              <span className="px-3 py-1.5 bg-[#f1f5f9] border border-[#e2e8f0] rounded-full text-xs text-[#94a3b8]">포인트 충전·사용 기능은 준비 중입니다</span>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
