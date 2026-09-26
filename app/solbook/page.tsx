'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppBar from '@/app/components/AppBar';
import type { SolvookBook, SolvookCatalog, SolvookItem, SolvookUnit } from '@/lib/solvook-catalog';
import { trackEvent } from '@/lib/track-event';

/**
 * 쏠북 바로구매 — 왼쪽 교재 트리 · 오른쪽 교재 카드(자료 라인업).
 * 모의고사는 달마다 한 카드(전체 합본 · 번호별 종합 · 유형별 · 통합 워크북), 교재는 과·강마다 한 카드.
 */

/** 쏠북 상품 페이지 — lib/solvook-catalog 의 solvookProductUrl 과 같다(서버 모듈을 불러오지 않으려고 따로 둔다) */
const productUrl = (id: string) => `https://solvook.com/products/${id}`;
/** 한 번에 보여 주는 카드 수 — 「더 보기」로 늘린다 */
const PAGE_CARDS = 8;

const TAG_ORDER = ['변형문제', '워크북', '직보/파이널'];
const tagLabel = (t: string) => (t === '직보/파이널' ? '직보·파이널' : t);

function won(n: number): string {
  return `${n.toLocaleString()}원`;
}

function priceRange(items: SolvookItem[]): string {
  if (!items.length) return '';
  const ps = items.map((i) => i.price);
  const lo = Math.min(...ps), hi = Math.max(...ps);
  return lo === hi ? won(lo) : `${won(lo)}~${won(hi)}`;
}

/** 쏠북 상품 id 는 시간 순으로 커진다 — 길이 → 사전순으로 비교하면 최신순 */
function newerId(a: string, b: string): number {
  return b.length - a.length || (b > a ? 1 : b < a ? -1 : 0);
}

/**
 * 한 묶음 안 상품 제목이 모두 같은 머리말(「영어I_YBM박준언_변형문제_」)로 시작하면 그 머리말을 떼고 보여 준다.
 * 구분자(_ · 공백) 경계에서만 자르고, 너무 짧으면 그대로 둔다.
 */
function shortTitles(items: SolvookItem[]): Map<string, string> {
  const out = new Map<string, string>();
  if (items.length < 2) {
    for (const it of items) out.set(it.id, it.title.replace(/_/g, ' '));
    return out;
  }
  let prefix = items[0].title;
  for (const it of items) {
    let i = 0;
    while (i < prefix.length && i < it.title.length && prefix[i] === it.title[i]) i++;
    prefix = prefix.slice(0, i);
  }
  const cut = Math.max(prefix.lastIndexOf('_'), prefix.lastIndexOf(' '));
  const n = cut >= 5 ? cut + 1 : 0;
  for (const it of items) {
    const rest = it.title.slice(n).replace(/^[_\s]+/, '').replace(/_/g, ' ').trim();
    out.set(it.id, n && rest ? rest : it.title.replace(/_/g, ' '));
  }
  return out;
}

