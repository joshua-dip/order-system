'use client';

import type { GistBoxData } from '@/lib/korean-explainer/types';
import { Field, HTML_HINT, TextArea, TextInput } from './_form-utils';

export default function GistBoxForm({ data, onChange }: { data: GistBoxData; onChange: (d: GistBoxData) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Field label="label (chip)">
        <TextInput value={data.label} onChange={v => onChange({ ...data, label: v })} placeholder="한 줄 요지 / 마무리" />
      </Field>
      <Field label="body_html" hint={HTML_HINT}>
        <TextArea value={data.body_html} onChange={v => onChange({ ...data, body_html: v })} rows={3} />
      </Field>
    </div>
  );
}
