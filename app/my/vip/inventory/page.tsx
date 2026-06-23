'use client';

import { useCallback, useEffect, useState } from 'react';

interface InvItem { id: string; name: string; category: string; quantity: number; unit: string; minQuantity: number; location: string; note: string; lowStock: boolean; createdAt: string }
interface CategoryAgg { name: string; count: number }
interface Summary { lowStock: number }

export default function InventoryPage() {
  const [items, setItems] = useState<InvItem[]>([]);
  const [categories, setCategories] = useState<CategoryAgg[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // 폼
  const [fName, setFName] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fQuantity, setFQuantity] = useState('0');
  const [fUnit, setFUnit] = useState('');
  const [fMinQuantity, setFMinQuantity] = useState('0');
  const [fLocation, setFLocation] = useState('');
  const [fNote, setFNote] = useState('');

  const resetForm = () => {
    setEditId(null); setFName(''); setFCategory(''); setFQuantity('0');
    setFUnit(''); setFMinQuantity('0'); setFLocation(''); setFNote('');
  };

  const load = useCallback(async (category: string, q: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (q.trim()) params.set('q', q.trim());
    const d = await fetch(`/api/my/vip/inventory?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setItems(d.items); setCategories(d.categories ?? []); setSummary(d.summary ?? null); }
    setLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { load(filterCategory, query); }, query ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, filterCategory, query]);

  const submit = async () => {
    if (!fName.trim()) { alert('품목명을 입력하세요.'); return; }
    setSaving(true);
    try {
      const payload = {
        name: fName, category: fCategory, quantity: Number(fQuantity) || 0,
        unit: fUnit, minQuantity: Number(fMinQuantity) || 0, location: fLocation, note: fNote,
      };
      const url = editId ? `/api/my/vip/inventory?id=${editId}` : '/api/my/vip/inventory';
      const res = await fetch(url, {
        method: editId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setOpen(false); resetForm();
      await load(filterCategory, query);
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };

  const startEdit = (it: InvItem) => {
    setEditId(it.id);
    setFName(it.name); setFCategory(it.category); setFQuantity(String(it.quantity));
    setFUnit(it.unit); setFMinQuantity(String(it.minQuantity)); setFLocation(it.location); setFNote(it.note);
    setOpen(true);
  };

  const adjust = async (it: InvItem, delta: number) => {
    // 낙관적 업데이트
    setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, quantity: Math.max(0, x.quantity + delta), lowStock: x.minQuantity > 0 && Math.max(0, x.quantity + delta) <= x.minQuantity } : x));
    await fetch(`/api/my/vip/inventory?id=${it.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ delta }),
    });
    await load(filterCategory, query);
  };

  const remove = async (it: InvItem) => {
    if (!confirm(`「${it.name}」 품목을 삭제할까요?`)) return;
    await fetch(`/api/my/vip/inventory?id=${it.id}`, { method: 'DELETE', credentials: 'include' });
    await load(filterCategory, query);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">재고 관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">교재·물품 재고 수량을 관리하고 부족 품목을 한눈에 봅니다.</p>
        </div>
        <div className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="품목명 검색"
            className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          <button onClick={() => { if (open) { setOpen(false); } else { resetForm(); setOpen(true); } }}
            className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">＋ 품목 추가</button>
        </div>
      </div>

      {/* 요약 */}
      {summary && (
        <div className="grid grid-cols-1 gap-2 max-w-[200px]">
          <div className={`rounded-lg px-3 py-2.5 text-center border ${summary.lowStock > 0 ? 'bg-rose-900/15 border-rose-700/40' : 'bg-zinc-900/60 border-zinc-800/70'}`}>
            <div className={`text-lg font-bold tabular-nums ${summary.lowStock > 0 ? 'text-rose-300' : 'text-zinc-100'}`}>{summary.lowStock}</div>
            <div className={`text-[10px] mt-0.5 ${summary.lowStock > 0 ? 'text-rose-300/70' : 'text-zinc-500'}`}>부족 품목</div>
          </div>
        </div>
      )}

      {/* 작성/수정 폼 */}
      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <div className="text-sm font-medium text-zinc-300">{editId ? '품목 수정' : '새 품목 추가'}</div>
          <div className="flex flex-wrap gap-2">
            <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="품목명"
              className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <input value={fCategory} onChange={(e) => setFCategory(e.target.value)} placeholder="분류" list="inv-categories"
              className="w-[140px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <datalist id="inv-categories">
              {categories.map((c) => <option key={c.name} value={c.name} />)}
            </datalist>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] text-zinc-500">수량</span>
              <input type="number" min={0} value={fQuantity} onChange={(e) => setFQuantity(e.target.value)}
                className="w-[90px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 focus:outline-none focus:border-[#c9a44e]/50" />
            </div>
            <input value={fUnit} onChange={(e) => setFUnit(e.target.value)} placeholder="단위 (권, 개…)"
              className="w-[120px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <div className="flex items-center gap-1.5">
              <span className="text-[12px] text-zinc-500">최소</span>
              <input type="number" min={0} value={fMinQuantity} onChange={(e) => setFMinQuantity(e.target.value)}
                className="w-[90px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 focus:outline-none focus:border-[#c9a44e]/50" />
            </div>
            <input value={fLocation} onChange={(e) => setFLocation(e.target.value)} placeholder="보관 위치"
              className="flex-1 min-w-[140px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          </div>
          <textarea value={fNote} onChange={(e) => setFNote(e.target.value)} placeholder="메모 (선택)" rows={2}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setOpen(false); resetForm(); }} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200 transition-colors">취소</button>
            <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">{saving ? '저장 중…' : editId ? '수정 저장' : '품목 저장'}</button>
          </div>
        </div>
      )}

      {/* 분류 필터 */}
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setFilterCategory('')} className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${filterCategory === '' ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>전체</button>
        {categories.map((c) => (
          <button key={c.name} onClick={() => setFilterCategory(c.name)} className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${filterCategory === c.name ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>{c.name} <span className="text-[11px] opacity-70">{c.count}</span></button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">{query || filterCategory ? '조건에 맞는 품목이 없습니다.' : '등록된 품목이 없습니다. 「＋ 품목 추가」로 시작하세요.'}</div>
      ) : (
        <div className="space-y-2.5">
          {items.map((it) => (
            <div key={it.id} className={`rounded-xl border p-4 flex items-center gap-4 ${it.lowStock ? 'bg-rose-900/10 border-rose-700/40' : 'bg-zinc-900/50 border-zinc-800/80'}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-medium text-zinc-100">{it.name}</span>
                  {it.category && <span className="px-1.5 py-0.5 rounded text-[11px] bg-zinc-700/50 text-zinc-300">{it.category}</span>}
                  {it.lowStock && <span className="px-1.5 py-0.5 rounded text-[11px] bg-rose-500/20 text-rose-200">부족</span>}
                  {it.location && <span className="text-[11px] text-zinc-500">📍 {it.location}</span>}
                </div>
                {it.note && <div className="text-[12px] text-zinc-500 whitespace-pre-wrap leading-relaxed">{it.note}</div>}
                {it.minQuantity > 0 && <div className="text-[11px] text-zinc-600 mt-0.5">최소 보유 {it.minQuantity}{it.unit}</div>}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => adjust(it, -1)} className="w-7 h-7 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors text-base leading-none">−</button>
                <div className="text-center min-w-[56px]">
                  <span className={`text-xl font-bold tabular-nums ${it.lowStock ? 'text-rose-300' : 'text-zinc-100'}`}>{it.quantity}</span>
                  {it.unit && <span className="text-[11px] text-zinc-500 ml-0.5">{it.unit}</span>}
                </div>
                <button onClick={() => adjust(it, 1)} className="w-7 h-7 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors text-base leading-none">＋</button>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <button onClick={() => startEdit(it)} className="text-[11px] text-zinc-500 hover:text-zinc-200 transition-colors">수정</button>
                <button onClick={() => remove(it)} className="text-[11px] text-zinc-600 hover:text-rose-400 transition-colors">삭제</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
