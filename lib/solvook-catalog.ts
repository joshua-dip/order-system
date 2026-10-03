/**
 * 쏠북(solvook.com) 고미조슈아 브랜드 판매 자료 목록 — 공개 페이지(/solbook)용.
 *
 * 쏠북 매장이 쓰는 공개 API(api-market.solvook.com/brands/<brand>/…)를 그대로 읽어 교재 → 단원 → 상품으로 묶는다.
 * 손으로 링크를 옮겨 적지 않는다 — 쏠북에 올리면 다음 새로고침(6시간) 때 자동으로 반영된다.
 * 쏠북이 응답하지 않으면 마지막으로 받은 스냅샷(Mongo)을 그대로 보여 준다. 가격도 쏠북 값을 그대로 쓴다.
 */
import { getDb } from '@/lib/mongodb';

export const SOLVOOK_BRAND = 'gomijoshua';
export const SOLVOOK_STORE_URL = `https://solvook.com/@${SOLVOOK_BRAND}`;
const API = `https://api-market.solvook.com/brands/${SOLVOOK_BRAND}`;
const SNAPSHOT_COLLECTION = 'solvook_catalog_snapshots';
/** 이보다 오래된 스냅샷이면 요청 때 새로 받는다 */
export const SOLVOOK_REFRESH_MS = 6 * 60 * 60 * 1000;
const PAGE = 100;
const HEADERS = { origin: 'https://solvook.com', referer: 'https://solvook.com/', 'user-agent': 'Mozilla/5.0 (gomijoshua catalog)' };

export type SolvookTag = '변형문제' | '워크북' | '직보/파이널' | string;

export interface SolvookItem {
  id: string;
  title: string;
  tag: SolvookTag;
  price: number;
  /** 제목의 [N문항]·N문제 — 없으면 null */
  questions: number | null;
}

export interface SolvookUnit {
  unit: string;
  /** 표지 — 단원 안 첫 상품의 쏠북 썸네일(상품마다 넣으면 목록이 너무 커진다) */
  image?: string;
  /** 서술형 자료의 표지(있으면) — 「서술형」 모아 보기 카드에 쓴다 */
  essayImage?: string;
  items: SolvookItem[];
}

export interface SolvookBook {
  /** 화면 표기 — 「[22개정][YBM] 」 같은 머리말을 뗀 교재명 */
  title: string;
  /** 쏠북 원래 교재명(sourceName) */
  source: string;
  count: number;
  tags: Record<string, number>;
  units: SolvookUnit[];
}

export interface SolvookCategory {
  title: string;
  emoji: string;
  count: number;
  books: SolvookBook[];
}

/** 목록 모양이 바뀌면 올린다 — 옛 스냅샷은 6시간을 기다리지 않고 새로 받는다 */
export const SOLVOOK_CATALOG_VERSION = 5;

export interface SolvookCatalog {
  version?: number;
  brand: string;
  storeUrl: string;
  fetchedAt: string;
  total: number;
  tags: Record<string, number>;
  categories: SolvookCategory[];
}

type RawItem = {
  id: string;
  title: string;
  unit?: string | null;
  category?: { tag?: string } | null;
  price?: number | null;
  imageUrl?: string | null;
  sourceName?: string | null;
  subject?: string | null;
};
type RawCategories = { depthItems?: { title: string; emoji?: string; items?: { title: string }[] }[] };

export function solvookProductUrl(id: string): string {
  return `https://solvook.com/products/${id}`;
}

/** 「[22개정][YBM] 공통영어 2 (박준언)」 → 「공통영어 2 (박준언)」 */
function bookTitle(source: string): string {
  return source.replace(/^(\[[^\]]*\]\s*)+/, '').trim();
}

function parseQuestions(title: string): number | null {
  const m = title.match(/(\d{1,5})\s*(?:문항|문제)/);
  return m ? Number(m[1]) : null;
}

/** 단원 정렬 — 「전체」 맨 앞, 숫자 순(1과·2강·03월·Test 3), 대수능은 맨 뒤 */
function unitRank(u: string): [number, number, string] {
  if (/^전체/.test(u)) return [0, 0, u];
  if (/대수능/.test(u)) return [3, 0, u];
  const n = u.match(/\d+/);
  return n ? [1, Number(n[0]), u] : [2, 0, u];
}
function compareUnits(a: string, b: string): number {
  const x = unitRank(a), y = unitRank(b);
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], 'ko');
}

