'use client';

/**
 * 문장 분석 패널 — 문장을 누르면 뜬다.
 *   듣기(전체·천천히·보통), 끊어읽기 어구(누르면 그 어구만 듣기, 드래그하면 고른 부분 듣기),
 *   문장 성분(SVOC), 해석, 문법 포인트, 핵심 단어.
 */

import { useMemo } from 'react';
import type { GrammarPointEntry, SvocSentenceData } from '@/lib/passage-analyzer-types';
import { chunkSentence, type LiveVocab } from '@/lib/passage-live-chunks';
import { speak, stopSpeaking, ttsSupported, type TtsRate } from './live-tts';

const ROLE_STYLE: Record<string, { label: string; cls: string }> = {
  subject: { label: 'S', cls: 'bg-amber-100 text-amber-900' },
  verb: { label: 'V', cls: 'bg-sky-100 text-sky-900' },
  indirectObject: { label: 'IO', cls: 'bg-emerald-100 text-emerald-900' },
  directObject: { label: 'O', cls: 'bg-emerald-100 text-emerald-900' },
  object: { label: 'O', cls: 'bg-emerald-100 text-emerald-900' },
  subjectComplement: { label: 'C', cls: 'bg-violet-100 text-violet-900' },
  objectComplement: { label: 'OC', cls: 'bg-pink-100 text-pink-900' },
  complement: { label: 'C', cls: 'bg-violet-100 text-violet-900' },
};

/** 단어 번호 → 성분. 여러 절이면 먼저 나온 절이 이긴다. */
function roleByWord(clauses: SvocSentenceData[] | undefined): Map<number, { role: string; start: boolean }> {
  const out = new Map<number, { role: string; start: boolean }>();
  for (const clause of clauses ?? []) {
    const c = clause as unknown as Record<string, unknown>;
    for (const role of Object.keys(ROLE_STYLE)) {
      const s = c[`${role}Start`];
      const e = c[`${role}End`];
      if (typeof s !== 'number' || typeof e !== 'number' || e < s) continue;
      for (let i = s; i <= e; i++) if (!out.has(i)) out.set(i, { role, start: i === s });
    }
  }
  return out;
}

function speakSelectionIn(el: HTMLElement, rate: TtsRate) {
  const sel = window.getSelection();
  const text = sel && !sel.isCollapsed ? sel.toString().trim() : '';
  if (text && sel && el.contains(sel.anchorNode)) speak(text, rate);
}

export function LiveSentencePanelBody({
  sentence,
  korean,
  breaks,
  svoc,
  grammarPoints,
  vocab,
  rate,
  onRate,
  showSvoc,
  onToggleSvoc,
}: {
  sentence: string;
  korean: string;
  breaks?: number[];
  svoc?: SvocSentenceData[];
  grammarPoints?: GrammarPointEntry[];
  vocab: LiveVocab[];
  rate: TtsRate;
  onRate: (r: TtsRate) => void;
  showSvoc: boolean;
  onToggleSvoc: () => void;
}) {
  const chunks = useMemo(() => chunkSentence(sentence, breaks), [sentence, breaks]);
  const roles = useMemo(() => roleByWord(svoc), [svoc]);
  const words = useMemo(() => sentence.split(/\s+/), [sentence]);
  const canSpeak = ttsSupported();
  const hasSvoc = roles.size > 0;

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border-2 border-rose-200 p-3">
        {canSpeak ? (
          <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => speak(sentence, rate)}
              className="rounded-lg bg-orange-500 px-3 py-1.5 font-bold text-white hover:bg-orange-600"
            >
              ▶ 전체 듣기
            </button>
            {(['slow', 'normal'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  onRate(r);
                  speak(sentence, r);
                }}
                className={`rounded-lg px-3 py-1.5 font-semibold ${rate === r ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                {r === 'slow' ? '🐢 천천히' : '보통'}
              </button>
            ))}
            <button type="button" onClick={stopSpeaking} className="rounded-lg px-2 py-1.5 text-slate-400 hover:bg-slate-100" title="멈춤">
              ■
            </button>
            <span className="text-slate-400">· 어구를 누르거나 드래그해서 듣기</span>
          </div>
        ) : null}

        {/* 끊어읽기 어구 — 누르면 그 어구만 */}
        <div
          className="flex flex-wrap items-baseline gap-x-1 gap-y-2 text-[1.05rem] leading-relaxed"
          onMouseUp={(e) => canSpeak && speakSelectionIn(e.currentTarget, rate)}
        >
          {chunks.map((c, i) => (
            <span key={i} className="inline-flex items-baseline">
              {i > 0 ? <span className="mx-1 text-emerald-500">/</span> : null}
              <button
                type="button"
                onClick={() => {
                  const sel = window.getSelection();
                  if (sel && !sel.isCollapsed) return; // 드래그는 onMouseUp 이 처리
                  if (canSpeak) speak(c, rate);
                }}
                className="rounded px-0.5 text-left hover:bg-emerald-50 hover:text-emerald-800"
                style={{ userSelect: 'text' }}
              >
                {c}
              </button>
            </span>
          ))}
        </div>

        {hasSvoc ? (
          <div className="mt-3 border-t border-dashed border-slate-200 pt-3">
            <button type="button" onClick={onToggleSvoc} className="mb-2 text-xs font-semibold text-slate-500 hover:text-slate-800">
              {showSvoc ? '▾' : '▸'} 문장 성분 (S·V·O·C)
            </button>
            {showSvoc ? (
              <div className="flex flex-wrap gap-x-1 gap-y-3 pt-2 text-[0.95rem]">
                {words.map((w, i) => {
                  const r = roles.get(i);
                  const st = r ? ROLE_STYLE[r.role] : null;
                  return (
                    <span key={i} className={`relative rounded px-0.5 ${st?.cls ?? ''}`}>
                      {r?.start && st ? (
                        <span className="absolute -top-4 left-0 text-[11px] font-extrabold leading-none tracking-wide">{st.label}</span>
                      ) : null}
                      {w}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {korean ? <p className="mt-3 border-t border-slate-200 pt-3 text-[0.95rem] leading-relaxed text-slate-700">{korean}</p> : null}
      </div>

      {grammarPoints?.length ? (
        <section>
          <h4 className="mb-1.5 text-xs font-bold text-slate-500">문법 포인트</h4>
          <ul className="space-y-1.5">
            {grammarPoints.map((g, i) => (
              <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="font-semibold text-slate-900">{g.title}</span>
                {g.content ? <span className="ml-1.5 text-slate-600">{g.content}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {vocab.length ? (
        <section>
          <h4 className="mb-1.5 text-xs font-bold text-slate-500">핵심 단어</h4>
          <div className="flex flex-wrap gap-1.5">
            {vocab.map((v) => (
              <button
                key={v.word}
                type="button"
                onClick={() => canSpeak && speak(v.word, rate)}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-left text-sm hover:border-emerald-300 hover:bg-emerald-50"
                title="눌러서 발음 듣기"
              >
                <span className="font-semibold">{v.word}</span>
                {v.pos ? <span className="ml-1 text-[11px] text-slate-400">{v.pos}</span> : null}
                <span className="ml-1.5 text-slate-600">{v.meaning}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
