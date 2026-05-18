'use client';

import { useRouter } from 'next/navigation';
import AppBar from '@/app/components/AppBar';

interface Props {
  title?: string;
  /** 뒤로 가기 시 이동할 경로 (없으면 router.back) */
  backTo?: string;
}

export default function SharedResourcesHeader({ title = '공유자료', backTo }: Props) {
  const router = useRouter();
  return (
    <AppBar
      title={title}
      showBackButton
      onBackClick={() => {
        if (backTo) router.push(backTo);
        else router.back();
      }}
    />
  );
}
