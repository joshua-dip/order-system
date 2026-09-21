'use client';

/**
 * 워크북키트 — 빈칸·낱말배열·어법(G/H) PDF 제작.
 * 교재/지문 다중 선택 또는 BW 주문번호로 불러온 뒤 유형 체크 → 미리보기 → PDF/ZIP.
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import PassagePickerModal, { type PassageItem } from '../_components/PassagePickerModal';
import {
  BLANK_KINDS,
  KIT_TYPE_LABEL,
  type KitMaterialType,
} from '@/lib/workbook-kit/types';

type GenEntry = {
  type: KitMaterialType;
  fileName: string;
  title: string;
  questionCount: number;
  warning: string | null;
  html: string | null;
};

const ALL_TYPES: KitMaterialType[] = [
  ...BLANK_KINDS.map((k) => `blank_${k}` as KitMaterialType),
  'word_arrange',
  'grammar_either_or',
  'grammar_correction',
];

function downloadBlob(buf: ArrayBuffer, fileName: string, mime: string) {
  const blob = new Blob([buf], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export default function WorkbookKitPage() {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selected, setSelected] = useState<PassageItem[]>([]);
  const [types, setTypes] = useState<KitMaterialType[]>([
    'blank_keyword',
    'blank_prep',
    'word_arrange',
  ]);
  const [includeTranslation, setIncludeTranslation] = useState(true);
  const [orderNumber, setOrderNumber] = useState('BW-20260921-001');
  const [orderMsg, setOrderMsg] = useState('');
  const [busy, setBusy] = useState<'gen' | 'pdf' | 'zip' | 'order' | null>(null);
  const [entries, setEntries] = useState<GenEntry[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [error, setError] = useState('');

  const textbook = selected[0]?.textbook ?? '';

  const toggleType = (t: KitMaterialType) => {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  };

  const addPassage = useCallback((p: PassageItem) => {
    setSelected((prev) => {
      if (prev.some((x) => x._id === p._id)) return prev;
      if (prev.length && prev[0].textbook !== p.textbook) {
        if (!confirm(`교재가 다릅니다 (${prev[0].textbook} → ${p.textbook}). 선택 지문을 교체할까요?`)) {
          return prev;
        }
        return [p];
      }
      return [...prev, p];
    });
    setPickerOpen(false);
  }, []);

  const removePassage = (id: string) => {
    setSelected((prev) => prev.filter((p) => p._id !== id));
  };

  const loadOrder = async () => {
    setBusy('order');
    setError('');
    setOrderMsg('');
    try {
      const r = await fetch(
        `/api/admin/workbook-kit/order?orderNumber=${encodeURIComponent(orderNumber.trim())}`,
        { credentials: 'include' },
      );
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || '주문 조회 실패');
        return;
      }
      const ps = (d.passages ?? []) as PassageItem[];
      setSelected(
        ps.map((p) => ({
          _id: p._id,
          textbook: p.textbook,
          chapter: p.chapter,
          number: p.number,
          source_key: p.source_key,
        })),
      );
      if (Array.isArray(d.suggestedTypes) && d.suggestedTypes.length) {
        setTypes(d.suggestedTypes.filter((t: string) => ALL_TYPES.includes(t as KitMaterialType)));
      }
      const miss = Array.isArray(d.missingLessons) ? d.missingLessons : [];
      setOrderMsg(
        `${d.orderNumber}: ${ps.length}지문` +
          (miss.length ? ` · 미매칭 ${miss.length}` : '') +
          (d.selectedPackages?.length ? ` · 패키지 ${d.selectedPackages.join(', ')}` : ''),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '주문 조회 오류');
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (!selected.length || !types.length) {
      setError('지문과 유형을 선택하세요.');
      return;
    }
    setBusy('gen');
    setError('');
    try {
      const r = await fetch('/api/admin/workbook-kit/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passageIds: selected.map((p) => p._id),
          types,
          includeTranslation,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || '생성 실패');
        return;
      }
      setEntries(d.entries ?? []);
      setPreviewIdx(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '생성 오류');
    } finally {
      setBusy(null);
    }
  };

  const download = async (format: 'pdf' | 'zip') => {
    if (!selected.length || !types.length) return;
    setBusy(format === 'zip' ? 'zip' : 'pdf');
    setError('');
    try {
      const r = await fetch('/api/admin/workbook-kit/pdf-bulk', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passageIds: selected.map((p) => p._id),
          types,
          includeTranslation,
          format,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error || `PDF 실패 (${r.status})`);
        return;
      }
      const buf = await r.arrayBuffer();
      const cd = r.headers.get('Content-Disposition') || '';
      const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd);
      const name = decodeURIComponent(m?.[1] || m?.[2] || `workbook-kit.${format}`);
      downloadBlob(buf, name, format === 'zip' ? 'application/zip' : 'application/pdf');
    } catch (e) {
      setError(e instanceof Error ? e.message : '다운로드 오류');
    } finally {
      setBusy(null);
    }
  };

  const previewHtml = useMemo(() => {
    const e = entries[previewIdx];
    return e?.html || '';
  }, [entries, previewIdx]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">워크북키트</h1>
        <p className="text-sm text-slate-400 mt-1">
          빈칸쓰기 · 낱말배열 · 어법(양자택일/오류수정)을 선택 지문으로 PDF 생성합니다. 어법은{' '}
          <Link href="/admin/workbook-maker/grammar" className="text-emerald-400 underline">
            어법공략
          </Link>
          에 저장된 자료만 사용합니다.
        </p>
      </div>

      <section className="rounded-xl border border-slate-700 bg-slate-950/60 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">BW/MW 주문 불러오기</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={orderNumber}
            onChange={(e) => setOrderNumber(e.target.value)}
            className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-sm w-56"
            placeholder="BW-20260921-001"
          />
          <button
            type="button"
            onClick={loadOrder}
            disabled={busy === 'order'}
            className="px-3 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-sm font-semibold disabled:opacity-50"
          >
            {busy === 'order' ? '조회 중…' : '주문 지문 불러오기'}
          </button>
          {orderMsg && <span className="text-xs text-slate-400">{orderMsg}</span>}
        </div>
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-950/60 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-200">
            지문 {selected.length}개{textbook ? ` · ${textbook}` : ''}
          </h2>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm"
          >
            + 지문 추가
          </button>
        </div>
        {selected.length === 0 ? (
          <p className="text-sm text-slate-500">지문을 추가하거나 주문을 불러오세요.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {selected.map((p) => (
              <li
                key={p._id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 text-xs border border-slate-600"
              >
                <span>{p.source_key || `${p.chapter} ${p.number}`}</span>
                <button type="button" className="text-slate-400 hover:text-white" onClick={() => removePassage(p._id)}>
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-700 bg-slate-950/60 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-200">유형</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {ALL_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" checked={types.includes(t)} onChange={() => toggleType(t)} />
              {KIT_TYPE_LABEL[t]}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={includeTranslation}
            onChange={(e) => setIncludeTranslation(e.target.checked)}
          />
          빈칸쓰기 해석 포함 (번역포함)
        </label>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={!!busy || !selected.length}
          className="px-4 py-2 rounded-lg bg-sky-700 hover:bg-sky-600 text-sm font-semibold disabled:opacity-50"
        >
          {busy === 'gen' ? '생성 중…' : '미리보기 생성'}
        </button>
        <button
          type="button"
          onClick={() => download('pdf')}
          disabled={!!busy || !selected.length}
          className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-sm font-semibold disabled:opacity-50"
        >
          {busy === 'pdf' ? 'PDF…' : '합본 PDF'}
        </button>
        <button
          type="button"
          onClick={() => download('zip')}
          disabled={!!busy || !selected.length}
          className="px-4 py-2 rounded-lg bg-violet-700 hover:bg-violet-600 text-sm font-semibold disabled:opacity-50"
        >
          {busy === 'zip' ? 'ZIP…' : '유형별 ZIP'}
        </button>
      </div>

      {error && (
        <div className="text-sm text-rose-300 border border-rose-800/50 rounded-lg px-3 py-2 bg-rose-950/30">{error}</div>
      )}

      {entries.length > 0 && (
        <section className="rounded-xl border border-slate-700 overflow-hidden">
          <div className="flex flex-wrap gap-1 p-2 bg-slate-950 border-b border-slate-700">
            {entries.map((e, i) => (
              <button
                key={`${e.type}-${i}`}
                type="button"
                onClick={() => setPreviewIdx(i)}
                className={`px-2.5 py-1 rounded text-xs ${
                  i === previewIdx ? 'bg-emerald-700 text-white' : 'bg-slate-800 text-slate-300'
                }`}
              >
                {e.title}
                {e.warning ? ' ⚠' : ` (${e.questionCount})`}
              </button>
            ))}
          </div>
          {entries[previewIdx]?.warning && (
            <p className="text-xs text-amber-300 px-3 py-2 bg-amber-950/40">{entries[previewIdx].warning}</p>
          )}
          {previewHtml ? (
            <iframe title="preview" className="w-full bg-white" style={{ height: '70vh' }} srcDoc={previewHtml} />
          ) : (
            <p className="p-4 text-sm text-slate-500">미리볼 HTML이 없습니다.</p>
          )}
        </section>
      )}

      {pickerOpen && (
        <PassagePickerModal
          onSelect={addPassage}
          onClose={() => setPickerOpen(false)}
          lastTextbookKey="workbook_kit_last_textbook"
          showCounts={false}
        />
      )}
    </div>
  );
}
