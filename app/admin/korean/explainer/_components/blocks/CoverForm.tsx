'use client';

import type { CoverData } from '@/lib/korean-explainer/types';
import { Field, TextInput } from './_form-utils';

export default function CoverForm({ data, onChange }: { data: CoverData; onChange: (d: CoverData) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Field label="exam_title (시험 제목, 표지 h1)">
        <TextInput value={data.exam_title} onChange={v => onChange({ ...data, exam_title: v })} />
      </Field>
      <Field label="set_range (문항 범위)">
        <TextInput value={data.set_range} onChange={v => onChange({ ...data, set_range: v })} placeholder="22-25" />
      </Field>
      <Field label="genre (갈래)">
        <TextInput value={data.genre} onChange={v => onChange({ ...data, genre: v })} placeholder="독서(사회) / 현대소설 등" />
      </Field>
      <Field label="work_title (작품/지문 제목)">
        <TextInput value={data.work_title} onChange={v => onChange({ ...data, work_title: v })} placeholder="이문구 「암소」" />
      </Field>
      <Field label="show_subtitle (부제 노출)">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={data.show_subtitle ?? false}
            onChange={e => onChange({ ...data, show_subtitle: e.target.checked })}
          />
          LYCEUM ENGLISH ACADEMY · 학력평가 해설
        </label>
      </Field>
    </div>
  );
}
