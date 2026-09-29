'use client';

/** VIP 수업 화면 — admin view 그대로 + 사용자(회원) API. VIP는 항상 회원이라 게스트 게이트 불필요. */

import { ClassKitLiveView } from '@/app/admin/class-kit/live/ClassKitLiveView';

export default function VipClassKitLivePage() {
  return <ClassKitLiveView passagesApiBase="/api/class-kit/passages" routeBase="/my/vip/class-kit" homeHref="/my/vip/class-kit/live" />;
}
