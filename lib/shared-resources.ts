/**
 * 공유자료 (/shared-resources) — 서버 전용 인덱서.
 *
 *  - 자료 파일은 `public/shared-resources/<examSlug>/<category>/...` 에 둔다.
 *  - 회차별 폴더 안에 선택적 `meta.json` 으로 표시 라벨·정렬·카테고리 순서 지정.
 *  - 이 모듈은 **서버 전용** (`fs` 사용). 클라이언트 컴포넌트는 `lib/shared-resources-shared` 에서 import.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { CategoryGroup, ExamMeta, ResourceItem } from './shared-resources-shared';

/* 클라이언트도 같이 쓸 타입·헬퍼는 그대로 재노출 (서버 코드도 그대로 import 해도 OK) */
export type { CategoryGroup, ExamMeta, ResourceItem, ResourceVariant } from './shared-resources-shared';
export { CATEGORY_META, getCategoryMeta, formatFileSize } from './shared-resources-shared';

const ROOT = path.join(process.cwd(), 'public', 'shared-resources');

/* ─────────────────────────────────────────────────────────────────────────────
 * 디스크 스캔 — TTL in-memory 캐시
 *
 * Why TTL (not mtime): 깊은 하위 폴더에 파일 추가/삭제 시 회차 dir 의 mtime 이
 *   파일시스템에 따라 갱신 안 될 수 있음 (ext4 한정). 그래서 30s TTL 로 단순화.
 *   ISR(revalidate=60) 와 합쳐도 자료 갱신은 최대 90s 안에 노출됨.
 * ──────────────────────────────────────────────────────────────────────────── */

const SCAN_CACHE_TTL_MS = 30_000;
interface CacheEntry<T> { expiresAt: number; value: T; }
const summariesCache: { entry: CacheEntry<ExamMeta[]> | null } = { entry: null };
const detailCache = new Map<string, CacheEntry<{ meta: ExamMeta; groups: CategoryGroup[] }>>();

