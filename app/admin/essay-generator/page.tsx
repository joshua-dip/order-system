import { EssayGeneratorClient } from './EssayGeneratorClient';

/**
 * 서술형 출제기 — 「조건영작배열(배열·영작형)」 기본 라우트.
 * 글의 의미 서술형은 ./meaning/page.tsx.
 */
export default function EssayGeneratorPage() {
  return <EssayGeneratorClient lockedExamType="배열형" />;
}
