'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import AdminSidebar from '../../_components/AdminSidebar';
import { isEbsTextbook } from '@/lib/textbookSort';

/* ─── 타입 ─── */
type TextbooksMode = 'analysis' | 'essay' | 'workbook' | 'variant';

interface DetailUser {
  id: string;
  loginId: string;
  name: string;
  email: string;
  phone: string;
  dropboxFolderPath: string;
  dropboxSharedLink: string;
  canAccessAnalysis: boolean;
  canAccessEssay: boolean;
  myFormatApproved: boolean;
  allowedTextbooks: string[];
  allowedTextbooksAnalysis?: string[];
  allowedTextbooksEssay?: string[];
  allowedTextbooksWorkbook?: string[];
  allowedTextbooksVariant?: string[];
  allowedEssayTypeIds: string[];
  points: number;
  supplementaryNote: string;
  annualMemberSince: string | null;
  monthlyMemberSince: string | null;
  monthlyMemberUntil: string | null;
  signupPremiumTrialUntil: string | null;
  isVip: boolean;
  vipSince: string | null;
  createdAt: string;
}

interface AdminOrder {
  id: string;
  orderNumber: string | null;
  orderText: string;
  createdAt: string;
  status: string;
  statusLabel: string;
  orderMetaFlow: string | null;
  revenueWon: number | null;
  completedAt: string | null;
  fileUrl: string | null;
  dropboxFolderCreated: boolean;
}

interface PointLedgerItem {
  id: string;
  delta: number;
  balanceAfter: number;
  kind: string;
  kindLabel: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

type Tab = 'info' | 'orders' | 'points' | 'dropbox' | 'vocabulary';

interface VocabAdminRow {
  id: string;
  user_id: string;
  login_id: string;
  passage_id: string;
  textbook: string;
  display_label: string;
  package_type: string;
  points_used: number;
  order_number: string;
  purchased_at: string;
  last_edited_at: string;
  entry_count: number;
  has_custom_edit: boolean;
}

/* ─── 뱃지 ─── */
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  processing: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  cancelled: 'bg-red-500/20 text-red-300 border-red-500/40',
};

const AVATAR_COLORS = [
  'from-violet-500 to-purple-600',
  'from-sky-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-pink-500 to-rose-600',
];

function Badge({ text, cls }: { text: string; cls: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      {text}
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider">{children}</h3>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      {children}
    </div>
  );
}

function EditInput({
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-400"
    />
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <div
        onClick={() => onChange(!checked)}
        className={`w-10 h-5.5 rounded-full relative transition-colors ${checked ? 'bg-sky-500' : 'bg-slate-600'}`}
        style={{ height: '1.375rem' }}
      >
        <span
          className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
          style={{ width: '1.125rem', height: '1.125rem' }}
        />
      </div>
      <span className="text-sm text-slate-200">{label}</span>
    </label>
  );
}

