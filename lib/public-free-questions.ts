import { ObjectId, type Db } from 'mongodb';
import { FREE_VARIANT_TYPES } from '@/lib/variant-pricing';

/**
 * 공개 무료 배포용 변형문제.
 *
 * gomijoshua.com 에서 **로그인 없이 바로 받아 쓰는** 홍보용 세트다.
 * 판매 재고(`generated_questions`)와 **별개 컬렉션**에 둔다 — 같은 곳에 플래그로 섞으면
 * 파이널·학교 시험지·문제은행처럼 `status='완료'` 로 문항을 뽑아 쓰는 경로가 전부
 * 무료 배포분을 팔아 버릴 수 있다. 여기 든 문항은 오직 공개 API 만 읽는다.
 *
 * 문항은 판매분을 옮겨온 것이 아니라 **이 세트용으로 새로 만든 것**이다.
 */
export const PUBLIC_FREE_QUESTIONS_COLLECTION = 'public_free_questions';

/** 무료 배포 대상 유형 — 무료 7유형 그대로이고 고난도는 들어가지 않는다. */
export const PUBLIC_FREE_TYPES = [...FREE_VARIANT_TYPES] as string[];

export function isPublicFreeType(type: string): boolean {
  return PUBLIC_FREE_TYPES.includes(type);
}

/** 한 번에 받을 수 있는 문항 수 상한 (통째로 긁어가는 것을 막는다) */
export const PUBLIC_FREE_MAX_QUESTIONS_PER_PDF = 60;

/**
 * 공개에서 빼는 조합.
 *
 * **43~45번 장문의 순서·삽입** — 기본 삽입은 추출형이고 원문 문장이 전부 본문에 남아야 해서
 * 본문이 21~23문장(약 2,000자)이 된다. 인쇄하면 한 문항이 한 페이지를 거의 채운다.
 * 순서도 24문장을 세 덩이로 못 나눠 앞부분만 잘라 쓰게 되어 지문 전체를 담지 못한다.
 * 둘 다 문항 자체는 규격에 맞지만 **홍보용 PDF 로는 부적합**하다(2026-09-12, 두 샤드가 독립 보고).
 *
 * 삭제하지 않고 `대기` 로 남긴다 — 되돌리기 쉽고, 판매 쪽에서 쓸 수도 있다.
 */
export function isExcludedFromPublicFree(source: string, type: string): boolean {
  const isLongPassage = /4\d\s*~\s*4\d번/.test(source) && /4[3-5]/.test(source);
  return isLongPassage && (type === '순서' || type === '삽입');
}

export type PublicFreeQuestionDoc = {
  _id: ObjectId;
  textbook: string;
  passage_id: ObjectId;
  source: string;
  type: string;
  option_type: string;
  difficulty: string;
  question_data: Record<string, unknown>;
  status: string;
  serialNo?: number;
  created_at: Date;
  updated_at: Date;
};

/** 공개 목록에 노출할 회차 = 이 컬렉션에 문항이 있는 교재만 */
export async function listFreeExams(
  db: Db,
): Promise<Array<{ textbook: string; grade: string; questionCount: number; passageCount: number }>> {
  const rows = await db
    .collection(PUBLIC_FREE_QUESTIONS_COLLECTION)
    .aggregate([
      { $match: { status: '완료', type: { $in: PUBLIC_FREE_TYPES } } },
      {
        $group: {
          _id: '$textbook',
          questionCount: { $sum: 1 },
          passages: { $addToSet: '$source' },
        },
      },
      { $sort: { _id: -1 } },
    ])
    .toArray();

  return rows.map((r) => ({
    textbook: String(r._id),
    grade: /고([123])/.exec(String(r._id))?.[1] ?? '',
    questionCount: r.questionCount as number,
    passageCount: (r.passages as unknown[]).length,
  }));
}

/** 한 회차의 지문별 보유 유형 */
export async function listFreePassages(
  db: Db,
  textbook: string,
): Promise<Array<{ source: string; number: string; types: string[]; questionCount: number }>> {
  const rows = await db
    .collection(PUBLIC_FREE_QUESTIONS_COLLECTION)
    .aggregate([
      { $match: { textbook, status: '완료', type: { $in: PUBLIC_FREE_TYPES } } },
      { $group: { _id: '$source', types: { $addToSet: '$type' }, questionCount: { $sum: 1 } } },
    ])
    .toArray();

  /* `43~45번` 같은 묶음 번호를 통째로 잡는다 — `(\d+)번` 만 쓰면 "45" 로 잘린다. */
  const numOf = (source: string) => /(\d+(?:\s*~\s*\d+)?)번/.exec(source)?.[1]?.replace(/\s+/g, '') ?? '';
  return rows
    .map((r) => ({
      source: String(r._id),
      number: numOf(String(r._id)),
      types: (r.types as string[]).slice().sort((a, b) => PUBLIC_FREE_TYPES.indexOf(a) - PUBLIC_FREE_TYPES.indexOf(b)),
      questionCount: r.questionCount as number,
    }))
    .sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));
}

/** PDF 로 낼 문항을 고른다. 무료 유형·상한 밖 요청은 조용히 잘라낸다. */
export async function pickFreeQuestions(
  db: Db,
  opts: { textbook: string; sources?: string[]; types?: string[]; limit?: number },
): Promise<PublicFreeQuestionDoc[]> {
  const types = (opts.types ?? PUBLIC_FREE_TYPES).filter(isPublicFreeType);
  const filter: Record<string, unknown> = {
    textbook: opts.textbook,
    status: '완료',
    type: { $in: types.length > 0 ? types : PUBLIC_FREE_TYPES },
  };
  if (opts.sources && opts.sources.length > 0) filter.source = { $in: opts.sources };

  const limit = Math.min(
    Math.max(1, opts.limit ?? PUBLIC_FREE_MAX_QUESTIONS_PER_PDF),
    PUBLIC_FREE_MAX_QUESTIONS_PER_PDF,
  );

  const docs = await db
    .collection<PublicFreeQuestionDoc>(PUBLIC_FREE_QUESTIONS_COLLECTION)
    .find(filter)
    .limit(limit)
    .toArray();

  /* 인쇄 순서: 지문 번호 → 무료 유형 표준 순서. DB 순서에 맡기면 회차마다 뒤죽박죽이다. */
  const numOf = (s: string) => Number(/(\d+)번/.exec(s)?.[1] ?? 0);
  return docs.sort((a, b) => {
    const d = numOf(a.source) - numOf(b.source);
    if (d !== 0) return d;
    return PUBLIC_FREE_TYPES.indexOf(a.type) - PUBLIC_FREE_TYPES.indexOf(b.type);
  });
}
