'use client';

import { useState, useEffect, useCallback } from 'react';

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

const TABS: { value: AppStatus | 'all'; label: string }[] = [
  { value: 'pending', label: '대기' },
  { value: 'contacted', label: '연락완료' },
  { value: 'completed', label: '가입처리완료' },
  { value: 'rejected', label: '거절' },
  { value: 'all', label: '전체' },
];

const TYPE_LABELS: Record<ApplicantType, string> = {
  student: '학생',
  parent: '학부모',
  teacher: '선생님',
};

const TYPE_COLORS: Record<ApplicantType, string> = {
  student: 'bg-blue-100 text-blue-700',
  parent: 'bg-purple-100 text-purple-700',
  teacher: 'bg-green-100 text-green-700',
};

const STATUS_LABELS: Record<AppStatus, string> = {
  pending: '대기',
  contacted: '연락완료',
  completed: '가입처리완료',
  rejected: '거절',
};

const CONTACT_NUMBER = '01079270806';

export default function AdminMembershipApplicationsPage() {
  const [tab, setTab] = useState<AppStatus | 'all'>('pending');
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [actionId, setActionId] = useState<string | null>(null);
  const [memo, setMemo] = useState<Record<string, string>>({});
  const [memoEditing, setMemoEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sp = new URLSearchParams({ search });
    if (tab !== 'all') sp.set('status', tab);
    sp.set('limit', '100');
    const res = await fetch(`/api/admin/membership-applications?${sp}`);
    const d = await res.json();
    setApplications(d.applications ?? []);
    setPendingCount(d.pendingCount ?? 0);
    setLoading(false);
  }, [tab, search]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (id: string, action: string, extra?: Record<string, unknown>) => {
    setActionId(id);
    await fetch(`/api/admin/membership-applications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    setActionId(null);
    load();
  };

  const doDelete = async (id: string) => {
    if (!confirm('신청서를 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
    setActionId(id);
    await fetch(`/api/admin/membership-applications/${id}`, { method: 'DELETE' });
    setActionId(null);
    load();
  };

  const saveMemo = async (id: string) => {
    await fetch(`/api/admin/membership-applications/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'updateMemo', adminMemo: memo[id] ?? '' }),
    });
    setMemoEditing(null);
    load();
  };

  const fmt = (d?: string) =>
    d
      ? new Date(d).toLocaleDateString('ko-KR', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '-';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">가입 신청 관리</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          신규 회원 가입 신청서를 확인하고 처리합니다.
          {pendingCount > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 text-red-600 font-semibold">
              미처리 {pendingCount}건
            </span>
          )}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        {/* 탭 */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTab(t.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                tab === t.value
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              {t.label}
              {t.value === 'pending' && pendingCount > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  {pendingCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* 검색 */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이름·전화 검색"
          className="flex-1 px-4 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-indigo-400"
        />
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">불러오는 중...</div>
      ) : applications.length === 0 ? (
        <div className="text-center py-16 text-slate-400">신청서가 없습니다.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {applications.map((app) => (
            <div key={app.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 sm:p-5">
              {/* 헤더 행 */}
              <div className="flex flex-wrap items-start gap-2 mb-3">
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${TYPE_COLORS[app.applicantType]}`}>
                  {TYPE_LABELS[app.applicantType]}
                </span>
                <span className="text-base font-bold text-slate-800">{app.name}</span>
                <div className="flex gap-2 ml-auto items-center">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    app.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                    app.status === 'contacted' ? 'bg-blue-100 text-blue-700' :
                    app.status === 'completed' ? 'bg-green-100 text-green-700' :
                    'bg-slate-100 text-slate-500'
                  }`}>
                    {STATUS_LABELS[app.status]}
                  </span>
                  <span className="text-xs text-slate-400">{fmt(app.appliedAt)}</span>
                </div>
              </div>

              {/* 전화번호 */}
              <div className="flex gap-2 mb-3">
                <a
                  href={`tel:${app.phone.replace(/-/g, '')}`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-sm font-mono text-slate-700 transition"
                >
                  📞 {app.phone}
                </a>
                <a
                  href={`sms:${app.phone.replace(/-/g, '')}?body=${encodeURIComponent(`안녕하세요, ${app.name}님. 가입 신청 확인했습니다.`)}`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-yellow-50 hover:bg-yellow-100 text-sm text-slate-700 transition"
                >
                  💬 문자
                </a>
                <a
                  href={`tel:${CONTACT_NUMBER}`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-xs text-slate-500 transition ml-auto"
                >
                  관리자 번호: {CONTACT_NUMBER}
                </a>
              </div>

              {/* 메모 */}
              <div className="mb-3">
                {memoEditing === app.id ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={memo[app.id] ?? app.adminMemo ?? ''}
                      onChange={(e) => setMemo((m) => ({ ...m, [app.id]: e.target.value }))}
                      placeholder="관리자 메모"
                      className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:outline-none focus:border-indigo-400"
                    />
                    <button
                      type="button"
                      onClick={() => saveMemo(app.id)}
                      className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      onClick={() => setMemoEditing(null)}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 text-sm hover:bg-slate-200"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setMemo((m) => ({ ...m, [app.id]: app.adminMemo ?? '' }));
                      setMemoEditing(app.id);
                    }}
                    className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1.5"
                  >
                    <span>✏️</span>
                    <span>{app.adminMemo ? app.adminMemo : '메모 추가'}</span>
                  </button>
                )}
              </div>

              {/* 액션 버튼 */}
              <div className="flex flex-wrap gap-2">
                {app.status !== 'contacted' && app.status !== 'completed' && app.status !== 'rejected' && (
                  <button
                    type="button"
                    disabled={actionId === app.id}
                    onClick={() => doAction(app.id, 'markContacted')}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition"
                  >
                    연락완료
                  </button>
                )}
                {app.status !== 'completed' && (
                  <button
                    type="button"
                    disabled={actionId === app.id}
                    onClick={() => doAction(app.id, 'markCompleted')}
                    className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-60 transition"
                  >
                    가입처리완료
                  </button>
                )}
                {app.status !== 'rejected' && app.status !== 'completed' && (
                  <button
                    type="button"
                    disabled={actionId === app.id}
                    onClick={() => doAction(app.id, 'markRejected')}
                    className="px-3 py-1.5 rounded-lg bg-slate-500 text-white text-sm font-medium hover:bg-slate-600 disabled:opacity-60 transition"
                  >
                    거절
                  </button>
                )}
                {app.status !== 'pending' && (
                  <button
                    type="button"
                    disabled={actionId === app.id}
                    onClick={() => doAction(app.id, 'markPending')}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 transition"
                  >
                    대기로 되돌리기
                  </button>
                )}
                <button
                  type="button"
                  disabled={actionId === app.id}
                  onClick={() => doDelete(app.id)}
                  className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 disabled:opacity-60 transition ml-auto"
                >
                  삭제
                </button>
              </div>

              {/* 타임스탬프 */}
              {(app.contactedAt || app.completedAt || app.rejectedAt) && (
                <div className="mt-3 pt-3 border-t border-slate-50 flex flex-wrap gap-3 text-xs text-slate-400">
                  {app.contactedAt && <span>연락: {fmt(app.contactedAt)}</span>}
                  {app.completedAt && <span>처리완료: {fmt(app.completedAt)}</span>}
                  {app.rejectedAt && <span>거절: {fmt(app.rejectedAt)}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
