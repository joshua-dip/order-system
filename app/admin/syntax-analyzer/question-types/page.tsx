'use client';

import { useCallback, useEffect, useState } from 'react';

type QType = { id: string; label: string; prompt: string; order: number; isActive: boolean };

export default function QuestionTypesPage() {
  const [items, setItems] = useState<QType[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ id: '', label: '', prompt: '', order: 0 });

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/admin/passage-analyzer/question-types', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d.types) ? d.types : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.id.trim()) return;
    const res = await fetch('/api/admin/passage-analyzer/question-types', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: form.id.trim(),
        label: form.label.trim() || form.id,
        prompt: form.prompt,
        order: form.order,
        isActive: true,
      }),
    });
    if (res.ok) {
      setForm({ id: '', label: '', prompt: '', order: items.length });
      load();
    }
  }

  async function del(id: string) {
    if (!confirm('삭제할까요?')) return;
    await fetch(`/api/admin/passage-analyzer/question-types?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    load();
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <h1 className="text-xl font-bold">문제 유형 설정</h1>
      <p className="text-slate-400 text-sm">MongoDB <code className="text-amber-200/90">passage_analyzer_question_types</code></p>

      <form onSubmit={save} className="space-y-2 border border-slate-700 rounded-lg p-4 bg-slate-800/40">
        <p className="text-sm font-semibold text-slate-300">추가 / 수정</p>
        <input
          placeholder="id (grammar, context, …)"
          value={form.id}
          onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm"
        />
        <input
          placeholder="표시 이름"
          value={form.label}
          onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm"
        />
        <textarea
          placeholder="출제 프롬프트 힌트"
          value={form.prompt}
          onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
          rows={3}
          className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm"
        />
        <input
          type="number"
          placeholder="order"
          value={form.order}
          onChange={(e) => setForm((f) => ({ ...f, order: parseInt(e.target.value, 10) || 0 }))}
          className="w-32 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm"
        />
        <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-700 text-sm">
          저장
        </button>
      </form>

      {loading ? (
        <p className="text-slate-500">불러오는 중…</p>
      ) : (
        <ul className="space-y-2">
          {items.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-start justify-between gap-2 border border-slate-700 rounded-lg p-3 text-sm"
            >
              <div>
                <span className="font-mono text-sky-300">{t.id}</span>
                <span className="text-slate-400 ml-2">order {t.order}</span>
                <p className="text-white font-medium">{t.label}</p>
                <p className="text-slate-500 text-xs mt-1 whitespace-pre-wrap">{t.prompt}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setForm({ id: t.id, label: t.label, prompt: t.prompt, order: t.order })
                  }
                  className="text-xs text-sky-400"
                >
                  편집
                </button>
                <button type="button" onClick={() => del(t.id)} className="text-xs text-red-400">
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
