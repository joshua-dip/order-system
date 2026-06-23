'use client';

import { useCallback, useEffect, useState } from 'react';
import { downloadBlob } from '@/lib/download-blob';

const VARIANT_TYPES = ['빈칸', '순서', '삽입', '삽입-고난도', '어법', '어법-고난도', '빈칸-고난도', '어휘', '어휘-고난도', '함의', '주제', '주장', '제목', '요약', '요지', '일치', '불일치', '무관한문장', '순서-고난도', '요약-고난도', '무관한문장-고난도', '함의-고난도', '주제-고난도', '제목-고난도', '주장-고난도', '일치-고난도', '불일치-고난도'];
const DIFFICULTIES = ['하', '중', '상'];

interface BrowseItem { questionId: string; serialNo: number | null; type: string; textbook: string; source: string; difficulty: string; question: string; preview: string; saved: boolean }
interface BankItem { id: string; questionId: string; serialNo: number | null; type: string; textbook: string; source: string; difficulty: string; question: string; preview: string; folder: string; tags: string[] }
interface FolderInfo { name: string; count: number }

const fmtSerial = (n: number | null) => (typeof n === 'number' && n > 0 ? `V-${String(n).padStart(6, '0')}` : '');

export default function VipQuestionBankPage() {
  const [tab, setTab] = useState<'bank' | 'browse'>('bank');
  const [textbooks, setTextbooks] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/my/vip/textbooks', { credentials: 'include' }).then((r) => r.json()).then((d) => { if (d.ok) setTextbooks(d.textbooks ?? []); });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">문제 관리</h1>
        <p className="text-sm text-zinc-500 mt-0.5">변형문제를 불러와 내 문제로 담고, 폴더로 정리해 시험지로 활용합니다</p>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-zinc-900/60 border border-zinc-800/80 w-fit">
        {([['bank', '내 문제'], ['browse', '불러오기']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${tab === id ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-400 hover:text-zinc-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'browse' ? <BrowseTab textbooks={textbooks} /> : <BankTab textbooks={textbooks} />}
    </div>
  );
}

/* ───────────────── 불러오기 ───────────────── */
function BrowseTab({ textbooks }: { textbooks: string[] }) {
  const [type, setType] = useState('');
  const [textbook, setTextbook] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [saveFolder, setSaveFolder] = useState('');
  const [searched, setSearched] = useState(false);

  const search = useCallback(async (p = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p) });
    if (type) params.set('type', type);
    if (textbook) params.set('textbook', textbook);
    if (difficulty) params.set('difficulty', difficulty);
    if (q.trim()) params.set('q', q.trim());
    const d = await fetch(`/api/my/vip/questions/search?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setItems(d.items); setPage(d.page); setTotalPages(d.totalPages); setTotal(d.total); }
    setSearched(true); setSel(new Set()); setLoading(false);
  }, [type, textbook, difficulty, q]);

  const toggle = (id: string) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const saveIds = async (ids: string[]) => {
    if (ids.length === 0) return;
    const res = await fetch('/api/my/vip/question-bank', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ questionIds: ids, folder: saveFolder.trim() }) });
    const d = await res.json();
    if (res.ok && d.ok) { alert(`${d.added}문항을 담았어요${d.alreadySaved ? ` (이미 담긴 ${d.alreadySaved}개 제외)` : ''}.`); search(page); }
    else alert(d.error || '담기에 실패했습니다.');
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <select value={type} onChange={(e) => setType(e.target.value)} className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 [&>option]:bg-zinc-900">
            <option value="">유형 전체</option>
            {VARIANT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={textbook} onChange={(e) => setTextbook(e.target.value)} className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 [&>option]:bg-zinc-900">
            <option value="">교재 전체</option>
            {textbooks.map((t) => <option key={t} value={t}>{t.length > 24 ? t.slice(0, 24) + '…' : t}</option>)}
          </select>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 [&>option]:bg-zinc-900">
            <option value="">난이도 전체</option>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search(1)} placeholder="고유번호(V-…) · 출처 검색" className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 placeholder-zinc-600" />
        </div>
        <div className="flex justify-end mt-3">
          <button onClick={() => search(1)} disabled={loading} className="px-4 py-2 rounded-xl bg-zinc-100 text-zinc-900 text-sm font-medium hover:bg-white disabled:opacity-40">{loading ? '검색 중…' : '검색'}</button>
        </div>
      </div>

      {sel.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-xl bg-indigo-900/20 border border-indigo-700/40 px-4 py-2.5">
          <span className="text-sm text-indigo-200">{sel.size}개 선택</span>
          <input value={saveFolder} onChange={(e) => setSaveFolder(e.target.value)} placeholder="폴더(선택)" className="px-2.5 py-1 rounded-lg bg-zinc-900/60 border border-zinc-700/60 text-xs text-zinc-100 placeholder-zinc-600 w-32" />
          <button onClick={() => saveIds([...sel])} className="px-3 py-1.5 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm hover:bg-indigo-500">내 문제로 담기</button>
        </div>
      )}

      {searched && items.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">조건에 맞는 문제가 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.questionId} className={`rounded-xl border p-4 transition-colors ${sel.has(it.questionId) ? 'bg-indigo-900/20 border-indigo-700/50' : 'bg-zinc-900/50 border-zinc-800/80 hover:border-zinc-700'}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={sel.has(it.questionId)} onChange={() => toggle(it.questionId)} disabled={it.saved} className="mt-1 rounded accent-indigo-500 disabled:opacity-40" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 text-[11px]">{it.type}</span>
                    {it.serialNo && <span className="text-[11px] text-zinc-500 font-mono">{fmtSerial(it.serialNo)}</span>}
                    <span className="text-[11px] text-zinc-600 truncate max-w-[260px]">{it.textbook} · {it.source}</span>
                    <span className="text-[11px] text-zinc-600">{it.difficulty}</span>
                  </div>
                  {it.question && <div className="text-sm text-zinc-300 truncate">{it.question}</div>}
                  <div className="text-xs text-zinc-500 truncate">{it.preview}</div>
                </div>
                {it.saved ? (
                  <span className="text-[11px] text-emerald-400/80 flex-shrink-0">담김 ✓</span>
                ) : (
                  <button onClick={() => saveIds([it.questionId])} className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 text-xs hover:bg-zinc-700">담기</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button onClick={() => search(page - 1)} disabled={page <= 1 || loading} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-sm disabled:opacity-30">이전</button>
          <span className="text-xs text-zinc-500">{page} / {totalPages} · 총 {total}</span>
          <button onClick={() => search(page + 1)} disabled={page >= totalPages || loading} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-sm disabled:opacity-30">다음</button>
        </div>
      )}
    </div>
  );
}

/* ───────────────── 내 문제 ───────────────── */
function BankTab({ textbooks: _textbooks }: { textbooks: string[] }) {
  const [items, setItems] = useState<BankItem[]>([]);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [folder, setFolder] = useState<string>('__all__');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (folder !== '__all__') params.set('folder', folder);
    if (type) params.set('type', type);
    if (q.trim()) params.set('q', q.trim());
    const d = await fetch(`/api/my/vip/question-bank?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setItems(d.items); setFolders(d.folders); }
    setSel(new Set()); setLoading(false);
  }, [folder, type, q]);

  useEffect(() => { load(); }, [load]);

  const toggle = (id: string) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectedItems = items.filter((it) => sel.has(it.id));

  const removeOne = async (it: BankItem) => {
    if (!confirm('내 문제에서 제거할까요?')) return;
    setBusy(true);
    await fetch(`/api/my/vip/question-bank?id=${it.id}`, { method: 'DELETE', credentials: 'include' });
    await load(); setBusy(false);
  };
  const removeSelected = async () => {
    if (!confirm(`선택한 ${sel.size}문항을 제거할까요?`)) return;
    setBusy(true);
    for (const id of sel) await fetch(`/api/my/vip/question-bank?id=${id}`, { method: 'DELETE', credentials: 'include' });
    await load(); setBusy(false);
  };
  const moveSelected = async () => {
    const target = prompt('이동할 폴더 이름 (비우면 미분류):', folder !== '__all__' ? folder : '');
    if (target === null) return;
    setBusy(true);
    await fetch('/api/my/vip/question-bank', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ ids: [...sel], folder: target.trim() }) });
    await load(); setBusy(false);
  };
  const downloadSelected = async () => {
    const ids = selectedItems.map((it) => it.questionId);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const title = folder !== '__all__' && folder ? `내 문제 - ${folder}` : '내 문제 모음';
      const params = new URLSearchParams({ format: 'pdf', ids: ids.join(','), title, cover: 'true' });
      const res = await fetch('/api/my/vip/generate/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(Object.fromEntries(params)) });
      if (!res.ok) throw new Error();
      downloadBlob(await res.blob(), `${title}.pdf`);
    } catch { alert('다운로드에 실패했습니다.'); }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      {/* 폴더 칩 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {[{ name: '__all__', label: '전체' }, { name: '', label: '미분류' }].map((f) => (
          <button key={f.name} onClick={() => setFolder(f.name)} className={`px-3 py-1 rounded-full text-xs transition-colors ${folder === f.name ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>{f.label}</button>
        ))}
        {folders.filter((f) => f.name !== '').map((f) => (
          <button key={f.name} onClick={() => setFolder(f.name)} className={`px-3 py-1 rounded-full text-xs transition-colors ${folder === f.name ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>📁 {f.name} <span className="opacity-60">{f.count}</span></button>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex gap-2 flex-wrap">
        <select value={type} onChange={(e) => setType(e.target.value)} className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 [&>option]:bg-zinc-900">
          <option value="">유형 전체</option>
          {VARIANT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="고유번호 · 출처 검색" className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 placeholder-zinc-600 flex-1 min-w-[180px]" />
      </div>

      {/* 선택 액션 바 */}
      {sel.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-xl bg-zinc-800/60 border border-zinc-700/60 px-4 py-2.5">
          <span className="text-sm text-zinc-200">{sel.size}개 선택</span>
          <button onClick={downloadSelected} disabled={busy} className="px-3 py-1.5 rounded-lg bg-rose-600/80 text-zinc-100 text-sm hover:bg-rose-500 disabled:opacity-40">시험지로 다운로드</button>
          <button onClick={moveSelected} disabled={busy} className="px-3 py-1.5 rounded-lg bg-zinc-700 text-zinc-200 text-sm hover:bg-zinc-600 disabled:opacity-40">폴더 이동</button>
          <button onClick={removeSelected} disabled={busy} className="px-3 py-1.5 rounded-lg text-rose-400/90 border border-rose-500/30 text-sm hover:bg-rose-500/10 disabled:opacity-40">제거</button>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">담긴 문제가 없습니다. 「불러오기」에서 문제를 담아보세요.</div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className={`rounded-xl border p-4 transition-colors ${sel.has(it.id) ? 'bg-zinc-800/50 border-zinc-600' : 'bg-zinc-900/50 border-zinc-800/80 hover:border-zinc-700'}`}>
              <div className="flex items-start gap-3">
                <input type="checkbox" checked={sel.has(it.id)} onChange={() => toggle(it.id)} className="mt-1 rounded accent-zinc-400" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 text-[11px]">{it.type}</span>
                    {it.serialNo && <span className="text-[11px] text-zinc-500 font-mono">{fmtSerial(it.serialNo)}</span>}
                    {it.folder && <span className="text-[11px] text-amber-300/80">📁 {it.folder}</span>}
                    <span className="text-[11px] text-zinc-600 truncate max-w-[260px]">{it.textbook} · {it.source}</span>
                  </div>
                  {it.question && <div className="text-sm text-zinc-300 truncate">{it.question}</div>}
                  <div className="text-xs text-zinc-500 truncate">{it.preview}</div>
                </div>
                <button onClick={() => removeOne(it)} disabled={busy} title="제거" className="flex-shrink-0 p-1 rounded text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40">✕</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
