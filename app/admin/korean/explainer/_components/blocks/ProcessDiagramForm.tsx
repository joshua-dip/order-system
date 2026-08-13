'use client';

import type { ProcessDiagramData } from '@/lib/korean-explainer/types';
import { Field, HTML_HINT, ListSection, SmallBtn, TextArea, TextInput } from './_form-utils';

export default function ProcessDiagramForm({ data, onChange }: { data: ProcessDiagramData; onChange: (d: ProcessDiagramData) => void }) {
  const nodes = data.nodes ?? [];

  function updateNode(i: number, patch: Partial<ProcessDiagramData['nodes'][number]>) {
    onChange({ ...data, nodes: nodes.map((n, idx) => (idx === i ? { ...n, ...patch } : n)) });
  }
  function addNode() { onChange({ ...data, nodes: [...nodes, { label: '', body_html: '', variant: '' }] }); }
  function removeNode(i: number) { onChange({ ...data, nodes: nodes.filter((_, idx) => idx !== i) }); }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= nodes.length) return;
    const next = nodes.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...data, nodes: next });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="title (도해 제목, 선택)">
        <TextInput value={data.title ?? ''} onChange={v => onChange({ ...data, title: v })} placeholder="(선택) 광합성 과정 등" />
      </Field>

      <Field label="arrows (노드 사이 화살표 표시)">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={data.arrows !== false}
            onChange={e => onChange({ ...data, arrows: e.target.checked })}
          />
          → 화살표 자동 삽입
        </label>
      </Field>

      <ListSection title={`노드 (${nodes.length})`} onAdd={addNode}>
        {nodes.map((n, i) => (
          <div key={i} className="flex gap-2 items-start bg-white rounded p-2 border border-gray-200">
            <div className="flex flex-col gap-1 pt-1">
              <SmallBtn onClick={() => move(i, -1)}>↑</SmallBtn>
              <SmallBtn onClick={() => move(i, 1)}>↓</SmallBtn>
              <SmallBtn variant="danger" onClick={() => removeNode(i)}>✕</SmallBtn>
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <div className="grid grid-cols-[120px_120px_1fr] gap-2">
                <TextInput value={n.label} onChange={v => updateNode(i, { label: v })} placeholder="라벨" />
                <select
                  className="text-xs border border-gray-300 rounded px-2 py-1"
                  value={n.variant ?? ''}
                  onChange={e => updateNode(i, { variant: e.target.value as 'light' | 'dark' | '' })}
                >
                  <option value="">기본 (흰색)</option>
                  <option value="light">light (노랑)</option>
                  <option value="dark">dark (초록)</option>
                </select>
                <TextArea value={n.body_html} onChange={v => updateNode(i, { body_html: v })} placeholder="설명 (HTML)" rows={1} />
              </div>
            </div>
          </div>
        ))}
      </ListSection>

      <p className="text-[10px] text-gray-500 leading-relaxed">{HTML_HINT}</p>
    </div>
  );
}