/** 묶음 안 정렬 — 변형문제 → 워크북 → 직보·파이널, 같은 유형은 제목(숫자 인식) 순 */
function compareItems(a: SolvookItem, b: SolvookItem): number {
  const ia = TAG_ORDER.indexOf(a.tag), ib = TAG_ORDER.indexOf(b.tag);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.title.localeCompare(b.title, 'ko', { numeric: true });
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

/* ── 모의고사: 제목 표기가 제각각이라(127가지) 제목을 해석해 번호별 · 유형별 · 합본으로 다시 짠다 ── */

/** 「2026 고1 모의고사 영어」처럼 연도로 시작하는 모의고사 교재만 — 「미니 모의고사」 같은 참고서는 아니다 */
function isMockBook(source: string): boolean {
  return /^20\d\d\s.*모의고사/.test(source);
}

/** 「10월 모의고사」 → 「10월」, 「대수능」 → 「수능」 */
function mockUnitLabel(unit: string): string {
  const m = unit.match(/^0?(\d{1,2})월/);
  if (m) return `${Number(m[1])}월`;
  if (/수능/.test(unit)) return '수능';
  return unit;
}
/** 최신순 정렬용 달 — 수능은 11월 다음 */
function mockMonthOrder(unit: string): number {
  const m = unit.match(/^0?(\d{1,2})월/);
  if (m) return Number(m[1]);
  return /수능/.test(unit) ? 11.5 : 0;
}

const MOCK_TYPES = '주제|제목|주장|일치|불일치|함의|빈칸|요약|어법|어휘|순서|삽입|무관한문장';
/** 제목의 묶음 유형 약칭 → 화면 표기 */
const MOCK_TYPE_ALIASES: Record<string, string> = { 주제주일불: '주제·주장·일치·불일치' };
type MockVariant = '기본' | '고난도' | '전 유형' | '워크북';

type MockPart =
  | { kind: 'num'; num: string; order: number; variant: MockVariant }
  | { kind: 'type'; type: string; round: number | null }
  | { kind: 'bundle'; label: string }
  | { kind: 'other' };

function parseMock(it: SolvookItem): MockPart {
  const t = it.title;
  const num = (m: RegExpMatchArray) => ({ num: `${m[1]}번`, order: Number(m[1].split('~')[0]) });
  let m = t.match(/(\d{1,2}(?:~\d{1,2})?)번\s*통합\s*워크북/);
  if (m) return { kind: 'num', ...num(m), variant: '워크북' };
  m = t.match(new RegExp(`(?:^|[_\\s])(?:변형문제_)?(주제주일불|${MOCK_TYPES})(-고난도)?(?:[\\s_]*(\\d+)회차)?(?:[\\s_]*\\[|\\s*$)`));
  if (m && !/\d번/.test(t)) return { kind: 'type', type: `${MOCK_TYPE_ALIASES[m[1]] ?? m[1]}${m[2] ?? ''}`, round: m[3] ? Number(m[3]) : null };
  m = t.match(/워크북_([^_\[\]]+)\s*$/);
  if (m) return { kind: 'bundle', label: `${m[1].trim()} 워크북` };
  m = t.match(/(기본|고난도)\s*전체\s*합본/);
  if (m) return { kind: 'bundle', label: `${m[1]} 전체 합본` };
  /* 번호가 붙은 제목(「20번_변형문제 [93문항]」)은 합본이 아니다 */
  const hasNum = /\d번/.test(t);
  if (!hasNum && /전체_?일반/.test(t)) return { kind: 'bundle', label: '전체 합본 · 일반' };
  if (!hasNum && /전체\s*합본|전문항|변형문제(?:_전체)?_?\s*\[/.test(t)) return { kind: 'bundle', label: '전 유형 전체 합본' };
  m = t.match(/(?:번호)?(\d{1,2}(?:~\d{1,2})?)번[\s_]*(기본|고난도)?/);
  if (m && it.tag === '변형문제') {
    const v = m[2] as MockVariant | undefined;
    return { kind: 'num', ...num(m), variant: v ?? '전 유형' };
  }
  return { kind: 'other' };
}

/* ── 트리 · 카드 모델 ── */

interface TreeNode {
  key: string;
  label: string;
  count: number;
  children?: TreeNode[];
}

interface Card {
  key: string;
  node: string;
  title: string;
  sub: string;
  image?: string;
  mock: boolean;
  items: SolvookItem[];
  /** 최신순 정렬 키 — 클수록 최신 */
  recency: number;
  newestId: string;
}

function gradeOf(source: string): string {
  if (/국어/.test(source)) return '국어';
  const g = source.match(/고([123])/)?.[1];
  return g ? `고${g}` : '기타';
}

/** 카탈로그 → (트리, 카드 목록). 카드는 교재 × 단원(모의고사는 달) 하나. */
function buildModel(catalog: SolvookCatalog): { tree: TreeNode[]; cards: Card[] } {
  const tree: TreeNode[] = [];
  const cards: Card[] = [];
  const cardOf = (book: SolvookBook, u: SolvookUnit, node: string): Card => {
    const mock = isMockBook(book.source);
    const year = Number(book.source.match(/^(20\d\d)/)?.[1] ?? 0);
    const newestId = u.items.reduce((best, it) => (newerId(best, it.id) > 0 ? it.id : best), u.items[0]?.id ?? '0');
    if (mock) {
      const grade = gradeOf(book.source);
      const month = mockUnitLabel(u.unit);
      const subject = /국어/.test(book.source) ? '국어' : '영어';
      return {
        key: `${book.source}::${u.unit}`,
        node,
        title: month === '수능' ? `${year}년 수능 ${subject}` : `${year}년 ${month} ${grade === '국어' ? '고1' : grade} ${subject} 모의고사`,
        sub: `${grade === '국어' ? '국어' : grade} · ${year}년 · ${month}`,
        image: u.image,
        mock: true,
        items: u.items,
        recency: year * 100 + mockMonthOrder(u.unit),
        newestId,
      };
    }
    return {
      key: `${book.source}::${u.unit}`,
      node,
      title: u.unit === '전체' ? `${book.title} · 전체` : `${book.title} · ${u.unit}`,
      sub: book.title,
      image: u.image,
      mock: false,
      items: u.items,
      recency: 0,
      newestId,
    };
  };

  for (const cat of catalog.categories) {
    const catKey = `cat:${cat.title}`;
    const children: TreeNode[] = [];
    const hasMock = cat.books.some((b) => isMockBook(b.source));
    if (hasMock) {
      /* 모의고사는 학년별로 묶는다(연도별 교재를 한 학년 아래로) */
      const byGrade = new Map<string, SolvookBook[]>();
      for (const b of cat.books) byGrade.set(gradeOf(b.source), [...(byGrade.get(gradeOf(b.source)) ?? []), b]);
      const order = ['고1', '고2', '고3', '국어', '기타'];
      for (const g of [...byGrade.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b))) {
        const key = `${catKey}/${g}`;
        const books = byGrade.get(g)!;
        children.push({ key, label: g === '국어' ? '국어' : `${g.replace('고', '')}학년`, count: books.reduce((n, b) => n + b.count, 0) });
        for (const b of books) for (const u of b.units) cards.push(cardOf(b, u, key));
      }
    } else {
      for (const b of cat.books) {
        const key = `${catKey}/${b.source}`;
        children.push({ key, label: b.title, count: b.count });
        for (const u of b.units) cards.push(cardOf(b, u, key));
      }
    }
    tree.push({ key: catKey, label: cat.title, count: cat.count, children });
  }
  /* 모의고사가 주력이라 맨 앞(처음 열리는 곳)으로 */
  tree.sort((a, b) => Number(/모의고사/.test(b.label)) - Number(/모의고사/.test(a.label)));
  return { tree, cards };
}

/* ── 페이지 ── */

export default function SolbookPage() {
  return (
    <Suspense fallback={null}>
      <SolbookInner />
    </Suspense>
  );
}

type SortKey = 'recent' | 'name';

function SolbookInner() {
  const params = useSearchParams();
  const [catalog, setCatalog] = useState<SolvookCatalog | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string>('전체');
  const [node, setNode] = useState<string>('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [shown, setShown] = useState(PAGE_CARDS);

  useEffect(() => {
    let alive = true;
    fetch('/api/solbook/catalog')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.ok) setCatalog(d.catalog);
        else setError(d?.error || '목록을 불러오지 못했습니다.');
      })
      .catch(() => alive && setError('목록을 불러오지 못했습니다.'));
    return () => {
      alive = false;
    };
  }, []);

  const model = useMemo(() => (catalog ? buildModel(catalog) : null), [catalog]);

  /* ?q= · ?book= (주문서·안내 링크) — 검색어로 연다 */
  useEffect(() => {
    const q = params.get('q') || params.get('book');
    if (q) setQuery(q);
  }, [params]);

  /* 처음엔 첫 카테고리의 첫 항목(보통 모의고사 1학년)을 연다 */
  useEffect(() => {
    if (model && !node) setNode(model.tree[0]?.children?.[0]?.key ?? model.tree[0]?.key ?? '');
  }, [model, node]);

  useEffect(() => setShown(PAGE_CARDS), [node, query, tag, sort]);

  const tokens = useMemo(() => query.trim().split(/\s+/).map(normalize).filter(Boolean), [query]);
  const searching = tokens.length > 0;

  const visibleCards = useMemo(() => {
    if (!model) return [];
    const list: Card[] = [];
    for (const c of model.cards) {
      if (!searching && !(c.node === node || c.node.startsWith(`${node}/`))) continue;
      const items = c.items
        .filter((it) => tag === '전체' || it.tag === tag)
        .filter((it) => !searching || tokens.every((t) => normalize(`${c.title} ${c.sub} ${it.title}`).includes(t)))
        .sort(compareItems);
      if (items.length) list.push({ ...c, items });
    }
    return list.sort((a, b) =>
      sort === 'name'
        ? a.title.localeCompare(b.title, 'ko', { numeric: true })
        : b.recency - a.recency || newerId(a.newestId, b.newestId) || a.title.localeCompare(b.title, 'ko', { numeric: true }),
    );
  }, [model, node, tag, tokens, searching, sort]);

  const itemCount = visibleCards.reduce((n, c) => n + c.items.length, 0);
  const nodeLabel = useMemo(() => {
    for (const t of model?.tree ?? []) {
      if (t.key === node) return t.label;
      const ch = t.children?.find((c) => c.key === node);
      if (ch) return `${t.label} · ${ch.label}`;
    }
    return '';
  }, [model, node]);

  const selectNode = (key: string) => {
    setNode(key);
    setQuery('');
  };

  return (
    <div
      className="min-h-screen bg-slate-50"
      onClickCapture={(e) => {
        /* 쏠북 상품·매장 링크 클릭을 사용 기록으로 — 어떤 자료가 관심을 받는지 */
        const a = (e.target as HTMLElement).closest('a[href^="https://solvook.com/"]') as HTMLAnchorElement | null;
        if (!a) return;
        const id = a.href.match(/\/products\/(\d+)/)?.[1];
        trackEvent(id ? 'solbook_product_click' : 'solbook_store_click', { productId: id, title: a.title || a.textContent?.trim().slice(0, 120), query: query.trim() || undefined });
      }}
    >
      <AppBar title="쏠북 바로구매" />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">쏠북 바로구매</h1>
            <p className="mt-1.5 text-sm text-slate-600">교재를 고르면 쏠북에 올라온 자료 라인업을 한눈에 보고 바로 구매할 수 있어요.</p>
          </div>
          {catalog && (
            <a
              href={catalog.storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:border-slate-500"
            >
              쏠북 매장 전체 보기 <span aria-hidden>↗</span>
            </a>
          )}
        </header>

        {error && <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">{error}</div>}
        {!catalog && !error && <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">쏠북 자료 목록을 불러오는 중…</div>}

        {catalog && model && (
          <div className="lg:flex lg:items-start lg:gap-6">
            {/* 왼쪽 트리 — 데스크톱 */}
            <aside className="hidden lg:block lg:w-64 lg:shrink-0 lg:sticky lg:top-20">
              <nav className="max-h-[calc(100vh-7rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white py-2" aria-label="교재 고르기">
                <div className="px-4 pb-1.5 pt-1 text-[11px] font-bold text-slate-400">교재 고르기</div>
                {model.tree.map((t) => (
                  <div key={t.key} className="border-t border-slate-100 first:border-t-0">
                    <TreeButton on={node === t.key && !searching} onClick={() => selectNode(t.key)} strong count={t.count}>
                      {t.label}
                    </TreeButton>
                    {t.children?.map((c) => (
                      <TreeButton key={c.key} on={node === c.key && !searching} onClick={() => selectNode(c.key)} count={c.count} indent>
                        {c.label}
                      </TreeButton>
                    ))}
                  </div>
                ))}
              </nav>
            </aside>

            {/* 오른쪽 */}
            <div className="min-w-0 flex-1">
              {/* 모바일 — 카테고리 칩 두 줄 */}
              <div className="mb-3 lg:hidden">
                <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
                  {model.tree.map((t) => {
                    const on = node === t.key || node.startsWith(`${t.key}/`);
                    return (
                      <Chip key={t.key} on={on && !searching} subtle onClick={() => selectNode(t.children?.[0]?.key ?? t.key)}>
                        {t.label}
                      </Chip>
                    );
                  })}
                </div>
                {(() => {
                  const parent = model.tree.find((t) => node === t.key || node.startsWith(`${t.key}/`));
                  if (!parent?.children?.length || searching) return null;
                  return (
                    <div className="-mx-4 mt-1.5 flex gap-1.5 overflow-x-auto px-4 pb-1">
                      {parent.children.map((c) => (
                        <Chip key={c.key} on={node === c.key} onClick={() => selectNode(c.key)}>
                          {c.label}
                        </Chip>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* 필터 */}
              <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs font-bold text-slate-500">유형</span>
                  {['전체', ...TAG_ORDER.filter((t) => catalog.tags[t]), ...Object.keys(catalog.tags).filter((t) => !TAG_ORDER.includes(t))].map((t) => (
                    <Chip key={t} on={tag === t} onClick={() => setTag(t)}>
                      {t === '전체' ? '모두' : tagLabel(t)}
                    </Chip>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="교재·단원·번호로 찾기 (예: 공통영어 2 박준언, 26년 6월 고2, 41~42번)"
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
                  />
                  <div className="flex shrink-0 overflow-hidden rounded-lg border border-slate-300 text-xs font-semibold">
                    {(
                      [
                        ['recent', '최신순'],
                        ['name', '이름순'],
                      ] as [SortKey, string][]
                    ).map(([k, l]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setSort(k)}
                        className={`px-3 ${sort === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-2.5 flex items-center justify-between text-xs text-slate-500">
                  <span>
                    {searching ? (
                      <>
                        「{query.trim()}」 검색 결과{' '}
                        <button type="button" onClick={() => setQuery('')} className="ml-1 font-semibold text-sky-700 hover:underline">
                          지우기
                        </button>
                      </>
                    ) : (
                      nodeLabel
                    )}
                  </span>
                  <span className="tabular-nums">
                    교재 {visibleCards.length.toLocaleString()} · 자료 {itemCount.toLocaleString()}개
                  </span>
                </div>
              </div>

              {isMockNode(node) && !searching && (
                <p className="mb-3 text-xs text-slate-500">
                  모의고사는 <b className="text-slate-700">전체 합본 · 번호별 종합 · 유형별</b>로 나뉘어 있어 필요한 만큼만 골라 살 수 있어요. 세 구성은 같은 문항을 다르게 묶은 것이라{' '}
                  <b className="text-slate-700">중복 구매에 유의</b>해 주세요.
                </p>
              )}

              {visibleCards.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
                  조건에 맞는 자료가 아직 쏠북에 없어요. 필요한 교재·단원은 주문서로 맞춤 제작을 요청하실 수 있어요.{' '}
                  <a href={catalog.storeUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-sky-700 underline underline-offset-2">
                    쏠북 매장 전체 보기
                  </a>
                </div>
              ) : (
                <div className="space-y-4">
                  {visibleCards.slice(0, shown).map((c) => (
                    <CatalogCard key={c.key} card={c} />
                  ))}
                  {shown < visibleCards.length && (
                    <button
                      type="button"
                      onClick={() => setShown((n) => n + PAGE_CARDS)}
                      className="w-full rounded-xl border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700 hover:border-slate-500"
                    >
                      더 보기 ({(visibleCards.length - shown).toLocaleString()}개 교재 남음)
                    </button>
                  )}
                </div>
              )}

              <p className="mt-10 text-center text-xs text-slate-400">
                가격·구성은 쏠북 기준이며 결제는 쏠북에서 진행됩니다 · 쏠북 기준 {new Date(catalog.fetchedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 갱신
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function isMockNode(node: string): boolean {
  return /^cat:모의고사/.test(node);
}

function TreeButton({
  on,
  onClick,
  strong,
  indent,
  count,
  children,
}: {
  on: boolean;
  onClick: () => void;
  strong?: boolean;
  indent?: boolean;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={on ? 'true' : undefined}
      className={`flex w-full items-center gap-2 border-l-2 py-1.5 pr-4 text-left text-sm transition-colors ${indent ? 'pl-7' : 'pl-4'} ${
        on ? 'border-sky-600 bg-sky-50 font-semibold text-slate-900' : 'border-transparent text-slate-700 hover:bg-slate-50'
      } ${strong ? 'font-bold' : ''}`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{count.toLocaleString()}</span>
    </button>
  );
}

function Chip({ on, onClick, subtle, children }: { on: boolean; onClick: () => void; subtle?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        on ? (subtle ? 'border-slate-800 bg-slate-800 text-white' : 'border-sky-600 bg-sky-600 text-white') : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

/* ── 카드 ── */

function Cover({ card }: { card: Card }) {
  if (card.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={card.image} alt="" loading="lazy" className="h-24 w-[72px] shrink-0 rounded-md border border-slate-200 bg-slate-100 object-cover" />
    );
  }
  return (
    <div className="flex h-24 w-[72px] shrink-0 items-center justify-center rounded-md bg-slate-800 px-1 text-center text-[11px] font-bold leading-tight text-white">
      {card.mock ? card.sub.split(' · ').slice(-1)[0] : '쏠북'}
    </div>
  );
}

function CatalogCard({ card }: { card: Card }) {
  const tags = TAG_ORDER.map((t) => [t, card.items.filter((i) => i.tag === t).length] as const).filter(([, n]) => n > 0);
  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex gap-4 p-4">
        <Cover card={card} />
        <div className="min-w-0 flex-1">
          <h3 className="font-bold leading-snug text-slate-900">{card.title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{card.sub}</p>
          <p className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {tags.map(([t, n]) => (
              <span key={t} className="rounded border border-slate-300 px-1.5 py-0.5 font-semibold text-slate-600">
                {tagLabel(t)} {n}
              </span>
            ))}
          </p>
        </div>
      </div>
      <div className="border-t border-slate-100 px-4 pb-3 pt-2">
        <div className="mb-1 flex items-center justify-between text-[11px] font-bold text-slate-400">
          <span>자료 라인업</span>
          <span>금액</span>
        </div>
        {card.mock ? <MockLineup items={card.items} /> : <PlainLineup items={card.items} />}
      </div>
    </article>
  );
}

function BuyLink({ item, label }: { item: SolvookItem; label?: string }) {
  return (
    <a
      href={productUrl(item.id)}
      title={item.title}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700"
    >
      {label ?? '구매'} <span aria-hidden>↗</span>
    </a>
  );
}

/** 한 카드에 처음 보여 주는 상품 수 — 나머지는 「더 보기」 */
const LINEUP_PREVIEW = 10;

function PlainLineup({ items }: { items: SolvookItem[] }) {
  const shorts = shortTitles(items);
  const [all, setAll] = useState(false);
  const list = all ? items : items.slice(0, LINEUP_PREVIEW);
  return (
    <ul className="divide-y divide-slate-100">
      {list.map((it) => (
        <li key={it.id} className="flex items-center gap-2.5 py-2">
          <span className="w-16 shrink-0 text-[10px] font-bold text-slate-500">{tagLabel(it.tag)}</span>
          <span className="min-w-0 flex-1 text-sm leading-snug text-slate-800 [overflow-wrap:anywhere] line-clamp-2">{shorts.get(it.id)}</span>
          {it.questions != null && <span className="hidden shrink-0 text-xs tabular-nums text-slate-500 sm:inline">{it.questions}문항</span>}
          <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{won(it.price)}</span>
          <BuyLink item={it} />
        </li>
      ))}
      {items.length > LINEUP_PREVIEW && (
        <li className="pt-2">
          <button type="button" onClick={() => setAll((v) => !v)} className="w-full rounded-lg bg-slate-50 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100">
            {all ? '접기' : `${(items.length - LINEUP_PREVIEW).toLocaleString()}개 더 보기`}
          </button>
        </li>
      )}
    </ul>
  );
}

/** 펼침 행 — 한 줄 요약 + 누르면 아래에 상세 */
function ExpandRow({ title, desc, price, children }: { title: string; desc: string; price: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-2">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-slate-900">{title}</span>
          <span className="ml-2 text-xs text-slate-500">{desc}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{price}</span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700">
          {open ? '접기' : '골라 사기'} <span aria-hidden className={`transition-transform ${open ? 'rotate-180' : ''}`}>▾</span>
        </span>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </li>
  );
}

function CellLink({ item }: { item: SolvookItem }) {
  return (
    <a
      href={productUrl(item.id)}
      title={item.title}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col items-center rounded-md border border-slate-200 bg-white px-1.5 py-1 leading-tight hover:border-sky-600"
    >
      <span className="text-[11px] tabular-nums text-slate-500">{item.questions != null ? `${item.questions}문항` : '상품 보기'}</span>
      <span className="text-xs font-semibold tabular-nums text-slate-800">{won(item.price)}</span>
    </a>
  );
}

function MockLineup({ items }: { items: SolvookItem[] }) {
  const rows = new Map<string, { order: number; cells: Partial<Record<MockVariant, SolvookItem>> }>();
  const types = new Map<string, SolvookItem[]>();
  const bundles: { label: string; it: SolvookItem }[] = [];
  const others: SolvookItem[] = [];
  for (const it of items) {
    const p = parseMock(it);
    if (p.kind === 'num') {
      const r = rows.get(p.num) ?? { order: p.order, cells: {} };
      if (!r.cells[p.variant]) r.cells[p.variant] = it;
      else others.push(it);
      rows.set(p.num, r);
    } else if (p.kind === 'type') types.set(p.type, [...(types.get(p.type) ?? []), it]);
    else if (p.kind === 'bundle') bundles.push({ label: p.label, it });
    else others.push(it);
  }
  const rowList = [...rows.entries()].sort((a, b) => a[1].order - b[1].order);
  const numCols = (['기본', '고난도', '전 유형'] as MockVariant[]).filter((v) => rowList.some(([, r]) => r.cells[v]));
  const numItems = rowList.flatMap(([, r]) => numCols.map((c) => r.cells[c]).filter((x): x is SolvookItem => !!x));
  const wbItems = rowList.map(([, r]) => r.cells['워크북']).filter((x): x is SolvookItem => !!x);
  const typeOrder = MOCK_TYPES.split('|');
  const idx = (t: string) => {
    const i = typeOrder.indexOf(t.replace('-고난도', ''));
    return i < 0 ? -1 : i; // 묶음(주제·주장·일치·불일치)은 맨 앞
  };
  const typeList = [...types.entries()].sort((a, b) => idx(a[0]) - idx(b[0]) || a[0].length - b[0].length);
  const typeItems = typeList.flatMap(([, l]) => l);
  const roundOf = (it: SolvookItem) => (parseMock(it) as { round?: number | null }).round ?? null;
  const numLabel = (c: MockVariant) => (c === '기본' ? '기본' : c === '고난도' ? '고난도' : '전 유형');

  return (
    <ul className="divide-y divide-slate-100">
      {bundles.map(({ label, it }) => (
        <li key={it.id} className="flex items-center gap-2.5 py-2">
          <span className="min-w-0 flex-1">
            <span className="text-sm font-semibold text-slate-900">{label}</span>
            <span className="ml-2 text-xs text-slate-500">
              전 지문을 한 파일로{it.questions != null ? ` · ${it.questions.toLocaleString()}문항` : ''}
            </span>
          </span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{won(it.price)}</span>
          <BuyLink item={it} />
        </li>
      ))}

      {numItems.length > 0 && (
        <ExpandRow
          title="번호별 종합"
          desc={`${rowList.filter(([, r]) => numCols.some((c) => r.cells[c])).length}개 번호 · ${numCols.map(numLabel).join('·')} — 한 지문을 여러 유형으로`}
          price={priceRange(numItems)}
        >
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full min-w-[280px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-500">
                  <th className="px-3 py-2 text-left">번호</th>
                  {numCols.map((c) => (
                    <th key={c} className="px-1.5 py-2 text-center">
                      {numLabel(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowList
                  .filter(([, r]) => numCols.some((c) => r.cells[c]))
                  .map(([num, r]) => (
                    <tr key={num} className="border-b border-slate-100 last:border-0">
                      <td className="whitespace-nowrap px-3 py-1.5 font-semibold tabular-nums text-slate-800">{num}</td>
                      {numCols.map((c) => (
                        <td key={c} className="px-1.5 py-1.5">
                          {r.cells[c] ? <CellLink item={r.cells[c]!} /> : <span className="block text-center text-xs text-slate-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </ExpandRow>
      )}

      {typeItems.length > 0 && (
        <ExpandRow
          title="유형별"
          desc={`${new Set(typeList.map(([t]) => t.replace('-고난도', ''))).size}개 유형${typeList.some(([t]) => t.endsWith('-고난도')) ? ' · 기본·고난도' : ''} · 회차별 — 필요한 유형만`}
          price={priceRange(typeItems)}
        >
          <div className="space-y-1">
            {typeList.map(([type, list]) => (
              <div key={type} className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-1.5">
                <span className="w-24 shrink-0 text-xs font-semibold text-slate-800">{type}</span>
                {[...list]
                  .sort((a, b) => (roundOf(a) ?? 0) - (roundOf(b) ?? 0))
                  .map((it) => (
                    <a
                      key={it.id}
                      href={productUrl(it.id)}
                      title={it.title}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] tabular-nums text-slate-700 hover:border-sky-600"
                    >
                      {roundOf(it) != null ? `${roundOf(it)}회차 · ` : ''}
                      {it.questions != null ? `${it.questions}문항 · ` : ''}
                      {won(it.price)}
                    </a>
                  ))}
              </div>
            ))}
          </div>
        </ExpandRow>
      )}

      {wbItems.length > 0 && (
        <ExpandRow title="통합 워크북" desc={`${wbItems.length}개 번호 — 번호별 워크북`} price={priceRange(wbItems)}>
          <div className="flex flex-wrap gap-1.5">
            {rowList
              .filter(([, r]) => r.cells['워크북'])
              .map(([num, r]) => (
                <a
                  key={num}
                  href={productUrl(r.cells['워크북']!.id)}
                  title={r.cells['워크북']!.title}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs tabular-nums text-slate-700 hover:border-sky-600"
                >
                  <b className="font-semibold text-slate-900">{num}</b> · {won(r.cells['워크북']!.price)}
                </a>
              ))}
          </div>
        </ExpandRow>
      )}

      {others.map((it) => (
        <li key={it.id} className="flex items-center gap-2.5 py-2">
          <span className="w-16 shrink-0 text-[10px] font-bold text-slate-500">{tagLabel(it.tag)}</span>
          <span className="min-w-0 flex-1 text-sm leading-snug text-slate-800 [overflow-wrap:anywhere] line-clamp-2">{it.title.replace(/_/g, ' ')}</span>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{won(it.price)}</span>
          <BuyLink item={it} />
        </li>
      ))}
    </ul>
  );
}
