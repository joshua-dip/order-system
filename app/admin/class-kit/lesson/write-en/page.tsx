import LessonClient from '../LessonClient';

/** 수업용자료 · 영작하기 (한국어 제시 → 영어 작성). */
export default function ClassKitLessonWriteEnPage() {
  return <LessonClient forcedMode="writeEn" />;
}