/** 회차 슬러그 목록 (폴더만, meta.json 유무는 보지 않음) */
export function listExamSlugs(): string[] {
  if (!fs.existsSync(ROOT)) return [];
  return fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

/** 회차 메타 + 통계만 가져오기 (목록 페이지용, 자료 자체는 스캔하지 않음) */
export function listExamSummaries(): ExamMeta[] {
  const now = Date.now();
  if (summariesCache.entry && summariesCache.entry.expiresAt > now) {
    return summariesCache.entry.value;
  }
  const slugs = listExamSlugs();
  const out: ExamMeta[] = [];
  for (const slug of slugs) {
    const meta = readExamMeta(slug);
    const stats = scanExamStats(slug);
    out.push({ ...meta, slug, stats });
  }
  out.sort((a, b) => {
    const ao = a.order ?? 999;
    const bo = b.order ?? 999;
    if (ao !== bo) return ao - bo;
    return a.label.localeCompare(b.label, 'ko');
  });
  summariesCache.entry = { expiresAt: now + SCAN_CACHE_TTL_MS, value: out };
  return out;
}

function readExamMeta(slug: string): ExamMeta {
  const metaPath = path.join(ROOT, slug, 'meta.json');
  let raw: Partial<ExamMeta> = {};
  if (fs.existsSync(metaPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {
      /* 잘못된 JSON 은 무시 */
    }
  }
  return {
    slug,
    label: raw.label ?? slug,
    shortLabel: raw.shortLabel,
    subtitle: raw.subtitle,
    order: raw.order,
    category_order: raw.category_order,
    stats: { totalFiles: 0, totalBytes: 0, categoryCount: 0 },
  };
}

function scanExamStats(slug: string) {
  const examDir = path.join(ROOT, slug);
  if (!fs.existsSync(examDir)) {
    return { totalFiles: 0, totalBytes: 0, categoryCount: 0 };
  }
  const cats = fs
    .readdirSync(examDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'));
  let totalFiles = 0;
  let totalBytes = 0;
  for (const cat of cats) {
    walkFiles(path.join(examDir, cat.name), (file) => {
      totalFiles++;
      totalBytes += file.size;
    });
  }
  return { totalFiles, totalBytes, categoryCount: cats.length };
}

function walkFiles(dir: string, cb: (file: { abs: string; size: number; name: string }) => void) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkFiles(abs, cb);
    } else if (e.isFile()) {
      if (e.name.toLowerCase() === 'meta.json') continue;
      const stat = fs.statSync(abs);
      cb({ abs, size: stat.size, name: e.name });
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * 회차 상세 스캔 (카테고리·번호별)
 * ──────────────────────────────────────────────────────────────────────────── */

export function getExamDetail(slug: string): {
  meta: ExamMeta;
  groups: CategoryGroup[];
} | null {
  const examDir = path.join(ROOT, slug);
  if (!fs.existsSync(examDir)) return null;

  const now = Date.now();
  const cached = detailCache.get(slug);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const meta = readExamMeta(slug);
  const categories = fs
    .readdirSync(examDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name);

  /** category → subCategory|null → itemKey → ResourceItem */
  const map = new Map<string, Map<string | null, Map<string, ResourceItem>>>();
  let totalFiles = 0;
  let totalBytes = 0;

  for (const cat of categories) {
    const catDir = path.join(examDir, cat);
    const catEntries = fs.readdirSync(catDir, { withFileTypes: true });

    for (const entry of catEntries) {
      if (entry.name.startsWith('.')) continue;
      const entryAbs = path.join(catDir, entry.name);

      if (entry.isDirectory()) {
        const subEntries = fs.readdirSync(entryAbs, { withFileTypes: true });
        for (const sub of subEntries) {
          if (sub.isFile() && !sub.name.startsWith('.')) {
            registerFile({
              cat,
              subCategory: entry.name,
              fileAbs: path.join(entryAbs, sub.name),
              filename: sub.name,
              slug,
              map,
              counters: (size) => {
                totalFiles++;
                totalBytes += size;
              },
            });
          }
        }
      } else if (entry.isFile() && !entry.name.startsWith('.')) {
        registerFile({
          cat,
          subCategory: null,
          fileAbs: entryAbs,
          filename: entry.name,
          slug,
          map,
          counters: (size) => {
            totalFiles++;
            totalBytes += size;
          },
        });
      }
    }
  }

  const groups: CategoryGroup[] = [];
  for (const [cat, subMap] of map.entries()) {
    let groupFiles = 0;
    let groupBytes = 0;
    const subGroups: CategoryGroup['subGroups'] = [];
    const subKeys = [...subMap.keys()];
    subKeys.sort((a, b) => {
      if (a === null) return -1;
      if (b === null) return 1;
      return a.localeCompare(b, 'ko');
    });
    for (const subKey of subKeys) {
      const itemMap = subMap.get(subKey)!;
      const items = [...itemMap.values()];
      for (const it of items) {
        it.variants.sort((a, b) => extOrder(a.ext) - extOrder(b.ext));
      }
      /* 통합본(sortValue 99999) 도 그냥 큰 값으로 정렬 끝에. 클라이언트가 fullItems / numberItems
         로 다시 분리해서 노출하므로 여기 순서는 안전망 정도 의미. */
      items.sort((a, b) => a.sortValue - b.sortValue);
      for (const it of items) {
        for (const v of it.variants) {
          groupFiles++;
          groupBytes += v.sizeBytes;
        }
      }
      subGroups.push({ subCategory: subKey, items });
    }
    groups.push({ category: cat, subGroups, totalFiles: groupFiles, totalBytes: groupBytes });
  }

  const order = meta.category_order ?? [];
  groups.sort((a, b) => {
    const ai = order.indexOf(a.category);
    const bi = order.indexOf(b.category);
    if (ai === -1 && bi === -1) return a.category.localeCompare(b.category, 'ko');
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const result = {
    meta: { ...meta, stats: { totalFiles, totalBytes, categoryCount: groups.length } },
    groups,
  };
  detailCache.set(slug, { expiresAt: now + SCAN_CACHE_TTL_MS, value: result });
  return result;
}

function registerFile(args: {
  cat: string;
  subCategory: string | null;
  fileAbs: string;
  filename: string;
  slug: string;
  map: Map<string, Map<string | null, Map<string, ResourceItem>>>;
  counters: (size: number) => void;
}) {
  const { cat: rawCat, subCategory: rawSub, fileAbs, filename: rawFilename, slug, map, counters } = args;
  /* macOS APFS 는 NFD 로 보관 — 모든 한글 식별자를 NFC 로 정규화하여 일관 처리 */
  const cat = rawCat.normalize('NFC');
  const subCategory = rawSub ? rawSub.normalize('NFC') : null;
  const filename = rawFilename.normalize('NFC');

  if (filename.toLowerCase() === 'meta.json') return;

  const stat = fs.statSync(fileAbs);
  counters(stat.size);

  const ext = parseExt(filename);
  const { numberKey, label, sortValue } = parseNumberFromFilename(filename);

  const subMap = getOrCreate(map, cat, () => new Map<string | null, Map<string, ResourceItem>>());
  const itemMap = getOrCreate(subMap, subCategory, () => new Map<string, ResourceItem>());

  const itemKey = `${subCategory ?? ''}::${numberKey}`;
  let item = itemMap.get(itemKey);
  if (!item) {
    item = {
      examSlug: slug,
      category: cat,
      subCategory: subCategory ?? undefined,
      numberKey,
      label,
      sortValue,
      variants: [],
    };
    itemMap.set(itemKey, item);
  }
  const relSegments = [slug, cat, ...(subCategory ? [subCategory] : []), filename];
  const href = '/shared-resources/' + relSegments.map((s) => encodeURIComponent(s)).join('/');
  item.variants.push({
    ext,
    filename,
    sizeBytes: stat.size,
    href,
  });
}

function getOrCreate<K, V>(map: Map<K, V>, key: K, factory: () => V): V {
  let v = map.get(key);
  if (v === undefined) {
    v = factory();
    map.set(key, v);
  }
  return v;
}

function parseExt(filename: string): ResourceItem['variants'][number]['ext'] {
  /* 마지막 점 이후만 확장자로. 점이 없거나 끝이면 'other'. */
  const m = filename.match(/\.([^.]+)$/);
  const ext = (m?.[1] ?? '').toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'hwp' || ext === 'hwpx') return 'hwp';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  return 'other';
}

function extOrder(ext: ResourceItem['variants'][number]['ext']): number {
  switch (ext) {
    case 'pdf':
      return 0;
    case 'hwp':
      return 1;
    case 'docx':
      return 2;
    case 'xlsx':
      return 3;
    default:
      return 9;
  }
}

function parseNumberFromFilename(filename: string): { numberKey: string; label: string; sortValue: number } {
  /* 호출자(registerFile / collectZipEntries) 가 NFC 정규화한 filename 을 넘긴다 가정. */
  const base = filename.replace(/\.[^.]+$/, '');
  const m = base.match(/^(\d+(?:~\d+)?)번/);
  if (m) {
    const numTxt = m[1];
    const first = parseInt(numTxt.split('~')[0], 10);
    return { numberKey: numTxt, label: `${numTxt}번`, sortValue: isNaN(first) ? 9999 : first };
  }
  return { numberKey: 'all', label: '통합본', sortValue: 99999 };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * ZIP 묶음용 헬퍼 (API route 가 사용)
 * ──────────────────────────────────────────────────────────────────────────── */

/** 안전 경로 — `public/shared-resources/` 밖으로 못 나가게 정규화 */
export function resolveSafePath(...segments: string[]): string | null {
  const target = path.resolve(ROOT, ...segments);
  const root = path.resolve(ROOT) + path.sep;
  if (target !== path.resolve(ROOT) && !target.startsWith(root)) return null;
  if (!fs.existsSync(target)) return null;
  return target;
}

export function collectZipEntries(args: {
  examSlug: string;
  category?: string;
  subCategory?: string;
  /** 단일 번호 키 (기존 호환). numberKeys 와 동시 지정 시 numberKeys 가 우선. */
  numberKey?: string;
  /** 여러 번호 키 선택 다운로드 — ex: ["18", "19", "23"] */
  numberKeys?: string[];
}): { entries: Array<{ name: string; abs: string }>; zipName: string } | null {
  const { examSlug, category, subCategory, numberKey, numberKeys } = args;

  /* 여러 번호 선택 — 하나만 들어왔으면 단일 처리로 위임 */
  const multiKeys = numberKeys && numberKeys.length > 0 ? numberKeys : numberKey ? [numberKey] : null;

  if (multiKeys && multiKeys.length > 0 && category) {
    const dir = subCategory
      ? resolveSafePath(examSlug, category, subCategory)
      : resolveSafePath(examSlug, category);
    if (!dir) return null;
    const files = fs.readdirSync(dir).filter((n) => !n.startsWith('.'));
    const wanted = new Set(multiKeys);
    const entries: Array<{ name: string; abs: string; sortValue: number }> = [];
    for (const f of files) {
      const fNfc = f.normalize('NFC');
      const parsed = parseNumberFromFilename(fNfc);
      if (wanted.has(parsed.numberKey)) {
        entries.push({ name: fNfc, abs: path.join(dir, f), sortValue: parsed.sortValue });
      }
    }
    if (entries.length === 0) return null;
    entries.sort((a, b) => a.sortValue - b.sortValue);

    let labelPart: string;
    if (multiKeys.length === 1) {
      labelPart = multiKeys[0] === 'all' ? '통합본' : `${multiKeys[0]}번`;
    } else {
      labelPart = `선택${multiKeys.length}건`;
    }
    const subPart = subCategory ? `_${subCategory}` : '';
    return {
      entries: entries.map(({ name, abs }) => ({ name, abs })),
      zipName: `${examSlug}_${category}${subPart}_${labelPart}.zip`.normalize('NFC'),
    };
  }

  if (subCategory && category) {
    const dir = resolveSafePath(examSlug, category, subCategory);
    if (!dir) return null;
    return {
      entries: collectAllFiles(dir, dir),
      zipName: `${examSlug}_${category}_${subCategory}.zip`.normalize('NFC'),
    };
  }

  if (category) {
    const dir = resolveSafePath(examSlug, category);
    if (!dir) return null;
    return {
      entries: collectAllFiles(dir, dir),
      zipName: `${examSlug}_${category}.zip`.normalize('NFC'),
    };
  }

  const dir = resolveSafePath(examSlug);
  if (!dir) return null;
  return {
    entries: collectAllFiles(dir, dir).filter((e) => path.basename(e.abs).toLowerCase() !== 'meta.json'),
    zipName: `${examSlug}_전체.zip`.normalize('NFC'),
  };
}

function collectAllFiles(rootDir: string, dir: string): Array<{ name: string; abs: string }> {
  const out: Array<{ name: string; abs: string }> = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...collectAllFiles(rootDir, abs));
    } else if (e.isFile()) {
      /* ZIP 내부 파일명은 NFC 로 통일 (Windows·Linux 호환) */
      const rel = path.relative(rootDir, abs).normalize('NFC');
      out.push({ name: rel, abs });
    }
  }
  return out;
}

