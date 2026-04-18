'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EssayQuestionData } from '@/lib/member-essay-draft-claude';

type Section = {
  key: keyof EssayQuestionData;
  label: string;
  multiline?: boolean;
};

const SECTIONS: Section[] = [
  { key: 'Question', label: '발문' },
  { key: 'Paragraph', label: '지문', multiline: true },
  { key: 'Conditions', label: '조건', multiline: true },
  { key: 'SummaryFrame', label: '요약문 틀' },
  { key: 'SampleAnswer', label: '모범 답안' },
  { key: 'Explanation', label: '해설', multiline: true },
];

function formatConditions(raw: string): string {
  return raw.replace(/\\n/g, '\n');
}

type Props = {
  data: Record<string, unknown>;
  editable?: boolean;
  onDataChange?: (updated: Record<string, unknown>) => void;
  /** 문제 유형 — 키워드 레이블 변경 등에 사용 */
  questionType?: string;
};

export default function EssayQuestionPreview({ data, editable, onDataChange, questionType }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<keyof EssayQuestionData | null>(null);
  const [editBuf, setEditBuf] = useState('');

  useEffect(() => {
    if (!editable) setEditingKey(null);
  }, [editable]);

  const keywords = Array.isArray(data.Keywords)
    ? (data.Keywords as unknown[]).filter((k): k is string => typeof k === 'string')
    : [];

  const wordBank = Array.isArray(data.WordBank)
    ? (data.WordBank as unknown[]).filter((w): w is string => typeof w === 'string')
    : [];

  const isArrangement = wordBank.length > 0;

  const buildReadable = useCallback(() => {
    const parts: string[] = [];
    for (const s of SECTIONS) {
      const v = data[s.key];
      if (typeof v === 'string' && v.trim()) {
        parts.push(`[${s.label}]\n${formatConditions(v.trim())}`);
      }
    }
    if (wordBank.length > 0) {
      parts.push(`[배열할 단어]\n${wordBank.join(' / ')}`);
    }
    if (keywords.length > 0) {
      parts.push(`[핵심 어휘]\n${keywords.join(', ')}`);
    }
    return parts.join('\n\n');
  }, [data, keywords, wordBank]);

  const copyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildReadable());
      setCopied('전체');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  }, [buildReadable]);

  const copySection = useCallback(async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  }, []);

  const startEdit = (key: keyof EssayQuestionData) => {
    const raw = data[key];
    setEditBuf(typeof raw === 'string' ? formatConditions(raw.trim()) : '');
    setEditingKey(key);
  };

  const commitEdit = () => {
    if (!editingKey || !onDataChange) return;
    let value = editBuf.trim();
    // Conditions는 줄바꿈 → \n 이스케이프로 다시 저장
    if (editingKey === 'Conditions') {
      value = value.split('\n').map((l) => l.trim()).join('\n');
    }
    onDataChange({ ...data, [editingKey]: value });
    setEditingKey(null);
  };

  const cancelEdit = () => setEditingKey(null);

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">
          {editable ? '각 항목을 클릭해 직접 수정할 수 있습니다.' : '아래 내용을 확인한 뒤 저장하세요.'}
        </p>
        <button
          type="button"
          onClick={() => void copyAll()}
          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-100"
        >
          {copied === '전체' ? '복사됨' : '전체 복사'}
        </button>
      </div>

      {/* 배열형: 단어 뱅크 */}
      {isArrangement && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-700">
              배열할 단어 <span className="text-indigo-400 font-normal normal-case">({wordBank.length}개 · 순서 무관)</span>
            </span>
            <button
              type="button"
              onClick={() => void copySection('배열할 단어', wordBank.join(' / '))}
              className="text-[10px] font-semibold text-slate-400 hover:text-violet-700"
            >
              {copied === '배열할 단어' ? '복사됨' : '복사'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {wordBank.map((word, idx) => (
              <span
                key={`${word}-${idx}`}
                className="rounded-lg border border-indigo-200 bg-white px-3 py-1 text-sm font-semibold text-indigo-900 shadow-sm"
              >
                {word}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 핵심 어휘 / 정답 어휘 배지 */}
      {keywords.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {questionType === '요약문본문어휘' ? (
            <>
              <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600">정답 어휘</span>
              <span className="text-[10px] text-slate-400">(교사 참고용 — 학생에게 미공개)</span>
            </>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">핵심 어휘</span>
          )}
          {keywords.map((kw) => (
            <span
              key={kw}
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${
                questionType === '요약문본문어휘'
                  ? 'bg-amber-50 text-amber-800 ring-amber-200'
                  : 'bg-sky-100 text-sky-800 ring-sky-200'
              }`}
            >
              {kw}
            </span>
          ))}
        </div>
      )}

      {/* 섹션 목록 */}
      <div className="space-y-3">
        {SECTIONS.map(({ key, label, multiline }) => {
          const raw = data[key];
          const rawText = typeof raw === 'string' ? raw.trim() : '';
          if (!rawText && editingKey !== key) return null;
          const displayText = formatConditions(rawText);
          const isEditing = editingKey === key;

          return (
            <div
              key={key}
              className={`rounded-2xl border p-4 shadow-sm transition ${
                isEditing
                  ? 'border-violet-400 bg-violet-50/50 ring-2 ring-violet-200'
                  : key === 'SummaryFrame'
                    ? 'border-amber-200 bg-amber-50/60'
                    : key === 'SampleAnswer'
                      ? 'border-emerald-200 bg-emerald-50/60'
                      : 'border-slate-100 bg-white'
              }`}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span
                  className={`text-[10px] font-bold uppercase tracking-wide ${
                    key === 'SummaryFrame'
                      ? 'text-amber-700'
                      : key === 'SampleAnswer'
                        ? 'text-emerald-700'
                        : 'text-slate-500'
                  }`}
                >
                  {label}
                </span>
                {!isEditing && (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void copySection(label, displayText)}
                      className="text-[10px] font-semibold text-slate-400 hover:text-violet-700"
                    >
                      {copied === label ? '복사됨' : '복사'}
                    </button>
                    {editable && (
                      <button
                        type="button"
                        onClick={() => startEdit(key)}
                        className="text-[10px] font-semibold text-slate-400 hover:text-violet-700"
                      >
                        수정
                      </button>
                    )}
                  </div>
                )}
              </div>

              {isEditing ? (
                <div className="space-y-2">
                  <textarea
                    autoFocus
                    value={editBuf}
                    onChange={(e) => setEditBuf(e.target.value)}
                    rows={multiline ? 6 : 3}
                    className="w-full resize-none rounded-xl border border-violet-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-violet-200"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={commitEdit}
                      className="rounded-lg bg-violet-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-violet-700"
                    >
                      저장
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <p
                  className={`whitespace-pre-wrap text-sm leading-relaxed ${
                    key === 'Paragraph'
                      ? 'font-mono text-[13px] text-slate-700'
                      : key === 'SummaryFrame'
                        ? 'font-semibold text-amber-900'
                        : key === 'SampleAnswer'
                          ? 'font-semibold text-emerald-900'
                          : 'text-slate-800'
                  }`}
                >
                  {displayText}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
