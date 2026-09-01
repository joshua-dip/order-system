'use client';

/**
 * 지문 분석지 — 분석기 데이터를 골라 판매용 분석지(문제편·해설편)로 굽는다.
 *
 * 화면 구성은 리체움 /admin/analysis-sheet 를 따른다(2026-07-29 실물을 만든 화면):
 * 왼쪽에서 지문을 고르고, 가운데 양식 패널에서 무엇을 실을지 켜고 끄면
 * 오른쪽 미리보기가 실제 PDF 와 같은 조판기로 다시 그려진다. 조합은 양식으로
 * 저장해 두고 불러온다. 스냅샷은 없다 — 다운로드마다 저장소를 다시 읽으므로
 * 「편집」에서 고친 내용이 다음 다운로드에 바로 반영된다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SHEET_OPTIONS,
  QUESTION_EDITION_OPTIONS,
  type SheetOptions,
} from '@/lib/analysis-sheet-html';

interface PassageItem {
  _id: string;
  source_key?: string;
  chapter?: string;
}
interface Preset { id: string; name: string; options: SheetOptions }

/* PDF API 의 상한과 같은 값 — 넘겨 보내 400 받는 대신 화면에서 먼저 막는다. */
const MAX_PASSAGES = 30;

/** 양식 패널 항목 — 라벨은 인쇄물에서 보이는 그대로(리체움과 동일 묶음). */
const GROUPS: { title: string; items: { key: keyof SheetOptions; label: string; hint?: string }[] }[] = [
  {
    title: '지문 표기',
    items: [
      { key: 'topicHighlight', label: '주제문 형광', hint: '노랑+배지' },
      { key: 'contextHighlight', label: '핵심 어휘 형광', hint: '연두' },
      { key: 'connHighlight', label: '연결어 형광', hint: '분홍' },
      { key: 'grammarUnderline', label: '어법 밑줄', hint: '빨강' },
      { key: 'brackets', label: '구문 괄호', hint: '[ ] 절 · ( ) 구' },
      { key: 'bracketLabels', label: '괄호 라벨', hint: '전치사구…' },
      { key: 'breaks', label: '끊어읽기 /' },
      { key: 'svoc', label: 'SVOC 성분', hint: 'S·V·Od·Cs' },
      { key: 'gloss', label: '단어 아래 뜻', hint: '직독직해' },
    ],
  },
  {
    title: '해설·부가',
    items: [
      { key: 'grammarCallout', label: '어법 설명 상자' },
      { key: 'topicLine', label: '지문 머리 요약', hint: '◎ 한 줄' },
      { key: 'headerPills', label: '헤더 배지' },
      { key: 'summaryTable', label: '종합분석 표' },
      { key: 'examChips', label: '변형문제 예상' },
      { key: 'tagSummary', label: '어법 유형 집계' },
      { key: 'practiceLines', label: '쓰기 괘선' },
    ],
  },
  {
    title: '단어장',
    items: [
      { key: 'vocab', label: '단어장 싣기' },
      { key: 'vocabSynAnt', label: '동의어·반의어' },
      { key: 'vocabCheckbox', label: '체크박스' },
    ],
  },
  {
    title: '앞뒤 페이지',
    items: [
      { key: 'cover', label: '표지' },
      { key: 'toc', label: '목차' },
      { key: 'guide', label: '보는 법 안내' },
      { key: 'colophon', label: '판권' },
    ],
  },
];

const QUESTION_FULL: SheetOptions = { ...DEFAULT_SHEET_OPTIONS, ...QUESTION_EDITION_OPTIONS };

function sameOptions(a: SheetOptions, b: SheetOptions): boolean {
  return (Object.keys(DEFAULT_SHEET_OPTIONS) as (keyof SheetOptions)[])
    .every((k) => a[k] === b[k]);
}

