/**
 * 모의고사 교재명에서 괄호 안 지역·시행 월 표기를 제거·정리합니다.
 * - 신표기: "21년 11월 고2 영어모의고사 (경기도)" → "21년 11월 고2 영어모의고사"
 * - 신표기: "23년 11월 고2 영어모의고사 (경기도, 12월시행)" → "23년 11월 고2 영어모의고사"
 * - 신표기: "23년 11월 고2 영어모의고사 (12월 시행)" → "23년 11월 고2 영어모의고사"
 * - 구표기: "고2_2012_11월_A형(경기도)" → "고2_2012_11월_A형"
 */

const REGION_SEGMENT_EXACT = new Set([
  '서울시',
  '경기도',
  '부산시',
  '인천시',
  '대구시',
  '광주시',
  '대전시',
  '울산시',
  '세종시',
  '세종특별자치시',
  '강원도',
  '강원특별자치도',
  '충청북도',
  '충청남도',
  '전라북도',
  '전라남도',
  '경상북도',
  '경상남도',
  '제주도',
  '제주특별자치도',
  '전북특별자치도',
]);

function isRegionSegment(seg: string): boolean {
  const t = seg.trim();
  if (!t) return false;
  if (REGION_SEGMENT_EXACT.has(t)) return true;
  // 시·도 단독 (예: 수원시, 경상도 등)
  if (/^[가-힣]{2,8}시$/.test(t)) return true;
  if (/^[가-힣]{2,10}도$/.test(t)) return true;
  return false;
}

/** 예: "12월시행", "12월 시행", "1월  시행" — 괄호 안 콤마 조각·대괄호 메모에 공통 사용 */
export function isMockExamMonthScheduleSegment(seg: string): boolean {
  const t = seg.trim();
  return /^\d{1,2}월\s*시행$/.test(t);
}

/** 괄호 안 문자열을 콤마로 나눠 지역·월 시행만 제거한 뒤 남은 조각만 반환. 전부 제거되면 '' */
function filterParenInner(inner: string): string {
  const parts = inner
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = parts.filter((p) => !isRegionSegment(p) && !isMockExamMonthScheduleSegment(p));
  return kept.join(', ');
}

/** 신표기: YY년 M월 고N 영어모의고사 (…) */
function stripNewFormatRegion(name: string): string | null {
  const m = name.match(/^(\d{2}년\s+\d{1,2}월\s+고[123]\s+영어모의고사)(?:\s+\(([^)]+)\))?$/);
  if (!m) return null;
  const base = m[1];
  if (!m[2]) return name;
  const kept = filterParenInner(m[2]);
  if (!kept) return base;
  return `${base} (${kept})`;
}

/** 구표기: 고N_YYYY_MM월…(지역)[메모] */
function stripOldFormatRegion(name: string): string | null {
  const m = name.match(/^(고[123]_\d{4}_\d{1,2}월(?:_[AB]형)?)\(([^)]+)\)(\[([^\]]+)\])?$/);
  if (!m) return null;
  const base = m[1];
  const inner = m[2];
  const bracket = m[4] != null && m[4] !== '' ? `[${m[4]}]` : '';
  const kept = filterParenInner(inner);
  if (!kept) return base + bracket;
  return `${base}(${kept})${bracket}`;
}

/**
 * 모의고사 교재 키에서 괄호 안 지역·「N월 시행」류만 정리. 해당 없으면 입력 그대로 반환.
 */
export function stripRegionFromMockExamTextbookKey(name: string): string {
  const s = (name ?? '').trim();
  if (!s) return s;
  const oldFmt = stripOldFormatRegion(s);
  if (oldFmt !== null) return oldFmt;
  const newFmt = stripNewFormatRegion(s);
  if (newFmt !== null) return newFmt;
  return s;
}
