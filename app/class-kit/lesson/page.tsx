'use client';

import { useState } from 'react';
import LessonClient from '@/app/admin/class-kit/lesson/LessonClient';
import MembershipApplyModal from '@/app/components/MembershipApplyModal';

/** 사용자용 수업용자료 — 영한대조 (parallel). */
export default function UserClassKitLessonPage() {
  const [signupOpen, setSignupOpen] = useState(false);
  return (
    <>
      <LessonClient
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
