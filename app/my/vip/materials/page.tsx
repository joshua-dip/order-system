'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MATERIAL_TYPES, MATERIAL_TYPE_DESC, starterBlocks, type MaterialType } from '@/lib/material-types';

interface MaterialRow { id: string; type: MaterialType; title: string; grade: string; subtitle: string; blockCount: number; updatedAt: string; createdAt: string }

const TYPE_CLS: Record<MaterialType, string> = {
  특강: 'bg-violet-500/15 text-violet-300',
  문법: 'bg-blue-500/15 text-blue-300',
  리딩: 'bg-emerald-500/15 text-emerald-300',
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}
let _uid = 0;
const uid = () => `b${Date.now().toString(36)}${(_uid++).toString(36)}`;

export default function VipMaterialsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<MaterialRow[]>([]);
  const [filterType, setFilterType] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // 새 교재 폼
  const [nType, setNType] = useState<MaterialType>('특강');
  const [nTitle, setNTitle] = useState('');
  const [nGrade, setNGrade] = useState('');
  const [nSubtitle, setNSubtitle] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterType) params.set('type', filterType);
    if (q.trim()) params.set('q', q.trim());
    const d = await fetch(`/api/my/vip/materials?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) setRows(d.materials);
    setLoading(false);
  }, [filterType, q]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!nTitle.trim()) { alert('교재 제목을 입력하세요.'); return; }
    setCreating(true);
    try {
      const res = await fetch('/api/my/vip/materials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ type: nType, title: nTitle, grade: nGrade, subtitle: nSubtitle, blocks: starterBlocks(nType, uid) }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '생성 실패'); setCreating(false); return; }
      router.push(`/my/vip/materials/${d.id}`);
    } catch { alert('생성 중 오류'); setCreating(false); }
  };

  const remove = async (m: MaterialRow) => {
    if (!confirm(`교재 "${m.title}"을(를) 삭제할까요?`)) return;
    await fetch(`/api/my/vip/materials/${m.id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">교재 만들기</h1>
          <p className="text-sm text-zinc-500 mt-0.5">특강·문법·리딩 교재를 블록으로 직접 만들고 인쇄·PDF로 출력합니다.</p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">{open ? '닫기' : '＋ 새 교재'}</button>
      </div>

      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <div className="flex gap-1.5">
            {MATERIAL_TYPES.map((t) => (
              <button key={t} onClick={() => setNType(t)} title={MATERIAL_TYPE_DESC[t]}
                className={`flex-1 px-3 py-2.5 rounded-lg text-sm transition-colors border ${nType === t ? 'bg-zinc-100 text-zinc-900 border-zinc-100 font-medium' : 'bg-zinc-900/60 text-zinc-400 border-zinc-700/60 hover:bg-zinc-800'}`}>
                {t} 교재
                <span className="block text-[10px] font-normal opacity-70 mt-0.5">{MATERIAL_TYPE_DESC[t]}</span>
              </button>
            ))}
          </div>
          <input value={nTitle} onChange={(e) => setNTitle(e.target.value)} placeholder="교재 제목" className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          <div className="flex gap-2">
            <input value={nGrade} onChange={(e) => setNGrade(e.target.value)} placeholder="학년/대상 (선택)" className="w-40 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <input value={nSubtitle} onChange={(e) => setNSubtitle(e.target.value)} placeholder="부제 (선택)" className="flex-1 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200">취소</button>
            <button onClick={create} disabled={creating} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40">{creating ? '만드는 중…' : '만들고 편집'}</button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {[{ v: '', l: '전체' }, ...MATERIAL_TYPES.map((t) => ({ v: t, l: t }))].map((f) => (
          <button key={f.v} onClick={() => setFilterType(f.v)} className={`px-3 py-1 rounded-full text-xs transition-colors ${filterType === f.v ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>{f.l}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목 검색" className="ml-auto px-3 py-1.5 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 w-44" />
      </div>

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">만든 교재가 없습니다. 「＋ 새 교재」로 시작하세요.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((m) => (
            <div key={m.id} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 hover:border-zinc-700 transition-colors">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${TYPE_CLS[m.type]}`}>{m.type}</span>
                {m.grade && <span className="text-[10px] text-zinc-500">{m.grade}</span>}
                <span className="ml-auto text-[10px] text-zinc-600">{m.blockCount}블록 · {when(m.updatedAt)}</span>
              </div>
              <button onClick={() => router.push(`/my/vip/materials/${m.id}`)} className="block text-left w-full">
                <div className="text-sm text-zinc-100 font-semibold leading-snug line-clamp-2 hover:text-white">{m.title}</div>
                {m.subtitle && <div className="text-[11px] text-zinc-500 mt-0.5 truncate">{m.subtitle}</div>}
              </button>
              <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-zinc-800/60">
                <button onClick={() => router.push(`/my/vip/materials/${m.id}`)} className="text-[11px] text-indigo-300 hover:text-indigo-200">편집</button>
                <a href={`/print/material/${m.id}`} target="_blank" rel="noopener noreferrer" className="text-[11px] text-zinc-400 hover:text-zinc-200">인쇄/PDF ↗</a>
                <button onClick={() => remove(m)} className="ml-auto text-[11px] text-zinc-600 hover:text-rose-400">삭제</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
