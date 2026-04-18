import { getDb } from '@/lib/mongodb';

/**
 * /variant 비회원 지문 → passages 출처 자동 매칭.
 * 관리자 UI에는 이 출처를 저장하지만 사용자에게는 노출하지 않는다.
 */

export type DetectedPassage = {
  passage_id: string;
  textbook: string;
  chapter: string;
  number: string;
  source_key: string;
  source_label: string;
  match_kind: 'head' | 'mid';
};

type PassageRef = {
  passage_id: string;
  textbook: string;
  chapter: string;
  number: string;
  source_key: string;
  normalized_full: string;
};

type Cache = {
  headMap: Map<string, PassageRef[]>;
  midMap: Map<string, PassageRef[]>;
  loadedAt: number;
  loading: Promise<void> | null;
};

const CACHE: Cache = {
  headMap: new Map(),
  midMap: new Map(),
  loadedAt: 0,
  loading: null,
};

/** 지문 지문(fingerprint) 길이 — 80자면 거의 유일하게 식별 가능하면서 짧은 편집에 덜 민감 */
const FP_LEN = 80;

/** 캐시 TTL — 지문 추가는 드무므로 10분 */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** 한 번에 처리 가능한 지문 길이 상한 (매우 긴 글은 지문 추출용으로만 사용) */
const MAX_NORMALIZE_LEN = 40_000;

/**
 * 매칭용 정규화:
 * - 유니코드 대시/인용부호/특수공백을 아스키 유사문자로 치환
 * - 소문자
 * - 알파벳·숫자·공백만 남김
 * - 공백 압축 + 트림
 */
export function normalizeForMatch(raw: string): string {
  if (typeof raw !== 'string') return '';
  let s = raw.length > MAX_NORMALIZE_LEN ? raw.slice(0, MAX_NORMALIZE_LEN) : raw;
  s = s
    .replace(/[\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u2032\u02BC]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ');
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** 앞쪽 / 중간 2개 지점에서 fingerprint 추출 */
function extractFingerprints(norm: string): { head: string; mid: string | null } {
  const head = norm.slice(0, FP_LEN);
  if (norm.length < FP_LEN * 3) return { head, mid: null };
  const midStart = Math.floor(norm.length / 2) - Math.floor(FP_LEN / 2);
  const mid = norm.slice(midStart, midStart + FP_LEN);
  return { head, mid };
}

function putRef(map: Map<string, PassageRef[]>, key: string, ref: PassageRef) {
  if (!key || key.length < FP_LEN) return;
  const arr = map.get(key);
  if (arr) arr.push(ref);
  else map.set(key, [ref]);
}

async function loadCache(force = false): Promise<void> {
  const now = Date.now();
  if (!force && CACHE.loadedAt && now - CACHE.loadedAt < CACHE_TTL_MS) return;
  if (CACHE.loading) return CACHE.loading;

  const task = (async () => {
    const db = await getDb('gomijoshua');
    const rows = await db
      .collection('passages')
      .find(
        { 'content.original': { $type: 'string' } },
        {
          projection: {
            _id: 1,
            textbook: 1,
            chapter: 1,
            number: 1,
            source_key: 1,
            'content.original': 1,
          },
        },
      )
      .toArray();

    const headMap = new Map<string, PassageRef[]>();
    const midMap = new Map<string, PassageRef[]>();

    for (const doc of rows) {
      const original = typeof doc.content?.original === 'string' ? doc.content.original : '';
      if (!original.trim()) continue;
      const norm = normalizeForMatch(original);
      if (norm.length < FP_LEN) continue;
      const { head, mid } = extractFingerprints(norm);
      const ref: PassageRef = {
        passage_id: String(doc._id),
        textbook: typeof doc.textbook === 'string' ? doc.textbook : '',
        chapter: typeof doc.chapter === 'string' ? doc.chapter : '',
        number: typeof doc.number === 'string' ? doc.number : '',
        source_key: typeof doc.source_key === 'string' ? doc.source_key : '',
        normalized_full: norm,
      };
      putRef(headMap, head, ref);
      if (mid) putRef(midMap, mid, ref);
    }

    CACHE.headMap = headMap;
    CACHE.midMap = midMap;
    CACHE.loadedAt = Date.now();
  })();

  CACHE.loading = task;
  try {
    await task;
  } finally {
    CACHE.loading = null;
  }
}

/** 외부에서 새 지문 등록 후 호출해 캐시 즉시 만료 */
export function invalidatePassageSourceCache(): void {
  CACHE.loadedAt = 0;
}

function buildSourceLabel(ref: PassageRef): string {
  const sk = ref.source_key.trim();
  if (sk) return sk;
  return [ref.chapter, ref.number].filter(Boolean).join(' ').trim() || '지문';
}

/**
 * 후보 ref 가 실제로 사용자 입력에 포함되는지(또는 포함하는지) 재검증.
 * fingerprint 충돌(희귀하지만 있을 수 있음) 방지용.
 */
function confirmMatch(inputNorm: string, ref: PassageRef): boolean {
  const target = ref.normalized_full;
  if (!target || !inputNorm) return false;
  // 사용자 입력이 원문 내부에 있거나, 원문이 사용자 입력 내부에 있으면 통과
  if (target.length <= inputNorm.length) {
    if (inputNorm.includes(target.slice(0, Math.min(target.length, 200)))) return true;
  }
  if (inputNorm.length <= target.length) {
    if (target.includes(inputNorm.slice(0, Math.min(inputNorm.length, 200)))) return true;
  }
  return false;
}

/**
 * 비회원 입력 지문 → passages 후보 매칭.
 * 실패 시 null.
 */
export async function detectPassageSource(
  paragraph: string,
): Promise<DetectedPassage | null> {
  const inputNorm = normalizeForMatch(paragraph);
  if (inputNorm.length < FP_LEN) return null;

  try {
    await loadCache(false);
  } catch (e) {
    console.error('detectPassageSource: cache load failed', e);
    return null;
  }

  const { head, mid } = extractFingerprints(inputNorm);

  const tryCandidates = (list: PassageRef[] | undefined, kind: 'head' | 'mid'): DetectedPassage | null => {
    if (!list || list.length === 0) return null;
    for (const ref of list) {
      if (confirmMatch(inputNorm, ref)) {
        return {
          passage_id: ref.passage_id,
          textbook: ref.textbook,
          chapter: ref.chapter,
          number: ref.number,
          source_key: ref.source_key,
          source_label: buildSourceLabel(ref),
          match_kind: kind,
        };
      }
    }
    return null;
  };

  const byHead = tryCandidates(CACHE.headMap.get(head), 'head');
  if (byHead) return byHead;

  if (mid) {
    const byMid = tryCandidates(CACHE.midMap.get(mid), 'mid');
    if (byMid) return byMid;
  }

  return null;
}
