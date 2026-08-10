'use client';

import type { SectionHeaderData } from '@/lib/korean-explainer/types';
import { Field, TextInput } from './_form-utils';

export default function SectionHeaderForm({ data, onChange }: { data: SectionHeaderData; onChange: (d: SectionHeaderData) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <Field label="tag (chip)">
        <TextInput value={data.tag} onChange={v => onChange({ ...data, tag: v })} placeholder="PASSAGE / SOLUTION / CONCEPTS" />
      </Field>
      <Field label="title (헤더 텍스트)">
        <TextInput value={data.title} onChange={v => onChange({ ...data, title: v })} placeholder="작품 상세 분석 · 문제 해설 ..." />
      </Field>
      <div className="text-[11px] text-gray-500 self-end leading-tight">
        ⓘ tag 는 노란 chip + navy 바탕으로 강조 표시됩니다.
      </div>
    </div>
  );
}
