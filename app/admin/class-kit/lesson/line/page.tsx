import LessonClient from '../LessonClient';

/** 수업용자료 · 한줄해석 (문장별 영어→한국어). */
export default function ClassKitLessonLinePage() {
  return <LessonClient forcedMode="lineByLine" />;
}
