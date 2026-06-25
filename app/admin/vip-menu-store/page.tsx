'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../_components/AdminSidebar';

interface MenuRow { id: string; label: string; paid: boolean; price: number; published: boolean }

const DEFAULT_PRICE = 1500;

export default function AdminVipMenuStorePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [adminLoginId, setAdminLoginId] = useState('');
  const [rows, setRows] = useState<MenuRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState('');

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user || d.user.role !== 'admin') { router.replace('/admin/login'); return; }
        setAdminLoginId(d.user.loginId ?? '');
        setReady(true);
      });
  }, [router]);

  const load = useCallback(async () => {
    const d = await fetch('/api/admin/vip-menu-store', { credentials: 'include' }).then((r) => r.json());
    if (d.ok) setRows(d.menus);
    setLoading(false);
  }, []);
  useEffect(() => { if (ready) load(); }, [ready, load]);

  const setRow = (id: string, patch: Partial<MenuRow>) => setRows((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));

  // 일괄: 전 메뉴 유료 + 1500P (기본 제공할 메뉴는 이후 '기본 제공' 체크로 제외)
  const applyAllPaid = () => setRows((prev) => prev.map((r) => ({ ...r, paid: true, price: DEFAULT_PRICE })));
  const setAllFree = () => setRows((prev) => prev.map((r) => ({ ...r, paid: false })));
  const setAllPublished = (v: boolean) => setRows((prev) => prev.map((r) => ({ ...r, published: v })));

  const paidCount = rows.filter((r) => r.paid).length;
  const freeCount = rows.length - paidCount;
  const pubCount = rows.filter((r) => r.paid && r.published).length;

  const save = async () => {
    setSaving(true);
    const menus: Record<string, { paid: boolean; price: number; published: boolean }> = {};
    for (const r of rows) menus[r.id] = { paid: r.paid, price: Math.max(0, Math.floor(r.price || 0)), published: r.published };
    const res = await fetch('/api/admin/vip-menu-store', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ menus }) });
    const d = await res.json();
    if (res.ok && d.ok) setSavedAt(new Date().toLocaleTimeString());
    else alert(d.error || '저장 실패');
    setSaving(false);
  };

  if (!ready) {
    return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center"><span className="text-sm text-slate-400">인증 확인 중…</span></div>;
  }

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      <AdminSidebar loginId={adminLoginId} />
      <main className="flex-1 p-8 overflow-x-hidden">
        <div className="max-w-4xl">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
            <h1 className="text-xl font-bold">VIP 메뉴 판매 설정</h1>
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium disabled:opacity-50">{saving ? '저장 중…' : '저장'}</button>
          </div>
          <p className="text-sm text-slate-400 mb-1"><b className="text-slate-200">기본 제공</b>(무료)으로 둔 메뉴는 모든 VIP가 즉시 사용합니다. 그 외는 <b className="text-slate-200">유료</b>이며, <b className="text-amber-300">공개</b>한 메뉴만 회원이 구매할 수 있습니다(비공개=준비 중).</p>
          <p className="text-xs text-slate-500 mb-4">예: 「학생 관리」는 출결·성적이 연동되므로 기본 제공 권장. {savedAt && <span className="text-emerald-400">· {savedAt} 저장됨</span>}</p>

          {/* 일괄 버튼 */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <button onClick={applyAllPaid} className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm hover:bg-slate-700">전부 유료 {DEFAULT_PRICE.toLocaleString()}P</button>
            <button onClick={setAllFree} className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm hover:bg-slate-700">전부 기본 제공</button>
            <span className="w-px h-5 bg-slate-700 mx-1" />
            <button onClick={() => setAllPublished(true)} className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm hover:bg-slate-700">전부 공개</button>
            <button onClick={() => setAllPublished(false)} className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-sm hover:bg-slate-700">전부 비공개</button>
            <span className="ml-auto text-xs text-slate-500">기본 {freeCount} · 유료 {paidCount} (공개 {pubCount})</span>
          </div>

          {loading ? (
            <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin" /></div>
          ) : (
            <div className="rounded-xl border border-slate-700/70 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-800/60 text-slate-400 text-xs">
                    <th className="text-left px-4 py-2.5">메뉴</th>
                    <th className="text-center px-3 py-2.5 w-28">기본 제공</th>
                    <th className="text-right px-4 py-2.5 w-40">가격 (포인트)</th>
                    <th className="text-center px-3 py-2.5 w-24">공개</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-700/50">
                      <td className="px-4 py-3 text-slate-200 font-medium">
                        {r.label}
                        {!r.paid
                          ? <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">기본</span>
                          : r.published
                            ? <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">유료·공개</span>
                            : <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-slate-600/40 text-slate-400">유료·준비 중</span>}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <input type="checkbox" checked={!r.paid} onChange={(e) => setRow(r.id, { paid: !e.target.checked })} className="rounded accent-emerald-500 w-4 h-4" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input type="number" min={0} step={100} value={r.price} disabled={!r.paid}
                          onChange={(e) => setRow(r.id, { price: Number(e.target.value) })}
                          className="w-28 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-right text-slate-100 disabled:opacity-30 focus:outline-none" />
                        <span className="text-slate-500 ml-1.5">P</span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <input type="checkbox" checked={r.paid && r.published} disabled={!r.paid} onChange={(e) => setRow(r.id, { published: e.target.checked })} className="rounded accent-amber-500 w-4 h-4 disabled:opacity-30" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
