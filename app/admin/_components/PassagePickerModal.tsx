'use client';

/**
 * 관리자 페이지 공용 — 지문 선택 모달.
 * essay-generator / block-workbook 등에서 동일한 흐름으로 지문을 고를 때 사용.
 *
 * - localStorage 키는 인스턴스마다 분리할 수 있도록 `lastTextbookKey` props 로 받음
 *   (기본값: 'admin_passage_picker_last_textbook'). essay-generator 와 block-workbook
 *   이 각자 마지막 교재를 기억하도록 호출부에서 넘긴다.
 */

import { useEffect, useRef, useState } from 'react';

export interface PassageItem {
  _id: string;
  textbook: string;
  chapter: string;
  number: string;
  source_key?: string;
  content?: {
    original?: string;
    sentences_en?: string[];
    sentences_ko?: string[];
  };
}

export interface PassagePickerModalProps {
  onSelect: (p: PassageItem) => void;
  onClose: () => void;
  /** localStorage 키. 페이지마다 마지막 교재를 따로 기억하고 싶으면 분리. */
  lastTextbookKey?: string;
  /**
   * 카운트 API URL. `?textbook=` 가 자동으로 붙는다.
   * 기본은 서술형 출제기 카운트(`/api/admin/essay-generator/passage-exam-counts`).
   */
  countsApi?: string;
  /** 카운트 뱃지 라벨. 기본: "문제 N개" → 호출부에서 "워크북 N개" 등으로 교체 가능. */
  countLabel?: (n: number) => string;
  /** true 면 카운트가 0인 지문은 목록에서 숨김. */
  hideZeroCount?: boolean;
}

const DEFAULT_LAST_TB_KEY = 'admin_passage_picker_last_textbook';
const DEFAULT_COUNTS_API = '/api/admin/essay-generator/passage-exam-counts';
const DEFAULT_COUNT_LABEL = (n: number) => `문제 ${n}개`;

export default function PassagePickerModal({
  onSelect,
  onClose,
  lastTextbookKey = DEFAULT_LAST_TB_KEY,
  countsApi = DEFAULT_COUNTS_API,
  countLabel = DEFAULT_COUNT_LABEL,
  hideZeroCount = false,
}: PassagePickerModalProps) {
  const [textbooks, setTextbooks] = useState<string[]>([]);
  /** SSR·첫 클라이언트 페인트와 동일해야 hydration 오류가 나지 않음 — localStorage는 mount 후 복원 */
  const [selectedTb, setSelectedTb] = useState('');
  const [passages, setPassages] = useState<PassageItem[]>([]);
  const [examCounts, setExamCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [tbLoading, setTbLoading] = useState(true);
  /** 마지막에 선택했던 지문 _id (지문 목록 내에서 자동 스크롤·강조) */
  const [lastPassageId, setLastPassageId] = useState<string>('');
  const passageRowRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  /** 첫 로드 후 단 한 번만 자동 스크롤. 검색 입력 등으로 다시 트리거되지 않도록. */
  const didInitialScrollRef = useRef(false);
  const lastPassageStorageKey = `${lastTextbookKey}_passage`;

  useEffect(() => {
    try {
      const v = localStorage.getItem(lastTextbookKey);
      if (v) setSelectedTb(v);
      const lp = localStorage.getItem(lastPassageStorageKey);
      if (lp) setLastPassageId(lp);
    } catch {
      /* ignore */
    }
  }, [lastTextbookKey, lastPassageStorageKey]);

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
      fetch(`${countsApi}?textbook=${encodeURIComponent(selectedTb)}`, { credentials: 'include' }).then(r => r.json()).catch(() => ({ counts: {} })),
    ]).then(([pd, cd]) => {
      setPassages(pd.items ?? []);
      setExamCounts(cd.counts ?? {});
    }).finally(() => setLoading(false));
  }, [selectedTb, lastTextbookKey, countsApi]);

  /** passages 가 새로 도착하면, 마지막 선택 지문이 있을 때 해당 행을 스크롤 컨테이너 가운데로.
   *  scrollIntoView 는 모달 layout 직후 가끔 어긋나기에 컨테이너 scrollTop 을 직접 계산. */
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    if (!lastPassageId || loading || passages.length === 0) return;
    const cont = scrollContainerRef.current;
    const el = passageRowRefs.current.get(lastPassageId);
    if (!cont || !el) return;
    const tick = () => {
      const containerRect = cont.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const offsetWithinContainer = elRect.top - containerRect.top + cont.scrollTop;
      const target = offsetWithinContainer - cont.clientHeight / 2 + el.clientHeight / 2;
      cont.scrollTop = Math.max(0, target);
      didInitialScrollRef.current = true;
    };
    // layout 안정화: 두 번의 raf 후 실행 (모달 mount + reflow 보장)
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(tick);
      // cleanup 핸들 보관용
      (cont as unknown as { _bwRaf?: number })._bwRaf = raf2;
    });
    return () => {
      cancelAnimationFrame(raf1);
      const raf2 = (cont as unknown as { _bwRaf?: number })._bwRaf;
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [passages, loading, lastPassageId]);

  const handleSelect = (p: PassageItem) => {
    try {
      localStorage.setItem(lastPassageStorageKey, p._id);
    } catch {
      /* ignore */
    }
    onSelect(p);
  };

  const filtered = passages.filter(p => {
    if (hideZeroCount) {
      const sk = p.source_key ?? `${p.chapter} ${p.number}`;
      if (!(examCounts[sk] > 0)) return false;
    }
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

        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto scrollbar-thin">
          {!selectedTb && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">교재를 먼저 선택하세요</div>
          )}
          {selectedTb && loading && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">불러오는 중...</div>
          )}
          {selectedTb && !loading && filtered.length === 0 && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
              {hideZeroCount && passages.length > 0
                ? '저장된 항목이 있는 지문이 없습니다'
                : '지문이 없습니다'}
            </div>
          )}
          {filtered.map(p => {
            const sk = p.source_key ?? `${p.chapter} ${p.number}`;
            const cnt = examCounts[sk] ?? 0;
            const isLast = p._id === lastPassageId;
            return (
              <button
                key={p._id}
                ref={el => { passageRowRefs.current.set(p._id, el); }}
                type="button"
                onClick={() => handleSelect(p)}
                className={`w-full text-left px-5 py-3 border-b border-slate-700/60 hover:bg-slate-700/50 transition-colors ${
                  isLast ? 'bg-emerald-900/30 border-l-4 border-l-emerald-400' : ''
                }`}
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
                      {countLabel(cnt)}
                    </span>
                  )}
                  {isLast && (
                    <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded-full">
                      최근
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
