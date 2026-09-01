'use client';

/**
 * 지문 분석지 — 분석기에서 채운 데이터를 골라 묶어 A4 PDF 로 내린다.
 *
 * 스냅샷을 만들지 않는다. 다운로드마다 passage_analyses 를 다시 읽으므로,
 * 각 행의 「편집」으로 분석 작업대에 들어가 고치면 다음 다운로드에 바로 반영된다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

interface PassageItem {
  _id: string;
  source_key?: string;
  chapter?: string;
  number?: string | number;
}

/* PDF API 의 상한과 같은 값 — 넘겨 보내 400 받는 대신 화면에서 먼저 막는다. */
const MAX_PASSAGES = 30;

export default function AnalysisSheetPage() {
  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [textbook, setTextbook] = useState('');
  const [items, setItems] = useState<PassageItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/admin/passages/textbooks', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setTextbooks(Array.isArray(d.textbooks) ? d.textbooks : []))
      .catch(() => setTextbooks([]));
  }, []);

  const fetchProgress = useCallback((list: PassageItem[]) => {
    if (!list.length) {
      setProgress({});
      return;
    }
    fetch('/api/admin/passage-analyzer/list-progress', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passageIds: list.map((p) => p._id) }),
    })
      .then((r) => r.json())
      .then((d) => setProgress(d.progress && typeof d.progress === 'object' ? d.progress : {}))
      .catch(() => setProgress({}));
  }, []);

  useEffect(() => {
    if (!textbook) {
      setItems([]);
      setProgress({});
      setSelected(new Set());
      return;
    }
    setListLoading(true);
    setSelected(new Set());
    const params = new URLSearchParams({ textbook, page: '1', limit: '500' });
    fetch(`/api/admin/passages?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const list: PassageItem[] = Array.isArray(d.items) ? d.items : [];
        setItems(list);
        fetchProgress(list);
      })
      .catch(() => setItems([]))
      .finally(() => setListLoading(false));
  }, [textbook, fetchProgress]);

  const pct = useCallback(
    (id: string) => progress[id.toLowerCase()] ?? 0,
    [progress],
  );

  /* 챕터 묶음 — Lesson 단위 주문이 많아 챕터째 고르는 동선이 실제 사용 흐름이다. */
  const groups = useMemo(() => {
    const map = new Map<string, PassageItem[]>();
    for (const p of items) {
      const key = String(p.chapter ?? '').trim() || '(챕터 없음)';
      const arr = map.get(key);
      if (arr) arr.push(p);
      else map.set(key, [p]);
    }
    return [...map.entries()];
  }, [items]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleGroup = (list: PassageItem[]) => {
    const ready = list.filter((p) => pct(p._id) > 0).map((p) => p._id);
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = ready.length > 0 && ready.every((id) => next.has(id));
      for (const id of ready) {
        if (allIn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const download = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setMsg('');
    try {
      /* 화면 나열 순서대로 보낸다 — 지면 차례가 곧 목록 차례. */
      const ordered = items.filter((p) => selected.has(p._id)).map((p) => p._id);
      const res = await fetch('/api/admin/syntax-analyzer/analysis-sheet-pdf', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passageIds: ordered, title: title.trim() || undefined }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setMsg(String(d.error || `다운로드 실패 (${res.status})`));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `분석지_${(title.trim() || textbook).replace(/[\\/:*?"<>|]+/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg(`✓ ${ordered.length}개 지문을 내려받았습니다.`);
    } finally {
      setBusy(false);
    }
  };

  const readyCount = items.filter((p) => pct(p._id) > 0).length;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-xl font-bold">지문 분석지</h1>
        <p className="text-sm text-slate-400 mt-1">
          분석기에 저장된 데이터를 골라 A4 분석지 PDF 로 내립니다. 다운로드마다 저장소를
          다시 읽으므로 <span className="text-slate-300">「편집」에서 고친 내용이 다음 다운로드에 바로 반영</span>됩니다.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs text-slate-500 block mb-1">교재</span>
          <select
            value={textbook}
            onChange={(e) => setTextbook(e.target.value)}
            className="bg-slate-950 border border-slate-600 rounded-md px-3 py-2 text-sm min-w-64"
          >
            <option value="">교재 선택…</option>
            {textbooks.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="block flex-1 min-w-56">
          <span className="text-xs text-slate-500 block mb-1">문서 제목 (비우면 「교재명 지문 분석지」)</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={textbook ? `${textbook} 지문 분석지` : ''}
            className="w-full bg-slate-950 border border-slate-600 rounded-md px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy || selected.size === 0 || selected.size > MAX_PASSAGES}
          className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-600 text-sm font-semibold disabled:opacity-40"
        >
          {busy ? 'PDF 생성 중…' : `PDF 다운로드 (${selected.size})`}
        </button>
      </div>

      {selected.size > MAX_PASSAGES && (
        <p className="text-xs text-amber-400">
          한 번에 {MAX_PASSAGES}개까지만 묶을 수 있습니다. 나눠서 받아 주세요.
        </p>
      )}
      {msg && <p className="text-sm text-slate-300">{msg}</p>}

      {textbook && (
        <div className="text-xs text-slate-500 flex items-center gap-3">
          <span>지문 {items.length}개 · 분석 있음 {readyCount}개</span>
          <button
            type="button"
            onClick={() => fetchProgress(items)}
            className="text-sky-400 hover:text-sky-300"
          >
            ↻ 진행률 새로고침
          </button>
        </div>
      )}

      {listLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-slate-600 border-t-white rounded-full" />
        </div>
      ) : (
        groups.map(([chapter, list]) => {
          const ready = list.filter((p) => pct(p._id) > 0);
          const allIn = ready.length > 0 && ready.every((p) => selected.has(p._id));
          return (
            <div key={chapter} className="rounded-lg border border-slate-700/80 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/60 text-sm">
                <input
                  type="checkbox"
                  checked={allIn}
                  disabled={ready.length === 0}
                  onChange={() => toggleGroup(list)}
                  className="accent-sky-500"
                />
                <span className="font-semibold">{chapter}</span>
                <span className="text-xs text-slate-500">
                  {ready.length}/{list.length}개 분석 있음
                </span>
              </div>
              <ul className="divide-y divide-slate-800">
                {list.map((p) => {
                  const percent = pct(p._id);
                  const hasData = percent > 0;
                  return (
                    <li key={p._id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.has(p._id)}
                        disabled={!hasData}
                        onChange={() => toggle(p._id)}
                        className="accent-sky-500"
                      />
                      <span className={`flex-1 min-w-0 truncate ${hasData ? '' : 'text-slate-500'}`}>
                        {p.source_key || p._id}
                      </span>
                      <span
                        className={`text-xs tabular-nums ${
                          percent >= 100
                            ? 'text-emerald-400'
                            : percent > 0
                              ? 'text-amber-400'
                              : 'text-slate-600'
                        }`}
                      >
                        {percent}%
                      </span>
                      <a
                        href={`/admin/syntax-analyzer/analyze?passageId=${p._id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-sky-400 hover:text-sky-300 shrink-0"
                      >
                        ✏️ 편집
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
