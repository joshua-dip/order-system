'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { questionHtml, answerLabel, problemView, CIRCLED_NUMS, type BankProblem, type BankFormat } from './shared';

interface TopicBlock { key: string; title: string; subtitle: string; problems: BankProblem[]; }
interface FlowBlock { id: string; node: ReactNode; keepWithNext?: boolean; breakBefore?: boolean; breakAfter?: boolean; }

// A4 치수(96dpi 기준 px 환산) — 실제 인쇄 페이지와 동일하게 화면에서도 A4 카드로 쪽 나눔.
const PX_PER_MM = 96 / 25.4;
const PAGE_W_MM = 210;
const PAGE_H_MM = 297;
const PAD_MM = 14;
const CONTENT_W_MM = PAGE_W_MM - PAD_MM * 2; // 182mm
const CONTENT_H_PX = (PAGE_H_MM - PAD_MM * 2) * PX_PER_MM; // ≈ 1016px

/**
 * 문제지 인쇄 워크시트 — 실제 A4 페이지 카드로 쪽 나눔(몇 페이지인지 바로 보임) + 정답지(별지).
 * 새 탭이 아니라 전체화면 오버레이라 '닫기'는 onClose 만 호출(window.close 미사용 = 웹뷰 포함 안전).
 * PDF 다운로드는 서버 렌더(chromium, 한글 폰트 임베드)로 pdfBase 라우트를 호출한다.
 */
interface ConceptData { title: string; intro: string; table?: { title?: string; headers: string[]; rows: string[][] }; points: { term: string; detail: string; example?: string }[]; tip?: string }

// 개념 파스텔 팔레트 — 부드러운 톤. 표의 격(열) 색 = 아래 설명 태그 색으로 "색=격" 인지.
const CONCEPT_PAL = [
  { bg: '#eaf1fb', ink: '#4f74b3' },
  { bg: '#eaf4ee', ink: '#4f9070' },
  { bg: '#f8f2e8', ink: '#a8824f' },
  { bg: '#f1ecfa', ink: '#7d6bb0' },
  { bg: '#f9ecf1', ink: '#b06f8c' },
  { bg: '#e9f4f4', ink: '#4f9494' },
];

