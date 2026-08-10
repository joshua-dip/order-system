'use client';

import type { ParagraphTableData } from '@/lib/korean-explainer/types';
import { Field, HTML_HINT, ListSection, SmallBtn, TextArea, TextInput } from './_form-utils';

export default function ParagraphTableForm({ data, onChange }: { data: ParagraphTableData; onChange: (d: ParagraphTableData) => void }) {
  const columns = data.columns ?? [];
  const rows = data.rows ?? [];

  function updateCol(i: number, v: string) {
    onChange({ ...data, columns: columns.map((c, idx) => (idx === i ? v : c)) });
  }
  function removeCol(i: number) {
    onChange({
      ...data,
      columns: columns.filter((_, idx) => idx !== i),
      rows: rows.map(r => ({ cells: r.cells.filter((_, idx) => idx !== i) })),
    });
  }
  function addCol() {
    onChange({
      ...data,
      columns: [...columns, ''],
      rows: rows.map(r => ({ cells: [...r.cells, ''] })),
    });
  }
  function updateCell(rowIdx: number, cellIdx: number, v: string) {
    const next = rows.map((r, ri) => (ri === rowIdx ? { cells: r.cells.map((c, ci) => (ci === cellIdx ? v : c)) } : r));
    onChange({ ...data, rows: next });
  }
  function addRow() {
    onChange({ ...data, rows: [...rows, { cells: columns.map(() => '') }] });
  }
  function removeRow(i: number) {
    onChange({ ...data, rows: rows.filter((_, idx) => idx !== i) });
  }
  function moveRow(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...data, rows: next });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="첫 열을 문단 번호로 (first_col_is_paranum)">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={data.first_col_is_paranum ?? false}
            onChange={e => onChange({ ...data, first_col_is_paranum: e.target.checked })}
          />
          1열에 navy-tint 배경 적용
        </label>
      </Field>

      <ListSection title={`열 (${columns.length})`} onAdd={addCol}>
        <div className="flex gap-2 flex-wrap">
          {columns.map((c, i) => (
            <div key={i} className="flex items-center gap-1 bg-white border border-gray-200 rounded p-1">
              <TextInput value={c} onChange={v => updateCol(i, v)} className="!w-32" placeholder={`열 ${i + 1}`} />
              <SmallBtn variant="danger" onClick={() => removeCol(i)}>✕</SmallBtn>
            </div>
          ))}
          {columns.length === 0 && <p className="text-xs text-gray-500">+ 추가 로 열을 추가하세요.</p>}
        </div>
      </ListSection>

      <ListSection title={`행 (${rows.length})`} onAdd={addRow}>
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2 items-start bg-white rounded p-2 border border-gray-200">
            <div className="flex flex-col gap-1 pt-1">
              <SmallBtn onClick={() => moveRow(i, -1)}>↑</SmallBtn>
              <SmallBtn onClick={() => moveRow(i, 1)}>↓</SmallBtn>
              <SmallBtn variant="danger" onClick={() => removeRow(i)}>✕</SmallBtn>
            </div>
            <div className="flex-1 grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, columns.length)}, minmax(0, 1fr))` }}>
              {columns.map((col, ci) => (
                <TextArea
                  key={ci}
                  value={r.cells[ci] ?? ''}
                  onChange={v => updateCell(i, ci, v)}
                  placeholder={col}
                  rows={2}
                />
              ))}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="text-xs text-gray-500">+ 추가 로 행을 추가하세요.</p>}
      </ListSection>

      <p className="text-[10px] text-gray-500 leading-relaxed">셀은 HTML 허용. {HTML_HINT}</p>
    </div>
  );
}
