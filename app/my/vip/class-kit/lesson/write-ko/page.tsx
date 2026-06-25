'use client';

/** VIP 수업용자료 · 해석쓰기 (영어 제시 → 한국어 해석 작성). */

import LessonClient from '@/app/admin/class-kit/lesson/LessonClient';

export default function VipClassKitLessonWriteKoPage() {
  return (
    <LessonClient
      forcedMode="writeKo"
      passagesApiBase="/api/class-kit/passages"
      classKitApiBase="/api/class-kit"
      routeBase="/my/vip/class-kit"
      homeHref="/my/vip/class-kit/lecture"
    />
  );
}
