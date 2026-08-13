'use client';

import type { InfoBoxData } from '@/lib/korean-explainer/types';
import { Field, HTML_HINT, ListSection, SmallBtn, TextArea, TextInput } from './_form-utils';

export default function InfoBoxForm({ data, onChange }: { data: InfoBoxData; onChange: (d: InfoBoxData) => void }) {
  const rows = data.rows ?? [];

  function updateRow(i: number, patch: Partial<InfoBoxData['rows'][number]>) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange({ ...data, rows: next });
  }
  function removeRow(i: number) {
    onChange({ ...data, rows: rows.filter((_, idx) => idx !== i) });
  }
  function addRow() {
    onChange({ ...data, rows: [...rows, { label: '', value_html: '' }] });
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...data, rows: next });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="heading (info-box 제목)">
        <TextInput value={data.heading} onChange={v => onChange({ ...data, heading: v })} placeholder="작품 기본 정보" />
      </Field>

      <ListSection title={`행 (${rows.length})`} onAdd={addRow}>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 items-start bg-white rounded p-2 border border-gray-200">
            <div className="flex flex-col gap-1 pt-1">
              <SmallBtn onClick={() => move(i, -1)} title="위로">↑</SmallBtn>
              <SmallBtn onClick={() => move(i, 1)} title="아래로">↓</SmallBtn>
              <SmallBtn variant="danger" onClick={() => removeRow(i)} title="삭제">✕</SmallBtn>
            </div>
            <div className="flex-1 grid grid-cols-[100px_1fr] gap-2">
              <TextInput value={r.label} onChange={v => updateRow(i, { label: v })} placeholder="갈래 / 시점 / 주제" />
              <TextArea
                value={r.value_html}
                onChange={v => updateRow(i, { value_html: v })}
                placeholder="HTML 허용. 본문..."
                rows={2}
              />
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-gray-500">+ 추가 로 행을 추가하세요.</p>}
      </ListSection>

      <p className="text-[10px] text-gray-500 leading-relaxed">{HTML_HINT}</p>
    </div>
  );
}
