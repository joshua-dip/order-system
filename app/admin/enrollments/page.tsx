'use client';

import { useState, useEffect, useCallback } from 'react';

interface Enrollment {
  id: string;
  studentLoginId: string;
  studentName: string;
  cycleSnapshot: { title: string; priceWon: number; totalWeeks: number; targetGrade: string };
  status: string;
  depositorName?: string;
  appliedAt: string;
  paidAt?: string;
  activatedAt?: string;
  adminMemo?: string;
}

const TABS: { value: string; label: string }[] = [
  { value: 'pending_payment', label: '결제 대기' },
  { value: 'active', label: '활성' },
  { value: 'completed', label: '완료' },
  { value: 'cancelled', label: '취소' },
];

export default function AdminEnrollmentsPage() {
  const [tab, setTab] = useState('pending_payment');
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [memo, setMemo] = useState<Record<string, string>>({});
  const [memoEditing, setMemoEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const sp = new URLSearchParams({ status: tab, search });
    const res = await fetch(`/api/admin/enrollments?${sp}`);
    const d = await res.json();
    setEnrollments(d.enrollments ?? []);
    setLoading(false);
  }, [tab, search]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (id: string, action: string, extra?: Record<string, unknown>) => {
    setActionId(id);
    await fetch(`/api/admin/enrollments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    setActionId(null);
    load();
  };

  const saveMemo = async (id: string) => {
    await fetch(`/api/admin/enrollments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminMemo: memo[id] ?? '' }),
    });
    setMemoEditing(null);
    load();
  };

  const fmt = (d?: string) => d ? new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">등록 신청 관리</h1>
        <p className="text-sm text-slate-500 mt-0.5">학생의 사이클 신청 현황을 확인하고 입금을 승인합니다.</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        {/* 탭 */}
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {TABS.map(t => (
            <button key={t.value} type="button" onClick={() => setTab(t.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === t.value ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="아이디 또는 입금자명 검색"
          className="flex-1 px-4 py-2 rounded-xl border border-slate-200 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none"
        />
      </div>

      {loading ? <p className="text-slate-400 text-center py-10">불러오는 중...</p> : (
        <div className="space-y-3">
          {enrollments.map(e => (
            <div key={e.id} className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-bold text-slate-800">{e.studentName}</span>
                    <span className="text-xs text-slate-400">{e.studentLoginId}</span>
                    {e.depositorName && <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">입금자: {e.depositorName}</span>}
                  </div>
                  <p className="text-sm text-slate-600">{e.cycleSnapshot.title}</p>
                  <p className="text-sm font-semibold text-indigo-600">{e.cycleSnapshot.priceWon.toLocaleString()}원</p>
                  <div className="flex gap-3 mt-1 text-xs text-slate-400 flex-wrap">
                    <span>신청: {fmt(e.appliedAt)}</span>
                    {e.paidAt && <span className="text-emerald-600">입금신고: {fmt(e.paidAt)}</span>}
                    {e.activatedAt && <span>활성화: {fmt(e.activatedAt)}</span>}
                  </div>

                  {/* 메모 */}
                  <div className="mt-2">
                    {memoEditing === e.id ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={memo[e.id] ?? e.adminMemo ?? ''}
                          onChange={ev => setMemo(m => ({ ...m, [e.id]: ev.target.value }))}
                          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:border-indigo-400 outline-none"
                          placeholder="관리자 메모"
                        />
                        <button type="button" onClick={() => saveMemo(e.id)} className="text-xs px-2 py-1 rounded-lg bg-indigo-600 text-white">저장</button>
                        <button type="button" onClick={() => setMemoEditing(null)} className="text-xs px-2 py-1 rounded-lg border border-slate-200 text-slate-600">취소</button>
                      </div>
                    ) : (
                      <button type="button" onClick={() => { setMemoEditing(e.id); setMemo(m => ({ ...m, [e.id]: e.adminMemo ?? '' })); }}
                        className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
                        {e.adminMemo ? `메모: ${e.adminMemo}` : '+ 메모 추가'}
                      </button>
                    )}
                  </div>
                </div>

                {/* 액션 */}
                <div className="flex flex-wrap gap-2 flex-shrink-0">
                  {e.status === 'pending_payment' && (
                    <button type="button" onClick={() => doAction(e.id, 'activate')} disabled={actionId === e.id}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors">
                      {actionId === e.id ? '처리 중...' : '활성화'}
                    </button>
                  )}
                  {(e.status === 'pending_payment' || e.status === 'active') && (
                    <button type="button" onClick={() => { if (confirm('취소하시겠습니까?')) doAction(e.id, 'cancel'); }}
                      className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-medium hover:bg-red-50 transition-colors">
                      취소
                    </button>
                  )}
                  {e.status === 'active' && (
                    <button type="button" onClick={() => doAction(e.id, 'complete')}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-medium hover:bg-slate-50 transition-colors">
                      완료 처리
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {enrollments.length === 0 && <div className="text-center py-12 text-slate-400">해당하는 신청이 없습니다.</div>}
        </div>
      )}
    </div>
  );
}
