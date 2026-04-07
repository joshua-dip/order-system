'use client';

import { useState, useEffect, useMemo, type ReactNode } from 'react';
import AppBar from './AppBar';
import { OrderHubCard, type OrderHubCardProps } from './OrderHubCard';

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

interface TextbookSelectionProps {
  onTextbookSelect: (textbook: string) => void;
  onMockExamSelect: () => void;
  onWorkbookSelect: () => void;
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

/* ── Hub items ─────────────────────────────────────────────── */

function useHubItems(analysisUnlocked: boolean, isMember: boolean): HubEntry[] {
  return useMemo(
    () => [
      {
        id: 'mock',
        title: '모의고사 변형문제 주문',
        description: (<>18~40번, 41~42번, 43~45번<br />정해진 문항 구성</>),
        icon: <IconMock /> as ReactNode,
        accentColor: '#13294B',
        gridClassName: 'lg:col-span-3',
        href: '/mockexam',
        interactive: true,
      },
      {
        id: 'textbook',
        title: '부교재 변형문제 주문',
        description: (<>교재별 맞춤 문항 선택<br />다양한 교재 지원</>),
        icon: <IconTextbook /> as ReactNode,
        accentColor: '#13294B',
        gridClassName: 'lg:col-span-3',
        href: '/textbook',
        interactive: true,
      },
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
          ? (<>교재 하나로 변형·워크북·서술형·분석지를<br />한 번에 주문</>)
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
    ],
    [analysisUnlocked, isMember]
  );
}

/* ── Component ─────────────────────────────────────────────── */

const TextbookSelection = (_props: TextbookSelectionProps) => {
  const [user, setUser] = useState<{ canAccessAnalysis: boolean } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => {
        if (data?.user) {
          setUser({ canAccessAnalysis: !!data.user.canAccessAnalysis });
        } else {
          setUser(null);
        }
      })
      .catch(() => setUser(null));
  }, []);

  const isMember = user !== null;
  const analysisUnlocked = isMember && user.canAccessAnalysis;
  const hubItems = useHubItems(analysisUnlocked, isMember);

  return (
    <>
      <AppBar />
      <div className="min-h-screen motion-safe:scroll-smooth" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="container mx-auto max-w-6xl px-4 py-8 md:py-10">
          <div
            className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-6"
            role="list"
          >
            {hubItems.map(
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
        </div>
      </div>
    </>
  );
};

export default TextbookSelection;
