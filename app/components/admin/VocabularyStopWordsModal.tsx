'use client';

import { useEffect, useState } from 'react';
import { DEFAULT_ENGLISH_STOPWORDS } from '@/lib/passage-analyzer-vocabulary-generate';

const defaultStopSorted = [...DEFAULT_ENGLISH_STOPWORDS].sort((a, b) => a.localeCompare(b));

type Props = {
  open: boolean;
  onClose: () => void;
  customStopWords: string[];
  onSave: (words: string[]) => void;
};

export function VocabularyStopWordsModal({ open, onClose, customStopWords, onSave }: Props) {
  const [newWord, setNewWord] = useState('');
  const [editable, setEditable] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setEditable(new Set(customStopWords.map((w) => w.trim().toLowerCase()).filter(Boolean)));
    setNewWord('');
  }, [open, customStopWords]);

  if (!open) return null;

  const addWord = () => {
    const t = newWord.trim().toLowerCase();
    if (!t) return;
    const next = new Set(editable);
    next.add(t);
    setEditable(next);
    setNewWord('');
  };

  const removeWord = (w: string) => {
    const next = new Set(editable);
    next.delete(w);
    setEditable(next);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4">
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-600 bg-slate-900 p-5 shadow-xl"
        role="dialog"
        aria-labelledby="stopwords-modal-title"
      >
        <h2 id="stopwords-modal-title" className="text-lg font-semibold text-slate-100 mb-4">
          불용어 관리
        </h2>

        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-2">
              기본 불용어 ({defaultStopSorted.length}개)
            </h3>
            <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-700 bg-slate-950/80 p-2">
              <div className="flex flex-wrap gap-1">
                {defaultStopSorted.map((word) => (
                  <span
                    key={word}
                    className="rounded px-1.5 py-0.5 text-[10px] bg-slate-800 text-slate-400"
                  >
                    {word}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-[10px] text-slate-500 mt-1">기본 목록은 바꿀 수 없습니다.</p>
          </div>

          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-2">사용자 정의 불용어 ({editable.size}개)</h3>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addWord()}
                placeholder="추가할 단어"
                className="flex-1 rounded-lg border border-slate-600 bg-slate-950 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
              />
              <button
                type="button"
                onClick={addWord}
                className="rounded-lg bg-teal-800 px-3 py-1.5 text-sm text-white hover:bg-teal-700"
              >
                추가
              </button>
            </div>
            <div className="min-h-[80px] rounded-lg border border-teal-900/50 bg-teal-950/20 p-2">
              {editable.size > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {Array.from(editable)
                    .sort((a, b) => a.localeCompare(b))
                    .map((word) => (
                      <span
                        key={word}
                        className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] bg-teal-900/50 text-teal-100"
                      >
                        {word}
                        <button
                          type="button"
                          onClick={() => removeWord(word)}
                          className="ml-0.5 text-teal-300 hover:text-white"
                          aria-label={`${word} 제거`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                </div>
              ) : (
                <p className="text-center text-xs text-slate-500 py-4">사용자 정의 불용어가 없습니다.</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => {
              onSave(Array.from(editable));
              onClose();
            }}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm text-white hover:bg-teal-600"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
