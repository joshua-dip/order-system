'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  formatFileSize,
  getCategoryMeta,
  type CategoryGroup,
  type ResourceItem,
  type ResourceVariant,
} from '@/lib/shared-resources-shared';
import { CategoryIcon, ChevronDown, DownloadIcon } from '../../_components/Icons';

interface Props {
  examSlug: string;
  group: CategoryGroup;
}

/* 카테고리 아코디언 — 단일 emerald 액센트로 통일.
   기본 닫힘 (자료가 많아 한 번에 펼치면 무거움), `#cat-...` hash 진입 시 자동 펼침. */
export default function ExamCategoryAccordion({ examSlug, group }: Props) {
  const sectionId = `cat-${encodeURIComponent(group.category)}`;
  const [open, setOpen] = useState(false);
  const meta = getCategoryMeta(group.category);

  /* 서브그룹별 체크박스 선택 — 부모에서 관리해야 아코디언을 접었다 펴도 유지된다.
     Key: subCategory ?? '' (null 표현). */
  const [selectionMap, setSelectionMap] = useState<Record<string, Set<string>>>({});
  const setSubSelection = useCallback((subKey: string, updater: (prev: Set<string>) => Set<string>) => {
    setSelectionMap((prev) => ({ ...prev, [subKey]: updater(prev[subKey] ?? new Set()) }));
  }, []);

  useEffect(() => {
    function syncWithHash() {
      const hash = window.location.hash.replace(/^#/, '');
      if (hash === sectionId) setOpen(true);
    }
    syncWithHash();
    window.addEventListener('hashchange', syncWithHash);
    return () => window.removeEventListener('hashchange', syncWithHash);
  }, [sectionId]);

  const zipAllHref = `/api/shared-resources/zip?exam=${encodeURIComponent(examSlug)}&category=${encodeURIComponent(group.category)}`;

  return (
    <section
      id={sectionId}
      className="rounded-2xl border border-slate-200 bg-white overflow-hidden scroll-mt-20"
    >
      <header className="flex items-center gap-3 p-4 sm:p-5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-start gap-3 flex-1 min-w-0 text-left"
          aria-expanded={open}
        >
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl shrink-0 bg-emerald-50 text-emerald-700">
            <CategoryIcon name={meta.icon} className="w-6 h-6" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-slate-900 leading-tight break-keep">
              {group.category.replace(/_/g, ' ')}
            </h2>
            {meta.description && (
              <p className="mt-0.5 text-xs text-slate-500 leading-snug">{meta.description}</p>
            )}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span>파일 {group.totalFiles}개</span>
              {formatFileSize(group.totalBytes) && <span>{formatFileSize(group.totalBytes)}</span>}
            </div>
          </div>
          <ChevronDown
            className={`w-5 h-5 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
        <a
          href={zipAllHref}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0 border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
          title={`${group.category} 카테고리 전체 ZIP 다운로드`}
        >
          <DownloadIcon className="w-3.5 h-3.5" />
          전체 ZIP
        </a>
      </header>

      {/* 모바일 — 카테고리 전체 ZIP 버튼 */}
      <a
        href={zipAllHref}
        className="sm:hidden flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-t border-slate-100 text-slate-700 hover:bg-slate-50"
      >
        <DownloadIcon className="w-3.5 h-3.5" />
        카테고리 전체 ZIP 다운로드
      </a>

      {/* DOM 은 항상 유지 — 닫으면 hidden, 열면 노출. 이래야 SubGroupBlock 의 체크 상태가 마운트로 인해 초기화되지 않는다. */}
      <div className={`p-3 sm:p-4 border-t border-slate-100 space-y-5 bg-slate-50/40 ${open ? '' : 'hidden'}`}>
        {group.subGroups.map((sg, sgIdx) => {
          const subKey = sg.subCategory ?? '';
          return (
            <SubGroupBlock
              key={sg.subCategory ?? `default-${sgIdx}`}
              examSlug={examSlug}
              category={group.category}
              subCategory={sg.subCategory ?? null}
              items={sg.items}
              selected={selectionMap[subKey] ?? EMPTY_SET}
              onChange={(updater) => setSubSelection(subKey, updater)}
            />
          );
        })}
      </div>
    </section>
  );
}

const EMPTY_SET: ReadonlySet<string> = new Set();

function SubGroupBlock({
  examSlug,
  category,
  subCategory,
  items,
  selected,
  onChange,
}: {
  examSlug: string;
  category: string;
  subCategory: string | null;
  items: ResourceItem[];
  selected: ReadonlySet<string>;
  onChange: (updater: (prev: Set<string>) => Set<string>) => void;
}) {
  /* 통합본(all) 과 번호별 항목 분리 — 통합본은 list 위에 별도 강조 박스 */
  const { fullItems, numberItems } = useMemo(() => {
    const fullItems: ResourceItem[] = [];
    const numberItems: ResourceItem[] = [];
    for (const it of items) {
      if (it.numberKey === 'all') fullItems.push(it);
      else numberItems.push(it);
    }
    return { fullItems, numberItems };
  }, [items]);

  const allSelected = numberItems.length > 0 && selected.size === numberItems.length;
  const someSelected = selected.size > 0;

  function toggle(key: string) {
    onChange((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) onChange(() => new Set());
    else onChange(() => new Set(numberItems.map((it) => it.numberKey)));
  }

  /* indeterminate 는 ref 콜백 대신 useEffect 로 동기화 — render-time mutation 회피 */
  const allCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allCheckboxRef.current) {
      allCheckboxRef.current.indeterminate = !allSelected && someSelected;
    }
  }, [allSelected, someSelected]);

  const selectedZipHref = useMemo(() => {
    if (selected.size === 0) return null;
    const params = new URLSearchParams();
    params.set('exam', examSlug);
    params.set('category', category);
    if (subCategory) params.set('sub', subCategory);
    for (const k of selected) params.append('number', k);
    return `/api/shared-resources/zip?${params.toString()}`;
  }, [selected, examSlug, category, subCategory]);

  const subZipHref =
    subCategory != null
      ? `/api/shared-resources/zip?exam=${encodeURIComponent(examSlug)}&category=${encodeURIComponent(category)}&sub=${encodeURIComponent(subCategory)}`
      : null;

  return (
    <div>
      {subCategory && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">
            <span className="text-slate-300 mr-1">↳</span>
            {subCategory.replace(/_/g, ' ')}
          </h3>
          {subZipHref && (
            <a
              href={subZipHref}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-slate-200 text-slate-600 hover:bg-white"
            >
              <DownloadIcon className="w-3 h-3" />
              묶음 ZIP
            </a>
          )}
        </div>
      )}

      {/* 통합본 — 상단 강조 박스 */}
      {fullItems.length > 0 && (
        <div className="mb-3 space-y-2">
          {fullItems.map((it) => (
            <FullExamCard key={`full-${it.numberKey}`} item={it} />
          ))}
        </div>
      )}

      {/* 번호별 자료 — 체크박스 + 1열 list */}
      {numberItems.length > 0 && (
        <div className="rounded-xl border border-slate-200 overflow-hidden bg-white">
          {/* 선택 toolbar */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                ref={allCheckboxRef}
                checked={allSelected}
                onChange={toggleAll}
                aria-label="번호별 자료 전체 선택"
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>
                전체 선택
                {someSelected && (
                  <span className="ml-1.5 text-emerald-700 font-bold">({selected.size}/{numberItems.length})</span>
                )}
              </span>
            </label>
            {selectedZipHref ? (
              <a
                href={selectedZipHref}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              >
                <DownloadIcon className="w-3.5 h-3.5" />
                선택 {selected.size}개 ZIP
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-400 border border-dashed border-slate-300">
                <DownloadIcon className="w-3.5 h-3.5" />
                선택 후 다운로드
              </span>
            )}
          </div>

          {/* 번호 list — 1열 콤팩트 row */}
          <ul className="divide-y divide-slate-100">
            {numberItems.map((it) => (
              <ResourceRow
                key={`${it.category}-${it.subCategory ?? ''}-${it.numberKey}`}
                item={it}
                checked={selected.has(it.numberKey)}
                onToggle={() => toggle(it.numberKey)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * 통합본 카드 — 상단 강조. emerald 톤 단일 액센트.
 * ──────────────────────────────────────────────────────────────────────────── */
function FullExamCard({ item }: { item: ResourceItem }) {
  const totalBytes = item.variants.reduce((s, v) => s + v.sizeBytes, 0);
  const hasPdf = item.variants.some((v) => v.ext === 'pdf');
  const hasHwp = item.variants.some((v) => v.ext === 'hwp');
  const showZipBtn = hasPdf && hasHwp;

  const zipHref = `/api/shared-resources/zip?exam=${encodeURIComponent(item.examSlug)}&category=${encodeURIComponent(item.category)}${
    item.subCategory ? `&sub=${encodeURIComponent(item.subCategory)}` : ''
  }&number=${encodeURIComponent(item.numberKey)}`;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2.5">
      <span className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-600 text-white shrink-0">
        <DownloadIcon className="w-4 h-4" />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-bold text-slate-900 text-sm">{item.label}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white">전체</span>
        </div>
        {formatFileSize(totalBytes) && (
          <div className="text-[11px] text-slate-500">{formatFileSize(totalBytes)}</div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {item.variants.map((v) => (
          <FileButton key={v.ext + v.filename} variant={v} />
        ))}
        {showZipBtn && (
          <a
            href={zipHref}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            title="PDF + HWP 한 번에 ZIP"
          >
            <DownloadIcon className="w-3 h-3" />
            한 번에
          </a>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * 번호 row — 1열 콤팩트. 체크박스 + 번호 + 라벨 + 파일 버튼들.
 * ──────────────────────────────────────────────────────────────────────────── */
function ResourceRow({
  item,
  checked,
  onToggle,
}: {
  item: ResourceItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const totalBytes = item.variants.reduce((s, v) => s + v.sizeBytes, 0);
  const hasPdf = item.variants.some((v) => v.ext === 'pdf');
  const hasHwp = item.variants.some((v) => v.ext === 'hwp');
  const showZipBtn = hasPdf && hasHwp;

  const zipHref = `/api/shared-resources/zip?exam=${encodeURIComponent(item.examSlug)}&category=${encodeURIComponent(item.category)}${
    item.subCategory ? `&sub=${encodeURIComponent(item.subCategory)}` : ''
  }&number=${encodeURIComponent(item.numberKey)}`;

  return (
    <li
      className={`flex items-center gap-2 px-3 py-2 transition-colors ${
        checked ? 'bg-emerald-50/60' : 'hover:bg-slate-50'
      }`}
    >
      <label className="flex items-center cursor-pointer shrink-0 p-1 -m-1">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          aria-label={`${item.label} 선택`}
        />
      </label>
      <span className="inline-flex items-center justify-center min-w-[2.25rem] h-7 px-1.5 rounded-md text-[11px] font-bold shrink-0 bg-slate-100 text-slate-700">
        {item.numberKey}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-slate-800 truncate">{item.label}</div>
        {formatFileSize(totalBytes) && (
          <div className="text-[10px] text-slate-400">{formatFileSize(totalBytes)}</div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1 shrink-0">
        {item.variants.map((v) => (
          <FileButton key={v.ext + v.filename} variant={v} compact />
        ))}
        {showZipBtn && (
          <a
            href={zipHref}
            className="inline-flex items-center gap-0.5 px-2 py-1 rounded text-[10px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
            title="PDF + HWP 한 번에 ZIP"
          >
            ZIP
          </a>
        )}
      </div>
    </li>
  );
}

/* PDF / HWP 등 개별 파일 버튼 — outline slate 통일. 좌측 dot 으로만 타입 hint. */
function FileButton({ variant, compact }: { variant: ResourceVariant; compact?: boolean }) {
  const v = variant;
  const sizeCls = compact ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1 text-[11px]';
  const dotColor =
    v.ext === 'pdf' ? 'bg-rose-500' : v.ext === 'hwp' ? 'bg-blue-500' : 'bg-slate-400';
  return (
    <a
      href={v.href}
      download={v.filename}
      className={`inline-flex items-center gap-1 rounded-md font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors ${sizeCls}`}
      title={`${v.filename} (${formatFileSize(v.sizeBytes) ?? ''})`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} aria-hidden />
      {v.ext.toUpperCase()}
    </a>
  );
}
