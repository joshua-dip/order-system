'use client';

import { useEffect, useState } from 'react';

interface ConceptPoint { term: string; detail: string; example?: string }
interface ConceptTable { title?: string; headers: string[]; rows: string[][] }
interface Concept { title: string; intro: string; table?: ConceptTable | null; points: ConceptPoint[]; tip: string }

const EMPTY: Concept = { title: '', intro: '', points: [{ term: '', detail: '', example: '' }], tip: '' };

/** 진도(학습주제) 문법 개념 편집 모달. conceptBase = '/api/my/vip/grammar-problems/concept'. */
export function ConceptEditor({
  topicKey,
  topicLabel,
  conceptBase,
  onClose,
  onSaved,
}: {
  topicKey: string;
  topicLabel: string;
  conceptBase: string;
  onClose: () => void;
  onSaved?: (hasConcept: boolean) => void;
}) {
  const [concept, setConcept] = useState<Concept | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${conceptBase}?topicKey=${encodeURIComponent(topicKey)}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const c = d?.concept;
        setConcept(c ? { title: c.title || topicLabel, intro: c.intro || '', table: c.table || null, points: (c.points?.length ? c.points : EMPTY.points), tip: c.tip || '' } : { ...EMPTY, title: topicLabel });
      })
      .catch(() => { if (alive) setConcept({ ...EMPTY, title: topicLabel }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [topicKey, topicLabel, conceptBase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (patch: Partial<Concept>) => setConcept((c) => (c ? { ...c, ...patch } : c));
  const setPoint = (i: number, patch: Partial<ConceptPoint>) =>
    setConcept((c) => (c ? { ...c, points: c.points.map((p, k) => (k === i ? { ...p, ...patch } : p)) } : c));
  const addPoint = () => setConcept((c) => (c ? { ...c, points: [...c.points, { term: '', detail: '', example: '' }] } : c));
  const removePoint = (i: number) => setConcept((c) => (c ? { ...c, points: c.points.filter((_, k) => k !== i) } : c));

  const save = async () => {
    if (!concept || saving) return;
    setSaving(true);
    try {
      const body = { topicKey, title: concept.title, intro: concept.intro, points: concept.points.filter((p) => p.term || p.detail), tip: concept.tip, ...(concept.table ? { table: concept.table } : {}) };
      const r = await fetch(conceptBase, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      const has = !!(body.title || body.intro || body.points.length);
      onSaved?.(has);
      onClose();
    } catch {
      alert('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <span className="text-lg">📘</span>
          <div className="min-w-0">
            <p className="text-[11px] text-zinc-500">문법 개념 편집</p>
            <p className="truncate text-sm font-bold text-zinc-100">{topicLabel}</p>
          </div>
          <button onClick={onClose} className="ml-auto rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">✕</button>
        </div>

        {loading || !concept ? (
          <div className="py-16 text-center"><div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-400" /></div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div>
              <label className="text-[11px] font-medium text-zinc-500">제목</label>
              <input value={concept.title} onChange={(e) => set({ title: e.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 focus:border-[#c9a44e]/50 focus:outline-none" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-zinc-500">개념 요약 (한두 줄)</label>
              <textarea value={concept.intro} onChange={(e) => set({ intro: e.target.value })} rows={2}
                className="mt-1 w-full resize-y rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 focus:border-[#c9a44e]/50 focus:outline-none" />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-medium text-zinc-500">개념 항목 (용어 · 설명 · 예문)</label>
                <button onClick={addPoint} className="rounded-md border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-[#c9a44e]/50 hover:text-[#e8d48b]">+ 항목</button>
              </div>
              <div className="mt-1.5 space-y-2">
                {concept.points.map((p, i) => (
                  <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-2">
                    <div className="flex items-center gap-2">
                      <input value={p.term} onChange={(e) => setPoint(i, { term: e.target.value })} placeholder="용어 (예: 주격)"
                        className="w-40 rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[13px] font-semibold text-[#e8d48b] focus:border-[#c9a44e]/50 focus:outline-none" />
                      <input value={p.detail} onChange={(e) => setPoint(i, { detail: e.target.value })} placeholder="설명"
                        className="flex-1 rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[13px] text-zinc-200 focus:border-[#c9a44e]/50 focus:outline-none" />
                      <button onClick={() => removePoint(i)} className="rounded px-1.5 text-zinc-500 hover:text-rose-300">✕</button>
                    </div>
                    <input value={p.example ?? ''} onChange={(e) => setPoint(i, { example: e.target.value })} placeholder="예문 (선택, 영어)"
                      className="mt-1.5 w-full rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-[12px] italic text-zinc-300 focus:border-[#c9a44e]/50 focus:outline-none" />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-medium text-zinc-500">한 줄 팁 (선택)</label>
              <input value={concept.tip} onChange={(e) => set({ tip: e.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 focus:border-[#c9a44e]/50 focus:outline-none" />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-zinc-800 px-4 py-3">
          <p className="text-[11px] text-zinc-500">문제지 인쇄 시 「문법 개념 포함」을 켜면 이 내용이 문제 앞에 들어갑니다.</p>
          <button onClick={onClose} className="ml-auto rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">취소</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-gradient-to-r from-[#c9a44e] to-amber-600 px-4 py-1.5 text-sm font-bold text-zinc-950 hover:opacity-90 disabled:opacity-60">
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
