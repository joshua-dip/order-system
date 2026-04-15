'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isEbsTextbook } from '@/lib/textbookSort';

type MetaItem = { id: string; chapter: string; number: string; source_key: string };

type Props = {
  disabled?: boolean;
  onApply: (payload: { paragraph: string; textbook: string; source: string }) => void;
  currentParagraph: string;
};

export default function VariantSourceLoader({ disabled, onApply, currentParagraph }: Props) {
  const [open, setOpen] = useState(false);
  const [mockKeys, setMockKeys] = useState<string[]>([]);
  const [tbData, setTbData] = useState<Record<string, unknown> | null>(null);
  const [kind, setKind] = useState<'ebs' | 'mock'>('ebs');
  const [textbook, setTextbook] = useState('');
  const [metaItems, setMetaItems] = useState<MetaItem[]>([]);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [textLoading, setTextLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    import('@/app/data/mock-exams.json')
      .then((mod: unknown) => {
        const m = mod as { default?: Record<string, string[]> } & Record<string, string[]>;
        const d = m.default ?? m;
        const list: string[] = [];
        for (const arr of Object.values(d)) {
          if (Array.isArray(arr)) list.push(...arr);
        }
        setMockKeys(list);
      })
      .catch(() => setMockKeys([]));
  }, []);

  useEffect(() => {
    fetch('/api/textbooks')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setTbData(j && typeof j === 'object' ? j : null))
      .catch(() => setTbData(null));
  }, []);

  const ebsTextbooks = useMemo(() => {
    if (!tbData) return [] as string[];
    return Object.keys(tbData).filter((k) => isEbsTextbook(k));
  }, [tbData]);

  const textbookOptions = useMemo(() => {
    if (kind === 'ebs') return [...ebsTextbooks].sort((a, b) => a.localeCompare(b, 'ko'));
    return [...mockKeys].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [kind, ebsTextbooks, mockKeys]);

  useEffect(() => {
    if (!open) return;
    const first = textbookOptions[0] ?? '';
    setTextbook((prev) => (prev && textbookOptions.includes(prev) ? prev : first));
    setSearch('');
  }, [open, kind, textbookOptions]);

  const loadMeta = useCallback(async (tb: string) => {
    if (!tb.trim()) {
      setMetaItems([]);
      return;
    }
    setMetaLoading(true);
    setMetaError(null);
    setSelectedId('');
    try {
      const res = await fetch(
        `/api/my/member-variant/passages/meta?textbook=${encodeURIComponent(tb)}`,
        { credentials: 'include' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMetaError(data?.error || '목록을 불러오지 못했습니다.');
        setMetaItems([]);
        return;
      }
      const items = Array.isArray(data.items) ? data.items : [];
      setMetaItems(
        items.map((it: Record<string, unknown>) => ({
          id: String(it.id ?? ''),
          chapter: String(it.chapter ?? ''),
          number: String(it.number ?? ''),
          source_key: String(it.source_key ?? ''),
        })),
      );
    } catch {
      setMetaError('목록 요청 중 오류가 발생했습니다.');
      setMetaItems([]);
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !textbook) return;
    loadMeta(textbook);
  }, [open, textbook, loadMeta]);

  const labelForMeta = (it: MetaItem) => {
    if (it.source_key.trim()) return it.source_key;
    return [it.chapter, it.number].filter(Boolean).join(' ').trim() || it.id;
  };

  const filteredMeta = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return metaItems;
    return metaItems.filter((it) => labelForMeta(it).toLowerCase().includes(q));
  }, [metaItems, search]);

  const handleApplyText = async () => {
    if (!selectedId) return;
    setTextLoading(true);
    setMetaError(null);
    try {
      const res = await fetch(
        `/api/my/member-variant/passages/text?passage_id=${encodeURIComponent(selectedId)}`,
        { credentials: 'include' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMetaError(data?.error || '지문을 불러오지 못했습니다.');
        return;
      }
      const paragraph = typeof data.paragraph === 'string' ? data.paragraph : '';
      const tb = typeof data.textbook === 'string' ? data.textbook : textbook;
      const source = typeof data.source === 'string' ? data.source : '';
      if (!paragraph.trim()) {
        setMetaError('불러온 지문이 비어 있습니다.');
        return;
      }
      if (currentParagraph.trim().length >= 20) {
        const ok = window.confirm('이미 입력된 지문이 있습니다. 불러온 지문으로 덮어쓸까요?');
        if (!ok) return;
      }
      onApply({ paragraph, textbook: tb, source });
      setOpen(false);
    } catch {
      setMetaError('지문 요청 중 오류가 발생했습니다.');
    } finally {
      setTextLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white px-4 py-2 text-xs font-bold text-violet-900 shadow-sm transition hover:border-violet-300 hover:shadow disabled:opacity-50"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        소스 불러오기
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
          onClick={() => !textLoading && setOpen(false)}
        >
          <div
            className="max-h-[92vh] w-full max-w-lg overflow-hidden rounded-t-[1.25rem] border border-slate-200/80 bg-white shadow-2xl sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4 text-white">
              <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/30 sm:hidden" aria-hidden />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold tracking-tight">소스 불러오기</h3>
                  <p className="mt-1 text-xs text-violet-100/95">EBS · 모의고사에 등록된 지문만 가져올 수 있어요.</p>
                </div>
                <button
                  type="button"
                  disabled={textLoading}
                  onClick={() => setOpen(false)}
                  className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25"
                >
                  닫기
                </button>
              </div>
            </div>

            <div className="max-h-[calc(92vh-7rem)] space-y-4 overflow-y-auto p-5">
              <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setKind('ebs')}
                  className={`rounded-xl py-2.5 text-sm font-bold transition ${
                    kind === 'ebs' ? 'bg-white text-violet-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  EBS
                </button>
                <button
                  type="button"
                  onClick={() => setKind('mock')}
                  className={`rounded-xl py-2.5 text-sm font-bold transition ${
                    kind === 'mock' ? 'bg-white text-violet-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  모의고사
                </button>
              </div>

              <label className="block">
                <span className="text-xs font-bold text-slate-600">교재</span>
                <select
                  value={textbook}
                  onChange={(e) => setTextbook(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100"
                >
                  {textbookOptions.length === 0 ? (
                    <option value="">등록된 교재가 없습니다</option>
                  ) : (
                    textbookOptions.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))
                  )}
                </select>
              </label>

              <div>
                <label className="block">
                  <span className="text-xs font-bold text-slate-600">지문 찾기 (선택)</span>
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="번호·단원 등으로 검색"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                  />
                </label>
                <label className="mt-3 block">
                  <span className="text-xs font-bold text-slate-600">지문 선택</span>
                  <select
                    value={selectedId}
                    onChange={(e) => setSelectedId(e.target.value)}
                    disabled={metaLoading || filteredMeta.length === 0}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-100"
                  >
                    <option value="">
                      {metaLoading ? '불러오는 중…' : filteredMeta.length ? '지문을 선택하세요' : '등록된 지문 없음'}
                    </option>
                    {filteredMeta.map((it) => (
                      <option key={it.id} value={it.id}>
                        {labelForMeta(it)}
                      </option>
                    ))}
                  </select>
                </label>
                {!metaLoading && metaItems.length > 0 && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    {filteredMeta.length}/{metaItems.length}건 표시
                  </p>
                )}
              </div>

              {metaError && (
                <p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">{metaError}</p>
              )}

              <button
                type="button"
                disabled={!selectedId || textLoading || disabled}
                onClick={() => void handleApplyText()}
                className="w-full rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-500/25 transition hover:brightness-105 disabled:opacity-45"
              >
                {textLoading ? '불러오는 중…' : '이 지문으로 채우기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
