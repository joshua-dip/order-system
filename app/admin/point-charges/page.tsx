'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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
    return <div className="min-h-screen flex items-center justify-center text-slate-400">불러오는 중…</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-slate-800">💳 회원 포인트 구매내역</h1>
            <p className="text-xs text-slate-500 mt-0.5">토스 결제로 충전한 포인트(point_charge) 전체 내역</p>
          </div>
          <Link href="/admin" className="text-sm text-slate-500 hover:text-slate-800 px-3 py-2 rounded-lg border">← 관리자 홈</Link>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        {/* 요약 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs text-slate-500">구매 건수</p>
            <p className="text-xl font-bold text-slate-800 mt-1">{summary.count.toLocaleString()}건</p>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs text-slate-500">총 충전 포인트</p>
            <p className="text-xl font-bold text-indigo-600 mt-1">{pt(summary.points)}</p>
          </div>
          <div className="bg-white rounded-xl border p-4">
            <p className="text-xs text-slate-500">총 결제금액</p>
            <p className="text-xl font-bold text-emerald-600 mt-1">{won(summary.amount)}</p>
          </div>
        </div>

        {/* 필터 */}
        <div className="bg-white rounded-xl border p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">회원 검색</label>
            <input value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') fetchList(1); }}
              placeholder="이름 / 아이디"
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm w-48" />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">시작일</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </div>
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">종료일</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-300 text-sm" />
          </div>
          <button onClick={() => fetchList(1)}
            className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-700">조회</button>
          {(q || from || to) && (
            <button onClick={() => { setQ(''); setFrom(''); setTo(''); }}
              className="px-3 py-2 rounded-lg border text-sm text-slate-500 hover:bg-slate-50">초기화</button>
          )}
        </div>

        {/* 표 */}
        <div className="bg-white rounded-xl border overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-slate-400">로딩 중…</div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-sm">구매내역이 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b text-slate-500 text-xs">
                  <th className="text-left px-4 py-2.5 font-medium">회원</th>
                  <th className="text-right px-3 py-2.5 font-medium">결제금액</th>
                  <th className="text-right px-3 py-2.5 font-medium">충전 포인트</th>
                  <th className="text-right px-3 py-2.5 font-medium">충전 후 잔액</th>
                  <th className="text-left px-3 py-2.5 font-medium">주문번호</th>
                  <th className="text-left px-3 py-2.5 font-medium">일시</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b last:border-0 hover:bg-slate-50/60">
                    <td className="px-4 py-2.5">
                      <span className="text-slate-800 font-medium">{it.name || '(이름없음)'}</span>
                      <span className="text-slate-400 text-xs ml-1.5">{it.loginId}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-emerald-700 font-semibold">
                      {won(it.amountWon)}
                      {it.couponDiscountPct ? <span className="text-[10px] text-rose-500 ml-1">-{it.couponDiscountPct}%</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right text-indigo-600 font-semibold">{pt(it.points)}</td>
                    <td className="px-3 py-2.5 text-right text-slate-500">{it.balanceAfter == null ? '–' : pt(it.balanceAfter)}</td>
                    <td className="px-3 py-2.5 text-slate-400 text-xs font-mono">{it.orderId || '–'}</td>
                    <td className="px-3 py-2.5 text-slate-500 text-xs">{fmtDate(it.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 페이지 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 text-sm">
            <button disabled={page <= 1} onClick={() => fetchList(page - 1)}
              className="px-3 py-1.5 rounded border disabled:opacity-40 hover:bg-white">이전</button>
            <span className="text-slate-500">{page} / {totalPages} · 총 {total.toLocaleString()}건</span>
            <button disabled={page >= totalPages} onClick={() => fetchList(page + 1)}
              className="px-3 py-1.5 rounded border disabled:opacity-40 hover:bg-white">다음</button>
          </div>
        )}
      </main>
    </div>
  );
}
