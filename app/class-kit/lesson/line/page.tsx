'use client';

import { useState } from 'react';
import LessonClient from '@/app/admin/class-kit/lesson/LessonClient';
import MembershipApplyModal from '@/app/components/MembershipApplyModal';

/** 사용자용 한줄해석 (lineByLine). */
export default function UserClassKitLessonLinePage() {
  const [signupOpen, setSignupOpen] = useState(false);
  return (
    <>
      <LessonClient
        forcedMode="lineByLine"
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
