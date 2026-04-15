'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/* ── 타입 ─────────────────────────────────────────────── */

interface StatsRow {
  textbook: string;
  type: string;
  total: number;
  완료: number;
  대기: number;
  검수불일치: number;
  기타: number;
}

interface StatsData {
  textbooks: string[];
  types: string[];
  rows: StatsRow[];
  textbookTotals: Record<string, number>;
}

interface SourceRow {
  source: string;
  type: string;
  total: number;
  완료: number;
  대기: number;
  검수불일치: number;
  기타: number;
}

interface SourceData {
  textbook: string;
  sources: string[];
  types: string[];
  rows: SourceRow[];
  sourceTotals: Record<string, number>;
}

type ViewMode = 'heatmap' | 'bar-textbook' | 'bar-type';
type StatusFilter = 'all' | '완료' | '대기' | '검수불일치';

/** 대기 → 완료 검수 요청 클립보드 */
type PendingReviewCopyPayload =
  | { scope: 'cell'; source: string; type: string; 완료: number; 대기: number; total: number }
  | { scope: 'column'; type: string; 완료: number; 대기: number }
  | { scope: 'grand'; 완료: number; 대기: number };

function buildPendingReviewClipboardText(textbook: string, p: PendingReviewCopyPayload): string {
  if (p.scope === 'cell') {
    return [
      `교재: ${textbook}`,
      `소스(지문): ${p.source}`,
      `유형: ${p.type}`,
      `현재: 완료 ${p.완료}건 / 대기 ${p.대기}건 (합계 ${p.total}건)`,
      ``,
      `대기 ${p.대기}건에 대해 검수(정답 확인) 후 상태를 「완료」로 처리해 주세요.`,
      `(Claude Code에서 변형문제 검수·대기 문항 처리 절차에 따라 진행)`,
    ].join('\n');
  }
  if (p.scope === 'column') {
    return [
      `교재: ${textbook}`,
      `유형: ${p.type}`,
      `해당 유형 전체: 완료 ${p.완료}건 / 대기 ${p.대기}건`,
      ``,
      `이 유형의 대기 ${p.대기}건을 검수하여 모두 「완료」로 처리해 주세요.`,
      `(Claude Code에서 변형문제 검수 절차에 따라 진행)`,
    ].join('\n');
  }
  return [
    `교재: ${textbook}`,
    `전체 현황: 완료 ${p.완료}건 / 대기 ${p.대기}건`,
    ``,
    `위 대기 ${p.대기}건을 검수하여 「완료」로 처리해 주세요.`,
    `(Claude Code에서 변형문제 검수 절차에 따라 진행)`,
  ].join('\n');
}

/* ── 색상 ─────────────────────────────────────────────── */

const TYPE_COLORS: Record<string, string> = {
  주제: '#6366f1', 제목: '#8b5cf6', 주장: '#a855f7', 일치: '#06b6d4',
  불일치: '#0ea5e9', 함의: '#3b82f6', 빈칸: '#f59e0b', 요약: '#10b981',
  어법: '#ef4444', 순서: '#f97316', 삽입: '#ec4899', 무관한문장: '#84cc16',
  '삽입-고난도': '#e11d48',
};
function typeColor(type: string) { return TYPE_COLORS[type] ?? '#94a3b8'; }

function heatColor(value: number, max: number): string {
  if (max === 0 || value === 0) return 'bg-slate-800/60 text-slate-600';
  const r = value / max;
  if (r >= 0.8) return 'bg-indigo-500 text-white';
  if (r >= 0.6) return 'bg-indigo-400 text-white';
  if (r >= 0.4) return 'bg-indigo-300 text-slate-900';
  if (r >= 0.2) return 'bg-indigo-200 text-slate-900';
  if (r >= 0.05) return 'bg-indigo-100/80 text-slate-800';
  return 'bg-red-950 text-red-400';
}

