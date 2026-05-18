/**
 * 공유자료 — 클라이언트·서버 공용 타입과 pure 함수.
 *
 * 서버 전용 인덱싱(fs 사용)·zip 로직은 `lib/shared-resources.ts` 에 있다.
 * 클라이언트 컴포넌트는 반드시 이 파일에서 import 한다 (서버 모듈 import 시 webpack `node:fs` 오류).
 */

export interface ExamMeta {
  slug: string;
  label: string;
  shortLabel?: string;
  subtitle?: string;
  order?: number;
  category_order?: string[];
  stats: {
    totalFiles: number;
    totalBytes: number;
    categoryCount: number;
  };
}

export interface ResourceVariant {
  ext: 'pdf' | 'hwp' | 'xlsx' | 'docx' | 'other';
  filename: string;
  sizeBytes: number;
  /** /shared-resources/... 정적 URL (이미 URL 인코딩됨) */
  href: string;
}

export interface ResourceItem {
  examSlug: string;
  category: string;
  subCategory?: string;
  /** ex: '18', '41~42', 'all' */
  numberKey: string;
  /** ex: '18번', '41~42번', '통합본' */
  label: string;
  sortValue: number;
  variants: ResourceVariant[];
}

export interface CategoryGroup {
  category: string;
  subGroups: Array<{
    subCategory: string | null;
    items: ResourceItem[];
  }>;
  totalFiles: number;
  totalBytes: number;
}

/** 카테고리 표시 메타 — 단일 톤(emerald) 디자인, 아이콘은 의미 키 (CategoryIcon 컴포넌트가 SVG 매핑) */
export type CategoryIconName =
  | 'academic'
  | 'book'
  | 'translate'
  | 'arrow'
  | 'pencil'
  | 'edit'
  | 'puzzle'
  | 'hash'
  | 'folder';

export const CATEGORY_META: Record<string, { icon: CategoryIconName; description: string }> = {
  '강의용자료':       { icon: 'academic',  description: '문항 풀이 강의용 자료. 강사 노트·해설 위주.' },
  '수업용자료':       { icon: 'book',      description: '학생 배포용 수업 자료. 본문 정리·문항.' },
  '원문과해석':       { icon: 'translate', description: '본문 원문 + 한국어 해석 대조 자료.' },
  '한줄해석':         { icon: 'arrow',     description: '한 문장씩 직독 직해 — 빠른 의미 확인용.' },
  '해석쓰기':         { icon: 'pencil',    description: '학생이 직접 해석을 채워가는 빈칸형 워크시트.' },
  '영작하기':         { icon: 'edit',      description: '국문 → 영문 영작 학습지.' },
  '워크북_낱말배열':  { icon: 'puzzle',    description: '낱말 순서 배열 워크북 — 어순 감각 훈련.' },
  '워크북_빈칸쓰기':  { icon: 'hash',      description: '품사·키워드별 빈칸 쓰기 워크북.' },
};

const CATEGORY_FALLBACK: { icon: CategoryIconName; description: string } = {
  icon: 'folder',
  description: '',
};

export function getCategoryMeta(category: string) {
  return CATEGORY_META[category] ?? CATEGORY_FALLBACK;
}

/** 바이트 → 사람이 읽기 좋은 크기 */
export function formatFileSize(bytes?: number): string | null {
  if (typeof bytes !== 'number' || !isFinite(bytes) || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx++;
  }
  const decimals = value >= 100 || unitIdx === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[unitIdx]}`;
}
