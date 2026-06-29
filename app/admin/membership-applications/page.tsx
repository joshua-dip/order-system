'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../_components/AdminSidebar';

/** SMS/카톡으로 학생에게 보낼 계정 안내 멘트. */
function buildAccountNoticeText(opts: {
  name?: string;
  loginId?: string;
  initialPassword?: string;
  couponGrantedPct?: number | null;
}): string {
  const name = (opts.name ?? '').trim() || '회원';
  const id = (opts.loginId ?? '').trim();
  const pw = (opts.initialPassword ?? '').trim();
  const coupon = opts.couponGrantedPct ?? 0;
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? '').trim();

  const lines = [
    `[고미조슈아] ${name}님, 가입을 환영합니다 ✨`,
    '',
    '회원 가입이 완료되어 로그인 정보를 안내드립니다.',
    '',
    `▣ 로그인 ID : ${id}`,
    `▣ 초기 비밀번호 : ${pw}`,
  ];
  if (coupon > 0) {
    lines.push('', `🎟 가입 환영 선물로 포인트 구매 ${coupon}% 할인 쿠폰이 함께 지급되었습니다.`);
  }
  lines.push('');
  if (siteUrl) lines.push(`▶ 접속 : ${siteUrl}`);
  lines.push('▶ 첫 로그인 후 [마이페이지] 에서 비밀번호를 꼭 변경해 주세요.');
  lines.push('', '문의 사항은 본 메시지에 답장 주시면 됩니다. 감사합니다 :)');
  return lines.join('\n');
}

type ApplicantType = 'student' | 'parent' | 'teacher';
type AppStatus = 'pending' | 'contacted' | 'completed' | 'rejected';

interface Application {
  id: string;
  applicantType: ApplicantType;
  name: string;
  phone: string;
  status: AppStatus;
  adminMemo?: string;
  appliedAt: string;
  contactedAt?: string;
  completedAt?: string;
  rejectedAt?: string;
}

interface Stats {
  pending: number;
  contacted: number;
  completed: number;
  rejected: number;
  total: number;
  newToday: number;
  newThisWeek: number;
}

const TABS: { value: AppStatus | 'all'; label: string; statKey: keyof Stats | 'total' }[] = [
  { value: 'pending', label: '대기', statKey: 'pending' },
  { value: 'contacted', label: '연락완료', statKey: 'contacted' },
  { value: 'completed', label: '가입처리완료', statKey: 'completed' },
  { value: 'rejected', label: '거절', statKey: 'rejected' },
  { value: 'all', label: '전체', statKey: 'total' },
];

const TYPE_LABELS: Record<ApplicantType, string> = {
  student: '학생',
  parent: '학부모',
  teacher: '선생님',
};

const TYPE_BADGE: Record<ApplicantType, string> = {
  student: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  parent: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  teacher: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
};

const STATUS_LABELS: Record<AppStatus, string> = {
  pending: '대기',
  contacted: '연락완료',
  completed: '가입처리완료',
  rejected: '거절',
};

const STATUS_BADGE: Record<AppStatus, string> = {
  pending: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  contacted: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
  completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  rejected: 'bg-slate-600/40 text-slate-400 border-slate-600',
};

const CONTACT_NUMBER = '01079270806';

interface CreateAccountResult {
  ok: boolean;
  loginId?: string;
  name?: string;
  initialPassword?: string;
  couponGrantedPct?: number | null;
  error?: string;
}

/** 가입 환영 쿠폰 기본 할인율 (포인트 구매 할인) */
const WELCOME_COUPON_PCT = 10;

