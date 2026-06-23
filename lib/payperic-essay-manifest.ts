import type { EssayExamListItem } from '@/lib/essay-exams-store';
import type { ExamGroup } from '@/lib/essay-pdf-render';

/**
 * 한 모의고사 교재의 조건영작배열 essay_exams 를 payperic 상품 명세로 변환.
 *
 * 제목·태그·가격 규칙은 기존 수동 업로드 스크립트(payperic/scripts/upload-*.ts)와
 * 정확히 일치시켜, 이미 올라간 상품과 제목으로 멱등(중복 skip) 되게 한다.
 *   - 번호별: 문항당 800원 (18·19·20번 무료), 4난도 합본 PDF 1개
 *   - 난도별: 3,900원(정가 4,400), 해당 난도 전 문항 합본 PDF 1개
 *   - 풀세트: 14,000원(정가 17,600), 번호별+난도별 PDF 묶음 ZIP
 */

export const PRODUCT_TAG = '조건영작배열';
export const NUMBER_PRICE = 800;
export const FREE_NUMBERS = new Set(['18번', '19번', '20번']);
export const DIFFICULTY_PRICE = 3900;
export const DIFFICULTY_ORIGINAL = 4400;
export const FULLSET_PRICE = 14000;
export const FULLSET_ORIGINAL = 17600;

/** 난도 정렬 순서 (낮은 → 높은). 알 수 없는 난도는 뒤로. */
export const DIFFICULTY_ORDER = ['기본난도', '중난도', '고난도', '최고난도'];

export type ProductKind = 'number' | 'difficulty' | 'fullset';

export interface EssayProductSpec {
  kind: ProductKind;
  title: string;
  description: string;
  price: number;
  originalPrice: number;
  isFree: boolean;
  category: string;
  tags: string[];
  /** number/difficulty: 렌더할 그룹(=PDF 1개). fullset 은 undefined(번호+난도 PDF 묶음). */
  group?: ExamGroup;
  /** 파일 베이스명(확장자 제외). */
  fileLabel: string;
  ext: 'pdf' | 'zip';
}

export interface EssayBatchManifest {
  textbook: string;
  /** 배치 식별 태그(batch:<batchKey>) 및 상태조회 키. 교재명을 그대로 사용. */
  batchKey: string;
  category: string;
  gradeLabel: string;
  monthLabel: string;
  /** 번호별 + 난도별 (각 PDF 1개). */
  products: EssayProductSpec[];
  /** 풀세트 ZIP (products 의 PDF 들을 묶음). 문항이 없으면 null. */
  fullset: EssayProductSpec | null;
}

export interface ParsedTextbook {
  gradeLabel: string; // 고1 | 고2 | 고3
  monthLabel: string; // 예: "25년 6월"
  category: string;   // grade1-material | grade2-material | grade3-material
}

/** "25년 6월 고1 영어모의고사" → {gradeLabel:'고1', monthLabel:'25년 6월', category:'grade1-material'} */
export function parseTextbook(textbook: string): ParsedTextbook | null {
  const m = textbook.match(/(\d+\s*년)\s*(\d+\s*월)\s*(고\s*([123]))/);
  if (!m) return null;
  const year = m[1].replace(/\s+/g, '');
  const month = m[2].replace(/\s+/g, '');
  const gradeNum = m[4];
  return {
    gradeLabel: `고${gradeNum}`,
    monthLabel: `${year} ${month}`,
    category: `grade${gradeNum}-material`,
  };
}

/** sourceKey 에서 번호 라벨 추출. "…영어모의고사 41~42번" → "41-42번" */
export function extractNumberLabel(sourceKey: string, textbook: string): string {
  let num = sourceKey.startsWith(textbook) ? sourceKey.slice(textbook.length) : sourceKey;
  num = num.trim().replace(/~/g, '-').replace(/\s+/g, ' ').trim();
  return num;
}

/** 번호 라벨의 정렬용 첫 정수. "41-42번" → 41, "20번" → 20. */
function numberSortKey(label: string): number {
  const m = label.match(/\d+/);
  return m ? parseInt(m[0], 10) : 9999;
}

