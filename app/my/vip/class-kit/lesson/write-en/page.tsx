'use client';

/** VIP 수업용자료 · 영작하기 (한국어 제시 → 영어 작성). */

import LessonClient from '@/app/admin/class-kit/lesson/LessonClient';

export default function VipClassKitLessonWriteEnPage() {
  return (
    <LessonClient
      forcedMode="writeEn"
      passagesApiBase="/api/class-kit/passages"
      classKitApiBase="/api/class-kit"
      routeBase="/my/vip/class-kit"
      homeHref="/my/vip/class-kit/lecture"
    />
  );
}