export default function AnalysisSheetPage() {
  const [textbooks, setTextbooks] = useState<{ name: string; count: number }[]>([]);
  const [textbook, setTextbook] = useState('');
  const [items, setItems] = useState<PassageItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [brand, setBrand] = useState('');
  const [options, setOptions] = useState<SheetOptions>(DEFAULT_SHEET_OPTIONS);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    /* 전체 교재(300+)가 아니라 분석이 실제로 채워진 교재만. */
    fetch('/api/admin/syntax-analyzer/analysis-sheet-textbooks', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setTextbooks(Array.isArray(d.textbooks) ? d.textbooks : []))
      .catch(() => setTextbooks([]));
    loadPresets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPresets = useCallback(() => {
    fetch('/api/admin/syntax-analyzer/analysis-sheet-presets', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (j.success) setPresets(j.presets); })
      .catch(() => {});
  }, []);

  const fetchProgress = useCallback((list: PassageItem[]) => {
    if (!list.length) { setProgress({}); return; }
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
    if (!textbook) { setItems([]); setProgress({}); setSelected(new Set()); return; }
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

  const pct = useCallback((id: string) => progress[id.toLowerCase()] ?? 0, [progress]);

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

  const orderedSelected = useMemo(
    () => items.filter((p) => selected.has(p._id)).map((p) => p._id),
    [items, selected],
  );

  /* 미리보기 대상 — 선택한 지문 앞 2편, 아무것도 안 골랐으면 분석 있는 앞 2편. */
  const previewIds = useMemo(() => {
    const base = orderedSelected.length
      ? orderedSelected
      : items.filter((p) => pct(p._id) > 0).map((p) => p._id);
    return base.slice(0, 2);
  }, [orderedSelected, items, pct]);

  const refreshPreview = useCallback(() => {
    if (!previewIds.length) { setPreviewHtml(''); return; }
    setBusy('미리보기 그리는 중…');
    fetch('/api/admin/syntax-analyzer/analysis-sheet-preview', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passageIds: previewIds, options }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.success) { setPreviewHtml(j.html); setMsg(`미리보기 ${j.shown}편 (실제 PDF 와 같은 조판)`); }
        else setMsg(String(j.message || '미리보기 실패'));
      })
      .catch(() => setMsg('미리보기 실패'))
      .finally(() => setBusy(''));
  }, [previewIds, options]);

  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(refreshPreview, 400);
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [refreshPreview]);

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

  const toggleOption = (k: keyof SheetOptions) =>
    setOptions((o) => ({ ...o, [k]: !o[k] } as SheetOptions));

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) { setMsg('양식 이름을 입력하세요.'); return; }
    const r = await fetch('/api/admin/syntax-analyzer/analysis-sheet-presets', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, options }),
    }).then((x) => x.json()).catch(() => null);
    if (r?.success) { setMsg(`양식 「${name}」 저장됨`); setPresetName(''); loadPresets(); }
    else setMsg('양식 저장 실패');
  };

  const removePreset = async (p: Preset) => {
    if (!confirm(`양식 「${p.name}」을 지울까요?`)) return;
    await fetch(`/api/admin/syntax-analyzer/analysis-sheet-presets?id=${p.id}`, {
      method: 'DELETE', credentials: 'include',
    });
    loadPresets();
  };

  /** 현재 양식이 어느 판인지 — 파일명·표지에 찍을 이름. */
  const editionLabel = sameOptions(options, DEFAULT_SHEET_OPTIONS)
    ? '해설편'
    : sameOptions(options, QUESTION_FULL) ? '문제편' : '분석지';

  const requestPdf = async (edition: string, opts?: SheetOptions) => {
    const res = await fetch('/api/admin/syntax-analyzer/analysis-sheet-pdf', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        passageIds: orderedSelected,
        title: title.trim() || undefined,
        brand: brand.trim() || undefined,
        edition,
        ...(opts ? { options: opts } : {}),
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(String(d.error || `다운로드 실패 (${res.status})`));
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const base = (title.trim() || textbook).replace(/[\\/:*?"<>|]+/g, '_');
    a.download = edition === '분석지' ? `${base} 분석지.pdf` : `${base} 분석지 · ${edition}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadCurrent = async () => {
    if (!orderedSelected.length) return;
    setBusy(`${editionLabel} 굽는 중… (지문 ${orderedSelected.length}개)`);
    try {
      await requestPdf(editionLabel, options);
      setMsg(`✓ ${editionLabel} — 지문 ${orderedSelected.length}개`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '다운로드 실패');
    } finally { setBusy(''); }
  };

  /* 7월 실물과 같은 묶음 — 문제편·해설편 기본 양식 두 벌을 한 번에. */
  const downloadPair = async () => {
    if (!orderedSelected.length) return;
    try {
      setBusy(`문제편 굽는 중… (지문 ${orderedSelected.length}개)`);
      await requestPdf('문제편');
      setBusy(`해설편 굽는 중… (지문 ${orderedSelected.length}개)`);
      await requestPdf('해설편');
      setMsg(`✓ 문제편 · 해설편 — 지문 ${orderedSelected.length}개`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '다운로드 실패');
    } finally { setBusy(''); }
  };

  const readyCount = items.filter((p) => pct(p._id) > 0).length;
  const overLimit = orderedSelected.length > MAX_PASSAGES;

  return (
    <div className="max-w-[1700px] mx-auto px-4 py-5">
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="mr-2">
          <h1 className="text-xl font-bold">지문 분석지</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            「편집」에서 고친 내용은 다음 미리보기·다운로드에 바로 반영됩니다
          </p>
        </div>
        <label className="block">
          <span className="text-xs text-slate-500 block mb-1">교재 (분석 있는 것만)</span>
          <select
            value={textbook}
            onChange={(e) => setTextbook(e.target.value)}
            className="bg-slate-950 border border-slate-600 rounded-md px-3 py-2 text-sm min-w-64"
          >
            <option value="">교재 선택…</option>
            {textbooks.map((t) => (
              <option key={t.name} value={t.name}>{`${t.name} (${t.count})`}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-slate-500 block mb-1">문서 제목 (비우면 교재명)</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-56 bg-slate-950 border border-slate-600 rounded-md px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500 block mb-1">표지 하단 표기 (선택)</span>
          <input
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="예: 학원 이름"
            className="w-36 bg-slate-950 border border-slate-600 rounded-md px-3 py-2 text-sm"
          />
        </label>
        <div className="flex gap-2 ml-auto items-center">
          {busy && <span className="text-xs text-sky-400">{busy}</span>}
          {!busy && msg && <span className="text-xs text-slate-400">{msg}</span>}
          <button
            type="button"
            onClick={() => void downloadPair()}
            disabled={!!busy || orderedSelected.length === 0 || overLimit}
            className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-semibold disabled:opacity-40"
            title="문제편·해설편 기본 양식 두 벌 (양식 패널과 무관)"
          >
            문제편+해설편 (2파일)
          </button>
          <button
            type="button"
            onClick={() => void downloadCurrent()}
            disabled={!!busy || orderedSelected.length === 0 || overLimit}
            className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-600 text-sm font-semibold disabled:opacity-40"
            title="양식 패널에서 켠 항목대로"
          >
            {`현재 양식으로 PDF (${orderedSelected.length})`}
          </button>
        </div>
      </div>
      {overLimit && (
        <p className="text-xs text-amber-400 mb-2">
          한 번에 {MAX_PASSAGES}개까지만 묶을 수 있습니다. 나눠서 받아 주세요.
        </p>
      )}

      <div className="flex gap-4 items-start">
        {/* 왼쪽: 지문 선택 — 교재를 고르기 전에는 칸 자체를 만들지 않는다.
           빈 360px 이 통째로 남아 화면 왼쪽이 휑해 보였다. */}
        {textbook && (
        <div className="w-[360px] shrink-0 space-y-2">
          {textbook && (
            <div className="text-xs text-slate-500 flex items-center gap-3 px-1">
              <span>지문 {items.length} · 분석 {readyCount}</span>
              <button type="button" onClick={() => fetchProgress(items)} className="text-sky-400 hover:text-sky-300">
                ↻ 진행률
              </button>
              <a
                href={`/admin/syntax-analyzer?textbook=${encodeURIComponent(textbook)}`}
                className="text-sky-400 hover:text-sky-300"
              >
                분석 홈에서 열기 →
              </a>
            </div>
          )}
          <div className="max-h-[calc(100vh-220px)] overflow-y-auto space-y-2 pr-1">
            {listLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin w-7 h-7 border-4 border-slate-600 border-t-white rounded-full" />
              </div>
            ) : (
              groups.map(([chapter, list]) => {
                const ready = list.filter((p) => pct(p._id) > 0);
                const allIn = ready.length > 0 && ready.every((p) => selected.has(p._id));
                return (
                  <div key={chapter} className="rounded-lg border border-slate-700/80 overflow-hidden">
                    <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-800/60 text-xs">
                      <input
                        type="checkbox"
                        checked={allIn}
                        disabled={ready.length === 0}
                        onChange={() => toggleGroup(list)}
                        className="accent-sky-500"
                      />
                      <span className="font-semibold truncate">{chapter}</span>
                      <span className="text-slate-500 shrink-0 ml-auto">{ready.length}/{list.length}</span>
                    </div>
                    <ul className="divide-y divide-slate-800">
                      {list.map((p) => {
                        const percent = pct(p._id);
                        const hasData = percent > 0;
                        return (
                          <li key={p._id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs">
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
                            <span className={`tabular-nums ${percent >= 100 ? 'text-emerald-400' : percent > 0 ? 'text-amber-400' : 'text-slate-600'}`}>
                              {percent}%
                            </span>
                            <a
                              href={`/admin/syntax-analyzer/analyze?passageId=${p._id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky-400 hover:text-sky-300 shrink-0"
                            >
                              ✏️
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
        </div>
        )}

        {/* 가운데: 양식 */}
        <div className="w-[260px] shrink-0 space-y-2">
          <div className="rounded-lg border border-slate-700/80 p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-slate-300">판 기본값</span>
              <span className="text-[10px] text-slate-500">현재: {editionLabel}</span>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setOptions(DEFAULT_SHEET_OPTIONS)}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${sameOptions(options, DEFAULT_SHEET_OPTIONS) ? 'bg-sky-700' : 'bg-slate-800 hover:bg-slate-700'}`}
              >
                해설편
              </button>
              <button
                type="button"
                onClick={() => setOptions(QUESTION_FULL)}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold ${sameOptions(options, QUESTION_FULL) ? 'bg-sky-700' : 'bg-slate-800 hover:bg-slate-700'}`}
              >
                문제편
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-700/80 p-2.5">
            <span className="text-xs font-bold text-slate-300 block mb-1.5">양식 저장</span>
            <div className="flex gap-1.5 mb-1.5">
              <input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="양식 이름"
                className="flex-1 min-w-0 bg-slate-950 border border-slate-600 rounded-md px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => void savePreset()}
                className="rounded-md bg-slate-700 hover:bg-slate-600 px-2.5 py-1 text-xs font-semibold shrink-0"
              >
                저장
              </button>
            </div>
            {presets.length === 0 ? (
              <p className="text-[10px] text-slate-500">저장한 양식이 없습니다.</p>
            ) : (
              <div className="space-y-1">
                {presets.map((p) => (
                  <div key={p.id} className="flex items-center gap-1.5 rounded bg-slate-800/60 px-2 py-1">
                    <button
                      type="button"
                      onClick={() => { setOptions({ ...DEFAULT_SHEET_OPTIONS, ...p.options }); setMsg(`양식 「${p.name}」 적용`); }}
                      className="flex-1 truncate text-left text-xs hover:text-sky-300"
                    >
                      {p.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removePreset(p)}
                      className="text-[10px] text-slate-500 hover:text-red-400"
                    >
                      삭제
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-700/80 p-2.5">
            <span className="text-xs font-bold text-slate-300 block mb-1.5">해석 위치</span>
            <div className="flex gap-1">
              {([['inline', '문장 아래'], ['bottom', '지문 끝'], ['none', '없음']] as const).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setOptions((o) => ({ ...o, koPlacement: v }))}
                  className={`flex-1 rounded-md px-1.5 py-1 text-[11px] font-semibold ${options.koPlacement === v ? 'bg-sky-700' : 'bg-slate-800 hover:bg-slate-700'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {GROUPS.map((g) => (
            <div key={g.title} className="rounded-lg border border-slate-700/80 p-2.5">
              <span className="text-xs font-bold text-slate-300 block mb-1">{g.title}</span>
              <div className="space-y-0.5">
                {g.items.map((it) => (
                  <label key={String(it.key)} className="flex items-center gap-2 rounded px-1 py-0.5 cursor-pointer hover:bg-slate-800/50">
                    <input
                      type="checkbox"
                      checked={!!options[it.key]}
                      onChange={() => toggleOption(it.key)}
                      className="accent-sky-500"
                    />
                    <span className="text-xs">{it.label}</span>
                    {it.hint && <span className="text-[10px] text-slate-500">{it.hint}</span>}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 오른쪽: 미리보기 */}
        <div className="min-w-0 flex-1 rounded-lg border border-slate-700/80 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-700/80 px-3 py-2">
            <span className="text-sm font-bold">미리보기</span>
            <span className="text-[11px] text-slate-500">
              {orderedSelected.length ? '선택한 지문 앞 2편' : '분석 있는 앞 2편'} · 실제 PDF 와 같은 조판
            </span>
            <button
              type="button"
              onClick={refreshPreview}
              className="ml-auto rounded-md bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-xs font-semibold"
            >
              다시 그리기
            </button>
          </div>
          <div className="h-[calc(100vh-220px)] bg-slate-900">
            {previewHtml ? (
              <iframe title="분석지 미리보기" srcDoc={previewHtml} className="h-full w-full bg-white" />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                {busy || '교재를 고르면 미리보기가 나옵니다'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
