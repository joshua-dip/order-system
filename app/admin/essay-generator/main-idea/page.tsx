import { EssayGeneratorClient } from '../EssayGeneratorClient';
import { ESSAY_MAIN_IDEA_EXAM_TYPE } from '@/app/data/essay-categories';

/**
 * 서술형 출제기 — 「요지 조건영작배열」 라우트.
 * 동일한 출제기 UI 를 examType='일반요지요약형' 으로 고정해 렌더한다.
 * <보기> 단어를 순서대로 모두 써서 글의 요지를 한 문장으로 영작하는 학교 기출 형태.
 * (배열·영작형 기본 라우트는 ../page.tsx)
 */
export default function EssayGeneratorMainIdeaPage() {
  return <EssayGeneratorClient lockedExamType={ESSAY_MAIN_IDEA_EXAM_TYPE} />;
}
