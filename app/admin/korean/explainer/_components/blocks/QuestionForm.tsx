'use client';

import type { QuestionData } from '@/lib/korean-explainer/types';
import { Field, HTML_HINT, ListSection, SmallBtn, TextArea, TextInput } from './_form-utils';

const ANSWER_OPTIONS = ['①', '②', '③', '④', '⑤'];

export default function QuestionForm({ data, onChange }: { data: QuestionData; onChange: (d: QuestionData) => void }) {
  const choices = data.choices ?? [];
  const evidences = data.evidences ?? [];
  const trap = data.trap;

  function setAnswer(n: string) {
    // answer 와 correct_n 동기화 — validator 에서 강제
    onChange({ ...data, answer: n, correct_n: n });
  }

  function updateChoice(i: number, patch: Partial<QuestionData['choices'][number]>) {
    onChange({ ...data, choices: choices.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  }
  function addChoice() {
    const nextN = ANSWER_OPTIONS[choices.length] ?? '';
    onChange({ ...data, choices: [...choices, { n: nextN, judge: 'X', text_html: '' }] });
  }
  function removeChoice(i: number) {
    onChange({ ...data, choices: choices.filter((_, idx) => idx !== i) });
  }

  function updateEvidence(i: number, patch: Partial<NonNullable<QuestionData['evidences']>[number]>) {
    onChange({ ...data, evidences: evidences.map((e, idx) => (idx === i ? { ...e, ...patch } : e)) });
  }
  function addEvidence() {
    onChange({ ...data, evidences: [...evidences, { label: '핵심 판단', body_html: '' }] });
  }
  function removeEvidence(i: number) {
    onChange({ ...data, evidences: evidences.filter((_, idx) => idx !== i) });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="num (문항 번호)">
          <TextInput
            value={String(data.num ?? '')}
            onChange={v => {
              const n = Number(v);
              onChange({ ...data, num: Number.isFinite(n) ? n : 0 });
            }}
            placeholder="22"
          />
        </Field>
        <Field label="answer (①~⑤)">
          <select
            className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
            value={data.answer ?? ''}
            onChange={e => setAnswer(e.target.value)}
          >
            <option value="">—</option>
            {ANSWER_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="points (배점)">
          <TextInput
            value={String(data.points ?? '')}
            onChange={v => {
              const n = Number(v);
              onChange({ ...data, points: Number.isFinite(n) ? n : 0 });
            }}
            placeholder="2 / 3"
          />
        </Field>
        <Field label="(자동) correct_n">
          <div className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-gray-50 text-gray-600">
            {data.correct_n || '—'} <span className="text-[10px] text-gray-400">(answer 와 동기화)</span>
          </div>
        </Field>
      </div>

      <Field label="intent (출제의도)">
        <TextInput value={data.intent} onChange={v => onChange({ ...data, intent: v })} placeholder="서술상의 특징을 이해한다" />
      </Field>
      <Field label="prompt_html (문제 발문, HTML)" hint={HTML_HINT}>
        <TextArea value={data.prompt_html} onChange={v => onChange({ ...data, prompt_html: v })} rows={2} />
      </Field>

      <ListSection title={`evidences (핵심 판단 박스, ${evidences.length})`} onAdd={addEvidence}>
        {evidences.map((e, i) => (
          <div key={i} className="flex gap-2 items-start bg-white rounded p-2 border border-gray-200">
            <SmallBtn variant="danger" onClick={() => removeEvidence(i)}>✕</SmallBtn>
            <div className="flex-1 grid grid-cols-[120px_1fr] gap-2">
              <TextInput value={e.label} onChange={v => updateEvidence(i, { label: v })} placeholder="핵심 판단" />
              <TextArea value={e.body_html} onChange={v => updateEvidence(i, { body_html: v })} placeholder="근거 (HTML)" rows={2} />
            </div>
          </div>
        ))}
      </ListSection>

      <ListSection title={`choices (선지, ${choices.length})`} onAdd={addChoice}>
        {choices.map((c, i) => {
          const isCorrect = c.n === data.correct_n;
          return (
            <div key={i} className={`flex gap-2 items-start rounded p-2 border ${isCorrect ? 'bg-yellow-50 border-yellow-400' : 'bg-white border-gray-200'}`}>
              <SmallBtn variant="danger" onClick={() => removeChoice(i)}>✕</SmallBtn>
              <div className="flex-1 grid grid-cols-[60px_80px_1fr] gap-2">
                <select
                  className="px-2 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                  value={c.n}
                  onChange={e => updateChoice(i, { n: e.target.value })}
                >
                  {ANSWER_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <select
                  className="px-2 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
                  value={c.judge}
                  onChange={e => updateChoice(i, { judge: e.target.value as 'O' | 'X' })}
                >
                  <option value="O">O</option>
                  <option value="X">X</option>
                </select>
                <TextArea value={c.text_html} onChange={v => updateChoice(i, { text_html: v })} placeholder="선지 해설 (HTML)" rows={1} />
              </div>
            </div>
          );
        })}
        {choices.length === 0 && <p className="text-xs text-gray-500">+ 추가 로 5개 선지를 만드세요.</p>}
      </ListSection>

      <div className="flex flex-col gap-2 border border-gray-200 rounded-md p-2 bg-gray-50/50">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-700">trap (함정 포인트, 선택)</span>
          {trap ? (
            <SmallBtn variant="danger" onClick={() => onChange({ ...data, trap: undefined })}>제거</SmallBtn>
          ) : (
            <SmallBtn onClick={() => onChange({ ...data, trap: { title: '함정 포인트', body_html: '' } })}>+ 추가</SmallBtn>
          )}
        </div>
        {trap && (
          <div className="grid grid-cols-[180px_1fr] gap-2 bg-white p-2 rounded border border-gray-200">
            <TextInput value={trap.title} onChange={v => onChange({ ...data, trap: { ...trap, title: v } })} placeholder="제목" />
            <TextArea value={trap.body_html} onChange={v => onChange({ ...data, trap: { ...trap, body_html: v } })} placeholder="본문 (HTML)" rows={2} />
          </div>
        )}
      </div>
    </div>
  );
}
