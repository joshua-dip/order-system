'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AppBar from '@/app/components/AppBar';
import type { SolvookBook, SolvookCatalog, SolvookItem } from '@/lib/solvook-catalog';

/** 쏠북 상품 페이지 — lib/solvook-catalog 의 solvookProductUrl 과 같다(클라이언트에서 서버 모듈을 불러오지 않으려고 따로 둔다) */
const productUrl = (id: string) => `https://solvook.com/products/${id}`;
/** 검색 결과에서 한 번에 그리는 최대 상품 수 */
const SEARCH_RENDER_CAP = 300;

const TAG_ORDER = ['변형문제', '워크북', '직보/파이널'];
const tagLabel = (t: string) => (t === '직보/파이널' ? '직보·파이널' : t);

function won(n: number): string {
  return `${n.toLocaleString()}원`;
}

/**
 * 한 단원 안 상품 제목이 모두 같은 머리말(「영어I_YBM박준언_변형문제_」·「25년 10월 고3 영어모의고사_」)로
 * 시작하면 그 머리말을 떼고 보여 준다. 구분자(_ · 공백) 경계에서만 자르고, 너무 짧으면 그대로 둔다.
 */
function shortTitles(items: SolvookItem[]): Map<string, string> {
  const out = new Map<string, string>();
  if (items.length < 2) {
    for (const it of items) out.set(it.id, it.title);
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
    out.set(it.id, n && rest ? rest : it.title);
  }
  return out;
}

