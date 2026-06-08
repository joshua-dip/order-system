'use client';

import { useState } from 'react';
import LessonClient from '@/app/admin/class-kit/lesson/LessonClient';
import MembershipApplyModal from '@/app/components/MembershipApplyModal';

export default function UserClassKitLessonWriteKoPage() {
  const [signupOpen, setSignupOpen] = useState(false);
  return (
    <>
      <LessonClient
        forcedMode="writeKo"
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
