'use client';

import type { Compare2ColData } from '@/lib/korean-explainer/types';
import { Field, HTML_HINT, ListSection, SmallBtn, TextArea, TextInput } from './_form-utils';

export default function Compare2ColForm({ data, onChange }: { data: Compare2ColData; onChange: (d: Compare2ColData) => void }) {
  function updateSide(side: 'left' | 'right', patch: Partial<Compare2ColData['left']>) {
    onChange({ ...data, [side]: { ...data[side], ...patch } });
  }
  function updateItem(side: 'left' | 'right', i: number, v: string) {
    const cur = data[side].items_html;
    updateSide(side, { items_html: cur.map((x, idx) => (idx === i ? v : x)) });
  }
  function addItem(side: 'left' | 'right') {
    updateSide(side, { items_html: [...data[side].items_html, ''] });
  }
  function removeItem(side: 'left' | 'right', i: number) {
    updateSide(side, { items_html: data[side].items_html.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {(['left', 'right'] as const).map(side => (
        <div key={side} className="border border-gray-200 rounded-md p-2 bg-gray-50/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-700">{side === 'left' ? '왼쪽' : '오른쪽'}</span>
            <select
              className="text-xs border border-gray-300 rounded px-1 py-0.5"
              value={side === 'left' ? data.left_color : data.right_color}
              onChange={e => {
                const v = e.target.value as 'navy' | 'red' | 'green';
                if (side === 'left' && (v === 'navy' || v === 'green')) onChange({ ...data, left_color: v });
                else if (side === 'right' && (v === 'red' || v === 'navy')) onChange({ ...data, right_color: v });
              }}
            >
              {side === 'left' ? (
                <>
                  <option value="navy">navy (파랑)</option>
                  <option value="green">green (초록)</option>
                </>
              ) : (
                <>
                  <option value="red">red (빨강)</option>
                  <option value="navy">navy (파랑)</option>
                </>
              )}
            </select>
          </div>
          <Field label="title">
            <TextInput
              value={data[side].title}
              onChange={v => updateSide(side, { title: v })}
              placeholder={side === 'left' ? '[A] 황씨의 사업 실패' : '[B] 암소의 죽음'}
            />
          </Field>
          <ListSection title={`items_html (${data[side].items_html.length})`} onAdd={() => addItem(side)}>
            {data[side].items_html.map((it, i) => (
              <div key={i} className="flex items-start gap-1">
                <span className="text-xs text-gray-500 pt-2">·</span>
                <TextArea value={it} onChange={v => updateItem(side, i, v)} rows={1} />
                <SmallBtn variant="danger" onClick={() => removeItem(side, i)}>✕</SmallBtn>
              </div>
            ))}
          </ListSection>
        </div>
      ))}
      <p className="text-[10px] text-gray-500 leading-relaxed col-span-full">{HTML_HINT}</p>
    </div>
  );
}
