'use client';

/** VIP 작업 공간 — 사용자(회원) API. */

import { ClassKitWorkspaceView } from '@/app/admin/class-kit/workspace/ClassKitWorkspaceView';

export default function VipClassKitWorkspacePage() {
  return <ClassKitWorkspaceView passagesApiBase="/api/class-kit/passages" classKitApiBase="/api/class-kit" routeBase="/my/vip/class-kit" />;
}
