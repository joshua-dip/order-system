'use client';

/** 사용자용 수업 화면 — admin view 그대로 사용 + 사용자 API + 비회원 가입신청 게이트. */

import { useState } from 'react';
import { ClassKitLiveView } from '@/app/admin/class-kit/live/ClassKitLiveView';
import MembershipApplyModal from '@/app/components/MembershipApplyModal';

export default function UserClassKitLivePage() {
  const [signupOpen, setSignupOpen] = useState(false);
  return (
    <>
      <ClassKitLiveView
        passagesApiBase="/api/class-kit/passages"
        routeBase="/class-kit"
        homeHref="/class-kit/live"
        onGuestGate={() => setSignupOpen(true)}
      />
      <MembershipApplyModal open={signupOpen} onClose={() => setSignupOpen(false)} />
    </>
  );
}
