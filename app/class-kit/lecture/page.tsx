'use client';

/** 사용자용 강의용자료 — admin view 그대로 사용 + 사용자 API + 비회원 가입신청 게이트. */

import { useState } from 'react';
import { ClassKitLectureView } from '@/app/admin/class-kit/lecture/ClassKitLectureView';
import MembershipApplyModal from '@/app/components/MembershipApplyModal';

export default function UserClassKitLecturePage() {
  const [signupOpen, setSignupOpen] = useState(false);
  return (
    <>
      <ClassKitLectureView
        passagesApiBase="/api/class-kit/passages"
        classKitApiBase="/api/class-kit"
        routeBase="/class-kit"
        homeHref="/class-kit/lecture"
        onGuestGate={() => setSignupOpen(true)}
      />
      <MembershipApplyModal open={signupOpen} onClose={() => setSignupOpen(false)} />
    </>
  );
}
