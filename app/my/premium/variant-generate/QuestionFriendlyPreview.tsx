'use client';

import { useCallback, useEffect, useState } from 'react';

const LABELS: { key: string; label: string }[] = [
  { key: 'Question', label: '발문' },
  { key: 'Paragraph', label: '지문' },
  { key: 'Options', label: '선택지' },
  { key: 'CorrectAnswer', label: '정답' },
  { key: 'Explanation', label: '해설' },
];

function displayText(key: string, raw: string): string {
  if (key === 'Options') return raw.replace(/\s*###\s*/g, '\n');
  return raw;
}

type Props = {
  data: Record<string, unknown>;
  editable?: boolean;
  onDataChange?: (updated: Record<string, unknown>) => void;
};

export default function QuestionFriendlyPreview({ data, editable, onDataChange }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState('');

  useEffect(() => {
    if (!editable) setEditingKey(null);
  }, [editable]);

  const copy = useCallback(async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }, []);

  const copyAllReadable = useCallback(async () => {
    const parts: string[] = [];
    for (const { key, label } of LABELS) {
      const v = data[key];
      if (typeof v === 'string' && v.trim()) parts.push(`[${label}]\n${displayText(key, v.trim())}`);
    }
    await copy('전체', parts.join('\n\n'));
  }, [data, copy]);

  const startEdit = (key: string) => {
    const raw = data[key];
    setEditBuf(typeof raw === 'string' ? displayText(key, raw.trim()) : '');
    setEditingKey(key);
  };

  const commitEdit = () => {
    if (!editingKey || !onDataChange) return;
    let value = editBuf.trim();
    if (editingKey === 'Options') {
      value = value
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ### ');
    }
    onDataChange({ ...data, [editingKey]: value });
    setEditingKey(null);
  };

  const cancelEdit = () => setEditingKey(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">
          {editable ? '각 항목을 클릭해 직접 수정할 수 있습니다.' : '아래 내용을 확인한 뒤 저장하세요.'}
        </p>
        <button
          type="button"
          onClick={() => void copyAllReadable()}
          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-100"
        >
          {copied === '전체' ? '복사됨' : '전체 복사'}
        </button>
      </div>
      <div className="space-y-3">
        {LABELS.map(({ key, label }) => {
          const raw = data[key];
          const rawText = typeof raw === 'string' ? raw.trim() : '';
          if (!rawText && editingKey !== key) return null;
          const text = displayText(key, rawText);
          const isEditing = editingKey === key;

          return (
            <div
              key={key}
              className={`rounded-2xl border p-4 shadow-sm transition ${
                isEditing
                  ? 'border-violet-300 bg-violet-50/40 ring-2 ring-violet-200'
                  : 'border-slate-100 bg-gradient-to-b from-slate-50/80 to-white'
              } ${editable && !isEditing ? 'cursor-pointer hover:border-violet-200 hover:shadow-md' : ''}`}
              onClick={editable && !isEditing ? () => startEdit(key) : undefined}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-violet-700">{label}</span>
                <div className="flex items-center gap-2">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          commitEdit();
                        }}
                        className="rounded-lg bg-violet-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-violet-700"
                      >
                        확인
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelEdit();
                        }}
                        className="text-[11px] font-semibold text-slate-500 hover:text-slate-700"
                      >
                        취소
                      </button>
                    </>
                  ) : (
                    <>
                      {editable && (
                        <span className="text-[10px] text-slate-400">클릭해서 수정</span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copy(label, text);
                        }}
                        className="text-[11px] font-semibold text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-violet-700"
                      >
                        {copied === label ? '복사됨' : '복사'}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {isEditing ? (
                <textarea
                  autoFocus
                  value={editBuf}
                  onChange={(e) => setEditBuf(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') cancelEdit();
                  }}
                  rows={Math.max(3, editBuf.split('\n').length + 1)}
                  className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{text}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
