/**
 * 변형도 **집계**(분석 모달·구간 목록)용 — 목록 API의 variationPercentAgainstOriginal과 다를 수 있음(문자 길이 제한 등).
 */
import {
  variationRatioTruncated,
  paragraphTextForVariationCompare,
  normalizeTextForVariationCompare,
} from '@/lib/paragraph-variation';

export function parseVariationScanCap(): number {
  const raw = process.env.ADMIN_VARIATION_MAX_SCAN?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  const fallback = 80_000;
  const v = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.min(200_000, Math.max(3_000, v));
}

export function parseDocChunkSize(): number {
  const raw = process.env.ADMIN_VARIATION_DOC_CHUNK?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  const v = Number.isFinite(n) && n >= 50 ? n : 900;
  return Math.min(5000, Math.max(200, v));
}

export function parsePassageFetchBatch(): number {
  const raw = process.env.ADMIN_VARIATION_PASSAGE_BATCH?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  const v = Number.isFinite(n) && n >= 50 ? n : 400;
  return Math.min(1000, Math.max(100, v));
}

/** 0이면 전체 문자열 비교(느림). 기본 1800. */
export function parseCompareMaxChars(): number {
  const raw = process.env.ADMIN_VARIATION_COMPARE_MAX_CHARS?.trim();
  const n = raw ? parseInt(raw, 10) : NaN;
  if (raw === '0' || n === 0) return 0;
  const v = Number.isFinite(n) && n > 0 ? n : 1800;
  return Math.min(16_000, Math.max(256, v));
}

export function variationPercentAggregate(
  typeKey: string,
  orig: string,
  para: string,
  qd: Record<string, unknown> | undefined,
  compareMaxChars: number
): number {
  const comparePara = paragraphTextForVariationCompare(typeKey, para, qd, orig);
  const ratio = variationRatioTruncated(
    normalizeTextForVariationCompare(typeKey, orig),
    normalizeTextForVariationCompare(typeKey, comparePara),
    compareMaxChars
  );
  return Math.round(ratio * 100);
}

/** 집계 테이블 컬럼 인덱스 0~9 → 변형도 구간 */
export function pctMatchesBucket(pct: number, bucket: number): boolean {
  if (bucket < 0 || bucket > 9) return false;
  if (bucket === 9) return pct >= 90 && pct <= 100;
  const min = bucket * 10;
  const max = bucket * 10 + 9;
  return pct >= min && pct <= max;
}

export function bucketLabel(bucket: number): string {
  if (bucket === 9) return '90~100%';
  return `${bucket * 10}~${bucket * 10 + 9}%`;
}