/** 교재 정렬 — 연도가 있으면 최신 먼저, 같으면 학년 순 */
function compareBooks(a: SolvookBook, b: SolvookBook): number {
  const ya = Number(a.source.match(/^(20\d\d)/)?.[1] ?? 0);
  const yb = Number(b.source.match(/^(20\d\d)/)?.[1] ?? 0);
  return yb - ya || a.source.localeCompare(b.source, 'ko');
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: HEADERS, cache: 'no-store', signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`solvook ${r.status} ${url}`);
  return (await r.json()) as T;
}

async function fetchSubject(subject: string): Promise<RawItem[]> {
  const first = await getJson<{ pagination: { total: number }; items: RawItem[] }>(`${API}/search?subject=${subject}&limit=${PAGE}&offset=0`);
  const total = first.pagination?.total ?? first.items.length;
  const offsets: number[] = [];
  for (let off = PAGE; off < total; off += PAGE) offsets.push(off);
  const out = [...first.items];
  /* 동시에 6개씩 — 쏠북에 부담을 주지 않을 만큼만 */
  for (let i = 0; i < offsets.length; i += 6) {
    const pages = await Promise.all(
      offsets.slice(i, i + 6).map((off) =>
        getJson<{ items: RawItem[] }>(`${API}/search?subject=${subject}&limit=${PAGE}&offset=${off}`),
      ),
    );
    for (const p of pages) out.push(...p.items);
  }
  return out;
}