export default function AdminMembershipApplicationsPage() {
  const router = useRouter();
  const [adminLoginId, setAdminLoginId] = useState('');
  const [authChecked, setAuthChecked] = useState(false);

  const [tab, setTab] = useState<AppStatus | 'all'>('pending');
  const [applications, setApplications] = useState<Application[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [memo, setMemo] = useState<Record<string, string>>({});
  const [memoEditing, setMemoEditing] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [accountResult, setAccountResult] = useState<CreateAccountResult | null>(null);
  const [copyMsg, setCopyMsg] = useState('');
  const [noticeCopied, setNoticeCopied] = useState(false); // 안내 멘트 전체 복사 버튼 피드백
  // 계정 자동 생성 시 가입 환영 쿠폰(포인트 10% 할인) 함께 지급 여부
  const [grantWelcomeCoupon, setGrantWelcomeCoupon] = useState(true);

  // 인증
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (!d?.user || d.user.role !== 'admin') {
          router.replace('/admin/login');
          return;
        }
        setAdminLoginId(d.user.loginId ?? '');
        setAuthChecked(true);
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  const load = useCallback(async () => {
    if (!authChecked) return;
    setLoading(true);
    const sp = new URLSearchParams({ search });
    if (tab !== 'all') sp.set('status', tab);
    sp.set('limit', '100');
    const res = await fetch(`/api/admin/membership-applications?${sp}`, { credentials: 'include' });
    const d = await res.json();
    setApplications(d.applications ?? []);
    setStats(d.stats ?? null);
    setLastUpdated(new Date());
    setLoading(false);
  }, [tab, search, authChecked]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (id: string, action: string, extra?: Record<string, unknown>) => {
    setActionId(id);
    await fetch(`/api/admin/membership-applications/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    setActionId(null);
    load();
  };

  const doDelete = async (id: string) => {
    if (!confirm('신청서를 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
    setActionId(id);
    await fetch(`/api/admin/membership-applications/${id}`, { method: 'DELETE', credentials: 'include' });
    setActionId(null);
    load();
  };

  const saveMemo = async (id: string) => {
    await fetch(`/api/admin/membership-applications/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateMemo', adminMemo: memo[id] ?? '' }),
    });
    setMemoEditing(null);
    load();
  };

  const createAccount = async (id: string, name: string) => {
    const couponMsg = grantWelcomeCoupon
      ? `\n포인트 구매 ${WELCOME_COUPON_PCT}% 할인 쿠폰도 함께 지급됩니다.`
      : '';
    if (!confirm(`「${name}」 신청자로부터 사용자 계정을 자동 생성합니다.\n전화번호 = 로그인ID, 초기 비밀번호 발급.${couponMsg}\n계속할까요?`)) return;
    setActionId(id);
    try {
      const r = await fetch(`/api/admin/membership-applications/${id}/create-account`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grantCouponPct: grantWelcomeCoupon ? WELCOME_COUPON_PCT : undefined }),
      });
      const j = await r.json();
      if (!r.ok) {
        setAccountResult({ ok: false, error: j.error || '계정 생성 실패' });
      } else {
        setAccountResult({
          ok: true,
          loginId: j.loginId,
          name: j.name,
          initialPassword: j.initialPassword,
          couponGrantedPct: j.couponGrantedPct ?? null,
        });
        load();
      }
    } catch (e) {
      setAccountResult({ ok: false, error: (e as Error).message ?? '오류' });
    } finally {
      setActionId(null);
    }
  };

  const grantCoupon = async (id: string, name: string) => {
    if (!confirm(`「${name}」 회원에게 포인트 구매 ${WELCOME_COUPON_PCT}% 할인 쿠폰을 지급합니다.\n계속할까요?`)) return;
    setActionId(id);
    try {
      const r = await fetch(`/api/admin/membership-applications/${id}/grant-coupon`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discountPct: WELCOME_COUPON_PCT }),
      });
      const j = await r.json();
      setCopyMsg(r.ok ? `✓ ${WELCOME_COUPON_PCT}% 할인 쿠폰 지급 완료` : (j.error ?? '쿠폰 지급 실패'));
      window.setTimeout(() => setCopyMsg(''), 2200);
    } catch {
      setCopyMsg('쿠폰 지급 실패');
      window.setTimeout(() => setCopyMsg(''), 2200);
    } finally {
      setActionId(null);
    }
  };

  const copyText = async (text: string, label = '복사 완료') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(`✓ ${label}`);
      window.setTimeout(() => setCopyMsg(''), 1800);
    } catch {
      setCopyMsg('클립보드 복사 실패');
    }
  };

  const fmtDate = (d?: string) => {
    if (!d) return '-';
    const dt = new Date(d);
    const now = new Date();
    const diffMs = now.getTime() - dt.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);
    if (diffMin < 1) return '방금';
    if (diffMin < 60) return `${diffMin}분 전`;
    if (diffHr < 24) return `${diffHr}시간 전`;
    if (diffDay < 7) return `${diffDay}일 전`;
    return dt.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const fmtAbsolute = (d?: string) =>
    d
      ? new Date(d).toLocaleString('ko-KR', {
          year: '2-digit',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '-';

  const tabCount = (key: keyof Stats | 'total') => stats?.[key as keyof Stats] ?? 0;

  const showFilterChips = useMemo(() => stats !== null, [stats]);
  void showFilterChips;

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <span className="text-sm text-slate-400">인증 확인 중...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      <AdminSidebar loginId={adminLoginId} />

      <main className="flex-1 p-6 overflow-y-auto min-w-0">
        {/* 헤더 */}
        <div className="mb-6 flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">가입 신청 관리</h1>
            <p className="text-sm text-slate-400 mt-1">
              신규 회원 가입 신청서를 확인·연락·계정 생성합니다.
              {stats && stats.pending > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 text-rose-400 font-semibold">
                  · 미처리 {stats.pending}건
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="text-[11px] text-slate-500">
                {lastUpdated.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} 기준
              </span>
            )}
            <label
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-600 text-sm text-slate-300 cursor-pointer hover:bg-slate-700/60 select-none"
              title="계정 자동 생성 시 포인트 구매 할인 쿠폰을 함께 지급합니다."
            >
              <input
                type="checkbox"
                checked={grantWelcomeCoupon}
                onChange={(e) => setGrantWelcomeCoupon(e.target.checked)}
                className="h-4 w-4 accent-amber-400"
              />
              🎟 계정 생성 시 {WELCOME_COUPON_PCT}% 쿠폰 함께 지급
            </label>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm text-slate-300 hover:bg-slate-700/60 disabled:opacity-50"
              title="목록 + 통계 다시 불러오기"
            >
              {loading ? '⏳' : '↻ 새로고침'}
            </button>
          </div>
        </div>

        {/* 통계 카드 */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="대기 중" value={stats.pending} accent="amber" hint={stats.pending > 0 ? '바로 연락 필요' : '모두 처리됨'} />
            <StatCard label="오늘 신청" value={stats.newToday} accent="rose" hint="자정 ~ 지금" />
            <StatCard label="이번 주 신청" value={stats.newThisWeek} accent="sky" hint="최근 7일" />
            <StatCard label="전체 누적" value={stats.total} accent="slate" hint={`완료 ${stats.completed}`} />
          </div>
        )}

        {/* 탭 + 검색 */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-xl p-1 overflow-x-auto">
            {TABS.map((t) => {
              const count = tabCount(t.statKey);
              const isActive = tab === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTab(t.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    t.value === 'pending' && count > 0
                      ? 'bg-rose-500 text-white'
                      : isActive
                        ? 'bg-slate-600 text-slate-200'
                        : 'bg-slate-900/60 text-slate-400'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 이름·전화 검색"
            className="flex-1 px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* 콘텐츠 */}
        {loading && applications.length === 0 ? (
          <div className="text-center py-16 text-slate-500">불러오는 중...</div>
        ) : applications.length === 0 ? (
          <div className="text-center py-20 bg-slate-800 rounded-2xl border border-slate-700">
            <div className="text-4xl mb-3">📭</div>
            <div className="text-slate-300 font-medium">
              {tab === 'pending' ? '대기 중인 신청이 없습니다' :
               tab === 'all' && search ? '검색 결과가 없습니다' :
               '신청서가 없습니다'}
            </div>
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="mt-3 text-xs text-emerald-400 hover:underline"
              >
                검색 초기화
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {applications.map((app) => (
              <article
                key={app.id}
                className={`bg-slate-800 rounded-2xl border shadow-sm p-4 sm:p-5 transition ${
                  app.status === 'pending'
                    ? 'border-amber-500/50 ring-1 ring-amber-500/20'
                    : 'border-slate-700'
                }`}
              >
                {/* 헤더 행 */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border ${TYPE_BADGE[app.applicantType]}`}>
                    {TYPE_LABELS[app.applicantType]}
                  </span>
                  <span className="text-base font-bold text-white">{app.name}</span>
                  <button
                    type="button"
                    onClick={() => copyText(app.name, '이름 복사')}
                    className="text-[10px] text-slate-500 hover:text-slate-300"
                    title="이름 복사"
                  >
                    📋
                  </button>
                  <div className="flex gap-2 ml-auto items-center">
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${STATUS_BADGE[app.status]}`}>
                      {STATUS_LABELS[app.status]}
                    </span>
                    <span
                      className="text-xs text-slate-500"
                      title={fmtAbsolute(app.appliedAt)}
                    >
                      {fmtDate(app.appliedAt)}
                    </span>
                  </div>
                </div>

                {/* 연락 행 */}
                <div className="flex flex-wrap gap-2 mb-3">
                  <a
                    href={`tel:${app.phone.replace(/-/g, '')}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-sm font-mono text-slate-200 transition"
                  >
                    📞 {app.phone}
                  </a>
                  <button
                    type="button"
                    onClick={() => copyText(app.phone, '전화번호 복사')}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700/60 hover:bg-slate-700 text-xs text-slate-400"
                    title="전화번호 클립보드 복사"
                  >
                    📋
                  </button>
                  <a
                    href={`sms:${app.phone.replace(/-/g, '')}?body=${encodeURIComponent(`안녕하세요, ${app.name}님. 가입 신청 확인했습니다.`)}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-sm text-amber-200 transition"
                  >
                    💬 문자
                  </a>
                  <a
                    href={`tel:${CONTACT_NUMBER}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-700/40 hover:bg-slate-700/60 text-[11px] text-slate-500 transition ml-auto"
                    title="관리자 전화"
                  >
                    관리자: {CONTACT_NUMBER}
                  </a>
                </div>

                {/* 메모 */}
                <div className="mb-3">
                  {memoEditing === app.id ? (
                    <div className="flex flex-col gap-2">
                      <textarea
                        value={memo[app.id] ?? app.adminMemo ?? ''}
                        onChange={(e) => setMemo((m) => ({ ...m, [app.id]: e.target.value }))}
                        placeholder="관리자 메모 (여러 줄 가능)"
                        rows={3}
                        className="w-full px-3 py-2 text-sm rounded-lg bg-slate-900/60 border border-slate-600 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500 resize-y leading-relaxed"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => saveMemo(app.id)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500"
                        >
                          저장
                        </button>
                        <button
                          type="button"
                          onClick={() => setMemoEditing(null)}
                          className="px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600"
                        >
                          취소
                        </button>
                        <span className="text-[10px] text-slate-500 self-center ml-auto">
                          {(memo[app.id] ?? app.adminMemo ?? '').length} 자
                        </span>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setMemo((m) => ({ ...m, [app.id]: app.adminMemo ?? '' }));
                        setMemoEditing(app.id);
                      }}
                      className="text-sm text-slate-400 hover:text-slate-200 flex items-start gap-1.5 text-left w-full"
                    >
                      <span>✏️</span>
                      <span className={`flex-1 whitespace-pre-wrap leading-relaxed ${app.adminMemo ? '' : 'italic text-slate-500'}`}>
                        {app.adminMemo || '메모 추가'}
                      </span>
                    </button>
                  )}
                </div>

                {/* 액션 버튼 */}
                <div className="flex flex-wrap gap-2">
                  {app.status !== 'completed' && (
                    <button
                      type="button"
                      disabled={actionId === app.id}
                      onClick={() => createAccount(app.id, app.name)}
                      className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 text-white text-sm font-bold hover:opacity-90 disabled:opacity-60 transition shadow-sm"
                      title="전화번호로 사용자 계정 자동 생성 → 완료 처리"
                    >
                      ✨ 계정 자동 생성
                    </button>
                  )}
                  {app.status !== 'contacted' && app.status !== 'completed' && app.status !== 'rejected' && (
                    <button
                      type="button"
                      disabled={actionId === app.id}
                      onClick={() => doAction(app.id, 'markContacted')}
                      className="px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm font-medium hover:bg-sky-500 disabled:opacity-60 transition"
                    >
                      연락완료
                    </button>
                  )}
                  {app.status !== 'completed' && (
                    <button
                      type="button"
                      disabled={actionId === app.id}
                      onClick={() => doAction(app.id, 'markCompleted')}
                      className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 text-sm font-medium hover:bg-slate-700/60 disabled:opacity-60 transition"
                      title="다른 곳에서 이미 계정 만들었을 때 — 수동 완료 처리"
                    >
                      수동 완료
                    </button>
                  )}
                  {app.status !== 'rejected' && app.status !== 'completed' && (
                    <button
                      type="button"
                      disabled={actionId === app.id}
                      onClick={() => doAction(app.id, 'markRejected')}
                      className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-400 text-sm font-medium hover:bg-slate-700/60 disabled:opacity-60 transition"
                    >
                      거절
                    </button>
                  )}
                  {app.status === 'completed' && (
                    <button
                      type="button"
                      disabled={actionId === app.id}
                      onClick={() => grantCoupon(app.id, app.name)}
                      className="px-3 py-1.5 rounded-lg border border-amber-500/50 text-amber-300 text-sm font-medium hover:bg-amber-900/20 disabled:opacity-60 transition"
                      title={`이미 만들어진 계정에 포인트 구매 ${WELCOME_COUPON_PCT}% 할인 쿠폰을 지급합니다.`}
                    >
                      🎟 쿠폰 지급
                    </button>
                  )}
                  {app.status !== 'pending' && (
                    <button
                      type="button"
                      disabled={actionId === app.id}
                      onClick={() => doAction(app.id, 'markPending')}
                      className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-400 text-sm font-medium hover:bg-slate-700/60 disabled:opacity-60 transition"
                    >
                      대기로 되돌리기
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={actionId === app.id}
                    onClick={() => doDelete(app.id)}
                    className="px-3 py-1.5 rounded-lg border border-rose-700/60 text-rose-300 text-sm font-medium hover:bg-rose-900/30 disabled:opacity-60 transition ml-auto"
                  >
                    삭제
                  </button>
                </div>

                {/* 타임스탬프 */}
                {(app.contactedAt || app.completedAt || app.rejectedAt) && (
                  <div className="mt-3 pt-3 border-t border-slate-700/60 flex flex-wrap gap-3 text-xs text-slate-500">
                    {app.contactedAt && <span>📞 {fmtAbsolute(app.contactedAt)}</span>}
                    {app.completedAt && <span>✅ {fmtAbsolute(app.completedAt)}</span>}
                    {app.rejectedAt && <span>🚫 {fmtAbsolute(app.rejectedAt)}</span>}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </main>

      {/* 토스트 */}
      {copyMsg && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-700 text-white text-sm px-4 py-2 rounded-lg shadow-xl z-[60] border border-slate-600">
          {copyMsg}
        </div>
      )}

      {/* 계정 생성 결과 모달 */}
      {accountResult && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setAccountResult(null)}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {accountResult.ok ? (
              <>
                <div className="text-center mb-4">
                  <div className="text-4xl mb-2">✅</div>
                  <h3 className="text-lg font-bold text-white">계정 생성 완료</h3>
                  <p className="text-sm text-slate-400 mt-1">
                    「{accountResult.name}」 님의 계정이 만들어졌습니다.
                  </p>
                </div>
                <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-4 space-y-3">
                  <div>
                    <div className="text-xs text-slate-400 mb-1">로그인 ID</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm font-mono text-slate-200">
                        {accountResult.loginId}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyText(accountResult.loginId ?? '', '로그인 ID 복사')}
                        className="px-3 py-2 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-700/60"
                      >
                        📋
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400 mb-1">초기 비밀번호</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 px-3 py-2 bg-slate-800 border border-slate-600 rounded text-sm font-mono text-slate-200">
                        {accountResult.initialPassword}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyText(accountResult.initialPassword ?? '', '비밀번호 복사')}
                        className="px-3 py-2 text-xs rounded border border-slate-600 text-slate-300 hover:bg-slate-700/60"
                      >
                        📋
                      </button>
                    </div>
                  </div>
                </div>
                {accountResult.couponGrantedPct ? (
                  <div className="mt-3 rounded-xl border border-amber-500/50 bg-amber-900/20 px-4 py-3 text-sm text-amber-200 flex items-center gap-2">
                    <span className="text-lg">🎟</span>
                    포인트 구매 {accountResult.couponGrantedPct}% 할인 쿠폰이 함께 지급되었습니다.
                  </div>
                ) : null}
                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      copyText(
                        buildAccountNoticeText({
                          name: accountResult.name,
                          loginId: accountResult.loginId,
                          initialPassword: accountResult.initialPassword,
                          couponGrantedPct: accountResult.couponGrantedPct,
                        }),
                        '안내 멘트 복사 완료 (SMS·카톡 그대로 붙여넣기)',
                      );
                      setNoticeCopied(true);
                      window.setTimeout(() => setNoticeCopied(false), 1800);
                    }}
                    className={`w-full py-2.5 rounded-lg font-bold text-sm text-white transition-colors ${noticeCopied ? 'bg-emerald-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
                  >
                    {noticeCopied ? '✅ 복사되었습니다' : '📋 안내 멘트 전체 복사 (SMS·카톡용)'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountResult(null)}
                    className="w-full py-2 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600"
                  >
                    닫기
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 text-center mt-3 leading-relaxed">
                  신청서 상태가 자동으로 「가입처리완료」 로 변경됐습니다. <br />
                  학생에게 SMS/카톡 등으로 위 계정 정보를 전달하세요.
                </p>
              </>
            ) : (
              <>
                <div className="text-center mb-4">
                  <div className="text-4xl mb-2">⚠️</div>
                  <h3 className="text-lg font-bold text-white">계정 생성 실패</h3>
                </div>
                <div className="bg-rose-950/40 border border-rose-800/60 rounded-xl p-4 text-sm text-rose-300">
                  {accountResult.error}
                </div>
                <button
                  type="button"
                  onClick={() => setAccountResult(null)}
                  className="mt-4 w-full py-2 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600"
                >
                  닫기
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 보조 컴포넌트 ─────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number;
  accent: 'amber' | 'rose' | 'sky' | 'slate';
  hint?: string;
}

const ACCENT_CLASSES: Record<StatCardProps['accent'], { bg: string; ring: string; text: string }> = {
  amber: { bg: 'bg-amber-500/10', ring: 'ring-amber-500/30', text: 'text-amber-300' },
  rose: { bg: 'bg-rose-500/10', ring: 'ring-rose-500/30', text: 'text-rose-300' },
  sky: { bg: 'bg-sky-500/10', ring: 'ring-sky-500/30', text: 'text-sky-300' },
  slate: { bg: 'bg-slate-700/40', ring: 'ring-slate-600', text: 'text-slate-200' },
};

function StatCard({ label, value, accent, hint }: StatCardProps) {
  const c = ACCENT_CLASSES[accent];
  return (
    <div className={`${c.bg} rounded-xl ring-1 ${c.ring} p-3.5`}>
      <div className="text-[11px] text-slate-400 font-medium">{label}</div>
      <div className={`text-2xl font-bold mt-0.5 ${c.text} tabular-nums`}>{value.toLocaleString()}</div>
      {hint && <div className="text-[10px] text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}
