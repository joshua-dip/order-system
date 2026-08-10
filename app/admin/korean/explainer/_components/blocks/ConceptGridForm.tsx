'use client';

import type { ConceptGridData } from '@/lib/korean-explainer/types';
import { Field, HTML_HINT, ListSection, SmallBtn, TextArea, TextInput } from './_form-utils';

export default function ConceptGridForm({ data, onChange }: { data: ConceptGridData; onChange: (d: ConceptGridData) => void }) {
  const cards = data.cards ?? [];

  function updateCard(i: number, patch: Partial<ConceptGridData['cards'][number]>) {
    onChange({ ...data, cards: cards.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  }
  function removeCard(i: number) { onChange({ ...data, cards: cards.filter((_, idx) => idx !== i) }); }
  function addCard() { onChange({ ...data, cards: [...cards, { name: '', desc_html: '' }] }); }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= cards.length) return;
    const next = cards.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange({ ...data, cards: next });
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="columns (열 수)">
        <div className="flex gap-2">
          {([2, 3] as const).map(n => (
            <label key={n} className="inline-flex items-center gap-1 text-sm">
              <input
                type="radio"
                name="concept-grid-cols"
                checked={data.columns === n}
                onChange={() => onChange({ ...data, columns: n })}
              />
              {n}열
            </label>
          ))}
        </div>
      </Field>

      <ListSection title={`개념 카드 (${cards.length})`} onAdd={addCard}>
        {cards.map((c, i) => (
          <div key={i} className="flex gap-2 items-start bg-white rounded p-2 border border-gray-200">
            <div className="flex flex-col gap-1 pt-1">
              <SmallBtn onClick={() => move(i, -1)}>↑</SmallBtn>
              <SmallBtn onClick={() => move(i, 1)}>↓</SmallBtn>
              <SmallBtn variant="danger" onClick={() => removeCard(i)}>✕</SmallBtn>
            </div>
            <div className="flex-1 grid grid-cols-[120px_1fr] gap-2">
              <TextInput value={c.name} onChange={v => updateCard(i, { name: v })} placeholder="개념명" />
              <TextArea value={c.desc_html} onChange={v => updateCard(i, { desc_html: v })} placeholder="설명 (HTML)" rows={2} />
            </div>
          </div>
        ))}
      </ListSection>

      <p className="text-[10px] text-gray-500 leading-relaxed">{HTML_HINT}</p>
    </div>
  );
}