function fmt(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/* ── SVG 누적 막대 ────────────────────────────────────── */

function BarChart({
  bars,
  maxValue,
  labelWidth = 180,
  onLabelClick,
}: {
  bars: { label: string; segments: { value: number; color: string; key: string }[]; total: number }[];
  maxValue: number;
  labelWidth?: number;
  onLabelClick?: (label: string) => void;
}) {
  const barH = 26;
  const chartH = bars.length * barH + 4;
  const chartW = 460;
  const padR = 52;

  return (
    <svg width="100%" viewBox={`0 0 ${labelWidth + chartW + padR} ${chartH}`} className="overflow-visible">
      {bars.map((bar, i) => {
        const y = i * barH + 1;
        let x = 0;
        const isClickable = !!onLabelClick;
        return (
          <g key={bar.label}>
            <text
              x={labelWidth - 6}
              y={y + barH / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10}
              fill={isClickable ? '#a5b4fc' : '#94a3b8'}
              style={isClickable ? { cursor: 'pointer', textDecoration: 'underline' } : {}}
              onClick={isClickable ? () => onLabelClick(bar.label) : undefined}
            >
              {bar.label.length > 24 ? bar.label.slice(0, 23) + '…' : bar.label}
            </text>
            {bar.segments.map((seg) => {
              if (seg.value === 0) return null;
              const w = maxValue > 0 ? (seg.value / maxValue) * chartW : 0;
              const el = (
                <rect
                  key={seg.key}
                  x={labelWidth + x}
                  y={y + 2}
                  width={Math.max(1, w)}
                  height={barH - 5}
                  fill={seg.color}
                  rx={2}
                >
                  <title>{`${seg.key}: ${seg.value.toLocaleString()}`}</title>
                </rect>
              );
              x += w;
              return el;
            })}
            <text
              x={labelWidth + (maxValue > 0 ? (bar.total / maxValue) * chartW : 0) + 5}
              y={y + barH / 2}
              dominantBaseline="middle"
              fontSize={9}
              fill="#64748b"
            >
              {fmt(bar.total)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── 유형 클릭 분석 패널 ──────────────────────────────── */

function TypeAnalysisPanel({
  type,
  data,
  statusFilter,
  onClose,
}: {
  type: string;
  data: SourceData;
  statusFilter: StatusFilter;
  onClose: () => void;
}) {
  const rowMap = new Map<string, SourceRow>();
  for (const r of data.rows) rowMap.set(`${r.source}|${r.type}`, r);

  const getValue = (src: string): number => {
    const r = rowMap.get(`${src}|${type}`);
    if (!r) return 0;
    return statusFilter === 'all' ? r.total : (r[statusFilter] ?? 0);
  };

  const allSources = data.sources;
  const counts = allSources.map((s) => ({ source: s, count: getValue(s) }));
  const zeroSources = counts.filter((c) => c.count === 0);
  const nonZeroSources = counts.filter((c) => c.count > 0).sort((a, b) => a.count - b.count);
  const totalCount = counts.reduce((s, c) => s + c.count, 0);
  const avgAll = allSources.length > 0 ? totalCount / allSources.length : 0;
  const avgNonZero = nonZeroSources.length > 0
    ? nonZeroSources.reduce((s, c) => s + c.count, 0) / nonZeroSources.length
    : 0;

  // 분포: 1~3, 4~6, 7~9, 10~12, 13+ 구간
  const buckets = [
    { label: '1~3', min: 1, max: 3 },
    { label: '4~6', min: 4, max: 6 },
    { label: '7~9', min: 7, max: 9 },
    { label: '10~12', min: 10, max: 12 },
    { label: '13+', min: 13, max: Infinity },
  ];
  const bucketCounts = buckets.map((b) => ({
    label: b.label,
    count: nonZeroSources.filter((c) => c.count >= b.min && c.count <= b.max).length,
  }));
  const maxBucket = Math.max(...bucketCounts.map((b) => b.count), 1);

  return (
    <div className="rounded-xl border border-indigo-800/60 bg-slate-800/70 p-4 mt-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span
            className="inline-block rounded px-2 py-0.5 text-xs font-bold text-white"
            style={{ background: typeColor(type) }}
          >
            {type}
          </span>
          <span className="text-sm font-bold text-white">유형 분석</span>
          <span className="text-xs text-slate-400">
            ({statusFilter === 'all' ? '전체 상태' : statusFilter})
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-slate-300 text-xs px-2 py-1 rounded bg-slate-700"
        >
          ✕ 닫기
        </button>
      </div>

      {/* 핵심 지표 3종 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
        <div className="rounded-lg bg-slate-900 p-3">
          <p className="text-[10px] text-slate-400 mb-0.5">전체 소스</p>
          <p className="text-xl font-bold text-white">{allSources.length}</p>
        </div>
        <div className="rounded-lg bg-red-950/60 border border-red-900/50 p-3">
          <p className="text-[10px] text-red-300 mb-0.5">문제 없는 소스</p>
          <p className="text-xl font-bold text-red-200">{zeroSources.length}</p>
          <p className="text-[10px] text-red-400">
            {allSources.length > 0 ? ((zeroSources.length / allSources.length) * 100).toFixed(1) : 0}%
          </p>
        </div>
        <div className="rounded-lg bg-slate-900 p-3">
          <p className="text-[10px] text-slate-400 mb-0.5">평균 (0 포함)</p>
          <p className="text-xl font-bold text-slate-100">{avgAll.toFixed(1)}</p>
          <p className="text-[10px] text-slate-500">문항/소스</p>
        </div>
        <div className="rounded-lg bg-indigo-950/60 border border-indigo-800/50 p-3">
          <p className="text-[10px] text-indigo-300 mb-0.5">평균 (0 제외)</p>
          <p className="text-xl font-bold text-indigo-200">{avgNonZero.toFixed(1)}</p>
          <p className="text-[10px] text-indigo-400">문항/소스</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 분포 히스토그램 */}
        <div>
          <p className="text-xs font-semibold text-slate-300 mb-2">문항수 분포 (0 제외)</p>
          <div className="space-y-1.5">
            {bucketCounts.map((b) => (
              <div key={b.label} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 w-8 text-right">{b.label}</span>
                <div className="flex-1 bg-slate-800 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-4 rounded-full transition-all"
                    style={{
                      width: `${maxBucket > 0 ? (b.count / maxBucket) * 100 : 0}%`,
                      background: typeColor(type),
                      opacity: 0.85,
                    }}
                  />
                </div>
                <span className="text-[10px] text-slate-300 w-8">{b.count}개</span>
              </div>
            ))}
          </div>
        </div>

        {/* 문제 없는 소스 목록 */}
        {zeroSources.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-red-300 mb-2">
              문제 없는 소스 ({zeroSources.length}개)
            </p>
            <div className="max-h-[140px] overflow-y-auto space-y-0.5">
              {zeroSources.map((c) => (
                <div
                  key={c.source}
                  className="flex items-center justify-between px-2 py-0.5 rounded bg-red-950/30 text-[11px]"
                >
                  <span className="text-red-200">{c.source}</span>
                  <span className="text-red-500 font-bold">0</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 문제 적은 소스 (하위 10개, 0 제외) */}
        {nonZeroSources.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-300 mb-2">
              문항 적은 소스 Top 10 (0 제외)
            </p>
            <div className="max-h-[140px] overflow-y-auto space-y-0.5">
              {nonZeroSources.slice(0, 10).map((c) => (
                <div
                  key={c.source}
                  className="flex items-center justify-between px-2 py-0.5 rounded bg-slate-800 text-[11px]"
                >
                  <span className="text-slate-300">{c.source}</span>
                  <span
                    className="font-bold"
                    style={{ color: c.count < avgNonZero * 0.5 ? '#f87171' : c.count < avgNonZero ? '#fbbf24' : '#6ee7b7' }}
                  >
                    {c.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 소스별 히트맵 ────────────────────────────────────── */

function SourceHeatmap({
  data,
  statusFilter,
  onTypeClick,
  selectedType,
  onCellClick,
  onPendingReviewCopy,
}: {
  data: SourceData;
  statusFilter: StatusFilter;
  onTypeClick: (type: string) => void;
  selectedType: string | null;
  onCellClick?: (info: { source: string; type: string; count: number; avgNonZero: number; need: number }) => void;
  onPendingReviewCopy?: (payload: PendingReviewCopyPayload) => void;
}) {
  const rowMap = new Map<string, SourceRow>();
  for (const r of data.rows) rowMap.set(`${r.source}|${r.type}`, r);

  const getValue = (source: string, type: string): number => {
    const r = rowMap.get(`${source}|${type}`);
    if (!r) return 0;
    if (statusFilter === 'all') return r.total;
    return r[statusFilter] ?? 0;
  };

  // 유형별 비-제로 평균 미리 계산
  const typeAvgMap = new Map<string, number>();
  for (const tp of data.types) {
    const vals = data.sources.map((s) => getValue(s, tp)).filter((v) => v > 0);
    typeAvgMap.set(tp, vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0);
  }

  let heatMax = 0;
  for (const s of data.sources) {
    for (const t of data.types) {
      heatMax = Math.max(heatMax, getValue(s, t));
    }
  }

  // 강(chapter) 그룹 감지: "01강 *" → "01강"
  const getChapter = (source: string) => {
    const m = source.match(/^(\d+강)/);
    return m ? m[1] : null;
  };

  let prevChapter: string | null = null;

  // 유형별 완료/대기 합계
  const typeCompletedMap = new Map<string, number>();
  const typePendingMap = new Map<string, number>();
  for (const tp of data.types) {
    typeCompletedMap.set(tp, data.sources.reduce((s, src) => {
      const r = rowMap.get(`${src}|${tp}`);
      return s + (r?.완료 ?? 0);
    }, 0));
    typePendingMap.set(tp, data.sources.reduce((s, src) => {
      const r = rowMap.get(`${src}|${tp}`);
      return s + (r?.대기 ?? 0);
    }, 0));
  }

  // 전체 합계
  const grandCompleted = [...typeCompletedMap.values()].reduce((a, b) => a + b, 0);
  const grandPending = [...typePendingMap.values()].reduce((a, b) => a + b, 0);
  const grandMismatch = data.rows.reduce((s, r) => s + (r.검수불일치 ?? 0), 0);
  const grandTotal = data.sources.reduce((s, src) => s + (data.sourceTotals[src] ?? 0), 0);

  const showSplit = statusFilter === 'all';

  // 대기 상세 드릴다운
  const [showPendingDetail, setShowPendingDetail] = useState(false);
  const pendingItems = data.rows
    .filter((r) => (r.대기 ?? 0) > 0)
    .sort((a, b) => (b.대기 ?? 0) - (a.대기 ?? 0));

  return (
    <div className="space-y-2">
      {/* 전체 상태 요약 배지 */}
      {showSplit && (
        <div className="flex flex-wrap gap-2 text-xs mb-1">
          <span className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 bg-emerald-900/40 border border-emerald-700/50 text-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            완료 <strong>{grandCompleted.toLocaleString()}</strong>
          </span>
          <button
            onClick={() => setShowPendingDetail((v) => !v)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 border text-xs transition-colors ${
              showPendingDetail
                ? 'bg-amber-700/60 border-amber-500 text-amber-100'
                : 'bg-amber-900/40 border-amber-700/50 text-amber-200 hover:bg-amber-800/50'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
            대기 <strong>{grandPending.toLocaleString()}</strong>
            {grandPending > 0 && (
              <span className="ml-0.5 opacity-70">{showPendingDetail ? '▲' : '▼'}</span>
            )}
          </button>
          {grandMismatch > 0 && (
            <span className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 bg-red-900/40 border border-red-700/50 text-red-200">
              <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
              검수불일치 <strong>{grandMismatch.toLocaleString()}</strong>
            </span>
          )}
          <span className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 bg-slate-800 border border-slate-700 text-slate-300">
            합계 <strong>{grandTotal.toLocaleString()}</strong>
          </span>
        </div>
      )}

      {/* 대기 상세 패널 */}
      {showSplit && showPendingDetail && (
        <div className="rounded-xl border border-amber-800/50 bg-amber-950/30 p-3 mb-2">
          <p className="text-xs font-semibold text-amber-300 mb-2">
            대기 문항 목록 ({pendingItems.length}개 유형-소스 조합)
          </p>
          {pendingItems.length === 0 ? (
            <p className="text-xs text-slate-500">대기 문항 없음</p>
          ) : (
            <div className="max-h-[220px] overflow-y-auto space-y-0.5">
              {pendingItems.map((r) => (
                <div
                  key={`${r.source}|${r.type}`}
                  className="flex items-center gap-2 px-2 py-1 rounded bg-slate-900/60 text-[11px]"
                >
                  <span
                    className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold text-white shrink-0"
                    style={{ background: typeColor(r.type) }}
                  >
                    {r.type}
                  </span>
                  <span className="text-slate-300 flex-1 truncate">{r.source}</span>
                  <button
                    type="button"
                    title="클릭: 검수 요청 문구 클립보드 복사"
                    onClick={() =>
                      onPendingReviewCopy?.({
                        scope: 'cell',
                        source: r.source,
                        type: r.type,
                        완료: r.완료,
                        대기: r.대기,
                        total: r.total,
                      })
                    }
                    className="rounded px-1.5 py-0.5 bg-orange-500 text-white font-bold font-mono text-[10px] shrink-0 hover:bg-orange-400 cursor-pointer"
                  >
                    {r.대기}
                  </button>
                  <span className="text-slate-600 text-[10px] shrink-0">/ {r.total}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="overflow-auto max-h-[60vh]">
        <table className="text-[11px] border-collapse">
          <thead className="sticky top-0 z-10 bg-slate-900">
            {/* 유형 헤더 */}
            <tr>
              <th className="px-2 py-1.5 text-left text-slate-400 font-medium min-w-[110px] sticky left-0 bg-slate-900">소스</th>
              {data.types.map((tp) => (
                <th
                  key={tp}
                  className={`px-1 py-1.5 text-center font-semibold min-w-[52px] cursor-pointer hover:opacity-80 transition-opacity ${
                    selectedType === tp ? 'underline' : ''
                  }`}
                  style={{ color: typeColor(tp) }}
                  onClick={() => onTypeClick(tp)}
                  title={`${tp} 유형 분석`}
                >
                  {tp}
                </th>
              ))}
              <th className="px-2 py-1.5 text-right text-slate-400 font-medium">합계</th>
            </tr>
            {/* 유형별 완료/대기 요약 행 */}
            {showSplit && (
              <tr className="border-t border-slate-700 bg-slate-900/80">
                <td className="sticky left-0 bg-slate-900/80 px-2 py-1 text-[10px] text-slate-500 whitespace-nowrap">완료 / 대기</td>
                {data.types.map((tp) => {
                  const c = typeCompletedMap.get(tp) ?? 0;
                  const p = typePendingMap.get(tp) ?? 0;
                  const tot = c + p;
                  return (
                    <td key={tp} className="px-0.5 py-1 text-center">
                      {tot > 0 ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <div className="flex gap-0.5 text-[9px] font-mono leading-none items-center">
                            <span className="text-emerald-300">{c}</span>
                            <span className="text-slate-600">/</span>
                            {p > 0 ? (
                              <button
                                type="button"
                                title="클릭: 이 유형 대기 검수 요청 클립보드 복사"
                                onClick={() =>
                                  onPendingReviewCopy?.({ scope: 'column', type: tp, 완료: c, 대기: p })
                                }
                                className="rounded px-[3px] bg-orange-500 text-white font-bold leading-[1.3] hover:bg-orange-400 cursor-pointer"
                              >
                                {p}
                              </button>
                            ) : (
                              <span className="text-slate-600">0</span>
                            )}
                          </div>
                          <div className="w-full h-1 flex rounded-full overflow-hidden">
                            <div style={{ width: `${tot > 0 ? (c / tot) * 100 : 0}%`, background: '#34d399' }} />
                            <div style={{ width: `${tot > 0 ? (p / tot) * 100 : 0}%`, background: '#fbbf24' }} />
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-700">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-right text-[9px] font-mono">
                  <span className="text-emerald-300">{grandCompleted}</span>
                  <span className="text-slate-600"> / </span>
                  {grandPending > 0 ? (
                    <button
                      type="button"
                      title="클릭: 전체 대기 검수 요청 클립보드 복사"
                      onClick={() =>
                        onPendingReviewCopy?.({ scope: 'grand', 완료: grandCompleted, 대기: grandPending })
                      }
                      className="rounded px-[3px] bg-orange-500 text-white font-bold leading-[1.3] hover:bg-orange-400 cursor-pointer"
                    >
                      {grandPending}
                    </button>
                  ) : (
                    <span className="text-slate-600">0</span>
                  )}
                </td>
              </tr>
            )}
          </thead>
          <tbody>
            {data.sources.map((src) => {
              const chapter = getChapter(src);
              const isNewChapter = chapter !== prevChapter;
              prevChapter = chapter;
              const rowTotal = data.types.reduce((s, tp) => s + getValue(src, tp), 0);
              return (
                <tr
                  key={src}
                  className={`border-t ${isNewChapter && chapter ? 'border-slate-600' : 'border-slate-800'}`}
                >
                  <td className="sticky left-0 bg-slate-900 px-2 py-1 text-slate-300 whitespace-nowrap">
                    {src}
                  </td>
                  {data.types.map((tp) => {
                    const r = rowMap.get(`${src}|${tp}`);
                    const v = getValue(src, tp);
                    const completed = r?.완료 ?? 0;
                    const pending = r?.대기 ?? 0;
                    const avg = typeAvgMap.get(tp) ?? 0;
                    const need = Math.max(0, Math.round(avg) - v);
                    const clickable = onCellClick && need > 0;
                    const tooltipBase = showSplit
                      ? `완료 ${completed} / 대기 ${pending}`
                      : undefined;
                    const tooltip = clickable
                      ? `${tooltipBase ? tooltipBase + '\n' : ''}클릭: 평균(${avg.toFixed(1)}) 도달에 ${need}개 필요 — 클립보드 복사`
                      : tooltipBase;
                    return (
                      <td
                        key={tp}
                        className={`px-0.5 py-0 text-center font-mono ${heatColor(v, heatMax)} ${
                          selectedType === tp ? 'ring-1 ring-inset ring-white/20' : ''
                        } ${clickable ? 'cursor-pointer hover:brightness-125 active:scale-95 transition-all' : ''}`}
                        title={tooltip}
                        onClick={clickable ? () => onCellClick!({ source: src, type: tp, count: v, avgNonZero: avg, need }) : undefined}
                      >
                        {v > 0 ? (
                          <div className="flex flex-col items-center leading-none py-0.5 gap-[2px]">
                            <span>{v}</span>
                            {showSplit && (
                              <div className="flex items-center gap-[2px] text-[9px] font-mono">
                                <span className="text-emerald-300">{completed}</span>
                                <span className="text-slate-500">/</span>
                                {pending > 0 ? (
                                  <button
                                    type="button"
                                    title="클릭: 대기 검수 요청 클립보드 복사"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onPendingReviewCopy?.({
                                        scope: 'cell',
                                        source: src,
                                        type: tp,
                                        완료: completed,
                                        대기: pending,
                                        total: v,
                                      });
                                    }}
                                    className="rounded px-[3px] bg-orange-500 text-white font-bold leading-[1.3] hover:bg-orange-400 cursor-pointer"
                                  >
                                    {pending}
                                  </button>
                                ) : (
                                  <span className="text-slate-600">0</span>
                                )}
                              </div>
                            )}
                            {showSplit && v > 0 && (
                              <div className="w-full h-[2px] flex">
                                <div style={{ width: `${(completed / v) * 100}%`, background: 'rgba(52,211,153,0.9)' }} />
                                <div style={{ width: `${(pending / v) * 100}%`, background: 'rgba(251,191,36,0.9)' }} />
                              </div>
                            )}
                          </div>
                        ) : ''}
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-right text-slate-300 font-semibold">
                    {rowTotal > 0 ? rowTotal : '—'}
                  </td>
                </tr>
              );
            })}
            {/* 합계 행 */}
            <tr className="border-t-2 border-slate-600 sticky bottom-0 bg-slate-900">
              <td className="sticky left-0 bg-slate-900 px-2 py-1.5 text-indigo-300 font-bold">합계</td>
              {data.types.map((tp) => {
                const v = data.sources.reduce((s, src) => s + getValue(src, tp), 0);
                return (
                  <td key={tp} className="px-0.5 py-1.5 text-center font-bold text-slate-200">
                    {v > 0 ? fmt(v) : '—'}
                  </td>
                );
              })}
              <td className="px-2 py-1.5 text-right font-bold text-indigo-300">
                {grandTotal.toLocaleString()}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── 소스별 막대 차트 ─────────────────────────────────── */

function SourceBarChart({ data, statusFilter }: { data: SourceData; statusFilter: StatusFilter }) {
  const rowMap = new Map<string, SourceRow>();
  for (const r of data.rows) rowMap.set(`${r.source}|${r.type}`, r);

  const bars = data.sources.map((src) => {
    const segments = data.types
      .map((tp) => {
        const r = rowMap.get(`${src}|${tp}`);
        const value = r ? (statusFilter === 'all' ? r.total : (r[statusFilter] ?? 0)) : 0;
        return { key: tp, value, color: typeColor(tp) };
      })
      .filter((s) => s.value > 0);
    const total = segments.reduce((s, x) => s + x.value, 0);
    return { label: src, segments, total };
  });

  const maxVal = Math.max(...bars.map((b) => b.total), 1);

  return (
    <div className="overflow-auto max-h-[60vh]">
      <BarChart bars={bars} maxValue={maxVal} labelWidth={120} />
      <div className="mt-3 flex flex-wrap gap-2">
        {data.types.map((tp) => (
          <span key={tp} className="flex items-center gap-1 text-[10px] text-slate-400">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: typeColor(tp) }} />
            {tp}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── 드릴다운 패널 ────────────────────────────────────── */

function DrilldownPanel({
  textbook,
  statusFilter,
  onBack,
}: {
  textbook: string;
  statusFilter: StatusFilter;
  onBack: () => void;
}) {
  const [data, setData] = useState<SourceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subView, setSubView] = useState<'heatmap' | 'bar'>('heatmap');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const handleCellClick = useCallback((info: { source: string; type: string; count: number; avgNonZero: number; need: number }) => {
    const avg = info.avgNonZero;
    const text = [
      `교재: ${textbook}`,
      `소스(지문): ${info.source}`,
      `유형: ${info.type}`,
      `현재 문항 수: ${info.count}개`,
      `유형 소스별 평균: ${avg.toFixed(1)}개 (0 제외)`,
      ``,
      `위 소스에서 [${info.type}] 유형 변형문제 ${info.need}개를 만들어주세요.`,
      `(현재 ${info.count}개 → 목표 ${Math.round(avg)}개)`,
    ].join('\n');

    navigator.clipboard.writeText(text).then(() => {
      setToast(`✔ 복사됨 — ${info.source} · ${info.type} ${info.need}개 요청`);
      setTimeout(() => setToast(null), 3000);
    }).catch(() => {
      setToast('클립보드 복사 실패');
      setTimeout(() => setToast(null), 2000);
    });
  }, [textbook]);

  const handlePendingReviewCopy = useCallback(
    (payload: PendingReviewCopyPayload) => {
      const text = buildPendingReviewClipboardText(textbook, payload);
      const label =
        payload.scope === 'cell'
          ? `${payload.source} · ${payload.type} 대기 ${payload.대기}건`
          : payload.scope === 'column'
            ? `${payload.type} 유형 대기 ${payload.대기}건`
            : `전체 대기 ${payload.대기}건`;
      navigator.clipboard.writeText(text).then(() => {
        setToast(`✔ 검수 요청 복사됨 — ${label}`);
        setTimeout(() => setToast(null), 3000);
      }).catch(() => {
        setToast('클립보드 복사 실패');
        setTimeout(() => setToast(null), 2000);
      });
    },
    [textbook]
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(
      `/api/admin/generated-questions/stats/source?textbook=${encodeURIComponent(textbook)}`,
      { credentials: 'include' }
    )
      .then((r) => r.json())
      .then((d: SourceData) => setData(d))
      .catch(() => setError('데이터를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [textbook]);

  const filteredData: SourceData | null = data
    ? {
        ...data,
        types: typeFilter ? data.types.filter((t) => t === typeFilter) : data.types,
        rows: typeFilter ? data.rows.filter((r) => r.type === typeFilter) : data.rows,
      }
    : null;

  const totalCount = data
    ? Object.values(data.sourceTotals).reduce((s, v) => s + v, 0)
    : 0;

  return (
    <div>
      {/* 드릴다운 헤더 */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs text-white"
        >
          ← 전체 목록
        </button>
        <div>
          <p className="text-sm font-bold text-white">{textbook}</p>
          <p className="text-xs text-slate-400">
            총 <span className="text-indigo-300 font-bold">{totalCount.toLocaleString()}</span>문항
            · {data?.sources.length ?? 0}개 소스
          </p>
        </div>
      </div>

      {/* 안내 문구 */}
      <p className="text-[11px] text-slate-500 mb-2">
        히트맵에서 총합 숫자 영역을 클릭하면 추가 제작 요청이, 주황색 <strong className="text-orange-400">대기</strong> 숫자를 클릭하면 검수·완료 처리 요청이 클립보드에 복사됩니다.
      </p>

      {/* 클립보드 복사 토스트 */}
      {toast && (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-900/70 border border-emerald-700 px-3 py-2 text-xs text-emerald-200">
          <span>{toast}</span>
        </div>
      )}

      {/* 서브 컨트롤 */}
      <div className="flex flex-wrap gap-2 mb-3">
        <div className="flex rounded-lg overflow-hidden border border-slate-600 text-xs">
          {(['heatmap', 'bar'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setSubView(m)}
              className={`px-3 py-1.5 font-medium transition-colors ${
                subView === m
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {m === 'heatmap' ? '히트맵' : '막대 차트'}
            </button>
          ))}
        </div>
        {data && (
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-white"
          >
            <option value="">모든 유형</option>
            {data.types.map((tp) => (
              <option key={tp} value={tp}>{tp}</option>
            ))}
          </select>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin w-8 h-8 border-4 border-slate-600 border-t-indigo-400 rounded-full" />
        </div>
      )}
      {error && <p className="text-red-400 text-sm py-4">{error}</p>}
      {filteredData && !loading && (
        subView === 'heatmap'
          ? <SourceHeatmap
              data={filteredData}
              statusFilter={statusFilter}
              onTypeClick={(tp) => setSelectedType((prev) => prev === tp ? null : tp)}
              selectedType={selectedType}
              onCellClick={handleCellClick}
              onPendingReviewCopy={handlePendingReviewCopy}
            />
          : <SourceBarChart data={filteredData} statusFilter={statusFilter} />
      )}

      {/* 유형 분석 패널 */}
      {filteredData && !loading && selectedType && data && (
        <TypeAnalysisPanel
          type={selectedType}
          data={data}
          statusFilter={statusFilter}
          onClose={() => setSelectedType(null)}
        />
      )}

      {/* 유형별 합계 */}
      {filteredData && !loading && (
        <div className="mt-4 border-t border-slate-700 pt-3">
          <div className="flex flex-wrap gap-2">
            {filteredData.types.map((tp) => {
              const v = filteredData.sources.reduce((s, src) => {
                const r = filteredData.rows.find((row) => row.source === src && row.type === tp);
                return s + (r ? (statusFilter === 'all' ? r.total : (r[statusFilter] ?? 0)) : 0);
              }, 0);
              return (
                <div
                  key={tp}
                  className={`rounded-lg px-2.5 py-1.5 bg-slate-800 border text-xs cursor-pointer hover:border-slate-500 transition-colors ${
                    selectedType === tp ? 'border-indigo-500' : 'border-slate-700'
                  }`}
                  onClick={() => setSelectedType((prev) => prev === tp ? null : tp)}
                  title={`${tp} 유형 분석`}
                >
                  <span style={{ color: typeColor(tp) }} className="font-bold">{tp}</span>
                  <span className="ml-1.5 text-slate-300">{v.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 메인 모달 ────────────────────────────────────────── */

export function QuestionStatsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('heatmap');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedTextbook, setSelectedTextbook] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [sortAsc, setSortAsc] = useState(false);

  // 드릴다운: 클릭된 교재명 (null = 전체 뷰)
  const [drillTextbook, setDrillTextbook] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/admin/generated-questions/stats', { credentials: 'include' })
      .then((r) => r.json())
      .then((d: StatsData) => setData(d))
      .catch(() => setError('데이터를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (open && !data) load(); }, [open, data, load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (drillTextbook) setDrillTextbook(null); else onClose(); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose, drillTextbook]);

  if (!open) return null;

  /* ── 데이터 가공 ── */

  const rowMap = new Map<string, StatsRow>();
  if (data) for (const r of data.rows) rowMap.set(`${r.textbook}|${r.type}`, r);

  const getValue = (textbook: string, type: string): number => {
    const r = rowMap.get(`${textbook}|${type}`);
    if (!r) return 0;
    return statusFilter === 'all' ? r.total : (r[statusFilter] ?? 0);
  };

  const filteredTextbooks = data
    ? (selectedTextbook ? data.textbooks.filter((t) => t === selectedTextbook) : data.textbooks)
    : [];
  const filteredTypes = data
    ? (selectedType ? data.types.filter((t) => t === selectedType) : data.types)
    : [];

  let heatMax = 0;
  if (data) for (const tb of filteredTextbooks) for (const tp of filteredTypes) heatMax = Math.max(heatMax, getValue(tb, tp));

  const textbookBars = filteredTextbooks.map((tb) => {
    const segments = filteredTypes
      .map((tp) => ({ key: tp, value: getValue(tb, tp), color: typeColor(tp) }))
      .filter((s) => s.value > 0);
    const total = segments.reduce((s, x) => s + x.value, 0);
    return { label: tb, segments, total };
  });
  const sortedTextbookBars = [...textbookBars].sort((a, b) => sortAsc ? a.total - b.total : b.total - a.total);
  const maxTextbookTotal = Math.max(...sortedTextbookBars.map((b) => b.total), 1);

  const typeBars = filteredTypes.map((tp) => {
    const 완료 = filteredTextbooks.reduce((s, tb) => s + (rowMap.get(`${tb}|${tp}`)?.완료 ?? 0), 0);
    const 대기 = filteredTextbooks.reduce((s, tb) => s + (rowMap.get(`${tb}|${tp}`)?.대기 ?? 0), 0);
    const 검수불일치 = filteredTextbooks.reduce((s, tb) => s + (rowMap.get(`${tb}|${tp}`)?.검수불일치 ?? 0), 0);
    const 기타 = filteredTextbooks.reduce((s, tb) => s + (rowMap.get(`${tb}|${tp}`)?.기타 ?? 0), 0);
    const total = 완료 + 대기 + 검수불일치 + 기타;
    return {
      label: tp,
      total,
      segments: [
        { key: '완료', value: 완료, color: '#10b981' },
        { key: '대기', value: 대기, color: '#f59e0b' },
        { key: '검수불일치', value: 검수불일치, color: '#ef4444' },
        { key: '기타', value: 기타, color: '#475569' },
      ].filter((s) => s.value > 0),
    };
  });
  const sortedTypeBars = [...typeBars].sort((a, b) => sortAsc ? a.total - b.total : b.total - a.total);
  const maxTypeTotal = Math.max(...sortedTypeBars.map((b) => b.total), 1);

  const grandTotal = data ? filteredTextbooks.reduce((s, tb) => s + (data.textbookTotals[tb] ?? 0), 0) : 0;

  /* ── 렌더 ── */

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/70 backdrop-blur-sm overflow-y-auto p-4">
      <div className="w-full max-w-6xl bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl my-4">

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              문제수 시각화
              {drillTextbook && (
                <>
                  <span className="text-slate-500">›</span>
                  <span className="text-indigo-300 text-base">{drillTextbook}</span>
                </>
              )}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {drillTextbook
                ? '소스(지문)별 문항 현황 — 교재명 클릭 시 드릴다운'
                : `교재별·유형별 변형문제 현황 — 총 ${grandTotal.toLocaleString()}문항 · 교재명 클릭 시 소스별 분석`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {drillTextbook && (
              <button
                onClick={() => setDrillTextbook(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs text-white"
              >
                ← 전체
              </button>
            )}
            <button
              onClick={load}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs text-white disabled:opacity-50"
            >
              {loading ? '불러오는 중…' : '새로고침'}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-red-900 text-xs text-white transition-colors"
            >
              ✕ 닫기
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin w-10 h-10 border-4 border-slate-600 border-t-indigo-400 rounded-full" />
          </div>
        )}
        {error && <div className="px-6 py-8 text-center text-red-400 text-sm">{error}</div>}

        {data && !loading && (
          <>
            {/* 드릴다운 뷰 */}
            {drillTextbook ? (
              <div className="px-6 py-5">
                <DrilldownPanel
                  textbook={drillTextbook}
                  statusFilter={statusFilter}
                  onBack={() => setDrillTextbook(null)}
                />
              </div>
            ) : (
              <>
                {/* 필터 바 */}
                <div className="px-6 py-3 border-b border-slate-700/60 flex flex-wrap gap-3 items-center bg-slate-800/40">
                  <div className="flex rounded-lg overflow-hidden border border-slate-600 text-xs">
                    {(['heatmap', 'bar-textbook', 'bar-type'] as ViewMode[]).map((m) => {
                      const labels: Record<ViewMode, string> = { heatmap: '히트맵', 'bar-textbook': '교재별 막대', 'bar-type': '유형별 막대' };
                      return (
                        <button
                          key={m}
                          onClick={() => setViewMode(m)}
                          className={`px-3 py-1.5 font-medium transition-colors ${viewMode === m ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                        >
                          {labels[m]}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex rounded-lg overflow-hidden border border-slate-600 text-xs">
                    {(['all', '완료', '대기', '검수불일치'] as StatusFilter[]).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStatusFilter(s)}
                        className={`px-2.5 py-1.5 font-medium transition-colors ${statusFilter === s ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                      >
                        {s === 'all' ? '전체' : s}
                      </button>
                    ))}
                  </div>

                  <select
                    value={selectedTextbook}
                    onChange={(e) => setSelectedTextbook(e.target.value)}
                    className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-white max-w-[200px]"
                  >
                    <option value="">모든 교재</option>
                    {data.textbooks.map((tb) => <option key={tb} value={tb}>{tb}</option>)}
                  </select>

                  <select
                    value={selectedType}
                    onChange={(e) => setSelectedType(e.target.value)}
                    className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-white"
                  >
                    <option value="">모든 유형</option>
                    {data.types.map((tp) => <option key={tp} value={tp}>{tp}</option>)}
                  </select>

                  {viewMode !== 'heatmap' && (
                    <button
                      onClick={() => setSortAsc((v) => !v)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 border border-slate-600 text-xs text-slate-300 hover:bg-slate-700"
                    >
                      {sortAsc ? '↑ 오름차순' : '↓ 내림차순'}
                    </button>
                  )}
                </div>

                {/* 본문 */}
                <div className="px-6 py-5">

                  {/* ── 히트맵 ── */}
                  {viewMode === 'heatmap' && (
                    <div>
                      <p className="text-xs text-slate-500 mb-3">
                        진할수록 많음 · 빨간 셀 = 거의 없음 · 교재명 클릭 → 소스별 상세
                      </p>
                      <div className="overflow-x-auto max-h-[55vh] overflow-y-auto">
                        <table className="text-xs border-collapse">
                          <thead className="sticky top-0 z-10 bg-slate-900">
                            <tr>
                              <th className="sticky left-0 z-20 bg-slate-900 px-2 py-1.5 text-left text-slate-400 font-medium min-w-[170px]">교재</th>
                              {filteredTypes.map((tp) => (
                                <th key={tp} className="px-1 py-1.5 text-center font-semibold min-w-[52px]" style={{ color: typeColor(tp) }}>{tp}</th>
                              ))}
                              <th className="px-2 py-1.5 text-right text-slate-400 font-medium">합계</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredTextbooks.map((tb) => {
                              const rowTotal = filteredTypes.reduce((s, tp) => s + getValue(tb, tp), 0);
                              return (
                                <tr key={tb} className="border-t border-slate-800 hover:bg-slate-800/40">
                                  <td className="sticky left-0 bg-slate-900 px-2 py-1 max-w-[200px]">
                                    <button
                                      onClick={() => setDrillTextbook(tb)}
                                      className="text-left text-indigo-300 hover:text-indigo-100 hover:underline text-xs leading-tight line-clamp-1 w-full"
                                      title={`${tb} — 소스별 분석`}
                                    >
                                      {tb}
                                    </button>
                                  </td>
                                  {filteredTypes.map((tp) => {
                                    const v = getValue(tb, tp);
                                    return (
                                      <td key={tp} className={`px-0.5 py-0.5 text-center font-mono rounded ${heatColor(v, heatMax)}`}>
                                        {v > 0 ? fmt(v) : ''}
                                      </td>
                                    );
                                  })}
                                  <td className="px-2 py-1 text-right text-slate-300 font-bold">{rowTotal.toLocaleString()}</td>
                                </tr>
                              );
                            })}
                            <tr className="border-t-2 border-slate-600 sticky bottom-0 bg-slate-900">
                              <td className="sticky left-0 bg-slate-900 px-2 py-1.5 text-indigo-300 font-bold">합계</td>
                              {filteredTypes.map((tp) => {
                                const v = filteredTextbooks.reduce((s, tb) => s + getValue(tb, tp), 0);
                                return <td key={tp} className="px-0.5 py-1.5 text-center font-bold text-slate-200">{v > 0 ? fmt(v) : '—'}</td>;
                              })}
                              <td className="px-2 py-1.5 text-right font-bold text-indigo-300">{grandTotal.toLocaleString()}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── 교재별 막대 ── */}
                  {viewMode === 'bar-textbook' && (
                    <div>
                      <p className="text-xs text-slate-500 mb-3">교재명 클릭 → 소스별 상세 분석</p>
                      <div className="overflow-y-auto max-h-[55vh]">
                        <BarChart
                          bars={sortedTextbookBars}
                          maxValue={maxTextbookTotal}
                          labelWidth={200}
                          onLabelClick={(label) => setDrillTextbook(label)}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {filteredTypes.map((tp) => (
                          <span key={tp} className="flex items-center gap-1 text-[10px] text-slate-400">
                            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: typeColor(tp) }} />
                            {tp}
                          </span>
                        ))}
                      </div>
                      {/* 하위 30% */}
                      <div className="mt-5 border-t border-slate-700 pt-4">
                        <h3 className="text-xs font-bold text-slate-300 mb-2">⚠️ 상대적으로 적은 교재 (하위 30%)</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                          {(() => {
                            const bars = sortedTextbookBars.filter((b) => b.total > 0);
                            const cutoff = Math.ceil(bars.length * 0.3);
                            return [...bars].sort((a, b) => a.total - b.total).slice(0, cutoff).map((b) => (
                              <button
                                key={b.label}
                                onClick={() => setDrillTextbook(b.label)}
                                className="rounded-lg bg-red-950/40 border border-red-900/50 px-3 py-2 text-left hover:bg-red-900/40 transition-colors"
                              >
                                <p className="text-[10px] text-red-300 line-clamp-2">{b.label}</p>
                                <p className="text-base font-bold text-red-200 mt-0.5">{b.total.toLocaleString()}</p>
                              </button>
                            ));
                          })()}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── 유형별 막대 ── */}
                  {viewMode === 'bar-type' && (
                    <div>
                      <p className="text-xs text-slate-500 mb-3">유형별 총 문항수 (상태별 색상 누적)</p>
                      <div className="overflow-y-auto max-h-[55vh]">
                        <BarChart bars={sortedTypeBars} maxValue={maxTypeTotal} labelWidth={120} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {[{ label: '완료', color: '#10b981' }, { label: '대기', color: '#f59e0b' }, { label: '검수불일치', color: '#ef4444' }, { label: '기타', color: '#475569' }].map(({ label, color }) => (
                          <span key={label} className="flex items-center gap-1 text-[10px] text-slate-400">
                            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
                            {label}
                          </span>
                        ))}
                      </div>
                      <div className="mt-5 border-t border-slate-700 pt-4">
                        <h3 className="text-xs font-bold text-slate-300 mb-2">⚠️ 상대적으로 적은 유형 (하위 30%)</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                          {(() => {
                            const bars = sortedTypeBars.filter((b) => b.total > 0);
                            const cutoff = Math.ceil(bars.length * 0.3);
                            return [...bars].sort((a, b) => a.total - b.total).slice(0, cutoff).map((b) => (
                              <div key={b.label} className="rounded-lg bg-red-950/40 border border-red-900/50 px-3 py-2">
                                <p className="text-[10px] font-bold mb-0.5" style={{ color: typeColor(b.label) }}>{b.label}</p>
                                <p className="text-base font-bold text-red-200">{b.total.toLocaleString()}</p>
                              </div>
                            ));
                          })()}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 히트맵 유형별 합계 */}
                  {viewMode === 'heatmap' && (
                    <div className="mt-4 border-t border-slate-700 pt-3">
                      <div className="flex flex-wrap gap-2">
                        {filteredTypes.map((tp) => {
                          const v = filteredTextbooks.reduce((s, tb) => s + getValue(tb, tp), 0);
                          return (
                            <div key={tp} className="rounded-lg px-2.5 py-1.5 bg-slate-800 border border-slate-700 text-xs">
                              <span style={{ color: typeColor(tp) }} className="font-bold">{tp}</span>
                              <span className="ml-1.5 text-slate-300">{v.toLocaleString()}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
