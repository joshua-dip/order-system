'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface SetRow { id: string; title: string; folder: string; textbook: string; wordCount: number; updatedAt: string }
interface FolderInfo { name: string; count: number }

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

export default function VipWordsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<SetRow[]>([]);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [folder, setFolder] = useState('__all__');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [nTitle, setNTitle] = useState('');
  const [nFolder, setNFolder] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (folder !== '__all__') params.set('folder', folder);
    if (q.trim()) params.set('q', q.trim());
    const d = await fetch(`/api/my/vip/word-sets?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setRows(d.sets); setFolders(d.folders); }
    setLoading(false);
  }, [folder, q]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!nTitle.trim()) { alert('단어장 제목을 입력하세요.'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/my/vip/word-sets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ title: nTitle, folder: nFolder }) });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '생성 실패'); setCreating(false); return; }
      router.push(`/my/vip/words/${d.id}`);
    } catch { alert('생성 중 오류'); setCreating(false); }
  };
  const remove = async (s: SetRow) => {
    if (!confirm(`단어장 "${s.title}"을(를) 삭제할까요?`)) return;
    await fetch(`/api/my/vip/word-sets/${s.id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">단어 관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">단어장을 만들어 정리하고, 단어장·단어시험지로 인쇄·PDF 출력합니다.</p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">{open ? '닫기' : '＋ 새 단어장'}</button>
      </div>

      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <input value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder="단어장 제목 (예: Day 1 필수단어)" className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          <div className="flex gap-2">
            <input value={nFolder} onChange={(e) => setNFolder(e.target.value)} list="ws-folders" placeholder="강좌/단원 (선택)" className="flex-1 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <datalist id="ws-folders">{folders.filter((f) => f.name).map((f) => <option key={f.name} value={f.name} />)}</datalist>
            <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200">취소</button>
            <button onClick={create} disabled={creating} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40">{creating ? '만드는 중…' : '만들고 편집'}</button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {[{ name: '__all__', label: '전체' }, { name: '', label: '미분류' }].map((f) => (
          <button key={f.name} onClick={() => setFolder(f.name)} className={`px-3 py-1 rounded-full text-xs transition-colors ${folder === f.name ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>{f.label}</button>
        ))}
        {folders.filter((f) => f.name !== '').map((f) => (
          <button key={f.name} onClick={() => setFolder(f.name)} className={`px-3 py-1 rounded-full text-xs transition-colors ${folder === f.name ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>📒 {f.name} <span className="opacity-60">{f.count}</span></button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목 검색" className="ml-auto px-3 py-1.5 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 w-44" />
      </div>

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">만든 단어장이 없습니다. 「＋ 새 단어장」으로 시작하세요.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((s) => (
            <div key={s.id} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 hover:border-zinc-700 transition-colors">
              <div className="flex items-center gap-2 mb-1.5">
                {s.folder && <span className="text-[10px] text-amber-300/80">📒 {s.folder}</span>}
                <span className="ml-auto text-[10px] text-zinc-600">{s.wordCount}단어 · {when(s.updatedAt)}</span>
              </div>
              <button onClick={() => router.push(`/my/vip/words/${s.id}`)} className="block text-left w-full">
                <div className="text-sm text-zinc-100 font-semibold leading-snug line-clamp-2 hover:text-white">{s.title}</div>
                {s.textbook && <div className="text-[11px] text-zinc-500 mt-0.5 truncate">{s.textbook}</div>}
              </button>
              <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-zinc-800/60">
                <button onClick={() => router.push(`/my/vip/words/${s.id}`)} className="text-[11px] text-indigo-300 hover:text-indigo-200">편집</button>
                <a href={`/print/wordset/${s.id}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-zinc-400 hover:text-zinc-200">인쇄/시험지 ↗</a>
                <button onClick={() => remove(s)} className="ml-auto text-[11px] text-zinc-600 hover:text-rose-400">삭제</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
