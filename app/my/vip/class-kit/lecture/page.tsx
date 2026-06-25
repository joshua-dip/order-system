'use client';

/** VIP 강의용자료 — admin view 그대로 + 사용자(회원) API. VIP는 항상 회원이라 게스트 게이트 불필요. */

import { ClassKitLectureView } from '@/app/admin/class-kit/lecture/ClassKitLectureView';

export default function VipClassKitLecturePage() {
  return (
    <ClassKitLectureView
      passagesApiBase="/api/class-kit/passages"
      classKitApiBase="/api/class-kit"
      routeBase="/my/vip/class-kit"
      homeHref="/my/vip/class-kit/lecture"
    />
  );
}