/* ─── 메인 컴포넌트 ─── */
export default function UserDetailPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params?.id as string;

  const [adminLoginId, setAdminLoginId] = useState('');
  const [user, setUser] = useState<DetailUser | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [pointItems, setPointItems] = useState<PointLedgerItem[]>([]);
  const [vocabItems, setVocabItems] = useState<VocabAdminRow[]>([]);
  const [vocabTotal, setVocabTotal] = useState(0);
  const [vocabLoading, setVocabLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('info');

  /* 저장 상태 */
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* 편집 폼 상태 */
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editAnnual, setEditAnnual] = useState('');
  const [editMonthlyFrom, setEditMonthlyFrom] = useState('');
  const [editMonthlyUntil, setEditMonthlyUntil] = useState('');
  const [editIsVip, setEditIsVip] = useState(false);
  const [editAnalysis, setEditAnalysis] = useState(false);
  const [editEssay, setEditEssay] = useState(false);
  const [editMyFormat, setEditMyFormat] = useState(false);

  /* 포인트 지급 */
  const [addPointsInput, setAddPointsInput] = useState('');
  const [addingPoints, setAddingPoints] = useState(false);

  /* Dropbox */
  const [editDropboxPath, setEditDropboxPath] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [dropboxMsg, setDropboxMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /* 삭제 확인 */
  const [confirmDelete, setConfirmDelete] = useState(false);

  /* 교재 관리 모달 */
  const [textbooksMode, setTextbooksMode] = useState<TextbooksMode | null>(null);
  const [textbookList, setTextbookList] = useState<string[]>([]);
  const [textbooksSelected, setTextbooksSelected] = useState<string[]>([]);
  const [textbooksLoading, setTextbooksLoading] = useState(false);
  const [textbooksSaving, setTextbooksSaving] = useState(false);

  /* 주문 관리 모달 */
  const [orderModal, setOrderModal] = useState<AdminOrder | null>(null);
  const [orderModalTab, setOrderModalTab] = useState<'order' | 'manage' | 'email'>('order');
  const [orderStatusInput, setOrderStatusInput] = useState('');
  const [orderFileUrlInput, setOrderFileUrlInput] = useState('');
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderSaveMsg, setOrderSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [orderEmailTo, setOrderEmailTo] = useState('');
  const [orderEmailSubject, setOrderEmailSubject] = useState('');
  const [orderEmailMessage, setOrderEmailMessage] = useState('');
  const [orderEmailSending, setOrderEmailSending] = useState(false);
  const [orderEmailResult, setOrderEmailResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [orderCreatingFolder, setOrderCreatingFolder] = useState(false);
  const [orderDeletingId, setOrderDeletingId] = useState<string | null>(null);
  /* 이메일 첨부 */
  const [orderAttachments, setOrderAttachments] = useState<{ filename: string; content: string; contentType: string; size: number }[]>([]);
  const [dbxFiles, setDbxFiles] = useState<{ name: string; apiPath: string; size: number }[]>([]);
  const [dbxFilesLoading, setDbxFilesLoading] = useState(false);
  const [dbxFilesError, setDbxFilesError] = useState<string | null>(null);
  const [dbxSelected, setDbxSelected] = useState<Set<string>>(() => new Set());
  const [dbxAttaching, setDbxAttaching] = useState(false);

  /* ─── 데이터 로딩 ─── */
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user || d.user.role !== 'admin') { router.replace('/admin/login'); return; }
        setAdminLoginId(d.user.loginId ?? '');
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  const loadUser = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(`/api/admin/users/${userId}`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok || !d.user) { setError(d.error ?? '회원을 찾을 수 없습니다.'); return; }
      const u: DetailUser = d.user;
      setUser(u);
      setEditName(u.name);
      setEditEmail(u.email);
      setEditPhone(u.phone);
      setEditNote(u.supplementaryNote);
      setEditAnnual(u.annualMemberSince ?? '');
      setEditMonthlyFrom(u.monthlyMemberSince ?? '');
      setEditMonthlyUntil(u.monthlyMemberUntil ?? '');
      setEditIsVip(u.isVip);
      setEditAnalysis(u.canAccessAnalysis);
      setEditEssay(u.canAccessEssay);
      setEditMyFormat(u.myFormatApproved);
      setEditDropboxPath(u.dropboxFolderPath);
    } catch {
      setError('불러오는 중 오류가 발생했습니다.');
    }
  }, [userId]);

  const loadOrders = useCallback(async () => {
    if (!user?.loginId) return;
    const r = await fetch(`/api/admin/orders?loginId=${encodeURIComponent(user.loginId)}&limit=50`, { credentials: 'include' });
    const d = await r.json();
    if (d?.orders) setOrders(d.orders);
  }, [user?.loginId]);

  const openOrderModal = (o: AdminOrder) => {
    setOrderModal(o);
    setOrderModalTab('order');
    setOrderStatusInput(o.status);
    setOrderFileUrlInput(o.fileUrl ?? '');
    setOrderSaveMsg(null);
    setOrderEmailResult(null);
    setOrderAttachments([]);
    setDbxFiles([]);
    setDbxFilesError(null);
    setDbxSelected(new Set());
    // 드롭박스 파일 자동 로드
    setDbxFilesLoading(true);
    fetch(`/api/admin/orders/${o.id}/dropbox-files`, { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          const fileOnly = (data.files as { name: string; apiPath: string; size: number; isFolder: boolean }[]).filter((f) => !f.isFolder);
          setDbxFiles(fileOnly);
          const autoSelect = new Set(fileOnly.filter((f) => !f.name.startsWith('주문서_')).map((f) => f.apiPath));
          setDbxSelected(autoSelect);
        } else if (data.error && !data.error.includes('not_found') && !data.error.includes('Dropbox 환경')) {
          setDbxFilesError(data.error);
        }
      })
      .catch(() => { /* 드롭박스 없으면 무시 */ })
      .finally(() => setDbxFilesLoading(false));
    // 이메일 기본값
    const userEmail = user?.email ?? '';
    const emailFromText = o.orderText?.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/)?.[0] ?? null;
    setOrderEmailTo(emailFromText ?? userEmail);
    const orderNum = o.orderNumber ?? `주문 ${o.id.slice(-6)}`;
    setOrderEmailSubject(`[주문서] ${orderNum} 주문 내역 안내`);
    const greeting = user?.name ? `안녕하세요, ${user.name} 선생님` : '안녕하세요';
    const statusMsgs: Record<string, string> = {
      payment_confirmed: `${greeting}\n\n입금이 확인되었습니다. 감사합니다 :)\n제작을 시작하겠습니다. 완료되면 다시 안내 드리겠습니다.`,
      in_progress: `${greeting}\n\n현재 열심히 제작 중입니다. 조금만 기다려 주세요!`,
      completed: `${greeting}\n\n제작이 완료되었습니다! 파일 첨부드립니다:)`,
      accepted: `${greeting}\n\n주문을 확인했습니다. 입금 확인 후 제작을 시작하겠습니다.\n감사합니다!`,
    };
    setOrderEmailMessage(statusMsgs[o.status] ?? `${greeting}\n\n주문 내역을 안내드립니다. 문의 사항이 있으시면 언제든지 답장 주세요!`);
  };

  const handleOrderSaveStatus = async () => {
    if (!orderModal) return;
    setOrderSaving(true);
    setOrderSaveMsg(null);
    try {
      const r = await fetch(`/api/orders/${orderModal.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setStatus', status: orderStatusInput }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        setOrderSaveMsg({ ok: true, text: '상태가 저장되었습니다.' });
        const updated = { ...orderModal, status: orderStatusInput, statusLabel: d.statusLabel ?? orderStatusInput };
        setOrderModal(updated);
        setOrders((prev) => prev.map((o) => o.id === updated.id ? updated : o));
      } else {
        setOrderSaveMsg({ ok: false, text: d.error ?? '저장 실패' });
      }
    } catch { setOrderSaveMsg({ ok: false, text: '네트워크 오류' }); }
    finally { setOrderSaving(false); }
  };

  const handleOrderSaveFileUrl = async () => {
    if (!orderModal) return;
    setOrderSaving(true);
    setOrderSaveMsg(null);
    try {
      const r = await fetch(`/api/orders/${orderModal.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setFileUrl', fileUrl: orderFileUrlInput }),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        setOrderSaveMsg({ ok: true, text: '파일 URL이 저장되었습니다.' });
        const updated = { ...orderModal, fileUrl: orderFileUrlInput };
        setOrderModal(updated);
        setOrders((prev) => prev.map((o) => o.id === updated.id ? updated : o));
      } else {
        setOrderSaveMsg({ ok: false, text: d.error ?? '저장 실패' });
      }
    } catch { setOrderSaveMsg({ ok: false, text: '네트워크 오류' }); }
    finally { setOrderSaving(false); }
  };

  const handleOrderSendEmail = async () => {
    if (!orderModal || !orderEmailTo.trim()) return;
    setOrderEmailSending(true);
    setOrderEmailResult(null);
    try {
      const r = await fetch(`/api/admin/orders/${orderModal.id}/send-email`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: orderEmailTo,
          subject: orderEmailSubject,
          message: orderEmailMessage,
          attachments: orderAttachments.length > 0 ? orderAttachments : undefined,
        }),
      });
      const d = await r.json();
      setOrderEmailResult(r.ok && d.ok ? { ok: true, msg: '발송되었습니다.' } : { ok: false, msg: d.error ?? '발송 실패' });
    } catch { setOrderEmailResult({ ok: false, msg: '네트워크 오류' }); }
    finally { setOrderEmailSending(false); }
  };

  const handleDbxAttach = async () => {
    if (!orderModal || dbxSelected.size === 0) return;
    const selectedFiles = dbxFiles.filter((f) => dbxSelected.has(f.apiPath));
    setDbxAttaching(true);
    try {
      const res = await fetch(`/api/admin/orders/${orderModal.id}/dropbox-files`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: selectedFiles.map((f) => f.apiPath), names: selectedFiles.map((f) => f.name) }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.files)) {
        const attached = (data.files as { filename: string; content: string; contentType: string; size: number }[]);
        setOrderAttachments((prev) => {
          const existing = new Set(prev.map((a) => a.filename));
          return [...prev, ...attached.filter((a) => !existing.has(a.filename))];
        });
        setDbxSelected(new Set());
        if (data.errors?.length) alert(`일부 파일 오류:\n${(data.errors as string[]).join('\n')}`);
      } else {
        alert(data.error ?? '파일 다운로드 실패');
      }
    } catch { alert('파일 첨부 중 오류가 발생했습니다.'); }
    finally { setDbxAttaching(false); }
  };

  const handleOrderCreateDropboxFolder = async () => {
    if (!orderModal) return;
    setOrderCreatingFolder(true);
    try {
      const r = await fetch(`/api/admin/orders/${orderModal.id}/create-dropbox-folder`, { method: 'POST', credentials: 'include' });
      const d = await r.json();
      if (r.ok && d.ok) {
        const updated = { ...orderModal, dropboxFolderCreated: true };
        setOrderModal(updated);
        setOrders((prev) => prev.map((o) => o.id === updated.id ? updated : o));
        setOrderSaveMsg({ ok: true, text: `드롭박스 폴더 생성 완료: ${d.folderPath ?? ''}` });
      } else {
        setOrderSaveMsg({ ok: false, text: d.error ?? '폴더 생성 실패' });
      }
    } catch { setOrderSaveMsg({ ok: false, text: '네트워크 오류' }); }
    finally { setOrderCreatingFolder(false); }
  };

  const handleOrderDelete = async (orderId: string) => {
    if (!confirm('주문을 삭제하시겠습니까? 포인트 사용 내역이 있으면 자동으로 환불됩니다.')) return;
    setOrderDeletingId(orderId);
    try {
      const r = await fetch(`/api/orders/${orderId}`, { method: 'DELETE', credentials: 'include' });
      const d = await r.json();
      if (r.ok && d.ok) {
        setOrders((prev) => prev.filter((o) => o.id !== orderId));
        if (orderModal?.id === orderId) setOrderModal(null);
        await loadUser();
      } else {
        alert(d.error ?? '삭제 실패');
      }
    } catch { alert('네트워크 오류'); }
    finally { setOrderDeletingId(null); }
  };

  const loadPoints = useCallback(async () => {
    if (!userId) return;
    const r = await fetch(`/api/admin/users/${userId}/point-ledger`, { credentials: 'include' });
    const d = await r.json();
    if (d?.items) setPointItems(d.items);
  }, [userId]);

  const loadVocabularies = useCallback(async () => {
    if (!userId) return;
    setVocabLoading(true);
    try {
      const r = await fetch(`/api/admin/users/${userId}/vocabularies?limit=200&skip=0`, { credentials: 'include' });
      const d = await r.json();
      if (r.ok) {
        setVocabItems(d.items ?? []);
        setVocabTotal(typeof d.total === 'number' ? d.total : 0);
      } else {
        setVocabItems([]);
        setVocabTotal(0);
      }
    } catch {
      setVocabItems([]);
      setVocabTotal(0);
    } finally {
      setVocabLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    loadUser().finally(() => setLoading(false));
  }, [loadUser]);

  useEffect(() => {
    if (user && tab === 'orders') loadOrders();
  }, [user, tab, loadOrders]);

  useEffect(() => {
    if (user && tab === 'points') loadPoints();
  }, [user, tab, loadPoints]);

  useEffect(() => {
    if (user && tab === 'vocabulary') loadVocabularies();
  }, [user, tab, loadVocabularies]);

  /* ─── 기본정보 저장 ─── */
  async function handleSaveInfo() {
    if (!user) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const body: Record<string, unknown> = {
        name: editName,
        email: editEmail,
        phone: editPhone,
        supplementaryNote: editNote,
        canAccessAnalysis: editAnalysis,
        canAccessEssay: editEssay,
        myFormatApproved: editMyFormat,
        isVip: editIsVip,
        annualMemberSince: editAnnual || null,
        monthlyMemberSince: editMonthlyFrom || null,
        monthlyMemberUntil: editMonthlyUntil || null,
      };
      const r = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok) {
        setSaveMsg({ ok: true, text: '저장되었습니다.' });
        await loadUser();
      } else {
        setSaveMsg({ ok: false, text: d.error ?? '저장 실패' });
      }
    } catch {
      setSaveMsg({ ok: false, text: '네트워크 오류' });
    } finally {
      setSaving(false);
    }
  }

  /* ─── 비밀번호 초기화 ─── */
  async function handleResetPassword() {
    if (!confirm('비밀번호를 초기값으로 초기화할까요?')) return;
    const r = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resetPassword: true }),
    });
    const d = await r.json();
    alert(r.ok ? '비밀번호가 초기화되었습니다.' : (d.error ?? '실패'));
  }

  /* ─── 포인트 지급 ─── */
  async function handleAddPoints() {
    const n = parseInt(addPointsInput, 10);
    if (!n || n <= 0) { alert('지급할 포인트를 입력하세요.'); return; }
    setAddingPoints(true);
    try {
      const r = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addPoints: n }),
      });
      const d = await r.json();
      if (r.ok) {
        setAddPointsInput('');
        await loadUser();
        await loadPoints();
      } else {
        alert(d.error ?? '포인트 지급 실패');
      }
    } finally {
      setAddingPoints(false);
    }
  }

  /* ─── Dropbox 경로 저장 ─── */
  async function handleSaveDropbox() {
    setSaving(true);
    setDropboxMsg(null);
    const r = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dropboxFolderPath: editDropboxPath }),
    });
    const d = await r.json();
    setDropboxMsg(r.ok ? { ok: true, text: '저장되었습니다.' } : { ok: false, text: d.error ?? '실패' });
    if (r.ok) await loadUser();
    setSaving(false);
  }

  /* ─── Dropbox 폴더 생성 ─── */
  async function handleCreateDropboxFolder() {
    if (!editDropboxPath.trim()) { alert('먼저 폴더 경로를 입력하세요.'); return; }
    setCreatingFolder(true);
    setDropboxMsg(null);
    try {
      const r = await fetch(`/api/admin/users/${userId}/create-dropbox-folder`, { method: 'POST', credentials: 'include' });
      const d = await r.json();
      setDropboxMsg(r.ok ? { ok: true, text: '폴더가 생성되었습니다.' } : { ok: false, text: d.error ?? '실패' });
      if (r.ok) await loadUser();
    } finally {
      setCreatingFolder(false);
    }
  }

  /* ─── 계정 삭제 ─── */
  async function handleDelete() {
    const r = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE', credentials: 'include' });
    const d = await r.json();
    if (r.ok) {
      alert('계정이 삭제되었습니다.');
      router.push('/admin/users');
    } else {
      alert(d.error ?? '삭제 실패');
      setConfirmDelete(false);
    }
  }

  /* ─── 교재 관리 ─── */
  async function openTextbooksModal(mode: TextbooksMode) {
    if (!user) return;
    setTextbooksMode(mode);
    const legacy = Array.isArray(user.allowedTextbooks) ? user.allowedTextbooks : [];
    if (mode === 'analysis' || mode === 'essay') {
      const list =
        mode === 'analysis'
          ? Array.isArray(user.allowedTextbooksAnalysis)
            ? user.allowedTextbooksAnalysis
            : legacy
          : Array.isArray(user.allowedTextbooksEssay)
            ? user.allowedTextbooksEssay
            : legacy;
      setTextbooksSelected([...list]);
    } else {
      setTextbooksSelected([]);
    }
    setTextbooksLoading(true);
    try {
      const r = await fetch('/api/textbooks');
      const data = await r.json();
      if (data && typeof data === 'object' && !data.error) {
        let keys = Object.keys(data);
        if (mode === 'workbook' || mode === 'variant') {
          keys = keys.filter((k) => !/^고[123]_/.test(k));
          const solbookSet = new Set<string>();
          try {
            const sr = await fetch('/api/settings/variant-solbook', { cache: 'no-store' });
            const sj = (await sr.json()) as { textbookKeys?: unknown };
            if (Array.isArray(sj.textbookKeys)) {
              for (const k of sj.textbookKeys) {
                if (typeof k === 'string' && k.trim()) solbookSet.add(k.trim());
              }
            }
          } catch { /* solbook 실패해도 EBS만 제외 */ }
          keys = keys
            .filter((k) => !isEbsTextbook(k) && !solbookSet.has(k))
            .sort((a, b) => a.localeCompare(b, 'ko'));
          if (mode === 'workbook') {
            setTextbookList(keys);
            if (Array.isArray(user.allowedTextbooksWorkbook)) {
              setTextbooksSelected(user.allowedTextbooksWorkbook.filter((t) => keys.includes(t)));
            } else if (legacy.length > 0) {
              setTextbooksSelected(keys.filter((k) => legacy.includes(k)));
            } else {
              setTextbooksSelected([...keys]);
            }
          } else if (Array.isArray(user.allowedTextbooksVariant)) {
            const saved = user.allowedTextbooksVariant.filter((t): t is string => typeof t === 'string');
            const orphans = saved.filter(
              (t) => !keys.includes(t) && !/^고[123]_/.test(t) && !isEbsTextbook(t) && !solbookSet.has(t)
            );
            const list = [...keys, ...orphans].sort((a, b) => a.localeCompare(b, 'ko'));
            setTextbookList(list);
            setTextbooksSelected(saved.filter((t) => list.includes(t)));
          } else if (legacy.length > 0) {
            setTextbookList(keys);
            setTextbooksSelected(keys.filter((k) => legacy.includes(k)));
          } else {
            setTextbookList(keys);
            setTextbooksSelected([...keys]);
          }
        } else {
          setTextbookList(keys);
        }
      } else {
        setTextbookList([]);
      }
    } catch {
      setTextbookList([]);
    } finally {
      setTextbooksLoading(false);
    }
  }

  function closeTextbooksModal() {
    setTextbooksMode(null);
    setTextbookList([]);
    setTextbooksSelected([]);
  }

  async function saveAllowedTextbooks() {
    if (!textbooksMode) return;
    setTextbooksSaving(true);
    try {
      const body =
        textbooksMode === 'analysis'
          ? { allowedTextbooksAnalysis: textbooksSelected }
          : textbooksMode === 'essay'
            ? { allowedTextbooksEssay: textbooksSelected }
            : textbooksMode === 'workbook'
              ? { allowedTextbooksWorkbook: textbooksSelected }
              : { allowedTextbooksVariant: textbooksSelected };
      const r = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        await loadUser();
        closeTextbooksModal();
      } else {
        alert(d?.error || '저장에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setTextbooksSaving(false);
    }
  }

  async function clearAllowedTextbooks(mode: 'workbook' | 'variant') {
    const msg =
      mode === 'workbook'
        ? '워크북 부교재 전용 목록을 해제할까요? 이후에는 일반「교재 허용」목록(allowedTextbooks)과 동일한 규칙이 적용됩니다.'
        : '변형문제 부교재 전용 목록을 해제할까요? 이후에는 사이트 기본 노출(관리자 기본 교재 설정)만 적용됩니다.';
    if (!confirm(msg)) return;
    setTextbooksSaving(true);
    try {
      const body = mode === 'workbook' ? { allowedTextbooksWorkbook: null } : { allowedTextbooksVariant: null };
      const r = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        await loadUser();
      } else {
        alert(d?.error || '해제에 실패했습니다.');
      }
    } catch {
      alert('요청 중 오류가 발생했습니다.');
    } finally {
      setTextbooksSaving(false);
    }
  }

  /* ─── 멤버십 뱃지 계산 ─── */
  function getMembershipBadges(u: DetailUser) {
    const now = new Date();
    const badges: { text: string; cls: string }[] = [];
    if (u.isVip) badges.push({ text: 'VIP', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' });
    if (u.annualMemberSince) badges.push({ text: '연회원', cls: 'bg-violet-500/20 text-violet-300 border-violet-500/40' });
    if (u.monthlyMemberUntil) {
      const until = new Date(u.monthlyMemberUntil);
      badges.push(
        until > now
          ? { text: `월구독 (~${u.monthlyMemberUntil})`, cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' }
          : { text: `구독만료 (${u.monthlyMemberUntil})`, cls: 'bg-slate-600/40 text-slate-400 border-slate-600' }
      );
    }
    if (u.signupPremiumTrialUntil && new Date(u.signupPremiumTrialUntil) > now) {
      badges.push({ text: '7일 체험중', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' });
    }
    return badges;
  }

  /* ─── 렌더 ─── */
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex text-white">
        <AdminSidebar loginId={adminLoginId} />
        <main className="flex-1 flex items-center justify-center text-slate-500">불러오는 중...</main>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="min-h-screen bg-slate-900 flex text-white">
        <AdminSidebar loginId={adminLoginId} />
        <main className="flex-1 p-6">
          <div className="bg-red-500/20 border border-red-500/50 rounded-xl px-4 py-3 text-red-300 mb-4">
            {error ?? '회원을 찾을 수 없습니다.'}
          </div>
          <Link href="/admin/users" className="text-slate-400 hover:text-white text-sm">← 회원 목록으로</Link>
        </main>
      </div>
    );
  }

  const avatarColor = AVATAR_COLORS[Math.abs(user.loginId.charCodeAt(0)) % AVATAR_COLORS.length];
  const membershipBadges = getMembershipBadges(user);

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      <AdminSidebar loginId={adminLoginId} />
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* 상단 브레드크럼 */}
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-5">
            <Link href="/admin/users" className="hover:text-white transition-colors">회원상세관리</Link>
            <span>/</span>
            <span className="text-slate-300">{user.name}</span>
          </div>

          {/* 헤더 카드 */}
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5 mb-5">
            <div className="flex items-start gap-4">
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center text-xl font-extrabold text-white shrink-0 bg-gradient-to-br ${avatarColor}`}
              >
                {(user.name || user.loginId).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-lg font-bold text-white">{user.name}</h2>
                    <p className="text-slate-400 text-sm font-mono">{user.loginId}</p>
                    <p className="text-slate-400 text-sm mt-0.5">
                      {user.email && <span>{user.email}</span>}
                      {user.email && user.phone && <span className="text-slate-600"> · </span>}
                      {user.phone && <span>{user.phone}</span>}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-white">{user.points.toLocaleString()}<span className="text-base font-medium text-slate-400">P</span></p>
                    <p className="text-slate-500 text-xs mt-0.5">
                      가입 {user.createdAt ? new Date(user.createdAt).toLocaleDateString('ko-KR') : '—'}
                    </p>
                  </div>
                </div>
                {membershipBadges.length > 0 && (
                  <div className="flex gap-1.5 mt-2.5 flex-wrap">
                    {membershipBadges.map((b, i) => <Badge key={i} text={b.text} cls={b.cls} />)}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 탭 */}
          <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1 mb-5 border border-slate-700">
            {(
              [
                { key: 'info', label: '기본정보 & 권한' },
                { key: 'orders', label: '주문 내역' },
                { key: 'points', label: '포인트 내역' },
                { key: 'dropbox', label: 'Dropbox' },
                { key: 'vocabulary', label: '단어장' },
              ] as { key: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                  tab === t.key
                    ? 'bg-slate-700 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ─── 탭 내용: 기본정보 ─── */}
          {tab === 'info' && (
            <div className="space-y-5">
              {/* 프로필 */}
              <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
                <SectionTitle>프로필</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="이름">
                    <EditInput value={editName} onChange={setEditName} placeholder="이름" />
                  </Field>
                  <Field label="이메일">
                    <EditInput value={editEmail} onChange={setEditEmail} placeholder="이메일" type="email" />
                  </Field>
                  <Field label="전화번호">
                    <EditInput value={editPhone} onChange={setEditPhone} placeholder="전화번호" />
                  </Field>
                  <Field label="부가 메모">
                    <EditInput value={editNote} onChange={setEditNote} placeholder="메모" />
                  </Field>
                </div>
              </div>

              {/* 멤버십 */}
              <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
                <SectionTitle>멤버십</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                  <Field label="연회원 시작일">
                    <EditInput value={editAnnual} onChange={setEditAnnual} placeholder="YYYY-MM-DD" />
                  </Field>
                  <Field label="월구독 시작일">
                    <EditInput value={editMonthlyFrom} onChange={setEditMonthlyFrom} placeholder="YYYY-MM-DD" />
                  </Field>
                  <Field label="월구독 만료일">
                    <EditInput value={editMonthlyUntil} onChange={setEditMonthlyUntil} placeholder="YYYY-MM-DD" />
                  </Field>
                </div>
                <Toggle checked={editIsVip} onChange={setEditIsVip} label="VIP 회원" />
                {user.vipSince && (
                  <p className="text-slate-500 text-xs mt-1.5">VIP 시작: {user.vipSince}</p>
                )}
              </div>

              {/* 권한 */}
              <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
                <SectionTitle>메뉴 권한</SectionTitle>
                <div className="flex flex-col gap-3">
                  <Toggle checked={editAnalysis} onChange={setEditAnalysis} label="분석지 메뉴 허용" />
                  <Toggle checked={editEssay} onChange={setEditEssay} label="서술형 메뉴 허용" />
                  <Toggle checked={editMyFormat} onChange={setEditMyFormat} label="나만의 양식 승인" />
                </div>
              </div>

              {/* 허용 교재 관리 */}
              <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
                <SectionTitle>허용 교재 관리</SectionTitle>

                {/* 워크북 부교재 */}
                <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3.5 mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">📘</span>
                    <span className="text-xs font-semibold text-slate-300 flex-1">워크북 부교재 노출</span>
                    {user.allowedTextbooksWorkbook !== undefined ? (
                      <span className="text-[10px] font-semibold text-cyan-400/90">전용 목록 사용 중</span>
                    ) : (
                      <span className="text-[10px] font-semibold text-slate-500">일반 허용과 동일</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
                    공통 부교재(<code className="text-slate-400">WORKBOOK_SUPPLEMENTARY_COMMON_KEYS</code>) 외에 이 회원만
                    볼 추가 교재를 고릅니다. EBS·쏠북은 전 회원 공개라 선택 목록에 없습니다.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => openTextbooksModal('workbook')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-600 text-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-700/50"
                    >
                      부교재 선택
                      {user.allowedTextbooksWorkbook !== undefined
                        ? ` (${user.allowedTextbooksWorkbook.length}개)`
                        : user.allowedTextbooks.length > 0
                          ? ' (일반과 동일·미저장)'
                          : ''}
                    </button>
                    {user.allowedTextbooksWorkbook !== undefined && (
                      <button
                        type="button"
                        onClick={() => clearAllowedTextbooks('workbook')}
                        disabled={textbooksSaving}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-amber-500/30 text-amber-400/90 rounded-lg text-[11px] font-semibold hover:bg-amber-500/10 disabled:opacity-50"
                      >
                        전용 해제
                      </button>
                    )}
                  </div>
                </div>

                {/* 변형문제 부교재 */}
                <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3.5 mb-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm">📗</span>
                    <span className="text-xs font-semibold text-slate-300 flex-1">변형문제 부교재 노출</span>
                    {user.allowedTextbooksVariant !== undefined ? (
                      <span className="text-[10px] font-semibold text-emerald-400/90">전용 목록 사용 중</span>
                    ) : (
                      <span className="text-[10px] font-semibold text-slate-500">기본 노출과 동일</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
                    공통 부교재(<code className="text-slate-400">VARIANT_SUPPLEMENTARY_COMMON_KEYS</code>) 외에 이 회원만
                    부교재 변형문제 주문(/textbook) 화면에서 볼 추가 교재를 고릅니다.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => openTextbooksModal('variant')}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-600 text-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-700/50"
                    >
                      부교재 선택
                      {user.allowedTextbooksVariant !== undefined
                        ? ` (${user.allowedTextbooksVariant.length}개)`
                        : user.allowedTextbooks.length > 0
                          ? ' (미저장·저장 시 전용 적용)'
                          : ''}
                    </button>
                    {user.allowedTextbooksVariant !== undefined && (
                      <button
                        type="button"
                        onClick={() => clearAllowedTextbooks('variant')}
                        disabled={textbooksSaving}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-emerald-500/30 text-emerald-400/90 rounded-lg text-[11px] font-semibold hover:bg-emerald-500/10 disabled:opacity-50"
                      >
                        전용 해제
                      </button>
                    )}
                  </div>
                </div>

                {/* 분석지·서술형 (메뉴 권한 켜진 경우만) */}
                {(user.canAccessAnalysis || user.canAccessEssay) && (
                  <div className="rounded-xl border border-slate-700/70 bg-slate-900/40 p-3.5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm">📋</span>
                      <span className="text-xs font-semibold text-slate-300">메뉴별 교재 허용</span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed mb-2">
                      선택한 교재만 해당 메뉴(분석지·서술형)의 강과/교재 선택에 노출됩니다.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {user.canAccessAnalysis && (
                        <button
                          type="button"
                          onClick={() => openTextbooksModal('analysis')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-600 text-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-700/50"
                        >
                          📗 분석지 교재
                          {((user.allowedTextbooksAnalysis?.length ?? user.allowedTextbooks.length) ?? 0) > 0
                            ? ` (${user.allowedTextbooksAnalysis?.length ?? user.allowedTextbooks.length}개)`
                            : ''}
                        </button>
                      )}
                      {user.canAccessEssay && (
                        <button
                          type="button"
                          onClick={() => openTextbooksModal('essay')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-600 text-slate-300 rounded-lg text-[11px] font-semibold hover:bg-slate-700/50"
                        >
                          📘 서술형 교재
                          {((user.allowedTextbooksEssay?.length ?? user.allowedTextbooks.length) ?? 0) > 0
                            ? ` (${user.allowedTextbooksEssay?.length ?? user.allowedTextbooks.length}개)`
                            : ''}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 저장 버튼 */}
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleSaveInfo}
                  disabled={saving}
                  className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
                >
                  {saving ? '저장 중...' : '변경사항 저장'}
                </button>
                {saveMsg && (
                  <span className={`text-sm ${saveMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {saveMsg.text}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ─── 탭 내용: 주문 내역 ─── */}
          {tab === 'orders' && (
            <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
                <h3 className="font-semibold text-white">주문 내역</h3>
                <span className="text-slate-400 text-sm">{orders.length}건</span>
              </div>
              {orders.length === 0 ? (
                <div className="text-center py-10 text-slate-500 text-sm">주문 내역이 없습니다.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase tracking-wider">
                      <th className="text-left px-5 py-3 font-medium">주문번호</th>
                      <th className="text-left px-5 py-3 font-medium">주문일</th>
                      <th className="text-left px-5 py-3 font-medium">상태</th>
                      <th className="text-left px-5 py-3 font-medium hidden md:table-cell">유형</th>
                      <th className="text-right px-5 py-3 font-medium hidden lg:table-cell">매출</th>
                      <th className="text-right px-5 py-3 font-medium">관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr
                        key={o.id}
                        onClick={() => openOrderModal(o)}
                        className="border-b border-slate-700/50 last:border-0 hover:bg-slate-700/30 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3.5">
                          <p className="font-mono text-xs text-sky-300 hover:underline">{o.orderNumber ?? '—'}</p>
                        </td>
                        <td className="px-5 py-3.5 text-slate-400 text-xs">
                          {o.createdAt ? new Date(o.createdAt).toLocaleDateString('ko-KR') : '—'}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[o.status] ?? 'bg-slate-600/40 text-slate-400 border-slate-600'}`}>
                            {o.statusLabel}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-400 text-xs hidden md:table-cell">
                          {o.orderMetaFlow ?? '—'}
                        </td>
                        <td className="px-5 py-3.5 text-right text-slate-300 hidden lg:table-cell">
                          {o.revenueWon != null ? `${o.revenueWon.toLocaleString()}원` : '—'}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="text-xs px-2.5 py-1 rounded-lg bg-slate-700/80 text-slate-400 font-medium">
                            관리 →
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ─── 주문 관리 모달 ─── */}
          {orderModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
              <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-2xl shadow-2xl my-4 flex flex-col max-h-[90vh]">
                {/* 헤더 */}
                <div className="px-5 py-4 border-b border-slate-700 flex items-start justify-between shrink-0">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-bold text-white font-mono">{orderModal.orderNumber ?? orderModal.id}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_COLORS[orderModal.status] ?? 'bg-slate-600/40 text-slate-400 border-slate-600'}`}>
                        {orderModal.statusLabel}
                      </span>
                      {orderModal.fileUrl && (
                        <a href={orderModal.fileUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-400 hover:underline">
                          📎 파일 링크
                        </a>
                      )}
                    </div>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {orderModal.createdAt ? new Date(orderModal.createdAt).toLocaleString('ko-KR') : ''}
                      {orderModal.orderMetaFlow && ` · ${orderModal.orderMetaFlow}`}
                    </p>
                  </div>
                  <button type="button" onClick={() => setOrderModal(null)} className="text-slate-400 hover:text-white text-2xl leading-none px-1 ml-2 shrink-0">×</button>
                </div>

                {/* 탭 */}
                <div className="flex border-b border-slate-700 shrink-0">
                  {(['order', 'manage', 'email'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setOrderModalTab(t)}
                      className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${orderModalTab === t ? 'border-sky-500 text-sky-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
                    >
                      {t === 'order' ? '주문서' : t === 'manage' ? '관리' : '이메일'}
                    </button>
                  ))}
                </div>

                {/* 탭 내용 */}
                <div className="overflow-y-auto flex-1 p-5">

                  {/* ── 주문서 탭 ── */}
                  {orderModalTab === 'order' && (
                    <div>
                      {orderModal.orderText ? (
                        <pre className="bg-slate-900/60 rounded-xl p-4 text-sm text-slate-300 whitespace-pre-wrap leading-relaxed font-sans">
                          {orderModal.orderText}
                        </pre>
                      ) : (
                        <p className="text-slate-500 text-sm text-center py-10">주문서 내용이 없습니다.</p>
                      )}
                    </div>
                  )}

                  {/* ── 관리 탭 ── */}
                  {orderModalTab === 'manage' && (
                    <div className="space-y-5">
                      {/* 상태 변경 */}
                      <div>
                        <label className="block text-slate-400 text-xs mb-2 font-semibold uppercase tracking-wide">주문 상태</label>
                        <div className="flex gap-2 items-center">
                          <select
                            value={orderStatusInput}
                            onChange={(e) => setOrderStatusInput(e.target.value)}
                            className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                          >
                            <option value="pending">주문 접수</option>
                            <option value="accepted">제작 수락</option>
                            <option value="payment_confirmed">입금 확인</option>
                            <option value="in_progress">제작 중</option>
                            <option value="completed">완료</option>
                            <option value="cancelled">취소됨</option>
                          </select>
                          <button
                            type="button"
                            onClick={handleOrderSaveStatus}
                            disabled={orderSaving || orderStatusInput === orderModal.status}
                            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
                          >
                            저장
                          </button>
                        </div>
                      </div>

                      {/* 파일 URL */}
                      <div>
                        <label className="block text-slate-400 text-xs mb-2 font-semibold uppercase tracking-wide">완료 파일 URL</label>
                        <div className="flex gap-2 items-center">
                          <input
                            type="url"
                            value={orderFileUrlInput}
                            onChange={(e) => setOrderFileUrlInput(e.target.value)}
                            placeholder="https://drive.google.com/..."
                            className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500"
                          />
                          <button
                            type="button"
                            onClick={handleOrderSaveFileUrl}
                            disabled={orderSaving || orderFileUrlInput === (orderModal.fileUrl ?? '')}
                            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg"
                          >
                            저장
                          </button>
                        </div>
                        {orderModal.fileUrl && (
                          <a href={orderModal.fileUrl} target="_blank" rel="noopener noreferrer" className="mt-1 text-xs text-sky-400 hover:underline block truncate">
                            현재: {orderModal.fileUrl}
                          </a>
                        )}
                      </div>

                      {/* 저장 결과 */}
                      {orderSaveMsg && (
                        <p className={`text-sm rounded-lg px-3 py-2 ${orderSaveMsg.ok ? 'bg-emerald-900/40 text-emerald-300' : 'bg-red-900/40 text-red-300'}`}>
                          {orderSaveMsg.text}
                        </p>
                      )}

                      {/* 드롭박스 */}
                      <div className="border-t border-slate-700 pt-4">
                        <label className="block text-slate-400 text-xs mb-2 font-semibold uppercase tracking-wide">드롭박스</label>
                        {orderModal.dropboxFolderCreated ? (
                          <span className="text-xs text-emerald-400 font-medium">☁️ 폴더 생성됨</span>
                        ) : (
                          <button
                            type="button"
                            onClick={handleOrderCreateDropboxFolder}
                            disabled={orderCreatingFolder}
                            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-300 text-sm font-medium rounded-lg transition-colors"
                          >
                            {orderCreatingFolder ? '생성 중…' : '☁️ 드롭박스 폴더 생성'}
                          </button>
                        )}
                      </div>

                      {/* 삭제 */}
                      <div className="border-t border-slate-700 pt-4">
                        <button
                          type="button"
                          onClick={() => handleOrderDelete(orderModal.id)}
                          disabled={!!orderDeletingId}
                          className="px-4 py-2 bg-red-900/40 hover:bg-red-800/60 border border-red-700/50 disabled:opacity-50 text-red-300 text-sm font-medium rounded-lg transition-colors"
                        >
                          {orderDeletingId === orderModal.id ? '삭제 중…' : '🗑 주문 삭제'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── 이메일 탭 ── */}
                  {orderModalTab === 'email' && (
                    <div className="space-y-3">
                      <input
                        type="email"
                        value={orderEmailTo}
                        onChange={(e) => setOrderEmailTo(e.target.value)}
                        placeholder="받는 사람 이메일"
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500"
                      />
                      <input
                        type="text"
                        value={orderEmailSubject}
                        onChange={(e) => setOrderEmailSubject(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
                      />
                      <textarea
                        value={orderEmailMessage}
                        onChange={(e) => setOrderEmailMessage(e.target.value)}
                        rows={5}
                        className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm resize-none"
                      />

                      {/* 완료 파일 URL 링크 삽입 */}
                      {orderModal.fileUrl && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-400 truncate flex-1">📎 {orderModal.fileUrl}</span>
                          <button
                            type="button"
                            onClick={() => setOrderEmailMessage((prev) =>
                              prev + (prev.endsWith('\n') || prev === '' ? '' : '\n') + `\n파일 다운로드: ${orderModal!.fileUrl}`
                            )}
                            className="shrink-0 text-xs px-2.5 py-1 rounded-lg bg-sky-700/60 hover:bg-sky-600/80 text-sky-200 font-medium transition-colors"
                          >
                            본문에 링크 삽입
                          </button>
                        </div>
                      )}

                      {/* 드롭박스 파일 첨부 */}
                      <div className="rounded-lg border border-slate-600 bg-slate-900/50 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-indigo-300">📁 드롭박스 파일</span>
                          {dbxFilesLoading && (
                            <span className="text-[11px] text-slate-500 flex items-center gap-1">
                              <span className="inline-block w-3 h-3 border border-slate-500 border-t-indigo-400 rounded-full animate-spin" />
                              불러오는 중…
                            </span>
                          )}
                        </div>
                        {dbxFilesError && <p className="text-[11px] text-red-400 mb-2">{dbxFilesError}</p>}
                        {!dbxFilesLoading && dbxFiles.length === 0 && !dbxFilesError && (
                          <p className="text-[11px] text-slate-500">드롭박스 폴더에 파일이 없거나 폴더가 생성되지 않았습니다.</p>
                        )}
                        {dbxFiles.length > 0 && (
                          <>
                            <ul className="space-y-1 mb-2">
                              {dbxFiles.map((f) => {
                                const tooLarge = f.size > 20 * 1024 * 1024;
                                return (
                                  <li key={f.apiPath} className="flex items-center gap-2 text-xs">
                                    <input
                                      type="checkbox"
                                      id={`dbx-u-${f.apiPath}`}
                                      checked={dbxSelected.has(f.apiPath)}
                                      disabled={tooLarge}
                                      onChange={(e) => setDbxSelected((prev) => {
                                        const next = new Set(prev);
                                        if (e.target.checked) next.add(f.apiPath); else next.delete(f.apiPath);
                                        return next;
                                      })}
                                      className="accent-indigo-500 disabled:opacity-40"
                                    />
                                    <label htmlFor={`dbx-u-${f.apiPath}`} className={`flex-1 truncate cursor-pointer ${tooLarge ? 'text-slate-500 line-through' : 'text-slate-300'}`}>
                                      {f.name}
                                    </label>
                                    <span className={`shrink-0 ${tooLarge ? 'text-red-400 font-medium' : 'text-slate-500'}`}>
                                      {tooLarge ? `${(f.size / 1024 / 1024).toFixed(1)} MB — 너무 큼` : `${(f.size / 1024).toFixed(0)} KB`}
                                    </span>
                                  </li>
                                );
                              })}
                            </ul>
                            {dbxFiles.some((f) => f.size > 20 * 1024 * 1024) && (
                              <p className="text-[11px] text-amber-400 mb-2">⚠️ 20 MB 초과 파일은 첨부 불가 — 위 「본문에 링크 삽입」을 이용하세요.</p>
                            )}
                            <button
                              type="button"
                              disabled={dbxAttaching || dbxSelected.size === 0}
                              onClick={handleDbxAttach}
                              className="w-full py-1.5 rounded-lg bg-indigo-700/80 hover:bg-indigo-600 disabled:opacity-50 text-indigo-100 text-xs font-semibold transition-colors"
                            >
                              {dbxAttaching ? '다운로드 중…' : `선택 파일 첨부 (${dbxSelected.size}개)`}
                            </button>
                          </>
                        )}
                      </div>

                      {/* 첨부된 파일 목록 */}
                      {orderAttachments.length > 0 && (
                        <div className="rounded-lg border border-emerald-700/40 bg-emerald-900/20 p-3">
                          <p className="text-xs font-semibold text-emerald-300 mb-2">✅ 첨부 완료 ({orderAttachments.length}개)</p>
                          <ul className="space-y-1">
                            {orderAttachments.map((a) => (
                              <li key={a.filename} className="flex items-center justify-between text-xs">
                                <span className="text-slate-300 truncate flex-1">{a.filename}</span>
                                <div className="flex items-center gap-2 shrink-0 ml-2">
                                  <span className="text-slate-500">{(a.size / 1024).toFixed(0)} KB</span>
                                  <button
                                    type="button"
                                    onClick={() => setOrderAttachments((prev) => prev.filter((x) => x.filename !== a.filename))}
                                    className="text-red-400 hover:text-red-300 text-[11px]"
                                  >✕</button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {orderEmailResult && (
                        <p className={`text-sm rounded-lg px-3 py-2 ${orderEmailResult.ok ? 'bg-emerald-900/40 text-emerald-300' : 'bg-red-900/40 text-red-300'}`}>
                          {orderEmailResult.msg}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={handleOrderSendEmail}
                        disabled={orderEmailSending || !orderEmailTo.trim()}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
                      >
                        {orderEmailSending ? '발송 중…' : `✉ 이메일 발송${orderAttachments.length > 0 ? ` (첨부 ${orderAttachments.length}개)` : ''}`}
                      </button>
                    </div>
                  )}

                </div>
              </div>
            </div>
          )}

          {/* ─── 탭 내용: 포인트 내역 ─── */}
          {tab === 'points' && (
            <div className="space-y-4">
              {/* 포인트 지급 */}
              <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
                <SectionTitle>포인트 직접 지급</SectionTitle>
                <div className="flex gap-3 items-end">
                  <Field label="지급 포인트">
                    <input
                      type="number"
                      value={addPointsInput}
                      onChange={(e) => setAddPointsInput(e.target.value)}
                      placeholder="0"
                      min={1}
                      className="w-40 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-400"
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={handleAddPoints}
                    disabled={addingPoints}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
                  >
                    {addingPoints ? '처리 중...' : '지급하기'}
                  </button>
                  <p className="text-slate-400 text-sm ml-2">현재 잔액: <span className="text-white font-bold">{user.points.toLocaleString()}P</span></p>
                </div>
              </div>

              {/* 내역 테이블 */}
              <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
                  <h3 className="font-semibold text-white">포인트 거래 내역</h3>
                  <span className="text-slate-400 text-sm">{pointItems.length}건</span>
                </div>
                {pointItems.length === 0 ? (
                  <div className="text-center py-10 text-slate-500 text-sm">포인트 내역이 없습니다.</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase tracking-wider">
                        <th className="text-left px-5 py-3 font-medium">일시</th>
                        <th className="text-left px-5 py-3 font-medium">종류</th>
                        <th className="text-right px-5 py-3 font-medium">변동</th>
                        <th className="text-right px-5 py-3 font-medium">잔액</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pointItems.map((p) => (
                        <tr key={p.id} className="border-b border-slate-700/50 last:border-0 hover:bg-slate-700/20 transition-colors">
                          <td className="px-5 py-3 text-slate-400 text-xs">
                            {p.createdAt ? new Date(p.createdAt).toLocaleString('ko-KR') : '—'}
                          </td>
                          <td className="px-5 py-3 text-slate-300 text-xs">{p.kindLabel}</td>
                          <td className={`px-5 py-3 text-right font-mono text-sm font-semibold ${p.delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {p.delta >= 0 ? '+' : ''}{p.delta.toLocaleString()}
                          </td>
                          <td className="px-5 py-3 text-right text-slate-300 font-mono text-xs">
                            {p.balanceAfter.toLocaleString()}P
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ─── 탭 내용: 단어장 ─── */}
          {tab === 'vocabulary' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-slate-400 text-sm">
                  이 회원의 단어장 구매·편집 내역입니다. 전체 회원 분석은{' '}
                  <Link href="/admin/vocabulary-library" className="text-sky-400 hover:underline">
                    단어장 구매·편집 분석
                  </Link>
                  메뉴에서 확인하세요.
                </p>
                <button
                  type="button"
                  onClick={() => loadVocabularies()}
                  disabled={vocabLoading}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-50"
                >
                  새로고침
                </button>
              </div>
              <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
                {vocabLoading ? (
                  <div className="py-12 text-center text-slate-500 text-sm">불러오는 중…</div>
                ) : vocabItems.length === 0 ? (
                  <div className="py-12 text-center text-slate-500 text-sm">단어장 구매 내역이 없습니다.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[720px]">
                      <thead>
                        <tr className="border-b border-slate-700 text-slate-400 text-xs text-left">
                          <th className="px-4 py-3 font-medium">교재·지문</th>
                          <th className="px-4 py-3 font-medium">주문번호</th>
                          <th className="px-4 py-3 font-medium text-right">포인트</th>
                          <th className="px-4 py-3 font-medium">구매</th>
                          <th className="px-4 py-3 font-medium">최종 편집</th>
                          <th className="px-4 py-3 font-medium text-center">편집</th>
                          <th className="px-4 py-3 font-medium text-right">단어 수</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vocabItems.map((row) => (
                          <tr key={row.id} className="border-b border-slate-700/50 last:border-0 hover:bg-slate-700/20">
                            <td className="px-4 py-3 text-slate-300 max-w-[200px]">
                              <p className="truncate text-xs text-slate-500">{row.textbook}</p>
                              <p className="truncate">{row.display_label || '—'}</p>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-slate-400">{row.order_number}</td>
                            <td className="px-4 py-3 text-right">{row.points_used.toLocaleString()}P</td>
                            <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                              {row.purchased_at ? new Date(row.purchased_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                            </td>
                            <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                              {row.last_edited_at ? new Date(row.last_edited_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                            </td>
                            <td className="px-4 py-3 text-center text-xs">
                              {row.has_custom_edit ? (
                                <span className="font-semibold text-teal-300">편집됨</span>
                              ) : (
                                <span className="text-slate-600">원본</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-400">{row.entry_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {vocabTotal > vocabItems.length && (
                <p className="text-slate-500 text-xs">
                  최근 {vocabItems.length}건만 표시합니다. (전체 {vocabTotal}건)
                </p>
              )}
            </div>
          )}

          {/* ─── 탭 내용: Dropbox ─── */}
          {tab === 'dropbox' && (
            <div className="space-y-4">
              <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
                <SectionTitle>Dropbox 폴더 설정</SectionTitle>
                <div className="space-y-4">
                  <Field label="폴더 경로">
                    <EditInput
                      value={editDropboxPath}
                      onChange={setEditDropboxPath}
                      placeholder="/고미조슈아/회원명"
                    />
                  </Field>
                  {user.dropboxSharedLink && (
                    <Field label="공유 링크">
                      <a
                        href={user.dropboxSharedLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-400 text-sm underline break-all"
                      >
                        {user.dropboxSharedLink}
                      </a>
                    </Field>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={handleSaveDropbox}
                      disabled={saving}
                      className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
                    >
                      경로 저장
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateDropboxFolder}
                      disabled={creatingFolder}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
                    >
                      {creatingFolder ? '생성 중...' : '폴더 자동 생성'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setEditDropboxPath('');
                        const r = await fetch(`/api/admin/users/${userId}`, {
                          method: 'PATCH',
                          credentials: 'include',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ dropboxFolderPath: '' }),
                        });
                        if (r.ok) { setDropboxMsg({ ok: true, text: '경로가 초기화되었습니다.' }); await loadUser(); }
                      }}
                      className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium rounded-xl transition-colors"
                    >
                      경로 초기화
                    </button>
                  </div>
                  {dropboxMsg && (
                    <p className={`text-sm ${dropboxMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                      {dropboxMsg.text}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ─── 교재 선택 모달 ─── */}
          {textbooksMode && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="bg-slate-800 rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col border border-slate-700">
                <div className="p-4 border-b border-slate-700">
                  <h3 className="font-bold text-white">
                    {textbooksMode === 'analysis'
                      ? '분석지 허용 교재'
                      : textbooksMode === 'essay'
                        ? '서술형 허용 교재'
                        : textbooksMode === 'workbook'
                          ? '워크북 부교재 (회원 전용 추가)'
                          : '변형문제 부교재 (회원 전용 추가)'}
                  </h3>
                  <p className="text-slate-400 text-xs mt-1">
                    {textbooksMode === 'workbook' ? (
                      <>
                        모의고사(고1_/고2_/고3_)·EBS·쏠북(변형 쏠북 설정에 등록된 교재)은 제외된 목록입니다. EBS·쏠북은 전
                        회원에게 공개됩니다. 저장 시 이 회원에게는{' '}
                        <strong className="text-slate-300">공통 교재(WORKBOOK_SUPPLEMENTARY_COMMON_KEYS) ∪ 선택 교재</strong>만
                        워크북 부교재로 보입니다.
                      </>
                    ) : textbooksMode === 'variant' ? (
                      <>
                        모의고사(고1_/고2_/고3_)·EBS·쏠북(변형 쏠북 설정에 등록된 교재)은 제외된 목록입니다. EBS·쏠북은 전
                        회원에게 공개됩니다. 저장 시 이 회원에게는{' '}
                        <strong className="text-slate-300">공통 교재(VARIANT_SUPPLEMENTARY_COMMON_KEYS) ∪ 선택 교재</strong>만
                        부교재 변형문제 주문(/textbook) 화면의「회원 전용 추가」범위로 쓰입니다.
                      </>
                    ) : (
                      <>
                        선택한 교재만 해당 회원에게 노출됩니다.{' '}
                        {textbooksMode === 'analysis' ? '분석지' : '서술형'} 주문 시 강과/교재 선택에 사용됩니다.
                      </>
                    )}
                  </p>
                </div>
                <div className="p-4 overflow-y-auto flex-1">
                  {textbooksLoading ? (
                    <div className="py-8 text-center text-slate-500">교재 목록 불러오는 중…</div>
                  ) : textbookList.length === 0 ? (
                    <p className="text-slate-500 text-sm">교재 데이터가 없습니다.</p>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="flex items-center gap-2 text-slate-400 text-xs mb-2">
                        <input
                          type="checkbox"
                          checked={textbookList.length > 0 && textbooksSelected.length === textbookList.length}
                          onChange={(e) => {
                            if (e.target.checked) setTextbooksSelected([...textbookList]);
                            else setTextbooksSelected([]);
                          }}
                          className="rounded border-slate-500 bg-slate-700 text-cyan-500"
                        />
                        전체 선택 / 해제
                      </label>
                      {textbookList.map((tb) => (
                        <label
                          key={tb}
                          className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-slate-700/50 cursor-pointer text-sm text-slate-200"
                        >
                          <input
                            type="checkbox"
                            checked={textbooksSelected.includes(tb)}
                            onChange={(e) => {
                              if (e.target.checked) setTextbooksSelected((prev) => [...prev, tb]);
                              else setTextbooksSelected((prev) => prev.filter((t) => t !== tb));
                            }}
                            className="rounded border-slate-500 bg-slate-700 text-cyan-500"
                          />
                          <span className="truncate">{tb}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="p-4 border-t border-slate-700 flex justify-between">
                  <span className="text-slate-400 text-sm">{textbooksSelected.length}개 선택</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={closeTextbooksModal}
                      className="px-4 py-2 bg-slate-600 text-slate-200 rounded-lg text-sm font-medium hover:bg-slate-500"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={saveAllowedTextbooks}
                      disabled={textbooksSaving}
                      className="px-4 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium hover:bg-cyan-500 disabled:opacity-50"
                    >
                      {textbooksSaving ? '저장 중…' : '저장'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ─── 위험 영역 ─── */}
          <div className="mt-8 bg-red-950/30 rounded-2xl border border-red-900/50 p-5">
            <SectionTitle>위험 영역</SectionTitle>
            <div className="flex gap-3 flex-wrap">
              <button
                type="button"
                onClick={handleResetPassword}
                className="px-4 py-2 bg-amber-700/40 hover:bg-amber-700/60 border border-amber-700/50 text-amber-300 text-sm font-medium rounded-xl transition-colors"
              >
                비밀번호 초기화
              </button>
              {!confirmDelete ? (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="px-4 py-2 bg-red-700/40 hover:bg-red-700/60 border border-red-700/50 text-red-300 text-sm font-medium rounded-xl transition-colors"
                >
                  계정 삭제
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-red-300 text-sm">정말 삭제할까요?</span>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    삭제 확인
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm rounded-lg transition-colors"
                  >
                    취소
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5">
            <Link href="/admin/users" className="text-slate-500 hover:text-white text-sm transition-colors">
              ← 회원 목록으로
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
