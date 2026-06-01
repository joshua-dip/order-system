import LessonClient from '../LessonClient';

/** 수업용자료 · 해석쓰기 (영어 제시 → 한국어 해석 작성). */
export default function ClassKitLessonWriteKoPage() {
  return <LessonClient forcedMode="writeKo" />;
}
