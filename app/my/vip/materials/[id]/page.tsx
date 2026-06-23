'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import MaterialView from '@/app/components/MaterialView';
import { BLOCK_KINDS, BLOCK_LABEL, MATERIAL_TYPES, type BlockKind, type MaterialBlock, type MaterialType } from '@/lib/material-types';

let _uid = 0;
const uid = () => `b${Date.now().toString(36)}${(_uid++).toString(36)}`;

const KIND_HELP: Partial<Record<BlockKind, string>> = {
  examples: "한 줄에 하나씩. 해석을 붙이려면 'English sentence | 해석'",
  vocab: "한 줄에 하나씩. '단어 | 뜻'",
  problems: "한 줄에 하나씩. 정답을 붙이려면 '문제 | 정답'",
};

export default function MaterialEditorPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === 'string' ? params.id : '';

  const [type, setType] = useState<MaterialType>('특강');
  const [title, setTitle] = useState('');
  const [grade, setGrade] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [blocks, setBlocks] = useState<MaterialBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/my/vip/materials/${id}`, { credentials: 'include' }).then((r) => r.json()).then((d) => {
      if (!alive) return;
      if (!d.ok) { setNotFound(true); setLoading(false); return; }
      const m = d.material;
      setType(m.type); setTitle(m.title); setGrade(m.grade); setSubtitle(m.subtitle); setBlocks(m.blocks || []);
      setLoading(false);
    }).catch(() => { setNotFound(true); setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const mark = () => setDirty(true);
  const updateBlock = (bid: string, patch: Partial<MaterialBlock>) => { setBlocks((bs) => bs.map((b) => (b.id === bid ? { ...b, ...patch } : b))); mark(); };
  const addBlock = (kind: BlockKind) => { setBlocks((bs) => [...bs, { id: uid(), kind, ...(kind !== 'heading' ? { title: BLOCK_LABEL[kind] } : {}) }]); mark(); };
  const removeBlock = (bid: string) => { setBlocks((bs) => bs.filter((b) => b.id !== bid)); mark(); };
  const move = (idx: number, dir: -1 | 1) => {
    setBlocks((bs) => { const n = [...bs]; const j = idx + dir; if (j < 0 || j >= n.length) return bs; [n[idx], n[j]] = [n[j], n[idx]]; return n; });
    mark();
  };

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/my/vip/materials/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ type, title, grade, subtitle, blocks }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setDirty(false);
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  }, [id, type, title, grade, subtitle, blocks]);

  if (loading) return <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>;
  if (notFound) return <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-500">교재를 찾을 수 없습니다. <button onClick={() => router.push('/my/vip/materials')} className="text-indigo-300 underline ml-1">목록으로</button></div>;

  return (
    <div className="space-y-4">
      {/* 상단 바 */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => router.push('/my/vip/materials')} className="text-sm text-zinc-400 hover:text-zinc-200">← 목록</button>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-[11px] text-amber-400/80">저장 안 됨</span>}
          <button onClick={() => setPreview((v) => !v)} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 text-sm hover:bg-zinc-700">{preview ? '편집' : '미리보기'}</button>
          <a href={`/print/material/${id}`} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 text-sm hover:bg-zinc-700">인쇄/PDF ↗</a>
          <button onClick={save} disabled={saving || !dirty} className="px-4 py-1.5 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40">{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>

      {/* 메타 */}
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 space-y-2.5">
        <div className="flex gap-2 flex-wrap items-center">
          <select value={type} onChange={(e) => { setType(e.target.value as MaterialType); mark(); }} className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
            {MATERIAL_TYPES.map((t) => <option key={t} value={t}>{t} 교재</option>)}
          </select>
          <input value={grade} onChange={(e) => { setGrade(e.target.value); mark(); }} placeholder="학년/대상" className="w-32 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
        </div>
        <input value={title} onChange={(e) => { setTitle(e.target.value); mark(); }} placeholder="교재 제목" className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-base text-zinc-100 font-semibold placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
        <input value={subtitle} onChange={(e) => { setSubtitle(e.target.value); mark(); }} placeholder="부제 (선택)" className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
      </div>

      {preview ? (
        <div className="rounded-xl bg-white p-6 sm:p-8 shadow-lg overflow-x-auto">
          <MaterialView material={{ type, title, grade, subtitle, blocks }} />
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            {blocks.map((b, idx) => (
              <BlockEditor key={b.id} block={b} idx={idx} total={blocks.length}
                onChange={(patch) => updateBlock(b.id, patch)} onRemove={() => removeBlock(b.id)} onMove={(dir) => move(idx, dir)} />
            ))}
          </div>

          {/* 블록 추가 */}
          <div className="rounded-xl bg-zinc-900/40 border border-dashed border-zinc-700/60 p-3">
            <div className="text-[11px] text-zinc-500 mb-2">블록 추가</div>
            <div className="flex flex-wrap gap-1.5">
              {BLOCK_KINDS.map((k) => (
                <button key={k} onClick={() => addBlock(k)} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 text-xs hover:bg-zinc-700">＋ {BLOCK_LABEL[k]}</button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function BlockEditor({ block, idx, total, onChange, onRemove, onMove }: {
  block: MaterialBlock; idx: number; total: number;
  onChange: (patch: Partial<MaterialBlock>) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const { kind } = block;
  const help = KIND_HELP[kind];
  const inputCls = 'w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50';

  return (
    <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-3.5">
      <div className="flex items-center gap-2 mb-2">
        <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px]">{BLOCK_LABEL[kind]}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => onMove(-1)} disabled={idx === 0} className="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 text-xs">▲</button>
          <button onClick={() => onMove(1)} disabled={idx === total - 1} className="px-1.5 py-0.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-30 text-xs">▼</button>
          <button onClick={onRemove} className="px-1.5 py-0.5 text-zinc-600 hover:text-rose-400 text-xs">삭제</button>
        </div>
      </div>

      {kind === 'heading' ? (
        <input value={block.content ?? ''} onChange={(e) => onChange({ content: e.target.value })} placeholder="단원 제목 (예: 1강. 분사구문)" className={`${inputCls} font-semibold`} />
      ) : (
        <div className="space-y-2">
          <input value={block.title ?? ''} onChange={(e) => onChange({ title: e.target.value })} placeholder="소제목 (선택)" className={inputCls} />
          <textarea value={block.content ?? ''} onChange={(e) => onChange({ content: e.target.value })} rows={kind === 'passage' ? 5 : 4}
            placeholder={kind === 'passage' ? '영문 지문' : kind === 'text' ? '설명/본문' : help} className={`${inputCls} resize-y ${kind === 'passage' ? 'font-mono' : ''}`} />
          {kind === 'passage' && (
            <textarea value={block.ko ?? ''} onChange={(e) => onChange({ ko: e.target.value })} rows={3} placeholder="해석 (선택)" className={`${inputCls} resize-y`} />
          )}
          {help && kind !== 'passage' && kind !== 'text' && <p className="text-[10px] text-zinc-600">{help}</p>}
        </div>
      )}
    </div>
  );
}
