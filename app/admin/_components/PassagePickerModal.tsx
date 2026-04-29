'use client';

/**
 * 관리자 페이지 공용 — 지문 선택 모달.
 * essay-generator / block-workbook 등에서 동일한 흐름으로 지문을 고를 때 사용.
 *
 * - localStorage 키는 인스턴스마다 분리할 수 있도록 `lastTextbookKey` props 로 받음
 *   (기본값: 'admin_passage_picker_last_textbook'). essay-generator 와 block-workbook
 *   이 각자 마지막 교재를 기억하도록 호출부에서 넘긴다.
 */

import { useEffect, useState } from 'react';

export interface PassageItem {
  _id: string;
  textbook: string;
  chapter: string;
  number: string;
  source_key?: string;
  content?: { original?: string };
}

export interface PassagePickerModalProps {
  onSelect: (p: PassageItem) => void;
  onClose: () => void;
  /** localStorage 키. 페이지마다 마지막 교재를 따로 기억하고 싶으면 분리. */
  lastTextbookKey?: string;
}

const DEFAULT_LAST_TB_KEY = 'admin_passage_picker_last_textbook';

export default function PassagePickerModal({
  onSelect,
  onClose,
  lastTextbookKey = DEFAULT_LAST_TB_KEY,
}: PassagePickerModalProps) {
  const [textbooks, setTextbooks] = useState<string[]>([]);
  /** SSR·첫 클라이언트 페인트와 동일해야 hydration 오류가 나지 않음 — localStorage는 mount 후 복원 */
  const [selectedTb, setSelectedTb] = useState('');
  const [passages, setPassages] = useState<PassageItem[]>([]);
  const [examCounts, setExamCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [tbLoading, setTbLoading] = useState(true);

  useEffect(() => {
    try {
      const v = localStorage.getItem(lastTextbookKey);
      if (v) setSelectedTb(v);
    } catch {
      /* ignore */
    }
  }, [lastTextbookKey]);

  useEffect(() => {
    fetch('/api/admin/passages/textbooks', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setTextbooks(d.textbooks ?? []))
      .finally(() => setTbLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedTb) { setPassages([]); setExamCounts({}); return; }
    localStorage.setItem(lastTextbookKey, selectedTb);
    setLoading(true);
    Promise.all([
      fetch(`/api/admin/passages?textbook=${encodeURIComponent(selectedTb)}&limit=500`, { credentials: 'include' }).then(r => r.json()),
      fetch(`/api/admin/essay-generator/passage-exam-counts?textbook=${encodeURIComponent(selectedTb)}`, { credentials: 'include' }).then(r => r.json()).catch(() => ({ counts: {} })),
    ]).then(([pd, cd]) => {
      setPassages(pd.items ?? []);
      setExamCounts(cd.counts ?? {});
    }).finally(() => setLoading(false));
  }, [selectedTb, lastTextbookKey]);

  const filtered = passages.filter(p => {
    if (!q.trim()) return true;
    const lq = q.toLowerCase();
    return (
      (p.source_key ?? '').toLowerCase().includes(lq) ||
      p.chapter.toLowerCase().includes(lq) ||
      p.number.toLowerCase().includes(lq) ||
      (p.content?.original ?? '').toLowerCase().includes(lq)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-2xl w-[720px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <span className="font-bold text-white">지문 불러오기</span>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-4 flex gap-3 border-b border-slate-700">
          {/* 교재 선택 */}
          <select
            value={selectedTb}
            onChange={e => { setSelectedTb(e.target.value); setQ(''); }}
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-slate-400"
          >
            <option value="">{tbLoading ? '교재 불러오는 중...' : '교재 선택'}</option>
            {textbooks.map(tb => (
              <option key={tb} value={tb}>{tb}</option>
            ))}
          </select>

          {/* 검색 */}
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="지문 검색 (소스키, 챕터, 내용)"
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {!selectedTb && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">교재를 먼저 선택하세요</div>
          )}
          {selectedTb && loading && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">불러오는 중...</div>
          )}
          {selectedTb && !loading && filtered.length === 0 && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">지문이 없습니다</div>
          )}
          {filtered.map(p => {
            const sk = p.source_key ?? `${p.chapter} ${p.number}`;
            const cnt = examCounts[sk] ?? 0;
            return (
              <button
                key={p._id}
                type="button"
                onClick={() => onSelect(p)}
                className="w-full text-left px-5 py-3 border-b border-slate-700/60 hover:bg-slate-700/50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-mono bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                    {p.chapter} · {p.number}
                  </span>
                  {p.source_key && (
                    <span className="text-xs text-blue-400">{p.source_key}</span>
                  )}
                  {cnt > 0 && (
                    <span className="text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded-full">
                      문제 {cnt}개
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-300 line-clamp-2 leading-relaxed">
                  {p.content?.original ?? '(지문 없음)'}
                </p>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-slate-700 text-xs text-slate-500">
          {selectedTb && !loading && `${filtered.length}개`}
        </div>
      </div>
    </div>
  );
}
