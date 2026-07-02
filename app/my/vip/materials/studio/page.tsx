'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STUDIO_DIFFICULTIES } from '@/lib/vip-material-studio';

interface Item { id: string; title: string; subtitle: string; difficulty: string; pageCount: number; updatedAt: string | null }

const LEVEL_CLS: Record<string, string> = {
  기초: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  심화: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  고난도: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

export default function StudioListPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newLevel, setNewLevel] = useState<string>('기초');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch('/api/my/vip/materials/studio', { credentials: 'include' }).then((r) => r.json());
      if (d.ok) setItems(d.items as Item[]);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const createBlank = async () => {
    setBusy(true);
    try {
      const d = await fetch('/api/my/vip/materials/studio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ title: newTitle.trim() || '새 교재', difficulty: newLevel }),
      }).then((r) => r.json());
      if (d.ok && d.id) router.push(`/my/vip/materials/studio/${d.id}`);
    } catch { alert('생성에 실패했습니다.'); }
    setBusy(false);
  };

  const createSeed = async () => {
    if (!confirm('여름방학 문법특강 8회차 교재 3권(기초·심화·고난도)을 샘플 내용과 함께 생성할까요?')) return;
    setBusy(true);
    try {
      const d = await fetch('/api/my/vip/materials/studio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ seed: 'grammar8' }),
      }).then((r) => r.json());
      if (d.ok) { await load(); alert('3권이 생성되었습니다. 카드를 눌러 편집하세요.'); }
    } catch { alert('생성에 실패했습니다.'); }
    setBusy(false);
  };

  const remove = async (it: Item) => {
    if (!confirm(`「${it.title}」 교재를 삭제할까요?`)) return;
    await fetch(`/api/my/vip/materials/studio/${it.id}`, { method: 'DELETE', credentials: 'include' });
    setItems((prev) => prev.filter((x) => x.id !== it.id));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-sm border border-[#c9a44e]/25">교재 만들기</span>
          스튜디오 <span className="text-[11px] font-normal px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">자유 편집</span>
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">인디자인처럼 페이지 위에 텍스트·이미지·QR·문제를 자유롭게 배치하고 PDF·HWPX 로 내려받습니다.</p>
      </div>

      {/* 생성 */}
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 flex flex-wrap items-end gap-2.5">
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">제목</label>
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="새 교재 제목"
            className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100 placeholder-zinc-600 w-56" />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">난이도</label>
          <select value={newLevel} onChange={(e) => setNewLevel(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100">
            {STUDIO_DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <button onClick={createBlank} disabled={busy}
          className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-200 text-sm font-semibold hover:bg-amber-500/30 disabled:opacity-40">
          + 새 교재
        </button>
        <button onClick={createSeed} disabled={busy}
          className="px-4 py-2 rounded-lg bg-emerald-500/15 text-emerald-300 text-sm font-semibold border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-40">
          🌞 여름방학 문법특강 8회차 세트 (기초·심화·고난도 3권)
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">
          아직 교재가 없습니다. 위에서 새 교재를 만들거나 문법특강 세트를 생성해 보세요.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((it) => (
            <div key={it.id} className="group rounded-xl bg-zinc-900/50 border border-zinc-800/80 hover:border-zinc-600 transition-colors overflow-hidden">
              <button onClick={() => router.push(`/my/vip/materials/studio/${it.id}`)} className="w-full text-left p-4">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  {it.difficulty && <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold border ${LEVEL_CLS[it.difficulty] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>{it.difficulty}</span>}
                  <span className="text-[11px] text-zinc-600">{it.pageCount}페이지</span>
                </div>
                <div className="text-sm font-semibold text-zinc-100 truncate">{it.title}</div>
                {it.subtitle && <div className="text-[12px] text-zinc-500 truncate mt-0.5">{it.subtitle}</div>}
                <div className="text-[11px] text-zinc-600 mt-2">{it.updatedAt ? new Date(it.updatedAt).toLocaleString('ko-KR') : ''}</div>
              </button>
              <div className="px-4 pb-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <a href={`/api/my/vip/materials/studio/${it.id}/pdf`} className="text-[11px] text-rose-300/90 hover:text-rose-200">PDF</a>
                <a href={`/api/my/vip/materials/studio/${it.id}/hwpx`} className="text-[11px] text-sky-300/90 hover:text-sky-200">HWPX</a>
                <button onClick={() => remove(it)} className="ml-auto text-[11px] text-zinc-600 hover:text-rose-400">삭제</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
