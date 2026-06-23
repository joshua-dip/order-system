'use client';

import type { WordItem, WordsetPrintMode } from '@/lib/word-types';

export interface WordSetDoc {
  title: string;
  folder?: string;
  textbook?: string;
  words: WordItem[];
}

/** 단어장/단어시험지 렌더 (흰 종이) — 편집 미리보기·인쇄 공용. */
export default function WordSetView({ set, mode = '전체', showAnswers = true }: { set: WordSetDoc; mode?: WordsetPrintMode; showAnswers?: boolean }) {
  const words = set.words || [];
  return (
    <div className="material-paper text-[#1a1a1a] leading-relaxed">
      <header className="mb-4 pb-3 border-b-2 border-[#1a1a1a]">
        <div className="flex items-center gap-2 mb-1 text-[12px] text-[#555]">
          <span className="px-2 py-0.5 rounded bg-[#eee] border border-[#ccc]">{mode === '전체' ? '단어장' : `단어 시험 · ${mode}`}</span>
          {set.folder && <span>{set.folder}</span>}
          {set.textbook && <span>· {set.textbook}</span>}
          <span className="ml-auto">총 {words.length}단어</span>
        </div>
        <h1 className="text-xl font-bold">{set.title || '제목 없음'}</h1>
        {mode !== '전체' && (
          <p className="text-[12px] text-[#555] mt-1">이름 __________  점수 ______ / {words.length}</p>
        )}
      </header>

      <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
        {words.map((it, i) => {
          const answer = mode === '영→한 시험' ? it.m : mode === '한→영 시험' ? it.w : '';
          return (
            <li key={i} className="flex gap-2 text-[14px] py-0.5 border-b border-dotted border-[#ddd]">
              <span className="text-[#888] w-6 shrink-0 text-right">{i + 1}.</span>
              {mode === '전체' && (
                <div className="min-w-0">
                  <span className="font-medium">{it.w}</span>
                  <span className="text-[#555] ml-2">{it.m}</span>
                  {it.ex && <div className="text-[12px] text-[#888] italic">{it.ex}</div>}
                </div>
              )}
              {mode !== '전체' && (
                <div className="flex-1 flex justify-between gap-3 min-w-0">
                  <span className={`shrink-0 ${mode === '영→한 시험' ? 'font-medium' : 'text-[#444]'}`}>{mode === '영→한 시험' ? it.w : it.m}</span>
                  <span className="flex-1 border-b border-[#bbb] text-right text-[#1565c0]">{showAnswers ? answer : ' '}</span>
                </div>
              )}
            </li>
          );
        })}
        {words.length === 0 && <li className="text-[#999] text-sm">단어가 없습니다.</li>}
      </ol>
    </div>
  );
}