function difficultySortKey(level: string): number {
  const i = DIFFICULTY_ORDER.indexOf(level);
  return i === -1 ? 999 : i;
}

/**
 * 매니페스트 생성. 학년을 못 읽으면 throw (category 오분류 방지).
 */
export function buildEssayBatchManifest(
  textbook: string,
  exams: EssayExamListItem[],
): EssayBatchManifest {
  const parsed = parseTextbook(textbook);
  if (!parsed) {
    throw new Error(`교재명에서 학년(고1/2/3)·연월을 읽을 수 없습니다: "${textbook}"`);
  }
  const { gradeLabel, monthLabel, category } = parsed;
  const baseTags = [gradeLabel, monthLabel, PRODUCT_TAG];

  // 번호별 그룹: 번호 → ids(전 난도)
  const byNumber = new Map<string, string[]>();
  // 난도별 그룹: 난도 → ids(전 번호)
  const byDifficulty = new Map<string, string[]>();

  for (const e of exams) {
    const num = extractNumberLabel(e.sourceKey, textbook);
    if (num) {
      const arr = byNumber.get(num) ?? [];
      arr.push(e._id);
      byNumber.set(num, arr);
    }
    const lvl = e.difficulty || '기본난도';
    const darr = byDifficulty.get(lvl) ?? [];
    darr.push(e._id);
    byDifficulty.set(lvl, darr);
  }

  const products: EssayProductSpec[] = [];

  // 번호별
  const numbers = Array.from(byNumber.keys()).sort((a, b) => numberSortKey(a) - numberSortKey(b));
  for (const num of numbers) {
    const ids = byNumber.get(num)!;
    const isFree = FREE_NUMBERS.has(num);
    products.push({
      kind: 'number',
      title: `${textbook} ${num} ${PRODUCT_TAG}`,
      description: `${textbook} ${num} 조건영작배열 (기본·중·고·최고난도 4단계 + 정답·해설).`,
      price: isFree ? 0 : NUMBER_PRICE,
      originalPrice: NUMBER_PRICE,
      isFree,
      category,
      tags: [...baseTags, num],
      group: { name: `${textbook} ${num}`, ids },
      fileLabel: `${textbook} ${num}`,
      ext: 'pdf',
    });
  }

  // 난도별
  const levels = Array.from(byDifficulty.keys()).sort((a, b) => difficultySortKey(a) - difficultySortKey(b));
  for (const lvl of levels) {
    const ids = byDifficulty.get(lvl)!;
    products.push({
      kind: 'difficulty',
      title: `${textbook} ${PRODUCT_TAG} ${lvl} 전체`,
      description: `${textbook} 조건영작배열 ${lvl} 전체 ${ids.length}문항 묶음.`,
      price: DIFFICULTY_PRICE,
      originalPrice: DIFFICULTY_ORIGINAL,
      isFree: false,
      category,
      tags: [...baseTags, lvl, '난이도별'],
      group: { name: lvl, ids },
      fileLabel: lvl,
      ext: 'pdf',
    });
  }

  const hasContent = numbers.length > 0 || levels.length > 0;
  const fullset: EssayProductSpec | null = hasContent
    ? {
        kind: 'fullset',
        title: `${textbook} ${PRODUCT_TAG} 전체 풀세트`,
        description: `${textbook} 조건영작배열 전 문항 × 전 난이도 풀세트.`,
        price: FULLSET_PRICE,
        originalPrice: FULLSET_ORIGINAL,
        isFree: false,
        category,
        tags: [...baseTags, '전체'],
        fileLabel: `${textbook}_조건영작배열_풀세트`,
        ext: 'zip',
      }
    : null;

  return { textbook, batchKey: textbook, category, gradeLabel, monthLabel, products, fullset };
}

/** 매니페스트의 모든 상품 제목(상태조회용). */
export function manifestTitles(m: EssayBatchManifest): string[] {
  const titles = m.products.map((p) => p.title);
  if (m.fullset) titles.push(m.fullset.title);
  return titles;
}
