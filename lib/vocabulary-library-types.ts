import type { ObjectId } from 'mongodb';
import type { VocabularyEntry } from './passage-analyzer-types';

export const USER_VOCABULARIES_COLLECTION = 'user_vocabularies';

export type VocabularyPackageType = 'basic' | 'detailed';

export type UserVocabularyDoc = {
  _id: ObjectId;
  user_id: ObjectId;
  login_id: string;
  passage_id: ObjectId;
  textbook: string;
  chapter?: string;
  number?: string;
  display_label: string;
  package_type: VocabularyPackageType;
  /** 사용자 편집본 */
  vocabulary_list: VocabularyEntry[];
  /** 구매 시점 원본 스냅샷 — reset용 */
  original_snapshot: VocabularyEntry[];
  points_used: number;
  order_id: ObjectId;
  order_number: string;
  purchased_at: Date;
  last_edited_at: Date;
  deleted_at: Date | null;
};

export type UserVocabularyInsert = Omit<UserVocabularyDoc, '_id'>;

/** API/클라이언트에 내려주는 직렬화된 형태 */
export type UserVocabularySerialized = Omit<
  UserVocabularyDoc,
  '_id' | 'user_id' | 'passage_id' | 'order_id' | 'purchased_at' | 'last_edited_at' | 'deleted_at'
> & {
  _id: string;
  passage_id: string;
  order_id: string;
  purchased_at: string;
  last_edited_at: string;
};

/** 신규 구매·차감에 사용하는 지문당 포인트 (통일 요금) */
export const VOCABULARY_POINTS_PER_PASSAGE = 300;

/** 레거시 UI·표시용 (가격은 모두 VOCABULARY_POINTS_PER_PASSAGE와 동일) */
export const VOCABULARY_PACKAGES = [
  { id: 'basic' as const, name: '단어장', description: '단어·뜻 등 분석 데이터 기준', price: VOCABULARY_POINTS_PER_PASSAGE },
] as const;

export function getPackagePrice(_packageType: VocabularyPackageType): number {
  return VOCABULARY_POINTS_PER_PASSAGE;
}
