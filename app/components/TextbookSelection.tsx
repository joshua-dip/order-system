'use client';

import { useState, useEffect, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import AppBar from './AppBar';
import { OrderHubCard, type OrderHubCardProps } from './OrderHubCard';
import { membershipPricingOneLiner } from '@/lib/membership-pricing';

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

interface TextbookSelectionProps {
  onTextbookSelect: (textbook: string) => void;
  onMockExamSelect: () => void;
  onWorkbookSelect: () => void;
  onUnifiedSelect?: () => void;
}

type HubEntry = Omit<OrderHubCardProps, 'bottomSlot'> & {
  id: string;
  bottomSlot?: OrderHubCardProps['bottomSlot'];
};

/* ── SVG icons (stroke-based, Lucide style) ──────────────── */

const svgBase = 'w-7 h-7';

function IconMock() {
  return (
    <svg className={svgBase} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
}

function IconTextbook() {
  return (
    <svg className={svgBase} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      <path d="M8 7h6" />
      <path d="M8 11h4" />
    </svg>
  );
}

function IconWorkbook() {
  return (
    <svg className={svgBase} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IconOrderNum() {
  return (
    <svg className={svgBase} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function IconAnalysis() {
  return (
    <svg className={svgBase} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v18h18" />
      <path d="M7 16l4-8 4 5 5-6" />
    </svg>
  );
}

function IconEssay() {
  return (
    <svg className={svgBase} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function IconVocabulary() {
  return (
    <svg className={svgBase} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 15 4-8 4 8" />
      <path d="M4 13h6" />
      <path d="M15 11h4.5a2 2 0 0 1 0 4H15V7h4a2 2 0 0 1 0 4" />
    </svg>
  );
}

function IconBundle() {
  return (
    <svg className={svgBase} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M9 3v18" />
    </svg>
  );
}

function IconGyogwaseo() {
  return (
    <svg className={svgBase} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function IconByok() {
  return (
    <svg className={svgBase} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v2" />
      <path d="M12 19v2" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
      <path d="m5.6 5.6 1.4 1.4" />
      <path d="m17 17 1.4 1.4" />
      <path d="m17 6.6 1.4-1.4" />
      <path d="m5.6 18.4 1.4-1.4" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

/* ── Hub items ─────────────────────────────────────────────── */

function useHubSections(
  analysisUnlocked: boolean,
  isMember: boolean,
  isPremiumMember: boolean
): { primary: HubEntry[]; more: HubEntry[] } {
  return useMemo(() => {
    const mock: HubEntry = {
      id: 'mock',
      title: '모의고사 변형문제 주문',
      description: (<>18~40번, 41~42번, 43~45번<br />정해진 문항 구성</>),
      icon: <IconMock /> as ReactNode,
      accentColor: '#13294B',
      gridClassName: 'lg:col-span-2',
      href: '/mockexam',
      interactive: true,
    };
    const textbook: HubEntry = {
      id: 'textbook',
      title: '부교재 변형문제 주문',
      description: (
        <>
          교재별 맞춤 문항 선택
          <br />
          다양한 교재 지원
          <br />
          <span className="font-semibold text-violet-600">쏠북 교재 지원</span>
        </>
      ),
      icon: <IconTextbook /> as ReactNode,
      accentColor: '#13294B',
      gridClassName: 'lg:col-span-2',
      href: '/textbook',
      interactive: true,
    };
    const gyogwaseo: HubEntry = {
      id: 'gyogwaseo',
      title: '교과서 자료 주문',
      description: (
        <>
          <span className="font-semibold text-violet-700">쏠북 정식 교재·구매</span>를 먼저 안내드립니다
          <br />
          맞춤은 강·시험 범위·유형을 골라 주문
          <br />
          <span className="font-semibold text-slate-600">통합 주문</span>으로 변형·워크북·분석지·단어장 등 조합도 가능
        </>
      ),
      icon: <IconGyogwaseo /> as ReactNode,
      accentColor: '#1B5E8A',
      gridClassName: 'lg:col-span-2',
      href: '/gyogwaseo',
      interactive: true,
    };
    const more: HubEntry[] = [
      {
        id: 'workbook',
        title: '워크북 주문',
        description: (<>빈칸쓰기, 낱말배열 등<br />카테고리별 문제 구성</>),
        icon: <IconWorkbook /> as ReactNode,
        accentColor: '#00A9E0',
        gridClassName: 'lg:col-span-2',
        href: '/workbook',
        interactive: true,
      },
      {
        id: 'order-num',
        title: '번호별 교재 제작하기',
        description: (<>모의고사 번호별<br />맞춤 교재 구성</>),
        icon: <IconOrderNum /> as ReactNode,
        accentColor: '#E11D48',
        gridClassName: 'lg:col-span-2',
        href: '/order-num',
        interactive: true,
      },
      {
        id: 'analysis',
        title: '분석지 주문제작',
        description: analysisUnlocked
          ? (<>맞춤 분석지<br />주문·제작 신청</>)
          : (<>회원 가입 문의(카톡)를 통해<br />이용할 수 있습니다.</>),
        icon: <IconAnalysis /> as ReactNode,
        accentColor: '#2D5016',
        gridClassName: 'lg:col-span-2',
        href: '/analysis',
        interactive: analysisUnlocked,
        bottomSlot: analysisUnlocked ? undefined : (
          <a
            href={KAKAO_INQUIRY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border-2 border-[#FEE500] bg-[#FEE500] px-4 py-2 text-xs font-bold text-gray-900 transition-colors hover:border-[#FDD835] hover:bg-[#FDD835] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#13294B]/40 focus-visible:ring-offset-2"
          >
            카톡 문의하기
          </a>
        ),
      },
      {
        id: 'essay',
        title: '서술형문제 주문제작',
        description: (<>EBS·모의고사 누구나 주문 가능<br />부교재는 회원만 이용</>),
        icon: <IconEssay /> as ReactNode,
        accentColor: '#5C4033',
        gridClassName: 'lg:col-span-4',
        href: '/essay',
        interactive: true,
      },
      {
        id: 'vocabulary',
        title: '단어장 주문 제작',
        description: (<>맞춤 단어장 제작 주문<br />세부 안내는 카톡 문의</>),
        icon: <IconVocabulary /> as ReactNode,
        accentColor: '#0D9488',
        gridClassName: 'lg:col-span-2',
        href: '/vocabulary-order',
        interactive: true,
      },
      {
        id: 'bundle',
        title: '통합 주문',
        description: isMember
          ? (<>교과서·부교재 하나를 기준으로<br />변형·워크북·서술형·분석지·단어장 등을<br />원하는 조합으로 한 번에 담기</>)
          : (<>회원 전용 서비스입니다<br />로그인 후 이용해 주세요</>),
        icon: <IconBundle /> as ReactNode,
        accentColor: '#7C3AED',
        gridClassName: 'lg:col-span-4',
        href: '/bundle',
        interactive: isMember,
        bottomSlot: isMember ? undefined : (
          <a
            href="/login"
            className="inline-flex items-center gap-2 rounded-full border-2 border-blue-600 bg-blue-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-700 hover:border-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2"
          >
            로그인하기
          </a>
        ),
      },
    ];
    return { primary: [mock, textbook, gyogwaseo], more };
  }, [analysisUnlocked, isMember, isPremiumMember]);
}

/* ── Component ─────────────────────────────────────────────── */

const TextbookSelection = (_props: TextbookSelectionProps) => {
  const [user, setUser] = useState<{ canAccessAnalysis: boolean; isPremiumMember?: boolean } | null>(null);
  const [premiumLoad, setPremiumLoad] = useState(true);
  const [finalGateOpen, setFinalGateOpen] = useState(false);
  const [byokGateOpen, setByokGateOpen] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data?.user) {
          setUser({
            canAccessAnalysis: !!data.user.canAccessAnalysis,
            isPremiumMember: data.user.isPremiumMember === true,
          });
        } else {
          setUser(null);
        }
      })
      .catch(() => setUser(null))
      .finally(() => setPremiumLoad(false));
  }, []);

  const isMember = user !== null;
  const analysisUnlocked = isMember && user.canAccessAnalysis;
  const isPremiumMember = user?.isPremiumMember === true;
  const { primary: hubPrimary, more: hubMore } = useHubSections(analysisUnlocked, isMember, isPremiumMember);

  const renderHubGrid = (items: HubEntry[]) => (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-6" role="list">
      {items.map(
        ({
          id,
          title,
          description,
          icon,
          accentColor,
          gridClassName,
          href,
          interactive,
          bottomSlot,
        }) => (
          <div key={id} className={gridClassName} role="listitem">
            <OrderHubCard
              title={title}
              description={description}
              icon={icon}
              accentColor={accentColor}
              href={href}
              interactive={interactive}
              bottomSlot={bottomSlot}
            />
          </div>
        )
      )}
    </div>
  );

  return (
    <>
      <AppBar />
      <div className="min-h-screen motion-safe:scroll-smooth" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="container mx-auto max-w-6xl px-4 py-8 md:py-10">
            {/* 파이널 예비 모의고사 + 변형문제 만들기 — 나란히 강조 배너 */}
          <div className="mb-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {premiumLoad ? (
              <div
                className="group flex min-h-[7.5rem] items-center justify-between overflow-hidden rounded-2xl px-5 py-5 shadow-md opacity-80 animate-pulse cursor-wait sm:px-7"
                style={{
                  background: 'linear-gradient(120deg, #1a1a6e 0%, #4b0082 55%, #7c3aed 100%)',
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <span className="text-lg font-extrabold tracking-tight text-white sm:text-xl">파이널 예비 모의고사</span>
                  <p className="text-sm font-medium text-purple-200">불러오는 중…</p>
                </div>
              </div>
            ) : user?.isPremiumMember ? (
              <Link
                href="/unified"
                className="group flex min-h-[7.5rem] items-center justify-between overflow-hidden rounded-2xl px-5 py-5 shadow-md transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 sm:px-7"
                style={{
                  background: 'linear-gradient(120deg, #1a1a6e 0%, #4b0082 55%, #7c3aed 100%)',
                }}
              >
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-yellow-400 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-gray-900 shadow">
                      NEW
                    </span>
                    <span className="text-lg font-extrabold tracking-tight text-white sm:text-xl">파이널 예비 모의고사</span>
                  </div>
                  <p className="text-sm font-medium text-purple-200">
                    시험 범위를 설정하고 예비 시험지를 제작하기에 가장 적합한 기능입니다
                  </p>
                  <p className="mt-0.5 text-xs text-purple-300">
                    부교재 + 모의고사를 한 번에 조합 · 유형별 문항수 개별 조정 · 시험범위 저장/불러오기
                  </p>
                </div>
                <div className="ml-4 flex shrink-0 flex-col items-center gap-2 sm:ml-6">
                  <svg
                    className="h-10 w-10 text-purple-300 transition-transform duration-200 group-hover:scale-110 sm:h-12 sm:w-12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                    <rect x="9" y="3" width="6" height="4" rx="1" />
                    <path d="M9 12h6" />
                    <path d="M9 16h4" />
                  </svg>
                  <span className="flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white backdrop-blur-sm group-hover:bg-white/30">
                    시작하기
                    <svg className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
                    </svg>
                  </span>
                </div>
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setFinalGateOpen(true)}
                className="group flex min-h-[7.5rem] w-full items-center justify-between overflow-hidden rounded-2xl px-5 py-5 text-left shadow-md transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 sm:px-7"
                style={{
                  background: 'linear-gradient(120deg, #1a1a6e 0%, #4b0082 55%, #7c3aed 100%)',
                }}
              >
                <div className="flex min-w-0 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-yellow-400 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-gray-900 shadow">
                      NEW
                    </span>
                    <span className="text-lg font-extrabold tracking-tight text-white sm:text-xl">파이널 예비 모의고사</span>
                  </div>
                  <p className="text-sm font-medium text-purple-200">
                    시험 범위를 설정하고 예비 시험지를 제작하기에 가장 적합한 기능입니다
                  </p>
                  <p className="mt-0.5 text-xs text-amber-200">
                    연회원 또는 월구독 회원 전용 · 클릭하면 이용 안내와 요금을 확인할 수 있습니다
                  </p>
                </div>
                <div className="ml-4 flex shrink-0 flex-col items-center gap-2 sm:ml-6">
                  <svg
                    className="h-10 w-10 text-purple-300 transition-transform duration-200 group-hover:scale-110 sm:h-12 sm:w-12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
                    <rect x="9" y="3" width="6" height="4" rx="1" />
                    <path d="M9 12h6" />
                    <path d="M9 16h4" />
                  </svg>
                  <span className="flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white backdrop-blur-sm group-hover:bg-white/30">
                    이용 안내
                  </span>
                </div>
              </button>
            )}

            {premiumLoad ? (
              <div
                className="group flex min-h-[7.5rem] items-center justify-between overflow-hidden rounded-2xl px-5 py-5 shadow-md opacity-80 animate-pulse cursor-wait sm:px-7"
                style={{
                  background: 'linear-gradient(120deg, #0c4a6e 0%, #0369a1 48%, #0d9488 100%)',
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <span className="text-lg font-extrabold tracking-tight text-white sm:text-xl">변형문제 만들기</span>
                  <p className="text-sm font-medium text-cyan-100">불러오는 중…</p>
                </div>
              </div>
            ) : isPremiumMember ? (
              <Link
                href="/my/premium/variant-generate"
                className="group flex min-h-[7.5rem] items-center justify-between overflow-hidden rounded-2xl px-5 py-5 shadow-md transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 sm:px-7"
                style={{
                  background: 'linear-gradient(120deg, #0c4a6e 0%, #0369a1 48%, #0d9488 100%)',
                }}
              >
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-lg font-extrabold tracking-tight text-white sm:text-xl">변형문제 만들기</span>
                  <p className="text-sm font-medium text-cyan-100">
                    본인 Claude API 키로 지문을 넣고 초안을 생성합니다
                  </p>
                  <p className="mt-0.5 text-xs text-cyan-200/90">
                    가입하면 7일 무료 · 월구독·연회원 전용 · API 키는 내 정보 탭에서만 등록(브라우저 로컬), 생성 시에만 Anthropic으로 전달됩니다
                  </p>
                </div>
                <div className="ml-4 flex shrink-0 flex-col items-center gap-2 text-cyan-100 sm:ml-6">
                  <div className="transition-transform duration-200 group-hover:scale-110 [&_svg]:h-10 [&_svg]:w-10 sm:[&_svg]:h-12 sm:[&_svg]:w-12">
                    <IconByok />
                  </div>
                  <span className="flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white backdrop-blur-sm group-hover:bg-white/30">
                    시작하기
                    <svg className="h-3 w-3 transition-transform duration-200 group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14" /><path d="M12 5l7 7-7 7" />
                    </svg>
                  </span>
                </div>
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setByokGateOpen(true)}
                className="group flex min-h-[7.5rem] w-full items-center justify-between overflow-hidden rounded-2xl px-5 py-5 text-left shadow-md transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 sm:px-7"
                style={{
                  background: 'linear-gradient(120deg, #0c4a6e 0%, #0369a1 48%, #0d9488 100%)',
                }}
              >
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-lg font-extrabold tracking-tight text-white sm:text-xl">변형문제 만들기</span>
                  <p className="text-sm font-medium text-cyan-100">
                    본인 Claude API 키로 지문을 넣고 초안을 생성합니다
                  </p>
                  <p className="mt-0.5 text-xs text-amber-100">
                    로그인 없이 바로 사용 가능
                  </p>
                </div>
                <div className="ml-4 flex shrink-0 flex-col items-center gap-2 text-cyan-100 sm:ml-6">
                  <div className="transition-transform duration-200 group-hover:scale-110 [&_svg]:h-10 [&_svg]:w-10 sm:[&_svg]:h-12 sm:[&_svg]:w-12">
                    <IconByok />
                  </div>
                  <span className="flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white backdrop-blur-sm group-hover:bg-white/30">
                    이용 안내
                  </span>
                </div>
              </button>
            )}
          </div>

          {finalGateOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => setFinalGateOpen(false)}>
              <div
                className="max-w-md w-full rounded-2xl bg-white p-6 shadow-xl space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-bold text-gray-900">파이널 예비 모의고사</h3>
                {!isMember ? (
                  <p className="text-sm text-gray-600">
                    로그인 후 <strong>연회원</strong> 또는 <strong>월구독</strong>으로 이용할 수 있습니다.
                    <span className="block text-xs text-gray-500 mt-2">{membershipPricingOneLiner()}</span>
                  </p>
                ) : (
                  <p className="text-sm text-gray-600">
                    이 메뉴는 <strong>연회원</strong> 또는 <strong>월구독</strong> 회원만 이용할 수 있습니다. 가입·요금 안내는 카카오톡으로 문의해 주세요.
                    <span className="block text-xs text-gray-500 mt-2">{membershipPricingOneLiner()}</span>
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  {!isMember ? (
                    <Link
                      href="/login?from=/unified"
                      className="block text-center rounded-xl bg-purple-700 px-4 py-3 text-sm font-bold text-white hover:bg-purple-800"
                      onClick={() => setFinalGateOpen(false)}
                    >
                      로그인
                    </Link>
                  ) : null}
                  <Link
                    href="/my"
                    className="block text-center rounded-xl border border-purple-300 px-4 py-3 text-sm font-semibold text-purple-800 hover:bg-purple-50"
                    onClick={() => setFinalGateOpen(false)}
                  >
                    내 정보
                  </Link>
                  <a
                    href={KAKAO_INQUIRY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center rounded-xl border border-amber-300 px-4 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-50"
                  >
                    카카오톡 문의
                  </a>
                  <button
                    type="button"
                    className="text-sm text-gray-500 underline"
                    onClick={() => setFinalGateOpen(false)}
                  >
                    닫기
                  </button>
                </div>
              </div>
            </div>
          )}

          {byokGateOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={() => setByokGateOpen(false)}>
              <div
                className="max-w-md w-full rounded-2xl bg-white p-6 shadow-xl space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-lg font-bold text-gray-900">변형문제 만들기</h3>
                {!isMember ? (
                  <>
                    <p className="text-sm text-gray-600">
                      본인 Claude API 키로 <strong>로그인 없이 바로</strong> 변형문제를 체험할 수 있습니다.
                      <br />
                      저장·내보내기(HWP/Excel)는 월구독 회원 전용입니다.
                      <span className="block text-xs text-gray-500 mt-2">{membershipPricingOneLiner()}</span>
                    </p>
                    <div className="flex flex-col gap-2">
                      <Link
                        href="/variant"
                        className="block text-center rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white hover:bg-sky-700"
                        onClick={() => setByokGateOpen(false)}
                      >
                        로그인 없이 체험하기
                      </Link>
                      <Link
                        href="/login?from=/my/premium/variant-generate"
                        className="block text-center rounded-xl border border-sky-300 px-4 py-3 text-sm font-semibold text-sky-900 hover:bg-sky-50"
                        onClick={() => setByokGateOpen(false)}
                      >
                        로그인 (저장 기능 포함)
                      </Link>
                      <a
                        href={KAKAO_INQUIRY_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-center rounded-xl border border-amber-300 px-4 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-50"
                      >
                        카카오톡 문의
                      </a>
                      <button
                        type="button"
                        className="text-sm text-gray-500 underline"
                        onClick={() => setByokGateOpen(false)}
                      >
                        닫기
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-gray-600">
                      가입일 기준 <strong>7일간 무료 체험</strong>이 가능합니다. 체험 종료 후에는 <strong>연회원</strong> 또는 <strong>월구독</strong>이 필요합니다. 본인 Claude API 키로 초안을 생성합니다.
                      <span className="block text-xs text-gray-500 mt-2">{membershipPricingOneLiner()}</span>
                    </p>
                    <div className="flex flex-col gap-2">
                      <Link
                        href="/my"
                        className="block text-center rounded-xl bg-sky-700 px-4 py-3 text-sm font-bold text-white hover:bg-sky-800"
                        onClick={() => setByokGateOpen(false)}
                      >
                        내 정보 (구독·API 키 설정)
                      </Link>
                      <a
                        href={KAKAO_INQUIRY_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-center rounded-xl border border-amber-300 px-4 py-3 text-sm font-semibold text-amber-900 hover:bg-amber-50"
                      >
                        카카오톡 문의
                      </a>
                      <button
                        type="button"
                        className="text-sm text-gray-500 underline"
                        onClick={() => setByokGateOpen(false)}
                      >
                        닫기
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <section className="mt-8" aria-labelledby="hub-primary-heading">
            <div className="mb-4">
              <h2 id="hub-primary-heading" className="text-lg font-bold text-slate-900 tracking-tight">
                모의고사 · 부교재 · 교과서 자료 주문
              </h2>
              <p className="mt-1 text-sm text-slate-600">가장 많이 이용하시는 주문입니다. 아래에서 바로 시작할 수 있어요.</p>
            </div>
            {renderHubGrid(hubPrimary)}
          </section>

          <section className="mt-12 border-t border-slate-200/90 pt-10" aria-labelledby="hub-more-heading">
            <div className="mb-4">
              <h2 id="hub-more-heading" className="text-base font-bold text-slate-800 tracking-tight">
                다른 주문 · 서비스
              </h2>
              <p className="mt-1 text-sm text-slate-500">워크북, 번호별 제작, 분석지, 서술형, 단어장, 통합 주문 등</p>
            </div>
            {renderHubGrid(hubMore)}
          </section>
        </div>
      </div>
    </>
  );
};

export default TextbookSelection;
