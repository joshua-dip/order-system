'use client';

/** VIP 수업용자료 — 영한대조(parallel) 기본. */

import LessonClient from '@/app/admin/class-kit/lesson/LessonClient';

export default function VipClassKitLessonPage() {
  return (
    <LessonClient
      passagesApiBase="/api/class-kit/passages"
      classKitApiBase="/api/class-kit"
      routeBase="/my/vip/class-kit"
      homeHref="/my/vip/class-kit/lecture"
    />
  );
}
