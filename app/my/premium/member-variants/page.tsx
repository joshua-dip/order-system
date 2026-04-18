'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AppBar from '@/app/components/AppBar';
import { membershipPricingOneLiner } from '@/lib/membership-pricing';
import MyMemberVariants from '../variant-generate/MyMemberVariants';

const KAKAO_INQUIRY_URL =
  process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

function MemberVariantsListInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusId = searchParams.get('focus') || undefined;
  const [loading, setLoading] = useState(true);
  const [deniedReason, setDeniedReason] = useState<null | 'login' | 'premium'>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user) {
          setDeniedReason('login');
          router.replace('/login?from=/my/premium/member-variants');
          return;
        }
        const premium = d.user.isPremiumMember === true;
        const trial = d.user.variantTrial;
        if (!premium && (!trial || !trial.eligible)) {
          setDeniedReason('premium');
          return;
        }
        setDeniedReason(null);
      })
      .catch(() => setDeniedReason('login'))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="w-full max-w-xs rounded-3xl bg-white p-10 text-center shadow-xl">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
          <p className="mt-4 text-sm font-medium text-slate-600">준비하는 중…</p>
        </div>
      </div>
    );
  }

  if (deniedReason === 'login') {
    return (
      <>
        <AppBar showBackButton />
        <div className="flex min-h-[60vh] items-center justify-center px-4">
          <p className="text-sm text-slate-600">로그인 페이지로 이동합니다…</p>
        </div>
      </>
    );
  }

  if (deniedReason === 'premium') {
    return (
      <>
        <AppBar showBackButton />
        <div className="min-h-screen bg-gradient-to-b from-slate-50 to-violet-50/40 px-4 py-14">
          <div className="mx-auto max-w-md rounded-3xl border border-violet-100 bg-white p-10 text-center shadow-xl shadow-violet-200/25">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-2xl">🔐</div>
            <h1 className="text-xl font-bold text-slate-900">체험 기간 만료</h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              이 목록은 <strong>변형문제 만들기</strong>와 동일한 이용 권한이 필요합니다.
            </p>
            <p className="mt-4 text-xs text-slate-500">{membershipPricingOneLiner()}</p>
            <div className="mt-8 flex flex-col gap-2 text-sm font-semibold">
              <Link href="/my" className="rounded-xl bg-slate-900 py-3 text-white hover:bg-slate-800">
                내 정보
              </Link>
              <a
                href={KAKAO_INQUIRY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-amber-200 bg-amber-50 py-3 text-amber-900 hover:bg-amber-100"
              >
                카카오톡 문의
              </a>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <AppBar showBackButton />
      <div className="bg-gradient-to-b from-slate-50 via-white to-violet-50/30 pb-10">
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 md:py-8">
          <header className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wider text-violet-600">변형문제 만들기</p>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 md:text-3xl">내가 만든 문항</h1>
            <p className="text-sm text-slate-600">
              저장한 문항을 모두 확인·검색·보낼 수 있어요.{' '}
              <Link
                href="/my/premium/variant-generate"
                className="font-semibold text-violet-700 underline decoration-violet-200 underline-offset-2 hover:text-violet-900"
              >
                변형문제 만들기로 돌아가기
              </Link>
            </p>
          </header>
          <MyMemberVariants refreshKey={0} listMode="full" highlightVariantId={focusId} />
        </div>
      </div>
    </>
  );
}

export default function MemberVariantsListPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="w-full max-w-xs rounded-3xl bg-white p-10 text-center shadow-xl">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
            <p className="mt-4 text-sm font-medium text-slate-600">준비하는 중…</p>
          </div>
        </div>
      }
    >
      <MemberVariantsListInner />
    </Suspense>
  );
}
