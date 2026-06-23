import { EssayGeneratorClient } from '../EssayGeneratorClient';
import { ESSAY_MEANING_EXAM_TYPE } from '@/app/data/essay-categories';

/**
 * 서술형 출제기 — 「글의 의미 서술형」 라우트.
 * 동일한 출제기 UI 를 examType='글의의미서술형' 으로 고정해 렌더한다.
 * (배열·영작형 기본 라우트는 ../page.tsx)
 */
export default function EssayGeneratorMeaningPage() {
  return <EssayGeneratorClient lockedExamType={ESSAY_MEANING_EXAM_TYPE} />;
}
