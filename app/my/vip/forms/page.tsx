'use client';

import { useCallback, useEffect, useState } from 'react';

interface FormItem { id: string; title: string; category: string; content: string; createdAt: string; updatedAt: string | null }
interface CategoryItem { name: string; count: number }

export default function FormsPage() {
  const [forms, setForms] = useState<FormItem[]>([]);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 새 양식 폼
  const [fTitle, setFTitle] = useState('');
  const [fCategory, setFCategory] = useState('');
  const [fContent, setFContent] = useState('');

  // 인라인 편집
  const [editId, setEditId] = useState('');
  const [eTitle, setETitle] = useState('');
  const [eCategory, setECategory] = useState('');
  const [eContent, setEContent] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const load = useCallback(async (category: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    const d = await fetch(`/api/my/vip/forms?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setForms(d.forms); setCategories(d.categories ?? []); }
    setLoading(false);
  }, []);

  useEffect(() => { load(filterCat); }, [load, filterCat]);

  const create = async () => {
    if (!fTitle.trim()) { alert('제목을 입력하세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/forms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ title: fTitle, category: fCategory, content: fContent }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setOpen(false); setFTitle(''); setFCategory(''); setFContent('');
      await load(filterCat);
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };

  const startEdit = (f: FormItem) => {
    setEditId(f.id); setETitle(f.title); setECategory(f.category); setEContent(f.content);
  };

  const saveEdit = async () => {
    if (!eTitle.trim()) { alert('제목을 입력하세요.'); return; }
    setEditSaving(true);
    try {
      const res = await fetch(`/api/my/vip/forms?id=${editId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ title: eTitle, category: eCategory, content: eContent }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setEditSaving(false); return; }
      setEditId('');
      await load(filterCat);
    } catch { alert('저장 중 오류'); }
    setEditSaving(false);
  };

  const copy = async (f: FormItem) => {
    try { await navigator.clipboard.writeText(f.content); alert('본문을 복사했습니다.'); }
    catch { alert('복사에 실패했습니다.'); }
  };

  const printForm = (f: FormItem) => {
    if (editId !== f.id) startEdit(f);
    setTimeout(() => window.print(), 50);
  };

  const remove = async (f: FormItem) => {
    if (!confirm('이 양식을 삭제할까요?')) return;
    await fetch(`/api/my/vip/forms?id=${f.id}`, { method: 'DELETE', credentials: 'include' });
    if (editId === f.id) setEditId('');
    await load(filterCat);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">학원 양식 관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">동의서·안내문 등 학원 문서 양식을 작성·보관하고 인쇄합니다.</p>
        </div>
        <button onClick={() => setOpen((v) => !v)}
          className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">＋ 새 양식</button>
      </div>

      {/* 작성 폼 */}
      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="양식 제목"
              className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <input value={fCategory} onChange={(e) => setFCategory(e.target.value)} placeholder="분류 (선택)" list="form-categories"
              className="w-44 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <datalist id="form-categories">
              {categories.map((c) => <option key={c.name} value={c.name} />)}
            </datalist>
          </div>
          <textarea value={fContent} onChange={(e) => setFContent(e.target.value)} placeholder="양식 본문 (동의서·안내문 내용)" rows={8}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200 transition-colors">취소</button>
            <button onClick={create} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">{saving ? '저장 중…' : '저장'}</button>
          </div>
        </div>
      )}

      {/* 분류 칩 */}
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setFilterCat('')} className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${filterCat === '' ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>전체</button>
        {categories.map((c) => (
          <button key={c.name || '__none'} onClick={() => setFilterCat(c.name)} className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${filterCat === c.name ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>{c.name || '미분류'} <span className="text-zinc-500">{c.count}</span></button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : forms.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">양식이 없습니다. 「＋ 새 양식」으로 시작하세요.</div>
      ) : (
        <div className="space-y-2.5">
          {forms.map((f) => (
            <div key={f.id} className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-4">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                {f.category && <span className="px-1.5 py-0.5 rounded text-[11px] bg-zinc-700/50 text-zinc-300">{f.category}</span>}
                <span className="text-sm font-medium text-zinc-100">{f.title}</span>
                <div className="ml-auto flex items-center gap-2">
                  <button onClick={() => (editId === f.id ? setEditId('') : startEdit(f))} className="text-[11px] px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">{editId === f.id ? '닫기' : '보기/편집'}</button>
                  <button onClick={() => copy(f)} className="text-[11px] px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">복사</button>
                  <button onClick={() => printForm(f)} className="text-[11px] px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">인쇄</button>
                  <button onClick={() => remove(f)} className="text-[11px] text-zinc-600 hover:text-rose-400 transition-colors">삭제</button>
                </div>
              </div>
              {editId === f.id ? (
                <div className="space-y-3 mt-3">
                  <div className="flex flex-wrap gap-2">
                    <input value={eTitle} onChange={(e) => setETitle(e.target.value)} placeholder="양식 제목"
                      className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
                    <input value={eCategory} onChange={(e) => setECategory(e.target.value)} placeholder="분류 (선택)" list="form-categories"
                      className="w-44 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
                  </div>
                  <textarea value={eContent} onChange={(e) => setEContent(e.target.value)} placeholder="양식 본문" rows={8}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditId('')} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200 transition-colors">취소</button>
                    <button onClick={saveEdit} disabled={editSaving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">{editSaving ? '저장 중…' : '저장'}</button>
                  </div>
                </div>
              ) : (
                f.content ? (
                  <div className="text-[13px] text-zinc-400 whitespace-pre-wrap leading-relaxed line-clamp-3">{f.content}</div>
                ) : (
                  <div className="text-[12px] text-zinc-600 italic">본문 미입력</div>
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
