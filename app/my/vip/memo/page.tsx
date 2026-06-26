'use client';

import { useCallback, useEffect, useState } from 'react';

type MemoColor = 'default' | 'yellow' | 'blue' | 'green' | 'pink';
interface Memo { id: string; title: string; content: string; color: MemoColor; pinned: boolean; createdAt: string; updatedAt: string | null }

const COLORS: { value: MemoColor; label: string; swatch: string; card: string }[] = [
  { value: 'default', label: '기본', swatch: 'bg-zinc-600', card: 'bg-zinc-900/50 border-zinc-800/80' },
  { value: 'yellow', label: '노랑', swatch: 'bg-amber-500', card: 'bg-amber-500/10 border-amber-700/30' },
  { value: 'blue', label: '파랑', swatch: 'bg-blue-500', card: 'bg-blue-500/10 border-blue-700/30' },
  { value: 'green', label: '초록', swatch: 'bg-emerald-500', card: 'bg-emerald-500/10 border-emerald-700/30' },
  { value: 'pink', label: '분홍', swatch: 'bg-pink-500', card: 'bg-pink-500/10 border-pink-700/30' },
];
const CARD_CLS: Record<MemoColor, string> = Object.fromEntries(COLORS.map((c) => [c.value, c.card])) as Record<MemoColor, string>;

export default function VipMemoPage() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    const d = await fetch(`/api/my/vip/memo?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) setMemos(d.memos);
    setLoading(false);
  }, [q]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">메모장</h1>
          <p className="text-sm text-zinc-500 mt-0.5">간단한 메모·할 일을 기록합니다. 고정해서 위로 올릴 수 있어요.</p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">{open ? '닫기' : '＋ 새 메모'}</button>
      </div>

      {open && <MemoForm onDone={() => { setOpen(false); load(); }} />}

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·내용 검색" className="w-full sm:max-w-xs px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : memos.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">등록한 메모가 없습니다. 「＋ 새 메모」로 메모를 추가하세요.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {memos.map((m) => <MemoCard key={m.id} m={m} reload={load} />)}
        </div>
      )}
    </div>
  );
}

/* ───────────────── 추가/수정 폼 ───────────────── */
function MemoForm({ onDone, edit }: { onDone: () => void; edit?: Memo }) {
  const [title, setTitle] = useState(edit?.title ?? '');
  const [content, setContent] = useState(edit?.content ?? '');
  const [color, setColor] = useState<MemoColor>(edit?.color ?? 'default');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!content.trim()) { alert('메모 내용을 입력하세요.'); return; }
    setSaving(true);
    try {
      const payload = { title, content, color };
      const res = await fetch(edit ? `/api/my/vip/memo?id=${edit.id}` : '/api/my/vip/memo', {
        method: edit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      onDone();
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };

  return (
    <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목 (선택)" className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
      <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="메모 내용" rows={4} className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500">색상</span>
        {COLORS.map((c) => (
          <button key={c.value} type="button" onClick={() => setColor(c.value)} title={c.label} className={`w-6 h-6 rounded-full ${c.swatch} transition-transform ${color === c.value ? 'ring-2 ring-zinc-100 ring-offset-2 ring-offset-zinc-900 scale-110' : 'opacity-70 hover:opacity-100'}`} />
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onDone} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200">취소</button>
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40">{saving ? '저장 중…' : edit ? '수정 저장' : '메모 저장'}</button>
      </div>
    </div>
  );
}

/* ───────────────── 메모 카드 ───────────────── */
function MemoCard({ m, reload }: { m: Memo; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const togglePin = async () => {
    setBusy(true);
    await fetch(`/api/my/vip/memo?id=${m.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ pinned: !m.pinned }) });
    setBusy(false);
    reload();
  };
  const remove = async () => {
    if (!confirm(`이 메모를 삭제할까요?`)) return;
    await fetch(`/api/my/vip/memo?id=${m.id}`, { method: 'DELETE', credentials: 'include' });
    reload();
  };

  if (editing) return <div className="sm:col-span-2 lg:col-span-3"><MemoForm edit={m} onDone={() => { setEditing(false); reload(); }} /></div>;

  return (
    <div className={`rounded-xl border p-4 flex flex-col ${CARD_CLS[m.color]}`}>
      <div className="flex items-start gap-2 mb-1">
        {m.pinned && <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-100/90 text-zinc-900 font-medium shrink-0">📌 고정</span>}
        <button onClick={togglePin} disabled={busy} title={m.pinned ? '고정 해제' : '고정'} className={`ml-auto text-sm shrink-0 transition-opacity ${m.pinned ? 'opacity-100' : 'opacity-40 hover:opacity-100'} disabled:opacity-30`}>📌</button>
      </div>
      {m.title && <div className="text-sm text-zinc-100 font-bold leading-snug mb-1 line-clamp-2">{m.title}</div>}
      <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed line-clamp-6 flex-1">{m.content}</div>
      <div className="flex gap-2 mt-3 pt-2 border-t border-zinc-700/40">
        <button onClick={() => setEditing(true)} className="ml-auto text-[11px] text-zinc-500 hover:text-zinc-200">수정</button>
        <button onClick={remove} className="text-[11px] text-zinc-600 hover:text-rose-400">삭제</button>
      </div>
    </div>
  );
}
