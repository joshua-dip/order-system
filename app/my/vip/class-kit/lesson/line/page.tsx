'use client';

/** VIP 수업용자료 · 한줄해석 (문장별 영어→한국어). */

import LessonClient from '@/app/admin/class-kit/lesson/LessonClient';

export default function VipClassKitLessonLinePage() {
  return (
    <LessonClient
      forcedMode="lineByLine"
      passagesApiBase="/api/class-kit/passages"
      classKitApiBase="/api/class-kit"
      routeBase="/my/vip/class-kit"
      homeHref="/my/vip/class-kit/lecture"
    />
  );
}
