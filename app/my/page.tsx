'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppBar from '../components/AppBar';

interface AuthUser {
  loginId: string;
  role: string;
  name: string;
  email: string;
  dropboxFolderPath?: string;
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

type TabKey = 'orders' | 'exam' | 'settings';
type ExamSubTabKey = 'upload' | 'list';

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

  const [pastExamSchool, setPastExamSchool] = useState('');
  const [pastExamGrade, setPastExamGrade] = useState('');
  const [pastExamYear, setPastExamYear] = useState('');
  const [pastExamType, setPastExamType] = useState('');
  const [pastExamScope, setPastExamScope] = useState('');
  const [pastExamSubmitting, setPastExamSubmitting] = useState(false);
  const [pastExamMessage, setPastExamMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pastExamFiles, setPastExamFiles] = useState<FileList | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  interface PastExamUpload {
    id: string;
    school: string;
    grade: string;
    examYear: string;
    examType: string;
    examScope: string;
    files: { originalName: string; fileIndex: number }[];
    adminCategories?: string[];
    createdAt: string;
  }
  const [pastExamUploads, setPastExamUploads] = useState<PastExamUpload[]>([]);
  const [pastExamLoading, setPastExamLoading] = useState(false);
  const [deletingUploadId, setDeletingUploadId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{ url: string; name: string; type: 'pdf' | 'image' } | null>(null);
  const [examListExpanded, setExamListExpanded] = useState(false);
  const [examSubTab, setExamSubTab] = useState<ExamSubTabKey>('upload');

  const [activeTab, setActiveTab] = useState<TabKey>('orders');

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

  const fetchPastExamUploads = () => {
    setPastExamLoading(true);
    fetch('/api/my/past-exam-upload')
      .then((res) => res.json())
      .then((data) => setPastExamUploads(data.uploads || []))
      .catch(() => setPastExamUploads([]))
      .finally(() => setPastExamLoading(false));
  };

  useEffect(() => {
    if (!user) return;
    fetchPastExamUploads();
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

  const handleDeleteUpload = async (id: string) => {
    if (!confirm('이 기출문제 업로드를 삭제하시겠습니까? 첨부 파일도 함께 삭제됩니다.')) return;
    setDeletingUploadId(id);
    try {
      const res = await fetch('/api/my/past-exam-upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPastExamUploads((prev) => prev.filter((u) => u.id !== id));
      } else {
        alert(data.error || '삭제에 실패했습니다.');
      }
    } catch {
      alert('삭제 요청 중 오류가 발생했습니다.');
    } finally {
      setDeletingUploadId(null);
    }
  };

  const handlePastExamSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPastExamMessage(null);
    setPastExamSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('school', pastExamSchool);
      formData.append('grade', pastExamGrade);
      formData.append('examYear', pastExamYear);
      formData.append('examType', pastExamType);
      formData.append('examScope', pastExamScope);
      if (pastExamFiles?.length) {
        for (let i = 0; i < pastExamFiles.length; i++) {
          formData.append('files', pastExamFiles[i]);
        }
      }
      const res = await fetch('/api/my/past-exam-upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setPastExamMessage({ type: 'success', text: '기출문제 업로드 정보 및 파일이 접수되었습니다.' });
        setPastExamSchool('');
        setPastExamGrade('');
        setPastExamYear('');
        setPastExamType('');
        setPastExamScope('');
        setPastExamFiles(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        fetchPastExamUploads();
      } else {
        setPastExamMessage({ type: 'error', text: data?.error || '저장에 실패했습니다.' });
      }
    } catch {
      setPastExamMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setPastExamSubmitting(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) {
      setPastExamFiles(e.dataTransfer.files);
      if (fileInputRef.current) {
        const dt = new DataTransfer();
        Array.from(e.dataTransfer.files).forEach((f) => dt.items.add(f));
        fileInputRef.current.files = dt.files;
      }
    }
  };

  if (loading) {
    return (
      <>
        <AppBar title="페이퍼릭" />
        <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
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

  const getPreviewType = (name: string): 'pdf' | 'image' | null => {
    const ext = name.toLowerCase().split('.').pop() || '';
    if (ext === 'pdf') return 'pdf';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image';
    return null;
  };

  const openPreview = (uploadId: string, fileIndex: number, fileName: string) => {
    const type = getPreviewType(fileName);
    if (!type) return;
    const url = `/api/my/past-exam-upload/download?id=${uploadId}&fileIndex=${fileIndex}&inline=1`;
    setPreviewFile({ url, name: fileName, type });
  };

  const tabs: { key: TabKey; label: string; icon: string; count?: number }[] = [
    { key: 'orders', label: '주문 내역', icon: '📋', count: orders.length },
    { key: 'exam', label: '기출문제', icon: '📤' },
    { key: 'settings', label: '내 정보', icon: '⚙️' },
  ];

  return (
    <>
      <AppBar title="페이퍼릭" />
      <div className="min-h-screen bg-[#f8fafc] text-[#0f172a] font-['Noto_Sans_KR',sans-serif]">
        {/* 상단 헤더 */}
        <div className="bg-white border-b border-[#e2e8f0]">
          <div className="max-w-3xl mx-auto px-5 pt-5 pb-0">
            <Link href="/" className="inline-flex items-center gap-1 text-[#2563eb] text-[13px] font-medium hover:underline mb-4">
              ← 메인 화면으로
            </Link>
            <div className="flex items-center gap-4 mb-5">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#14213d] to-[#2563eb] flex items-center justify-center text-2xl font-black text-white shrink-0">
                {(user.name || user.loginId).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-lg font-extrabold tracking-tight">{user.name || user.loginId}</div>
                <div className="text-sm text-[#64748b]">{user.loginId}</div>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className="px-4 py-2 text-[13px] text-[#64748b] border border-[#e2e8f0] rounded-xl hover:bg-gray-50 shrink-0"
              >
                로그아웃
              </button>
            </div>

            {/* Dropbox 상태 바 */}
            {hasDropbox ? (
              <div className="flex items-center gap-3 p-3 mb-5 rounded-xl bg-[#f0f9ff] border border-[#bae6fd]">
                <span className="text-base">📁</span>
                <span className="flex-1 text-[13px] text-[#0369a1] font-medium truncate">{user.dropboxFolderPath?.replace(/^\/+/, '')}</span>
                <a
                  href={user.dropboxSharedLink?.trim() || getDropboxFolderUrl(user.dropboxFolderPath!)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#0061ff] text-white rounded-lg text-[12px] font-bold hover:bg-[#0052d9] no-underline shrink-0"
                >
                  폴더 열기
                </a>
              </div>
            ) : (
              <div className="flex items-center gap-3 p-3 mb-5 rounded-xl bg-[#fffbeb] border border-[#fde68a]">
                <span className="text-base">📂</span>
                <span className="flex-1 text-[13px] text-[#92400e]">Dropbox 폴더가 아직 연결되지 않았어요. 관리자에게 문의해 주세요.</span>
              </div>
            )}

            {/* 탭 네비게이션 */}
            <div className="flex gap-0 -mb-px">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex items-center gap-1.5 px-4 py-3 text-[13px] font-semibold border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'border-[#2563eb] text-[#2563eb]'
                      : 'border-transparent text-[#94a3b8] hover:text-[#64748b]'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      activeTab === tab.key ? 'bg-[#2563eb] text-white' : 'bg-[#e2e8f0] text-[#64748b]'
                    }`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 탭 컨텐츠 */}
        <div className="max-w-3xl mx-auto px-5 py-6">

          {/* ━━ 주문 내역 탭 ━━ */}
          {activeTab === 'orders' && (
            <div>
              {orders.length === 0 ? (
                <div className="py-20 text-center">
                  <div className="text-5xl mb-3 opacity-40">📋</div>
                  <p className="text-sm text-[#94a3b8] mb-1">아직 제출한 주문이 없습니다</p>
                  <Link href="/" className="text-[13px] text-[#2563eb] font-medium hover:underline">
                    메인에서 주문하러 가기 →
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {orders.map((order) => {
                    const variant = statusVariant(order.status);
                    const statusLabel = ORDER_STATUS_LABELS[order.status] || order.status;
                    const canDownload = !!order.fileUrl;
                    return (
                      <div key={order.id} className="bg-white rounded-2xl border border-[#e2e8f0] p-4 hover:shadow-sm transition-shadow">
                        <div className="flex items-start gap-3">
                          <div className="px-2.5 py-1 bg-[#14213d] text-white rounded-lg text-[11px] font-bold font-mono shrink-0 mt-0.5">
                            {order.orderNumber || order.id.slice(-8)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-[#0f172a] truncate mb-1.5">{orderTitle(order.orderText)}</div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-[#94a3b8]">{formatDate(order.createdAt)}</span>
                              <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                                  variant === 'done' ? 'bg-[#dcfce7] text-[#16a34a]' :
                                  variant === 'making' ? 'bg-[#fef3c7] text-[#d97706]' :
                                  variant === 'cancel' ? 'bg-gray-100 text-gray-400' :
                                  'bg-[#dbeafe] text-[#2563eb]'
                                }`}
                              >
                                {variant === 'done' && '✓ '}
                                {variant === 'making' && '⏳ '}
                                {statusLabel}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#f1f5f9]">
                          <Link
                            href={`/order/done?id=${order.id}`}
                            className="flex-1 text-center py-2.5 border border-[#e2e8f0] rounded-xl text-xs font-semibold text-[#64748b] hover:border-[#3b82f6] hover:text-[#2563eb] no-underline transition-colors"
                          >
                            주문서 보기
                          </Link>
                          {canDownload ? (
                            <a
                              href={order.fileUrl!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex-1 text-center py-2.5 rounded-xl text-xs font-bold bg-[#2563eb] text-white hover:bg-[#1d4ed8] no-underline transition-colors"
                            >
                              📦 자료 받기
                            </a>
                          ) : (
                            <span className="flex-1 text-center py-2.5 rounded-xl text-xs font-semibold border border-[#e2e8f0] text-[#c5cdd8] cursor-not-allowed">
                              자료 준비 중
                            </span>
                          )}
                          {order.status === 'pending' && (
                            <button
                              type="button"
                              onClick={() => handleCancelOrder(order.id)}
                              disabled={cancellingId === order.id}
                              className="py-2.5 px-3 rounded-xl text-xs text-red-500 border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors"
                            >
                              {cancellingId === order.id ? '취소 중…' : '취소'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ━━ 기출문제 탭 (하위: 업로드 / 조회) ━━ */}
          {activeTab === 'exam' && (
            <div className="space-y-5">
            {/* 기출 하위 메뉴 */}
            <div className="flex gap-0 border-b border-[#e2e8f0] bg-white rounded-t-2xl overflow-hidden">
              <button
                type="button"
                onClick={() => setExamSubTab('upload')}
                className={`flex-1 py-3 text-[13px] font-semibold transition-colors ${examSubTab === 'upload' ? 'text-[#2563eb] border-b-2 border-[#2563eb] bg-[#f8fafc]' : 'text-[#94a3b8] hover:text-[#64748b] bg-white'}`}
              >
                기출문제 업로드
              </button>
              <button
                type="button"
                onClick={() => setExamSubTab('list')}
                className={`flex-1 py-3 text-[13px] font-semibold transition-colors ${examSubTab === 'list' ? 'text-[#2563eb] border-b-2 border-[#2563eb] bg-[#f8fafc]' : 'text-[#94a3b8] hover:text-[#64748b] bg-white'}`}
              >
                업로드한 기출문제 조회
              </button>
            </div>

            {examSubTab === 'upload' && (
            <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#f1f5f9]">
                <p className="text-sm font-bold text-[#0f172a]">기출문제 업로드</p>
                <p className="text-[12px] text-[#94a3b8] mt-0.5">서술형 맞춤 제작에 사용할 기출문제를 등록해 주세요</p>
              </div>
              <form onSubmit={handlePastExamSubmit} className="p-5 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="past-exam-school" className="block text-xs font-semibold text-[#475569] mb-1.5">학교</label>
                    <input
                      id="past-exam-school"
                      type="text"
                      value={pastExamSchool}
                      onChange={(e) => setPastExamSchool(e.target.value)}
                      placeholder="예: OO고등학교"
                      className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)]"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="past-exam-grade" className="block text-xs font-semibold text-[#475569] mb-1.5">학년</label>
                    <select
                      id="past-exam-grade"
                      value={pastExamGrade}
                      onChange={(e) => setPastExamGrade(e.target.value)}
                      className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)] bg-white"
                      required
                    >
                      <option value="">선택하세요</option>
                      <option value="고1">고1</option>
                      <option value="고2">고2</option>
                      <option value="고3">고3</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="past-exam-year" className="block text-xs font-semibold text-[#475569] mb-1.5">시험연도</label>
                    <select
                      id="past-exam-year"
                      value={pastExamYear}
                      onChange={(e) => setPastExamYear(e.target.value)}
                      className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)] bg-white"
                      required
                    >
                      <option value="">선택하세요</option>
                      {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                        <option key={y} value={String(y)}>{y}년</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="past-exam-type" className="block text-xs font-semibold text-[#475569] mb-1.5">시험 종류</label>
                    <select
                      id="past-exam-type"
                      value={pastExamType}
                      onChange={(e) => setPastExamType(e.target.value)}
                      className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)] bg-white"
                      required
                    >
                      <option value="">선택하세요</option>
                      <option value="1학기중간고사">1학기 중간고사</option>
                      <option value="1학기기말고사">1학기 기말고사</option>
                      <option value="2학기중간고사">2학기 중간고사</option>
                      <option value="2학기기말고사">2학기 기말고사</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="past-exam-scope" className="block text-xs font-semibold text-[#475569] mb-1.5">시험범위</label>
                  <textarea
                    id="past-exam-scope"
                    value={pastExamScope}
                    onChange={(e) => setPastExamScope(e.target.value)}
                    placeholder="시험범위를 자유롭게 입력해 주세요"
                    rows={3}
                    className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)] resize-y"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#475569] mb-1.5">기출문제 파일 첨부 (선택)</label>
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`relative flex flex-col items-center justify-center py-8 px-4 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                      dragActive
                        ? 'border-[#2563eb] bg-[#eff6ff]'
                        : 'border-[#d1d5db] bg-[#fafafa] hover:border-[#93c5fd] hover:bg-[#f0f9ff]'
                    }`}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.hwp,.hwpx"
                      onChange={(e) => setPastExamFiles(e.target.files?.length ? e.target.files : null)}
                      className="hidden"
                    />
                    <div className="text-3xl mb-2 opacity-50">📎</div>
                    <p className="text-sm font-medium text-[#475569] mb-1">파일을 끌어다 놓거나 클릭하세요</p>
                    <p className="text-[11px] text-[#94a3b8]">PDF, HWP, HWPX 또는 이미지 · 최대 5개 · 각 15MB 이하</p>
                  </div>
                  {pastExamFiles?.length ? (
                    <div className="mt-3 space-y-1.5">
                      {Array.from(pastExamFiles).map((f, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-2 bg-[#f1f5f9] rounded-lg text-[12px]">
                          <span className="text-[#64748b]">📄</span>
                          <span className="flex-1 truncate text-[#334155] font-medium">{f.name}</span>
                          <span className="text-[#94a3b8] shrink-0">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                {pastExamMessage && (
                  <div className={`flex items-center gap-2 p-3 rounded-xl text-sm font-medium ${
                    pastExamMessage.type === 'success' ? 'bg-[#dcfce7] text-[#16a34a]' : 'bg-[#fef2f2] text-[#dc2626]'
                  }`}>
                    <span>{pastExamMessage.type === 'success' ? '✓' : '!'}</span>
                    {pastExamMessage.text}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={pastExamSubmitting}
                  className="w-full py-3.5 bg-[#16a34a] text-white rounded-xl text-sm font-bold hover:bg-[#15803d] disabled:opacity-70 transition-colors"
                >
                  {pastExamSubmitting ? '접수 중…' : '기출문제 업로드'}
                </button>
              </form>
            </div>
            )}

            {examSubTab === 'list' && (
            <div className="bg-white rounded-2xl border border-[#e2e8f0] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#f1f5f9] flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-[#0f172a]">기출문제 조회</p>
                  <p className="text-[12px] text-[#94a3b8] mt-0.5">내가 올린 기출문제 {pastExamUploads.length}건</p>
                </div>
              </div>
              {pastExamLoading ? (
                <div className="py-10 text-center">
                  <div className="animate-spin w-6 h-6 border-3 border-[#2563eb] border-t-transparent rounded-full mx-auto" />
                </div>
              ) : pastExamUploads.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="text-4xl mb-2 opacity-30">📋</div>
                  <p className="text-sm text-[#94a3b8]">아직 올린 기출문제가 없습니다</p>
                </div>
              ) : (
                <>
                <div className="divide-y divide-[#f1f5f9]">
                  {(examListExpanded ? pastExamUploads : pastExamUploads.slice(0, 3)).map((upload) => (
                    <div key={upload.id} className="px-5 py-4 hover:bg-[#fafafa] transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-[#0f172a] mb-1">
                            {upload.school} · {upload.grade} · {upload.examYear}년 {upload.examType}
                          </div>
                          {upload.examScope && (
                            <p className="text-xs text-[#64748b] mb-1.5 line-clamp-2">시험범위: {upload.examScope}</p>
                          )}
                          {upload.adminCategories && upload.adminCategories.length > 0 ? (
                            <div className="mb-1.5 flex flex-wrap items-center gap-1">
                              <span className="text-[11px] text-[#16a34a] font-semibold">관리자 분류:</span>
                              <span className="text-[11px] text-[#475569]">{upload.adminCategories.join(', ')}</span>
                            </div>
                          ) : (
                            <p className="text-[11px] text-amber-600 font-medium mb-1.5">서술형 기출문제를 분석 중입니다.</p>
                          )}
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="text-[11px] text-[#94a3b8]">{formatDate(upload.createdAt)}</span>
                            {upload.files.length > 0 && (
                              <span className="inline-flex items-center gap-1 text-[11px] text-[#64748b] bg-[#f1f5f9] px-2 py-0.5 rounded-full">
                                📎 파일 {upload.files.length}개
                              </span>
                            )}
                          </div>
                          {upload.files.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                              {upload.files.map((f, i) => {
                                const previewable = !!getPreviewType(f.originalName);
                                return (
                                  <div key={i} className="flex items-center gap-1.5 text-[11px]">
                                    <span className="text-[#94a3b8]">📄</span>
                                    <a
                                      href={`/api/my/past-exam-upload/download?id=${upload.id}&fileIndex=${f.fileIndex}`}
                                      className="text-[#2563eb] hover:underline truncate no-underline flex-1 min-w-0"
                                      download
                                    >
                                      {f.originalName}
                                    </a>
                                    {previewable && (
                                      <button
                                        type="button"
                                        onClick={() => openPreview(upload.id, f.fileIndex, f.originalName)}
                                        className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold text-[#475569] bg-[#f1f5f9] hover:bg-[#e2e8f0] transition-colors"
                                      >
                                        미리보기
                                      </button>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteUpload(upload.id)}
                          disabled={deletingUploadId === upload.id}
                          className="shrink-0 px-3 py-2 rounded-xl text-xs text-red-500 border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors"
                        >
                          {deletingUploadId === upload.id ? '삭제 중…' : '삭제'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {pastExamUploads.length > 3 && !examListExpanded && (
                  <div className="px-5 py-4 border-t border-[#f1f5f9]">
                    <button
                      type="button"
                      onClick={() => setExamListExpanded(true)}
                      className="w-full py-2.5 rounded-xl border border-[#e2e8f0] text-[13px] font-semibold text-[#64748b] hover:bg-[#f8fafc] hover:border-[#cbd5e1] transition-colors"
                    >
                      더보기 ({pastExamUploads.length - 3}건 더)
                    </button>
                  </div>
                )}
                {examListExpanded && pastExamUploads.length > 3 && (
                  <div className="px-5 py-3 border-t border-[#f1f5f9]">
                    <button
                      type="button"
                      onClick={() => setExamListExpanded(false)}
                      className="text-[12px] text-[#94a3b8] hover:text-[#64748b]"
                    >
                      접기
                    </button>
                  </div>
                )}
                </>
              )}
            </div>
            )}
            </div>
          )}

          {/* ━━ 내 정보 탭 ━━ */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              {/* 이메일 */}
              <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                <div className="text-sm font-bold text-[#0f172a] mb-3">이메일 주소</div>
                <form onSubmit={handleSaveEmail} className="flex gap-2 items-center">
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="flex-1 px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] text-[#0f172a] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)]"
                  />
                  <button type="submit" disabled={emailSaving} className="px-5 py-3 bg-[#2563eb] text-white rounded-xl text-[13px] font-bold shrink-0 hover:bg-[#1d4ed8] disabled:opacity-70 transition-colors">
                    {emailSaving ? '저장 중…' : '저장'}
                  </button>
                </form>
                {emailMessage && (
                  <p className={`text-sm mt-2 ${emailMessage.type === 'success' ? 'text-[#16a34a]' : 'text-red-600'}`}>{emailMessage.text}</p>
                )}
              </div>

              {/* 비밀번호 변경 */}
              <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                <div className="text-sm font-bold text-[#0f172a] mb-3">비밀번호 변경</div>
                <form onSubmit={handleChangePassword} className="space-y-3">
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="새 비밀번호"
                    className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)]"
                    minLength={4}
                    autoComplete="new-password"
                  />
                  <input
                    type="password"
                    value={newPasswordConfirm}
                    onChange={(e) => setNewPasswordConfirm(e.target.value)}
                    placeholder="새 비밀번호 확인"
                    className="w-full px-3.5 py-3 border border-[#e2e8f0] rounded-xl text-[13px] outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[rgba(37,99,235,0.1)]"
                    minLength={4}
                    autoComplete="new-password"
                  />
                  <button
                    type="submit"
                    disabled={passwordSaving}
                    className="w-full py-3 bg-[#14213d] text-white rounded-xl text-[13px] font-bold hover:opacity-90 disabled:opacity-70 transition-colors"
                  >
                    {passwordSaving ? '변경 중…' : '비밀번호 변경'}
                  </button>
                </form>
                {passwordMessage && (
                  <p className={`text-sm mt-2 ${passwordMessage.type === 'success' ? 'text-[#16a34a]' : 'text-red-600'}`}>{passwordMessage.text}</p>
                )}
              </div>

              {/* Dropbox 정보 */}
              <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                <div className="text-sm font-bold text-[#0f172a] mb-3">Dropbox 폴더</div>
                {hasDropbox ? (
                  <div className="flex items-center gap-3 p-3 bg-[#f0f9ff] border border-[#bae6fd] rounded-xl">
                    <span className="text-lg">📁</span>
                    <span className="flex-1 text-[13px] text-[#0369a1] font-mono font-medium break-all">{user.dropboxFolderPath?.replace(/^\/+/, '')}</span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold bg-[#dcfce7] text-[#16a34a]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />연결됨
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-3 bg-[#fffbeb] border border-[#fde68a] rounded-xl">
                    <span className="text-lg">📂</span>
                    <span className="flex-1 text-[13px] text-[#92400e]">아직 연결되지 않았어요. 관리자에게 문의해 주세요.</span>
                  </div>
                )}
              </div>

              {/* 포인트 */}
              <div className="bg-white rounded-2xl border border-[#e2e8f0] p-5">
                <div className="text-sm font-bold text-[#0f172a] mb-3">내 포인트</div>
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-black tracking-tight">0 <sub className="text-xs font-medium text-[#94a3b8]">P</sub></span>
                  <span className="px-3 py-1.5 bg-[#f1f5f9] border border-[#e2e8f0] rounded-full text-[11px] text-[#94a3b8]">포인트 기능은 준비 중입니다</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 미리보기 모달 */}
      {previewFile && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="relative w-[95vw] max-w-4xl h-[90vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-5 py-3 border-b border-[#e2e8f0] shrink-0">
              <span className="text-sm font-bold text-[#0f172a] flex-1 truncate">{previewFile.name}</span>
              <a
                href={previewFile.url.replace('&inline=1', '')}
                download
                className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-[#2563eb] bg-[#eff6ff] hover:bg-[#dbeafe] no-underline transition-colors"
              >
                다운로드
              </a>
              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#0f172a] text-lg transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-[#f1f5f9] flex items-center justify-center">
              {previewFile.type === 'pdf' ? (
                <iframe
                  src={previewFile.url}
                  className="w-full h-full border-0"
                  title={previewFile.name}
                />
              ) : (
                <img
                  src={previewFile.url}
                  alt={previewFile.name}
                  className="max-w-full max-h-full object-contain p-4"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