/** 쏠북에서 새로 받아 묶는다 */
export async function fetchSolvookCatalog(): Promise<SolvookCatalog> {
  const [cats, en, ko] = await Promise.all([
    getJson<RawCategories>(`${API}/categories`),
    fetchSubject('EN'),
    fetchSubject('KO').catch(() => [] as RawItem[]),
  ]);
  const seen = new Set<string>();
  const raw = [...en, ...ko].filter((i) => i?.id && !seen.has(i.id) && seen.add(i.id));

  /* 교재(sourceName) → 단원 → 상품 */
  const bookMap = new Map<string, Map<string, SolvookItem[]>>();
  const unitImage = new Map<string, string>();
  const unitImageScore = new Map<string, number>();
  for (const r of raw) {
    const source = (r.sourceName ?? '').trim() || '기타';
    const unit = (r.unit ?? '').trim() || '전체';
    const item: SolvookItem = {
      id: String(r.id),
      title: String(r.title ?? '').trim(),
      tag: r.category?.tag ?? '기타',
      price: Number(r.price ?? 0),
      questions: parseQuestions(String(r.title ?? '')),
    };
    if (!bookMap.has(source)) bookMap.set(source, new Map());
    const units = bookMap.get(source)!;
    if (!units.has(unit)) units.set(unit, []);
    units.get(unit)!.push(item);
    /* 표지: 파일명에 「표지」가 든 이미지 > 페이지 썸네일(thumbnail)이 아닌 것 > 아무거나 */
    /* 서술형 표지는 따로 — 같은 단원 객관식 카드에 서술형 표지가 붙지 않게 */
    const imgKey = `${source}\u0000${unit}${/_서술형\s|서술형\s*특강/.test(item.title) ? '\u0000essay' : ''}`;   // 「Unit 05 서술형 연습」은 객관식
    if (r.imageUrl) {
      const url = String(r.imageUrl);
      const decoded = (() => {
        try {
          return decodeURIComponent(url);
        } catch {
          return url;
        }
      })();
      const score = /표지/.test(decoded) ? 3 : /thumbnail/i.test(decoded) ? 1 : 2;
      const prev = unitImage.get(imgKey);
      if (!prev || score > (unitImageScore.get(imgKey) ?? 0)) {
        unitImage.set(imgKey, url);
        unitImageScore.set(imgKey, score);
      }
    }
  }
  const books = new Map<string, SolvookBook>();
  for (const [source, units] of bookMap) {
    const tags: Record<string, number> = {};
    let count = 0;
    const list: SolvookUnit[] = [...units.entries()]
      .sort((a, b) => compareUnits(a[0], b[0]))
      .map(([unit, items]) => {
        for (const it of items) { tags[it.tag] = (tags[it.tag] ?? 0) + 1; count++; }
        return {
          unit,
          image: unitImage.get(`${source}\u0000${unit}`) ?? unitImage.get(`${source}\u0000${unit}\u0000essay`),
          essayImage: unitImage.get(`${source}\u0000${unit}\u0000essay`),
          items: items.sort((a, b) => a.title.localeCompare(b.title, 'ko', { numeric: true })),
        };
      });
    books.set(source, { title: bookTitle(source), source, count, tags, units: list });
  }

  /* 쏠북 브랜드 카테고리(EBS·모의고사/수능·참고서·교과서)로 묶는다. 카테고리 이름이 같은 것은 합친다. */
  const categories: SolvookCategory[] = [];
  const placed = new Set<string>();
  for (const d of cats.depthItems ?? []) {
    let cat = categories.find((c) => c.title === d.title);
    if (!cat) { cat = { title: d.title, emoji: d.emoji ?? '', count: 0, books: [] }; categories.push(cat); }
    for (const it of d.items ?? []) {
      const b = [...books.values()].find((x) => !placed.has(x.source) && (x.source === it.title || x.title === bookTitle(it.title)));
      if (!b) continue;
      placed.add(b.source);
      cat.books.push(b);
      cat.count += b.count;
    }
  }
  /* 쏠북 브랜드 카테고리에 아직 안 넣은 교재(새로 올린 책) — EBS 교재는 이름으로 EBS 에 넣는다.
     「하루 6개 1등급」 고1·고2 가 「기타」에 따로 떨어져 고3(EBS)과 갈라져 보였다(10/4) */
  const EBS_BOOK = /하루\s*6개|올림포스|수능특강|수능완성|기출의\s*미래|EBS/;
  const ebs = categories.find((c) => c.title === 'EBS');
  const rest: SolvookBook[] = [];
  for (const b of books.values()) {
    if (placed.has(b.source)) continue;
    if (ebs && EBS_BOOK.test(b.source)) {
      ebs.books.push(b);
      ebs.count += b.count;
    } else rest.push(b);
  }
  if (rest.length) categories.push({ title: '기타', emoji: '📦', count: rest.reduce((s, b) => s + b.count, 0), books: rest });
  for (const c of categories) c.books.sort(compareBooks);

  const tags: Record<string, number> = {};
  for (const b of books.values()) for (const [t, n] of Object.entries(b.tags)) tags[t] = (tags[t] ?? 0) + n;
  return {
    version: SOLVOOK_CATALOG_VERSION,
    brand: SOLVOOK_BRAND,
    storeUrl: SOLVOOK_STORE_URL,
    fetchedAt: new Date().toISOString(),
    total: raw.length,
    tags,
    categories: categories.filter((c) => c.books.length > 0),
  };
}

/**
 * 스냅샷을 돌려준다. 6시간이 지났거나 force 면 쏠북에서 새로 받고, 실패하면 옛 스냅샷을 쓴다.
 */
export async function getSolvookCatalog(opts: { force?: boolean } = {}): Promise<SolvookCatalog | null> {
  const db = await getDb('gomijoshua');
  const col = db.collection<{ _id: string; catalog: SolvookCatalog; fetchedAt: Date }>(SNAPSHOT_COLLECTION);
  const snap = await col.findOne({ _id: SOLVOOK_BRAND });
  const fresh =
    snap &&
    snap.catalog?.version === SOLVOOK_CATALOG_VERSION &&
    Date.now() - new Date(snap.fetchedAt).getTime() < SOLVOOK_REFRESH_MS;
  if (fresh && !opts.force) return snap.catalog;
  try {
    const catalog = await fetchSolvookCatalog();
    if (catalog.total > 0) {
      await col.updateOne({ _id: SOLVOOK_BRAND }, { $set: { catalog, fetchedAt: new Date() } }, { upsert: true });
      return catalog;
    }
  } catch (e) {
    console.error('[solvook-catalog] refresh failed', e);
  }
  return snap?.catalog ?? null;
}
