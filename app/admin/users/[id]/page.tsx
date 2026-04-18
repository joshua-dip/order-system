'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import AdminSidebar from '../../_components/AdminSidebar';

/* ─── 타입 ─── */
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

type Tab = 'info' | 'orders' | 'points' | 'dropbox';

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

  /* ─── 데이터 로딩 ─── */
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d?.role !== 'admin') { router.replace('/admin/login'); }
        else setAdminLoginId(d.loginId ?? '');
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  const loadUser = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await fetch(`/api/admin/users/${userId}`);
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
    const r = await fetch(`/api/admin/orders?loginId=${encodeURIComponent(user.loginId)}&limit=50`);
    const d = await r.json();
    if (d?.orders) setOrders(d.orders);
  }, [user?.loginId]);

  const loadPoints = useCallback(async () => {
    if (!userId) return;
    const r = await fetch(`/api/admin/users/${userId}/point-ledger`);
    const d = await r.json();
    if (d?.items) setPointItems(d.items);
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
      const r = await fetch(`/api/admin/users/${userId}/create-dropbox-folder`, { method: 'POST' });
      const d = await r.json();
      setDropboxMsg(r.ok ? { ok: true, text: '폴더가 생성되었습니다.' } : { ok: false, text: d.error ?? '실패' });
      if (r.ok) await loadUser();
    } finally {
      setCreatingFolder(false);
    }
  }

  /* ─── 계정 삭제 ─── */
  async function handleDelete() {
    const r = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' });
    const d = await r.json();
    if (r.ok) {
      alert('계정이 삭제되었습니다.');
      router.push('/admin/users');
    } else {
      alert(d.error ?? '삭제 실패');
      setConfirmDelete(false);
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

              {/* 허용 교재 요약 */}
              <div className="bg-slate-800 rounded-2xl border border-slate-700 p-5">
                <SectionTitle>허용 교재 현황</SectionTitle>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">워크북/분석지 교재</span>
                    <span className="text-white font-medium">{user.allowedTextbooks.length}종</span>
                  </div>
                  {user.allowedTextbooksWorkbook !== undefined && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">워크북 전용</span>
                      <span className="text-white font-medium">{user.allowedTextbooksWorkbook?.length ?? 0}종</span>
                    </div>
                  )}
                  {user.allowedTextbooksVariant !== undefined && (
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">변형문제 교재</span>
                      <span className="text-white font-medium">{user.allowedTextbooksVariant?.length ?? 0}종</span>
                    </div>
                  )}
                </div>
                <p className="text-slate-600 text-xs mt-3">교재 목록 수정은 회원 관리 카드의 「교재 선택하기」에서 진행하세요.</p>
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
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="border-b border-slate-700/50 last:border-0 hover:bg-slate-700/20 transition-colors">
                        <td className="px-5 py-3.5">
                          <p className="font-mono text-xs text-slate-300">{o.orderNumber ?? '—'}</p>
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
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
