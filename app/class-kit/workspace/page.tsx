'use client';

/** 사용자용 작업 공간 — 사용자 API + 비회원 가입신청 게이트. */

import { useState } from 'react';
import { ClassKitWorkspaceView } from '@/app/admin/class-kit/workspace/ClassKitWorkspaceView';
import MembershipApplyModal from '@/app/components/MembershipApplyModal';

export default function UserClassKitWorkspacePage() {
  const [signupOpen, setSignupOpen] = useState(false);
  return (
    <>
      <ClassKitWorkspaceView
        passagesApiBase="/api/class-kit/passages"
        classKitApiBase="/api/class-kit"
        routeBase="/class-kit"
        onGuestGate={() => setSignupOpen(true)}
      />
      <MembershipApplyModal open={signupOpen} onClose={() => setSignupOpen(false)} />
    </>
  );
}
