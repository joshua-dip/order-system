'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../_components/AdminSidebar';

interface MenuRow { id: string; label: string; paid: boolean; price: number }

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

  const save = async () => {
    setSaving(true);
    const menus: Record<string, { paid: boolean; price: number }> = {};
    for (const r of rows) menus[r.id] = { paid: r.paid, price: Math.max(0, Math.floor(r.price || 0)) };
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
        <div className="max-w-3xl">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
            <h1 className="text-xl font-bold">VIP 메뉴 판매 설정</h1>
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-medium disabled:opacity-50">{saving ? '저장 중…' : '저장'}</button>
          </div>
          <p className="text-sm text-slate-400 mb-1">메뉴별로 유료 여부와 포인트 가격을 정합니다. 유료로 지정한 메뉴는 VIP 회원이 「메뉴 설정」에서 구매해야 사용할 수 있습니다.</p>
          <p className="text-xs text-slate-500 mb-5">유료 해제(무료)하면 모든 VIP 회원이 즉시 사용 가능. {savedAt && <span className="text-emerald-400">· {savedAt} 저장됨</span>}</p>

          {loading ? (
            <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-slate-600 border-t-slate-400 rounded-full animate-spin" /></div>
          ) : (
            <div className="rounded-xl border border-slate-700/70 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-800/60 text-slate-400 text-xs">
                    <th className="text-left px-4 py-2.5">메뉴</th>
                    <th className="text-center px-4 py-2.5 w-24">유료</th>
                    <th className="text-right px-4 py-2.5 w-44">가격 (포인트)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-700/50">
                      <td className="px-4 py-3 text-slate-200 font-medium">{r.label}</td>
                      <td className="px-4 py-3 text-center">
                        <input type="checkbox" checked={r.paid} onChange={(e) => setRow(r.id, { paid: e.target.checked })} className="rounded accent-indigo-500 w-4 h-4" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input type="number" min={0} step={100} value={r.price} disabled={!r.paid}
                          onChange={(e) => setRow(r.id, { price: Number(e.target.value) })}
                          className="w-32 px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-right text-slate-100 disabled:opacity-40 focus:outline-none" />
                        <span className="text-slate-500 ml-1.5">P</span>
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
