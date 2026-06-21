'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../_components/AdminSidebar';

interface ChargeRow {
  id: string;
  userId: string;
  name: string;
  loginId: string;
  points: number;
  balanceAfter: number | null;
  amountWon: number | null;
  orderId: string;
  couponDiscountPct: number | null;
  createdAt: string | null;
}
interface Summary { count: number; points: number; amount: number }

const won = (n: number | null) => (n == null ? '–' : `${n.toLocaleString()}원`);
const pt = (n: number) => `${n.toLocaleString()}P`;
const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '–';

export default function AdminPointChargesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [adminLoginId, setAdminLoginId] = useState('');
  const [items, setItems] = useState<ChargeRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ count: 0, points: 0, amount: 0 });
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user || d.user.role !== 'admin') { router.replace('/admin/login'); return; }
        setAdminLoginId(d.user.loginId ?? '');
        setReady(true);
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  const fetchList = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(p), limit: '50' });
      if (q.trim()) sp.set('q', q.trim());
      if (from) sp.set('from', from);
      if (to) sp.set('to', to);
      const r = await fetch(`/api/admin/point-charges?${sp}`, { credentials: 'include' });
      const d = await r.json();
      if (d.ok) {
        setItems(d.items);
        setSummary(d.summary);
        setTotal(d.total);
        setTotalPages(d.totalPages);
        setPage(d.page);
      }
    } finally {
      setLoading(false);
    }
  }, [q, from, to]);

  useEffect(() => { if (ready) void fetchList(1); }, [ready, fetchList]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <span className="text-sm text-slate-400">인증 확인 중…</span>
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
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">💳 회원 포인트 구매내역</h1>
            <p className="text-sm text-slate-400 mt-1">토스 결제로 충전한 포인트(point_charge) 전체 내역</p>
          </div>
          <button
            type="button"
            onClick={() => fetchList(page)}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm text-slate-300 hover:bg-slate-700/60 disabled:opacity-50"
            title="다시 불러오기"
          >
            {loading ? '⏳' : '↻ 새로고침'}
          </button>
        </div>

        {/* 요약 카드 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <p className="text-xs text-slate-400">구매 건수</p>
            <p className="text-2xl font-bold text-white mt-1 tabular-nums">{summary.count.toLocaleString()}건</p>
          </div>
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <p className="text-xs text-slate-400">총 충전 포인트</p>
            <p className="text-2xl font-bold text-indigo-300 mt-1 tabular-nums">{pt(summary.points)}</p>
          </div>
          <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <p className="text-xs text-slate-400">총 결제금액</p>
            <p className="text-2xl font-bold text-emerald-300 mt-1 tabular-nums">{won(summary.amount)}</p>
          </div>
        </div>

        {/* 필터 */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-wrap items-end gap-3 mb-6">
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">회원 검색</label>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchList(1); }}
              placeholder="이름 / 아이디"
              className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-sm text-white placeholder-slate-500 w-48 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">시작일</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-sm text-white focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="block text-[11px] text-slate-400 mb-1">종료일</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="px-3 py-2 rounded-lg bg-slate-700 border border-slate-600 text-sm text-white focus:outline-none focus:border-indigo-500 [color-scheme:dark]"
            />
          </div>
          <button
            onClick={() => fetchList(1)}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500"
          >
            조회
          </button>
          {(q || from || to) && (
            <button
              onClick={() => { setQ(''); setFrom(''); setTo(''); }}
              className="px-3 py-2 rounded-lg border border-slate-600 text-sm text-slate-400 hover:bg-slate-700/60"
            >
              초기화
            </button>
          )}
        </div>

        {/* 표 */}
        <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-slate-500">로딩 중…</div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm">구매내역이 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400 text-xs">
                    <th className="text-left px-4 py-3 font-medium">회원</th>
                    <th className="text-right px-3 py-3 font-medium">결제금액</th>
                    <th className="text-right px-3 py-3 font-medium">충전 포인트</th>
                    <th className="text-right px-3 py-3 font-medium">충전 후 잔액</th>
                    <th className="text-left px-3 py-3 font-medium">주문번호</th>
                    <th className="text-left px-3 py-3 font-medium">일시</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-b border-slate-700/50 hover:bg-slate-700/40">
                      <td className="px-4 py-2.5">
                        <span className="text-white font-medium">{it.name || '(이름없음)'}</span>
                        <span className="text-slate-500 text-xs ml-1.5">{it.loginId}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-emerald-300 font-semibold tabular-nums">
                        {won(it.amountWon)}
                        {it.couponDiscountPct ? <span className="text-[10px] text-rose-400 ml-1">-{it.couponDiscountPct}%</span> : null}
                      </td>
                      <td className="px-3 py-2.5 text-right text-indigo-300 font-semibold tabular-nums">{pt(it.points)}</td>
                      <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums">{it.balanceAfter == null ? '–' : pt(it.balanceAfter)}</td>
                      <td className="px-3 py-2.5 text-slate-500 text-xs font-mono">{it.orderId || '–'}</td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs">{fmtDate(it.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 페이지 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 text-sm mt-5">
            <button
              disabled={page <= 1}
              onClick={() => fetchList(page - 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 disabled:opacity-40 hover:bg-slate-700/60"
            >
              이전
            </button>
            <span className="text-slate-400">{page} / {totalPages} · 총 {total.toLocaleString()}건</span>
            <button
              disabled={page >= totalPages}
              onClick={() => fetchList(page + 1)}
              className="px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 disabled:opacity-40 hover:bg-slate-700/60"
            >
              다음
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
