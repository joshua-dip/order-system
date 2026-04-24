'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EssayQuestionData } from '@/lib/member-essay-draft-claude';

/* ─── 섹션 정의 (기존 유형) ─── */
type Section = {
  key: keyof EssayQuestionData;
  label: string;
  multiline?: boolean;
};

const BASE_SECTIONS: Section[] = [
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
  questionType?: string;
};

/* ─────────────────────────────────────────────────────
   유형 자동 감지
───────────────────────────────────────────────────── */
function detectEssayVariant(
  data: Record<string, unknown>,
): 'blank-rearrangement' | 'summary-conditional' | 'dual-point' | 'legacy' {
  if (typeof data.Phrase === 'string') return 'blank-rearrangement';
  if (typeof data.SummaryWithBlank === 'string') return 'summary-conditional';
  if (typeof data.InstructionIntroEn === 'string') return 'dual-point';
  return 'legacy';
}

/* ─────────────────────────────────────────────────────
   공통 셀 컴포넌트
───────────────────────────────────────────────────── */
function FieldCard({
  label,
  accent,
  children,
  action,
}: {
  label: string;
  accent?: 'amber' | 'emerald' | 'violet' | 'sky' | 'indigo';
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  const headerCls =
    accent === 'amber'
      ? 'text-amber-700'
      : accent === 'emerald'
        ? 'text-emerald-700'
        : accent === 'violet'
          ? 'text-violet-700'
          : accent === 'sky'
            ? 'text-sky-700'
            : accent === 'indigo'
              ? 'text-indigo-700'
              : 'text-slate-500';
  const borderCls =
    accent === 'amber'
      ? 'border-amber-200 bg-amber-50/60'
      : accent === 'emerald'
        ? 'border-emerald-200 bg-emerald-50/60'
        : accent === 'violet'
          ? 'border-violet-200 bg-violet-50/40'
          : accent === 'sky'
            ? 'border-sky-200 bg-sky-50/40'
            : accent === 'indigo'
              ? 'border-indigo-200 bg-indigo-50/40'
              : 'border-slate-100 bg-white';

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${borderCls}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className={`text-[10px] font-bold uppercase tracking-wide ${headerCls}`}>{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function CopyBtn({
  label,
  text,
  copied,
  onCopy,
}: {
  label: string;
  text: string;
  copied: string | null;
  onCopy: (label: string, text: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(label, text)}
      className="text-[10px] font-semibold text-slate-400 hover:text-violet-700"
    >
      {copied === label ? '복사됨' : '복사'}
    </button>
  );
}

/* ─────────────────────────────────────────────────────
   빈칸재배열형 미리보기
───────────────────────────────────────────────────── */
function BlankRearrangementPreview({
  data,
  editable,
  onDataChange,
}: {
  data: Record<string, unknown>;
  editable?: boolean;
  onDataChange?: (updated: Record<string, unknown>) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState('');

  const phrase = typeof data.Phrase === 'string' ? data.Phrase : '';
  const passageWithBlank = typeof data.PassageWithBlank === 'string' ? data.PassageWithBlank : '';
  const wordBox = typeof data.WordBox === 'string' ? data.WordBox : '';
  const chunks = Array.isArray(data.Chunks)
    ? (data.Chunks as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];
  const explanation = typeof data.Explanation === 'string' ? data.Explanation : '';

  const doCopy = useCallback(async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  }, []);

  const startEdit = (key: string, value: string) => {
    setEditBuf(value);
    setEditKey(key);
  };

  const commit = (key: string) => {
    onDataChange?.({ ...data, [key]: editBuf.trim() });
    setEditKey(null);
  };

  const buildReadable = () =>
    [
      passageWithBlank && `[지문 (빈칸 포함)]\n${passageWithBlank}`,
      wordBox && `[보기]\n${wordBox}`,
      phrase && `[정답]\n${phrase}`,
      explanation && `[해설]\n${explanation}`,
    ]
      .filter(Boolean)
      .join('\n\n');

  const fields: { key: string; label: string; value: string; multiline?: boolean; accent?: 'amber' | 'emerald' | 'violet' | 'sky' | 'indigo' }[] = [
    { key: 'PassageWithBlank', label: '지문 (빈칸 포함)', value: passageWithBlank, multiline: true },
    { key: 'Phrase', label: '정답 (빈칸 채울 구)', value: phrase, accent: 'emerald' },
    { key: 'Explanation', label: '해설', value: explanation, multiline: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">
          {editable ? '각 항목을 클릭해 직접 수정할 수 있습니다.' : '아래 내용을 확인한 뒤 저장하세요.'}
        </p>
        <button
          type="button"
          onClick={() => void doCopy('전체', buildReadable())}
          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-100"
        >
          {copied === '전체' ? '복사됨' : '전체 복사'}
        </button>
      </div>

      {/* 보기 */}
      {chunks.length > 0 && (
        <FieldCard label={`보기 (${chunks.length}개 · 순서 무관)`} accent="indigo"
          action={<CopyBtn label="보기" text={wordBox} copied={copied} onCopy={(l, t) => void doCopy(l, t)} />}
        >
          <div className="flex flex-wrap gap-2">
            {(wordBox || chunks.join(' / ')).split(' / ').map((w, idx) => (
              <span
                key={idx}
                className="rounded-lg border border-indigo-200 bg-white px-3 py-1 text-sm font-semibold text-indigo-900 shadow-sm"
              >
                {w.trim()}
              </span>
            ))}
          </div>
        </FieldCard>
      )}

      {/* 나머지 필드 */}
      {fields.map(({ key, label, value, multiline, accent }) => {
        if (!value && editKey !== key) return null;
        const isEditing = editKey === key;
        return (
          <FieldCard key={key} label={label} accent={accent}
            action={
              !isEditing ? (
                <div className="flex items-center gap-1.5">
                  <CopyBtn label={label} text={value} copied={copied} onCopy={(l, t) => void doCopy(l, t)} />
                  {editable && (
                    <button
                      type="button"
                      onClick={() => startEdit(key, value)}
                      className="text-[10px] font-semibold text-slate-400 hover:text-violet-700"
                    >
                      수정
                    </button>
                  )}
                </div>
              ) : undefined
            }
          >
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
                  <button type="button" onClick={() => commit(key)} className="rounded-lg bg-violet-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-violet-700">저장</button>
                  <button type="button" onClick={() => setEditKey(null)} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">취소</button>
                </div>
              </div>
            ) : (
              <p className={`whitespace-pre-wrap text-sm leading-relaxed ${key === 'PassageWithBlank' ? 'font-mono text-[13px] text-slate-700' : key === 'Phrase' ? 'font-bold text-emerald-900' : 'text-slate-800'}`}>
                {value}
              </p>
            )}
          </FieldCard>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   요약문조건영작형 미리보기
───────────────────────────────────────────────────── */
function SummaryConditionalPreview({
  data,
  editable,
  onDataChange,
}: {
  data: Record<string, unknown>;
  editable?: boolean;
  onDataChange?: (updated: Record<string, unknown>) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState('');

  const summaryWithBlank = typeof data.SummaryWithBlank === 'string' ? data.SummaryWithBlank : '';
  const conditions = Array.isArray(data.Conditions)
    ? (data.Conditions as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];
  const answer = typeof data.Answer === 'string' ? data.Answer : '';
  const answerAlt = typeof data.AnswerAlt === 'string' ? data.AnswerAlt : '';
  const explanationKo = typeof data.ExplanationKo === 'string' ? data.ExplanationKo : '';
  const topicKo = typeof data.TopicKo === 'string' ? data.TopicKo : '';
  const points = typeof data.Points === 'number' ? data.Points : 5;

  const doCopy = useCallback(async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  }, []);

  const startEdit = (key: string, value: string) => { setEditBuf(value); setEditKey(key); };
  const commit = (key: string) => { onDataChange?.({ ...data, [key]: editBuf.trim() }); setEditKey(null); };

  const conditionsText = conditions.join('\n');
  const buildReadable = () =>
    [
      summaryWithBlank && `[요약문 (빈칸 포함)]\n${summaryWithBlank}`,
      conditionsText && `[조건]\n${conditionsText}`,
      answer && `[모범 답안]\n${answer}`,
      answerAlt && `[허용 답안]\n${answerAlt}`,
      explanationKo && `[해설]\n${explanationKo}`,
    ]
      .filter(Boolean)
      .join('\n\n');

  const stringFields: { key: string; label: string; value: string; multiline?: boolean; accent?: 'amber' | 'emerald' | 'violet' | 'sky' }[] = [
    { key: 'SummaryWithBlank', label: `요약문 틀 [${points}점]`, value: summaryWithBlank, accent: 'amber' },
    { key: 'Answer', label: '모범 답안', value: answer, accent: 'emerald' },
    { key: 'AnswerAlt', label: '허용 답안', value: answerAlt, accent: 'sky' },
    { key: 'ExplanationKo', label: '해설', value: explanationKo, multiline: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {topicKo && (
            <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-bold text-violet-800">
              {topicKo}
            </span>
          )}
          <p className="text-xs font-medium text-slate-500">
            {editable ? '항목을 클릭해 수정할 수 있습니다.' : '확인 후 저장하세요.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void doCopy('전체', buildReadable())}
          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-100"
        >
          {copied === '전체' ? '복사됨' : '전체 복사'}
        </button>
      </div>

      {/* 조건 */}
      {conditions.length > 0 && (
        <FieldCard label={`조건 (${conditions.length}개)`} accent="violet"
          action={<CopyBtn label="조건" text={conditionsText} copied={copied} onCopy={(l, t) => void doCopy(l, t)} />}
        >
          <ol className="space-y-1">
            {conditions.map((c, idx) => (
              <li key={idx} className="flex gap-2 text-sm text-slate-800">
                <span className="shrink-0 font-bold text-violet-700">{idx + 1}.</span>
                <span>{c}</span>
              </li>
            ))}
          </ol>
        </FieldCard>
      )}

      {/* 문자열 필드 */}
      {stringFields.map(({ key, label, value, multiline, accent }) => {
        if (!value && editKey !== key) return null;
        const isEditing = editKey === key;
        return (
          <FieldCard key={key} label={label} accent={accent}
            action={
              !isEditing ? (
                <div className="flex items-center gap-1.5">
                  <CopyBtn label={label} text={value} copied={copied} onCopy={(l, t) => void doCopy(l, t)} />
                  {editable && (
                    <button type="button" onClick={() => startEdit(key, value)} className="text-[10px] font-semibold text-slate-400 hover:text-violet-700">수정</button>
                  )}
                </div>
              ) : undefined
            }
          >
            {isEditing ? (
              <div className="space-y-2">
                <textarea autoFocus value={editBuf} onChange={(e) => setEditBuf(e.target.value)} rows={multiline ? 5 : 3}
                  className="w-full resize-none rounded-xl border border-violet-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-violet-200" />
                <div className="flex gap-2">
                  <button type="button" onClick={() => commit(key)} className="rounded-lg bg-violet-600 px-3 py-1 text-[11px] font-bold text-white">저장</button>
                  <button type="button" onClick={() => setEditKey(null)} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600">취소</button>
                </div>
              </div>
            ) : (
              <p className={`whitespace-pre-wrap text-sm leading-relaxed ${key === 'Answer' ? 'font-bold text-emerald-900' : key === 'AnswerAlt' ? 'font-semibold text-sky-900' : key === 'SummaryWithBlank' ? 'font-semibold text-amber-900' : 'text-slate-800'}`}>
                {value}
              </p>
            )}
          </FieldCard>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   이중요지영작형 미리보기
───────────────────────────────────────────────────── */
function DualPointPreview({
  data,
  editable,
  onDataChange,
}: {
  data: Record<string, unknown>;
  editable?: boolean;
  onDataChange?: (updated: Record<string, unknown>) => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState('');

  const introEn = typeof data.InstructionIntroEn === 'string' ? data.InstructionIntroEn : '';
  const task1 = typeof data.Task1En === 'string' ? data.Task1En : '';
  const task2 = typeof data.Task2En === 'string' ? data.Task2En : '';
  const wordMin = typeof data.WordMin === 'number' ? data.WordMin : 40;
  const wordMax = typeof data.WordMax === 'number' ? data.WordMax : 50;
  const points = typeof data.Points === 'number' ? data.Points : 8;
  const modelAnswer = typeof data.ModelAnswerEn === 'string' ? data.ModelAnswerEn : '';
  const modelAnswerAlt = typeof data.ModelAnswerAltEn === 'string' ? data.ModelAnswerAltEn : '';
  const explanationKo = typeof data.ExplanationKo === 'string' ? data.ExplanationKo : '';
  const topicKo = typeof data.TopicKo === 'string' ? data.TopicKo : '';

  const doCopy = useCallback(async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  }, []);

  const startEdit = (key: string, value: string) => { setEditBuf(value); setEditKey(key); };
  const commit = (key: string) => { onDataChange?.({ ...data, [key]: editBuf.trim() }); setEditKey(null); };

  const buildReadable = () =>
    [
      introEn && `[도입] ${introEn}`,
      (task1 || task2) && `[과제]\n1) ${task1}\n2) ${task2}`,
      `[단어 수] ${wordMin}–${wordMax}어 [${points}점]`,
      modelAnswer && `[모범 답안]\n${modelAnswer}`,
      modelAnswerAlt && `[허용 답안]\n${modelAnswerAlt}`,
      explanationKo && `[해설]\n${explanationKo}`,
    ]
      .filter(Boolean)
      .join('\n\n');

  const stringFields: { key: string; label: string; value: string; multiline?: boolean; accent?: 'amber' | 'emerald' | 'sky' }[] = [
    { key: 'ModelAnswerEn', label: '모범 답안', value: modelAnswer, multiline: true, accent: 'emerald' },
    { key: 'ModelAnswerAltEn', label: '허용 답안', value: modelAnswerAlt, multiline: true, accent: 'sky' },
    { key: 'ExplanationKo', label: '해설', value: explanationKo, multiline: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {topicKo && (
            <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-bold text-violet-800">
              {topicKo}
            </span>
          )}
          <p className="text-xs font-medium text-slate-500">
            {editable ? '항목을 클릭해 수정할 수 있습니다.' : '확인 후 저장하세요.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void doCopy('전체', buildReadable())}
          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-100"
        >
          {copied === '전체' ? '복사됨' : '전체 복사'}
        </button>
      </div>

      {/* 지시문 + 과제 */}
      <FieldCard label={`지시문 [${points}점 · ${wordMin}–${wordMax}어]`} accent="amber"
        action={<CopyBtn label="지시문" text={`${introEn} Based on the ideas presented in the passage, write an answer that explains:\n(1) ${task1}, and\n(2) ${task2}.\nWrite your answer in ${wordMin}–${wordMax} English words.`} copied={copied} onCopy={(l, t) => void doCopy(l, t)} />}
      >
        <div className="space-y-1.5 text-sm text-amber-900">
          <p className="font-semibold">{introEn}</p>
          <p className="text-[12px] text-amber-700">Based on the ideas presented in the passage, write an answer that explains:</p>
          {task1 && <p className="ml-2">(1) <span className="font-medium underline decoration-amber-400 underline-offset-2">{task1}</span>, and</p>}
          {task2 && <p className="ml-2">(2) <span className="font-medium underline decoration-amber-400 underline-offset-2">{task2}</span>.</p>}
          <p className="text-[11px] text-amber-600 font-medium">Write your answer in {wordMin}–{wordMax} English words. [{points}점]</p>
        </div>
      </FieldCard>

      {/* 모범·허용 답안, 해설 */}
      {stringFields.map(({ key, label, value, multiline, accent }) => {
        if (!value && editKey !== key) return null;
        const isEditing = editKey === key;
        return (
          <FieldCard key={key} label={label} accent={accent}
            action={
              !isEditing ? (
                <div className="flex items-center gap-1.5">
                  <CopyBtn label={label} text={value} copied={copied} onCopy={(l, t) => void doCopy(l, t)} />
                  {editable && (
                    <button type="button" onClick={() => startEdit(key, value)} className="text-[10px] font-semibold text-slate-400 hover:text-violet-700">수정</button>
                  )}
                </div>
              ) : undefined
            }
          >
            {isEditing ? (
              <div className="space-y-2">
                <textarea autoFocus value={editBuf} onChange={(e) => setEditBuf(e.target.value)} rows={multiline ? 5 : 3}
                  className="w-full resize-none rounded-xl border border-violet-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-violet-200" />
                <div className="flex gap-2">
                  <button type="button" onClick={() => commit(key)} className="rounded-lg bg-violet-600 px-3 py-1 text-[11px] font-bold text-white">저장</button>
                  <button type="button" onClick={() => setEditKey(null)} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600">취소</button>
                </div>
              </div>
            ) : (
              <p className={`whitespace-pre-wrap text-sm leading-relaxed ${key === 'ModelAnswerEn' ? 'font-bold text-emerald-900' : key === 'ModelAnswerAltEn' ? 'font-semibold text-sky-900' : 'text-slate-800'}`}>
                {value}
              </p>
            )}
          </FieldCard>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────
   기존 유형 미리보기 (요약문본문어휘 / 요약문조건영작배열)
───────────────────────────────────────────────────── */
function LegacyEssayPreview({
  data,
  editable,
  onDataChange,
  questionType,
}: Props) {
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

  const buildReadable = useCallback(() => {
    const parts: string[] = [];
    for (const s of BASE_SECTIONS) {
      const v = data[s.key];
      if (typeof v === 'string' && v.trim()) {
        parts.push(`[${s.label}]\n${formatConditions(v.trim())}`);
      }
    }
    if (wordBank.length > 0) parts.push(`[배열할 단어]\n${wordBank.join(' / ')}`);
    if (keywords.length > 0) parts.push(`[핵심 어휘]\n${keywords.join(', ')}`);
    return parts.join('\n\n');
  }, [data, keywords, wordBank]);

  const doCopy = useCallback(async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  }, []);

  const startEdit = (key: keyof EssayQuestionData) => {
    const raw = data[key];
    setEditBuf(typeof raw === 'string' ? formatConditions(raw.trim()) : '');
    setEditingKey(key);
  };

  const commitEdit = () => {
    if (!editingKey || !onDataChange) return;
    let value = editBuf.trim();
    if (editingKey === 'Conditions') value = value.split('\n').map((l) => l.trim()).join('\n');
    onDataChange({ ...data, [editingKey]: value });
    setEditingKey(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500">
          {editable ? '각 항목을 클릭해 직접 수정할 수 있습니다.' : '아래 내용을 확인한 뒤 저장하세요.'}
        </p>
        <button type="button" onClick={() => void doCopy('전체', buildReadable())}
          className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-800 hover:bg-violet-100">
          {copied === '전체' ? '복사됨' : '전체 복사'}
        </button>
      </div>

      {wordBank.length > 0 && (
        <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-700">
              배열할 단어 <span className="text-indigo-400 font-normal normal-case">({wordBank.length}개 · 순서 무관)</span>
            </span>
            <button type="button" onClick={() => void doCopy('배열할 단어', wordBank.join(' / '))}
              className="text-[10px] font-semibold text-slate-400 hover:text-violet-700">
              {copied === '배열할 단어' ? '복사됨' : '복사'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {wordBank.map((word, idx) => (
              <span key={`${word}-${idx}`} className="rounded-lg border border-indigo-200 bg-white px-3 py-1 text-sm font-semibold text-indigo-900 shadow-sm">
                {word}
              </span>
            ))}
          </div>
        </div>
      )}

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
            <span key={kw} className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${questionType === '요약문본문어휘' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-sky-100 text-sky-800 ring-sky-200'}`}>
              {kw}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-3">
        {BASE_SECTIONS.map(({ key, label, multiline }) => {
          const raw = data[key];
          const rawText = typeof raw === 'string' ? raw.trim() : '';
          if (!rawText && editingKey !== key) return null;
          const displayText = formatConditions(rawText);
          const isEditing = editingKey === key;
          return (
            <div key={key} className={`rounded-2xl border p-4 shadow-sm transition ${isEditing ? 'border-violet-400 bg-violet-50/50 ring-2 ring-violet-200' : key === 'SummaryFrame' ? 'border-amber-200 bg-amber-50/60' : key === 'SampleAnswer' ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-100 bg-white'}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className={`text-[10px] font-bold uppercase tracking-wide ${key === 'SummaryFrame' ? 'text-amber-700' : key === 'SampleAnswer' ? 'text-emerald-700' : 'text-slate-500'}`}>{label}</span>
                {!isEditing && (
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => void doCopy(label, displayText)} className="text-[10px] font-semibold text-slate-400 hover:text-violet-700">
                      {copied === label ? '복사됨' : '복사'}
                    </button>
                    {editable && (
                      <button type="button" onClick={() => startEdit(key)} className="text-[10px] font-semibold text-slate-400 hover:text-violet-700">수정</button>
                    )}
                  </div>
                )}
              </div>
              {isEditing ? (
                <div className="space-y-2">
                  <textarea autoFocus value={editBuf} onChange={(e) => setEditBuf(e.target.value)} rows={multiline ? 6 : 3}
                    className="w-full resize-none rounded-xl border border-violet-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 outline-none focus:ring-2 focus:ring-violet-200" />
                  <div className="flex gap-2">
                    <button type="button" onClick={commitEdit} className="rounded-lg bg-violet-600 px-3 py-1 text-[11px] font-bold text-white hover:bg-violet-700">저장</button>
                    <button type="button" onClick={() => setEditingKey(null)} className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50">취소</button>
                  </div>
                </div>
              ) : (
                <p className={`whitespace-pre-wrap text-sm leading-relaxed ${key === 'Paragraph' ? 'font-mono text-[13px] text-slate-700' : key === 'SummaryFrame' ? 'font-semibold text-amber-900' : key === 'SampleAnswer' ? 'font-semibold text-emerald-900' : 'text-slate-800'}`}>
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

/* ─────────────────────────────────────────────────────
   메인 라우터
───────────────────────────────────────────────────── */
export default function EssayQuestionPreview({ data, editable, onDataChange, questionType }: Props) {
  const variant = detectEssayVariant(data);

  if (variant === 'blank-rearrangement') {
    return <BlankRearrangementPreview data={data} editable={editable} onDataChange={onDataChange} />;
  }
  if (variant === 'summary-conditional') {
    return <SummaryConditionalPreview data={data} editable={editable} onDataChange={onDataChange} />;
  }
  if (variant === 'dual-point') {
    return <DualPointPreview data={data} editable={editable} onDataChange={onDataChange} />;
  }
  return <LegacyEssayPreview data={data} editable={editable} onDataChange={onDataChange} questionType={questionType} />;
}