/** 워크시트용 문법 개념 박스(문제 앞 한 페이지). 파스텔 톤·색 태그로 세련되고 간결하게. */
function ConceptBlockView({ c, title }: { c: ConceptData; title: string }) {
  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200/80 bg-white" style={{ breakInside: 'avoid', fontFamily: "'Jua', sans-serif" }}>
      <div className="flex items-center gap-2 border-b border-zinc-100 px-6 py-3">
        <span className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11.5px] text-zinc-500">문법 개념</span>
        <span className="text-[16.5px] text-zinc-700">{title}</span>
      </div>
      <div className="px-6 py-4">
        {c.intro && <p className="text-[14px] leading-7 text-zinc-500">{c.intro}</p>}
        {c.table && c.table.headers.length > 0 && c.table.rows.length > 0 && (
          <div className="mt-3 overflow-hidden rounded-xl border border-zinc-100">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {c.table.headers.map((h, i) => {
                    const col = CONCEPT_PAL[(i - 1 + CONCEPT_PAL.length) % CONCEPT_PAL.length];
                    return (
                      <th key={i} className="px-3 py-2 text-center text-[12.5px]"
                        style={i === 0 ? { background: '#f8f8f9', color: '#71717a' } : { background: col.bg, color: col.ink }}>{h}</th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {c.table.rows.map((r, ri) => (
                  <tr key={ri} className="border-t border-zinc-100">
                    {r.map((cell, ci) => <td key={ci} className="px-3 py-1.5 text-center"
                      style={ci === 0 ? { color: '#a1a1aa', fontSize: '12px' } : { color: '#3f3f46' }}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {c.points && c.points.length > 0 && (
          <div className="mt-4 space-y-3">
            {c.points.map((p, i) => {
              const col = CONCEPT_PAL[i % CONCEPT_PAL.length];
              return (
                <div key={i}>
                  {p.term && <span className="inline-block rounded-md px-2.5 py-0.5 text-[13.5px]" style={{ background: col.bg, color: col.ink }}>{p.term}</span>}
                  {p.detail && <p className="mt-1.5 text-[13.5px] leading-7 text-zinc-500">{p.detail}</p>}
                  {p.example && <p className="mt-1 text-[13px] leading-6 text-zinc-400">{p.example}</p>}
                </div>
              );
            })}
          </div>
        )}
        {c.tip && <p className="mt-4 rounded-lg bg-zinc-50 px-4 py-2.5 text-[12.5px] leading-6 text-zinc-400">💡 {c.tip}</p>}
      </div>
    </div>
  );
}

export function PrintWorksheet({
  keys,
  source = '',
  category = '',
  bankBase,
  conceptBase,
  conceptTopics,
  initialFmt = 'mc',
  onClose,
}: {
  keys: string[];
  source?: string;
  category?: string; // 객관식|주관식|선택형 필터(빈 값=전체)
  bankBase: string; // 예: '/api/my/vip/grammar-problems/bank'
  conceptBase?: string; // 예: '/api/my/vip/grammar-problems/concept' (없으면 개념 기능 숨김)
  conceptTopics?: Set<string>; // 개념 보유 topicKey (체크박스 노출 판단)
  initialFmt?: BankFormat;
  onClose: () => void;
}) {
  const pdfBase = bankBase.replace(/\/bank$/, '/print-pdf');
  const [blocks, setBlocks] = useState<TopicBlock[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withAnswers, setWithAnswers] = useState(true);
  const [fmt, setFmt] = useState<BankFormat>(initialFmt);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [includeConcepts, setIncludeConcepts] = useState(false);
  const [concepts, setConcepts] = useState<Record<string, ConceptData | null>>({});

  const keyStr = keys.join('|');
  const anyConcept = !!conceptBase && keys.some((k) => conceptTopics?.has(k));

  // 개념 포함 시 선택 범위의 개념 로드
  useEffect(() => {
    if (!includeConcepts || !conceptBase || keys.length === 0) return;
    let alive = true;
    Promise.all(
      keys.map((k) =>
        fetch(`${conceptBase}?topicKey=${encodeURIComponent(k)}`, { credentials: 'include' })
          .then((r) => r.json())
          .then((d) => [k, (d?.concept ?? null) as ConceptData | null] as const)
          .catch(() => [k, null] as const),
      ),
    ).then((entries) => { if (alive) setConcepts(Object.fromEntries(entries)); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeConcepts, conceptBase, keyStr]);

  useEffect(() => {
    if (keys.length === 0) { setError('선택한 범위가 없습니다.'); return; }
    let alive = true;
    setError(null);
    setBlocks(null);
    Promise.all(
      keys.map((k) =>
        fetch(`${bankBase}?topicKey=${encodeURIComponent(k)}${source ? `&source=${encodeURIComponent(source)}` : ''}${category ? `&category=${encodeURIComponent(category)}` : ''}`, { credentials: 'include' })
          .then((r) => r.json())
          .then((d): TopicBlock => {
            const segs = k.split(' > ');
            return { key: k, title: segs[segs.length - 1] ?? '', subtitle: segs.slice(0, -1).join(' · '), problems: d?.ok && Array.isArray(d.problems) ? (d.problems as BankProblem[]) : [] };
          })
          .catch((): TopicBlock => {
            const segs = k.split(' > ');
            return { key: k, title: segs[segs.length - 1] ?? '', subtitle: segs.slice(0, -1).join(' · '), problems: [] };
          }),
      ),
    )
      .then((bs) => { if (alive) setBlocks(bs); })
      .catch(() => { if (alive) setError('문제를 불러오지 못했습니다.'); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyStr, source, category, bankBase]);

  // ESC 로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const multi = keys.length > 1;
  const headerTitle = multi ? '선택 범위 문제지' : (blocks?.[0]?.title ?? '');
  const headerSub = multi ? `${keys.length}개 범위 · ${blocks?.[0]?.subtitle ?? ''}` : (blocks?.[0]?.subtitle ?? '');

  // 범위별 섹션 그룹
  const topicGroups = useMemo(() => {
    if (!blocks) return [];
    return blocks.map((b) => {
      const map = new Map<string, { instruction: string; choices?: string[]; items: BankProblem[] }>();
      for (const p of b.problems) {
        const v = problemView(p, fmt);
        if (!map.has(p.section)) map.set(p.section, { instruction: v.instruction, choices: v.choices, items: [] });
        map.get(p.section)!.items.push(p);
      }
      return { ...b, sections: [...map.entries()].map(([label, g]) => ({ label, ...g })) };
    });
  }, [blocks, fmt]);

  const anySubjective = !!blocks?.some((b) => b.problems.some((p) => p.subjective));
  const totalCount = blocks?.reduce((s, b) => s + b.problems.length, 0) ?? 0;

  // 페이지 쪽나눔용 흐름 블록(머리글 → 범위/섹션/문항 → 정답지). 문항마다 서술형 답란.
  const flowBlocks = useMemo<FlowBlock[]>(() => {
    if (!blocks) return [];
    const fb: FlowBlock[] = [];
    fb.push({
      id: 'hd',
      node: (
        <div className="border-b-2 border-zinc-900 pb-2">
          <p className="text-[11px] tracking-wide text-zinc-500">{headerSub}</p>
          <div className="flex items-end justify-between">
            <h1 className="text-xl font-extrabold">{headerTitle}</h1>
            <p className="text-[11px] text-zinc-500">이름 ______________ &nbsp; 날짜 ____월 ____일</p>
          </div>
        </div>
      ),
    });
    let seq = 0;
    for (const tb of topicGroups) {
      if (multi) {
        fb.push({
          id: `th-${tb.key}`,
          keepWithNext: true,
          node: (
            <h2 className="mt-5 border-l-4 border-zinc-900 pl-2 text-[15px] font-extrabold text-zinc-900">
              {tb.title}
              {tb.subtitle && <span className="ml-2 text-[11px] font-medium text-zinc-500">{tb.subtitle}</span>}
            </h2>
          ),
        });
      }
      // 문법 개념 페이지(선택) — 해당 범위 문제 앞에 삽입
      const concept = includeConcepts ? concepts[tb.key] : null;
      if (concept && (concept.intro || (concept.points && concept.points.length))) {
        // 개념은 한 페이지로 두고 그 뒤부터 문제 시작(breakAfter)
        fb.push({ id: `concept-${tb.key}`, breakAfter: true, node: <ConceptBlockView c={concept} title={concept.title || tb.title} /> });
      }
      if (tb.problems.length === 0) {
        fb.push({ id: `te-${tb.key}`, node: <p className="mt-2 text-[12px] text-zinc-400">이 범위의 문제가 없습니다.</p> });
        continue;
      }
      for (const g of tb.sections) {
        fb.push({
          id: `sh-${tb.key}-${g.label}`,
          keepWithNext: true,
          node: (
            <div className="mt-4">
              <p className="text-[13px] font-bold">
                <span className="mr-1.5 inline-block rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] font-extrabold text-white">{g.label}</span>
                {g.instruction}
              </p>
              {g.choices && g.choices.length > 0 && (
                <p className="mt-2 rounded border border-zinc-400 px-3 py-1.5 text-[13px]">
                  <span className="mr-2 text-[11px] text-zinc-500">|보기|</span>
                  {g.choices.join('   ·   ')}
                </p>
              )}
            </div>
          ),
        });
        for (const p of g.items) {
          seq += 1;
          const v = problemView(p, fmt);
          const isMc = !!v.options && v.options.length > 0;
          const answerLines = isMc ? 0 : v.type.includes('조건') ? 2 : 1;
          const n = seq;
          fb.push({
            id: `it-${p.id}`,
            node: (
              <div className="mt-3 text-[13.5px] leading-relaxed">
                <div className="flex gap-2">
                  <span className="font-bold">{n}.</span>
                  <span className="[&_u]:underline [&_u]:decoration-dotted" dangerouslySetInnerHTML={{ __html: questionHtml(p.question) }} />
                </div>
                {isMc && (
                  <div className="ml-6 mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-[13px]">
                    {v.options!.map((o, i) => <span key={i}>{CIRCLED_NUMS[i]} {o}</span>)}
                  </div>
                )}
                {answerLines > 0 && (
                  <div className="ml-6 mt-1.5">
                    {Array.from({ length: answerLines }).map((_, i) => (
                      <div key={i} className="border-b border-zinc-400" style={{ height: '1.7rem' }} />
                    ))}
                  </div>
                )}
              </div>
            ),
          });
        }
      }
    }
    // 정답지(별지) — 새 페이지에서 시작
    if (withAnswers && totalCount > 0) {
      fb.push({
        id: 'anh',
        breakBefore: true,
        keepWithNext: true,
        node: <h2 className="border-t-2 border-dashed border-zinc-400 pt-4 text-base font-extrabold">정답 및 해설 — {headerTitle}</h2>,
      });
      let n = 0;
      for (const tb of topicGroups) {
        if (tb.problems.length === 0) continue;
        if (multi) fb.push({ id: `ah-${tb.key}`, keepWithNext: true, node: <p className="mt-2 text-[12px] font-bold text-zinc-700">▎{tb.title}</p> });
        for (const g of tb.sections) {
          for (const p of g.items) {
            n += 1;
            const ans = fmt === 'subjective' && p.subjective ? p.subjective.answer : answerLabel(p);
            fb.push({
              id: `ans-${p.id}`,
              node: (
                <p className="mt-1 text-[12px] leading-relaxed">
                  <b>{n}.</b> <span className="font-semibold text-emerald-700">{ans}</span>
                  {p.explanation && <span className="text-zinc-500"> — {p.explanation}</span>}
                  <span className="ml-1 font-mono text-[10px] text-zinc-400">{p.serial}</span>
                </p>
              ),
            });
          }
        }
      }
    }
    return fb;
  }, [blocks, topicGroups, withAnswers, totalCount, multi, headerTitle, headerSub, fmt, includeConcepts, concepts]);

  // 흐름 블록을 A4 페이지 용량에 맞춰 쪽 나눔. 측정 높이는 state, 페이지 분할은 현재 flowBlocks 에서 파생
  // (인덱스를 state 에 저장하면 flowBlocks 가 바뀔 때 범위 초과로 크래시 → 항상 현재 배열 기준으로 계산).
  const measRef = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<number[] | null>(null);
  useLayoutEffect(() => {
    const el = measRef.current;
    if (!el || flowBlocks.length === 0) { setHeights(null); return; }
    const kids = Array.from(el.children) as HTMLElement[];
    setHeights(kids.map((k) => {
      const cs = getComputedStyle(k);
      return k.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    }));
  }, [flowBlocks]);

  const pages = useMemo<number[][] | null>(() => {
    if (flowBlocks.length === 0) return null;
    const h = heights ?? [];
    const res: number[][] = [];
    let cur: number[] = [];
    let used = 0;
    for (let i = 0; i < flowBlocks.length; i++) {
      const b = flowBlocks[i];
      const hi = h[i] || 0;
      if (b.breakBefore && cur.length) { res.push(cur); cur = []; used = 0; }
      // keepWithNext: 헤더가 페이지 끝에 홀로 남지 않도록 다음 블록까지 고려
      let need = hi;
      if (b.keepWithNext && i + 1 < flowBlocks.length) need += h[i + 1] || 0;
      // 머리글만 있는 페이지에 개념이 안 들어가도, 머리글을 홀로 두지 않고 함께 둔다
      // (개념은 breakAfter 라 어차피 자기 페이지를 차지 → 머리글+개념이 첫 페이지).
      const onlyHeader = cur.length === 1 && flowBlocks[cur[0]]?.id === 'hd';
      if (used > 0 && used + need > CONTENT_H_PX && !onlyHeader) { res.push(cur); cur = []; used = 0; }
      cur.push(i);
      used += hi;
      if (b.breakAfter) { res.push(cur); cur = []; used = 0; }
    }
    if (cur.length) res.push(cur);
    return res;
  }, [flowBlocks, heights]);

  const doPrint = () => {
    try { window.print(); } catch { /* 임베디드 브라우저 등 인쇄 미지원 환경 */ }
  };

  const downloadPdf = async () => {
    if (pdfLoading || keys.length === 0) return;
    setPdfLoading(true);
    try {
      const qs = keys.map((k) => `topicKey=${encodeURIComponent(k)}`).join('&')
        + `&fmt=${fmt}&answers=${withAnswers ? '1' : '0'}${source ? `&source=${encodeURIComponent(source)}` : ''}${category ? `&category=${encodeURIComponent(category)}` : ''}${includeConcepts ? '&concepts=1' : ''}`;
      const res = await fetch(`${pdfBase}?${qs}`, { credentials: 'include' });
      if (!res.ok) throw new Error('pdf');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${multi ? '선택범위_문제지' : (headerTitle || '문제지')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      alert('PDF 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setPdfLoading(false);
    }
  };

  const pageCount = pages?.length ?? 0;

  return (
    <div className="print-root fixed inset-0 z-[60] overflow-auto bg-zinc-200 print:bg-white">
      <style>{`
        @font-face { font-family: 'Jua'; font-style: normal; font-weight: 400; font-display: swap; src: url('/fonts/Jua-Regular.ttf') format('truetype'); }
        @media print {
          @page { size: A4; margin: 0; }
          body * { visibility: hidden; }
          .print-root, .print-root * { visibility: visible; }
          .print-root { position: absolute !important; inset: 0; background: #fff !important; }
          .no-print { display: none !important; }
          .ws-pages { margin: 0 !important; gap: 0 !important; }
          .ws-page { box-shadow: none !important; margin: 0 !important; }
          .ws-page + .ws-page { break-before: page; }
        }
      `}</style>

      {/* 도구 막대 (인쇄 시 숨김) */}
      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-zinc-300 bg-white/95 px-4 py-2.5 shadow-sm">
        <p className="text-sm font-bold text-zinc-800">문제지 인쇄 미리보기</p>
        {multi && <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[11px] font-bold text-white">{keys.length}개 범위</span>}
        {pageCount > 0 && <span className="rounded border border-zinc-300 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600">총 {pageCount}쪽</span>}
        <label className="ml-3 flex items-center gap-1.5 text-[12px] text-zinc-600">
          <input type="checkbox" checked={withAnswers} onChange={(e) => setWithAnswers(e.target.checked)} />
          정답지 포함
        </label>
        {anyConcept && (
          <label className="flex items-center gap-1.5 text-[12px] text-zinc-600" title="선택한 진도의 문법 개념 설명을 문제 앞에 넣습니다">
            <input type="checkbox" checked={includeConcepts} onChange={(e) => setIncludeConcepts(e.target.checked)} />
            📘 문법 개념 포함
          </label>
        )}
        {anySubjective && (
          <select value={fmt} onChange={(e) => setFmt(e.target.value === 'subjective' ? 'subjective' : 'mc')}
            className="rounded border border-zinc-300 px-2 py-1 text-[12px] text-zinc-700">
            <option value="mc">객관식</option>
            <option value="subjective">주관식 원형</option>
          </select>
        )}
        <button onClick={downloadPdf} disabled={pdfLoading}
          className="ml-auto rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-bold text-zinc-800 hover:bg-zinc-100 disabled:opacity-60">
          {pdfLoading ? '⏳ 생성 중…' : '⬇ PDF 다운로드'}
        </button>
        <button onClick={doPrint} className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-bold text-white hover:bg-zinc-700">🖨 인쇄</button>
        <button onClick={onClose} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100">닫기</button>
      </div>

      {/* 높이 측정용(숨김) */}
      <div ref={measRef} aria-hidden className="pointer-events-none invisible absolute left-[-99999px] top-0 bg-white text-zinc-900" style={{ width: `${CONTENT_W_MM}mm` }}>
        {flowBlocks.map((b) => <div key={b.id}>{b.node}</div>)}
      </div>

      {error ? (
        <p className="p-10 text-center text-sm text-rose-600">{error}</p>
      ) : !blocks || !pages ? (
        <p className="p-10 text-center text-sm text-zinc-500">불러오는 중…</p>
      ) : (
        <div className="ws-pages mx-auto my-4 flex flex-col items-center gap-4 print:my-0 print:gap-0">
          {pages.map((idxs, pi) => (
            <div key={pi} className="ws-page relative bg-white text-zinc-900 shadow" style={{ width: `${PAGE_W_MM}mm`, minHeight: `${PAGE_H_MM}mm`, padding: `${PAD_MM}mm` }}>
              {idxs.map((i) => flowBlocks[i]).filter(Boolean).map((b) => <div key={b.id}>{b.node}</div>)}
              <div className="no-print absolute bottom-3 right-4 text-[10px] text-zinc-400">{pi + 1} / {pages.length}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