/** 단원 안 정렬 — 변형문제 → 워크북 → 직보·파이널, 같은 유형은 제목(숫자 인식) 순 */
function compareItems(a: SolvookItem, b: SolvookItem): number {
  const ia = TAG_ORDER.indexOf(a.tag), ib = TAG_ORDER.indexOf(b.tag);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.title.localeCompare(b.title, 'ko', { numeric: true });
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

export default function SolbookPage() {
  return (
    <Suspense fallback={null}>
      <SolbookInner />
    </Suspense>
  );
}

function SolbookInner() {
  const params = useSearchParams();
  const [catalog, setCatalog] = useState<SolvookCatalog | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string>('전체');
  const [category, setCategory] = useState<string>('전체');
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    /* ?q= · ?book= 로 바로 들어오면(주문서·안내 링크) 검색어·펼침을 맞춘다 */
    const q = params.get('q');
    if (q) setQuery(q);
    const book = params.get('book');
    if (book) {
      setQuery(book);
      setOpen(new Set([book]));
    }
  }, [params]);

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

  const tokens = useMemo(() => normalize(query) ? query.trim().split(/\s+/).map(normalize).filter(Boolean) : [], [query]);

  /** 필터(유형·카테고리·검색어)를 적용한 카테고리 → 교재 → 단원 트리 */
  const view = useMemo(() => {
    if (!catalog) return [];
    const itemOk = (book: SolvookBook, unit: string, it: SolvookItem) => {
      if (tag !== '전체' && it.tag !== tag) return false;
      if (!tokens.length) return true;
      const hay = normalize(`${book.source} ${book.title} ${unit} ${it.title}`);
      return tokens.every((t) => hay.includes(t));
    };
    return catalog.categories
      .filter((c) => category === '전체' || c.title === category)
      .map((c) => {
        const books = c.books
          .map((b) => {
            const units = b.units
              .map((u) => ({ unit: u.unit, items: u.items.filter((it) => itemOk(b, u.unit, it)).sort(compareItems) }))
              .filter((u) => u.items.length > 0);
            const count = units.reduce((s, u) => s + u.items.length, 0);
            return { book: b, units, count };
          })
          .filter((b) => b.count > 0);
        return { cat: c, books, count: books.reduce((s, b) => s + b.count, 0) };
      })
      .filter((c) => c.books.length > 0);
  }, [catalog, tag, category, tokens]);

  const matchCount = view.reduce((s, c) => s + c.count, 0);
  const searching = tokens.length > 0;

  const toggle = (source: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });

  let rendered = 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <AppBar title="쏠북 바로구매" />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">쏠북 바로구매</h1>
          <p className="mt-1.5 text-sm text-slate-600">
            고미조슈아가 쏠북에 올린 변형문제·워크북을 교재별로 모았습니다. 상품을 누르면 쏠북 상품 페이지로 이동해요.
          </p>
          {catalog && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              <span>
                전체 <b className="text-slate-800 tabular-nums">{catalog.total.toLocaleString()}</b>개
              </span>
              <span aria-hidden>·</span>
              <span>쏠북 기준 {new Date(catalog.fetchedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 갱신</span>
              <a
                href={catalog.storeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:border-slate-500"
              >
                쏠북 매장 전체 보기 <span aria-hidden>↗</span>
              </a>
            </div>
          )}
        </header>

        {error && <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">{error}</div>}
        {!catalog && !error && <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">쏠북 자료 목록을 불러오는 중…</div>}

        {catalog && (
          <>
            <div className="pb-2 pt-1">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="교재·단원·번호로 검색 (예: 공통영어 2 박준언, 26년 6월 고2, 41~42번)"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600"
              />
            </div>
            <div className="mb-4">
              <div className="mt-1 flex flex-wrap gap-1.5">
                {['전체', ...TAG_ORDER.filter((t) => catalog.tags[t]), ...Object.keys(catalog.tags).filter((t) => !TAG_ORDER.includes(t))].map((t) => (
                  <Chip key={t} on={tag === t} onClick={() => setTag(t)}>
                    {t === '전체' ? '전체 유형' : tagLabel(t)}
                    {t !== '전체' && <span className="ml-1 tabular-nums opacity-60">{catalog.tags[t]?.toLocaleString()}</span>}
                  </Chip>
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {['전체', ...catalog.categories.map((c) => c.title)].map((c) => (
                  <Chip key={c} on={category === c} onClick={() => setCategory(c)} subtle>
                    {c === '전체' ? '전체 교재' : c}
                  </Chip>
                ))}
              </div>
            </div>

            {searching && (
              <p className="mb-3 text-xs text-slate-500">
                「{query.trim()}」 검색 결과 <b className="text-slate-800">{matchCount.toLocaleString()}</b>개
                {matchCount > SEARCH_RENDER_CAP && ` · 앞의 ${SEARCH_RENDER_CAP}개만 펼쳐 보여요. 검색어를 더 좁혀 보세요.`}
              </p>
            )}

            {view.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
                조건에 맞는 자료가 아직 쏠북에 없어요. 필요한 교재·단원은 주문서로 맞춤 제작을 요청하실 수 있어요.{' '}
                <a href={catalog.storeUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-sky-700 underline underline-offset-2">
                  쏠북 매장 전체 보기
                </a>
              </div>
            )}

            <div className="space-y-8">
              {view.map(({ cat, books, count }) => (
                <section key={cat.title}>
                  <h2 className="mb-2.5 flex items-baseline gap-2 text-sm font-bold text-slate-900">
                    <span>{cat.title}</span>
                    <span className="text-xs font-medium text-slate-400 tabular-nums">{count.toLocaleString()}</span>
                  </h2>
                  <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
                    {books.map(({ book, units, count: n }) => {
                      const expanded = open.has(book.source) || (searching && rendered < SEARCH_RENDER_CAP);
                      return (
                        <div key={book.source}>
                          <button
                            type="button"
                            onClick={() => toggle(book.source)}
                            aria-expanded={expanded}
                            className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold text-slate-900">{book.title}</span>
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {TAG_ORDER.filter((t) => book.tags[t]).map((t) => `${tagLabel(t)} ${book.tags[t]}`).join(' · ')}
                                {' · '}단원 {book.units.length}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">{n.toLocaleString()}개</span>
                            <span className={`shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden>
                              ›
                            </span>
                          </button>
                          {expanded && (
                            <div className="border-t border-slate-100 bg-slate-50/60 px-4 pb-3">
                              {units.map((u) => {
                                if (searching && rendered >= SEARCH_RENDER_CAP) return null;
                                const shorts = shortTitles(u.items);
                                return (
                                  <div key={u.unit} className="pt-3">
                                    <div className="mb-1.5 text-xs font-bold text-slate-600">{u.unit}</div>
                                    <ul className="space-y-1">
                                      {u.items.map((it) => {
                                        if (searching && rendered >= SEARCH_RENDER_CAP) return null;
                                        rendered++;
                                        return <ItemRow key={it.id} item={it} label={shorts.get(it.id) ?? it.title} />;
                                      })}
                                    </ul>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            <p className="mt-10 text-center text-xs text-slate-400">
              가격·구성은 쏠북 기준이며 결제는 쏠북에서 진행됩니다. 원하는 조합이 없으면 주문서로 맞춤 제작을 요청해 주세요.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Chip({ on, onClick, subtle, children }: { on: boolean; onClick: () => void; subtle?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        on
          ? subtle
            ? 'border-slate-800 bg-slate-800 text-white'
            : 'border-sky-600 bg-sky-600 text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:border-slate-500'
      }`}
    >
      {children}
    </button>
  );
}

function ItemRow({ item, label }: { item: SolvookItem; label: string }) {
  return (
    <li>
      <a
        href={productUrl(item.id)}
        title={item.title}
        target="_blank"
        rel="noopener noreferrer"
        className="group flex items-center gap-2.5 rounded-lg border border-transparent bg-white px-3 py-2 hover:border-slate-300"
      >
        <span className="shrink-0 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{tagLabel(item.tag)}</span>
        <span className="min-w-0 flex-1 text-sm leading-snug text-slate-800 [overflow-wrap:anywhere] line-clamp-2 sm:line-clamp-1 group-hover:text-slate-950">{label}</span>
        {item.questions != null && <span className="hidden shrink-0 text-xs tabular-nums text-slate-500 sm:inline">{item.questions}문항</span>}
        <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-700">{won(item.price)}</span>
        <span className="shrink-0 text-xs font-bold text-sky-600" aria-hidden>
          ↗
        </span>
      </a>
    </li>
  );
}
