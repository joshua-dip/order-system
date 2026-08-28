/**
 * 변형문제 주문서 공통 옵션 — 부교재(BV)·모의고사(MV) 가 함께 쓴다.
 *
 * 예전엔 QuestionSettings(부교재) 안에만 있었다. 그래서 저장 옵션·기납품 제외 같은
 * 기능을 부교재에 붙일 때 모의고사에는 안 갔고, 실제로 최근 주문 46건 모두
 * hwpStorageModes 가 없어 제작 job 이 「강별」로만 폴백하고 있었다.
 * 같은 일이 되풀이되지 않도록 값은 여기 한 곳에만 둔다.
 */

/** HWP 결과물 저장·분할 방식 (주문 미리보기에서 복수 선택) */
export type HwpStorageModeKey =
  | 'bySourceNumber'
  | 'byCategory'
  | 'byChapter'
  | 'byRound'
  | 'singleFull'
  | 'fullRandomPair';

/* 「전문항랜덤」은 「문항 순서 섞기」와 이름이 거의 같아 어느 쪽을 켠 건지 알 수 없었다.
   여기는 *파일을 몇 벌 만드는가*, 그쪽은 *순서를 섞는가* 라서 이름을 그렇게 갈랐다. */
export const HWP_STORAGE_OPTIONS: readonly { key: HwpStorageModeKey; label: string; hint: string }[] = [
  { key: 'bySourceNumber', label: '번호별', hint: '번호(Source)마다 파일 나눔' },
  { key: 'byCategory', label: '카테고리별', hint: '문제 유형마다 파일 나눔' },
  { key: 'byChapter', label: '강별', hint: '강(Chapter)마다 파일 나눔' },
  { key: 'byRound', label: '회차별', hint: '회차마다 파일 나눔' },
  { key: 'singleFull', label: '통합본', hint: '나눈 파일과 별도로 전체를 한 파일에 담아 드립니다' },
  { key: 'fullRandomPair', label: '전체 1파일 + 랜덤본', hint: '기본 순서 1벌과 무작위 순서 1벌을 함께 드립니다' },
] as const;

/* 강별·카테고리별·통합본을 처음부터 켜 둔다. 선생님들이 대부분 이 세 벌을 함께 쓰셔서
   매번 다시 고르는 수고를 덜기 위한 것이고, 필요 없으면 주문서에서 끄면 된다. */
export const DEFAULT_HWP_STORAGE_MODES: HwpStorageModeKey[] = ['byChapter', 'byCategory', 'singleFull'];

/**
 * 모의고사 주문의 기본값 — 「강별」을 뺀다.
 *
 * 모의고사는 강(Chapter) 개념이 없다. 회차·번호로만 나뉘어서 강별로 나누면
 * 파일이 하나로 뭉치거나 빈 묶음이 생긴다. 대신 번호별을 켜 둔다.
 */
export const DEFAULT_HWP_STORAGE_MODES_MOCK: HwpStorageModeKey[] = [
  'bySourceNumber',
  'byCategory',
  'singleFull',
];

export function formatHwpStorageSummary(modes: HwpStorageModeKey[]): string {
  if (modes.length === 0) return '1파일(기본)';
  return modes.map((k) => HWP_STORAGE_OPTIONS.find((o) => o.key === k)?.label ?? k).join(' + ');
}

/** 저장한 기본값에서 읽어 온 값 중 실제 존재하는 키만 남긴다. */
export function sanitizeHwpStorageModes(raw: unknown): HwpStorageModeKey[] {
  if (!Array.isArray(raw)) return [];
  const allowed = HWP_STORAGE_OPTIONS.map((o) => o.key) as string[];
  return raw.filter((x): x is HwpStorageModeKey => typeof x === 'string' && allowed.includes(x));
}
