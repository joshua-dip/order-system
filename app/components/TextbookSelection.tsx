'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import AppBar from './AppBar';
import HomeNoticeModal from './HomeNoticeModal';
import HomeNoticeBar from './HomeNoticeBar';
import { ServiceCard, buttonClass } from './ServiceCard';
import { membershipPricingOneLiner } from '@/lib/membership-pricing';
import { fetchAuthMe } from '@/lib/auth-me-cache';
import {
  SERVICES,
  SERVICE_GROUPS,
  SOLBOOK_SHORTCUT,
  MADE_TO_ORDER_DELIVERY,
  servicesInGroup,
  type ServiceDef,
  type ServiceGroup,
} from '@/lib/service-catalog';

const KAKAO_INQUIRY_URL = process.env.NEXT_PUBLIC_KAKAO_INQUIRY_URL || 'https://open.kakao.com/o/sHuV7wSh';

interface TextbookSelectionProps {
  onTextbookSelect: (textbook: string) => void;
  onMockExamSelect: () => void;
  onWorkbookSelect: () => void;
  onUnifiedSelect?: () => void;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'guest' }
  | { status: 'member'; canAccessAnalysis: boolean; isPremiumMember: boolean };

/** 실제 자료 예시 — 이미 공개된 샘플·체험 경로만 (고객 자료·비공개 파일 X) */
const SAMPLES: { title: string; desc: string; href: string; label: string; external?: boolean }[] = [
  { title: '변형문제 — 빈칸', desc: '유형 설명과 실제 문항 1개', href: '/sample/빈칸', label: '샘플 보기' },
  { title: '변형문제 — 순서', desc: '유형 설명과 실제 문항 1개', href: '/sample/순서', label: '샘플 보기' },
  { title: '서술형 워크북 — 조건영작배열', desc: '실제 PDF 한 묶음', href: '/api/essay-workbook/sample-pdf?type=arrange', label: 'PDF 샘플', external: true },
  { title: '서술형 워크북 — 글의의미', desc: '실제 PDF 한 묶음', href: '/api/essay-workbook/sample-pdf?type=meaning', label: 'PDF 샘플', external: true },
  { title: '모고 Q&A 분석지', desc: '문장 해석·SVOC를 웹에서', href: '/qna', label: '자료 보기' },
  { title: '무료 변형문제 PDF', desc: '무료 7종을 가입 없이', href: '/free', label: '무료 PDF 받기' },
];

/* ── Component ─────────────────────────────────────────────── */

const TextbookSelection = (_props: TextbookSelectionProps) => {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [finalGateOpen, setFinalGateOpen] = useState(false);
  const [byokGateOpen, setByokGateOpen] = useState(false);

  useEffect(() => {
    fetchAuthMe()
      .then((data) => {
        if (data?.user) {
          setAuth({
            status: 'member',
            canAccessAnalysis: !!data.user.canAccessAnalysis,
            isPremiumMember: data.user.isPremiumMember === true,
          });
        } else {
          setAuth({ status: 'guest' });
        }
      })
      .catch(() => setAuth({ status: 'guest' }));
  }, []);

  const loading = auth.status === 'loading';
  const isMember = auth.status === 'member';
  const isPremiumMember = auth.status === 'member' && auth.isPremiumMember;
  const analysisUnlocked = auth.status === 'member' && auth.canAccessAnalysis;

  /* 권한 확인 전에는 잠금 표시를 하지 않는다 — 회원에게 「잠김」이 번쩍이지 않게. 도착 화면이 다시 확인한다. */
  const cardProps = (s: ServiceDef): { action?: React.ReactNode; statusNote?: string } => {
    if (loading) return {};
    switch (s.id) {
      case 'final-mock':
        if (isPremiumMember) return {};
        return {
          statusNote: isMember ? '지금 계정은 구독 회원이 아니에요' : '로그인 후 구독 회원만 이용할 수 있어요',
          action: (
            <button type="button" onClick={() => setFinalGateOpen(true)} className={`${buttonClass.secondary} w-full sm:w-auto`}>
              이용 조건 보기
            </button>
          ),
        };
      case 'ai':
        if (isPremiumMember) {
          return {
            action: (
              <Link href="/my/premium/variant-generate" prefetch={false} className={`${buttonClass.primary} w-full sm:w-auto`}>
                직접 만들기 <span aria-hidden>→</span>
              </Link>
            ),
          };
        }
        return {
          action: (
            <button type="button" onClick={() => setByokGateOpen(true)} className={`${buttonClass.primary} w-full sm:w-auto`}>
              이용 방법 보기
            </button>
          ),
        };
      case 'analysis':
        if (analysisUnlocked) return {};
        return {
          statusNote: isMember ? '이 계정은 아직 분석지 권한이 없어요' : '회원 가입 후 카카오톡으로 신청해 주세요',
          action: (
            <a href={KAKAO_INQUIRY_URL} target="_blank" rel="noopener noreferrer" className={`${buttonClass.secondary} w-full sm:w-auto`}>
              카카오톡으로 신청 <span className="sr-only">(새 창)</span>
            </a>
          ),
        };
      case 'external':
      case 'essay-workbook':
        /* 화면은 로그인 전에도 둘러볼 수 있다(샘플·교재 목록). 주문 단계에서 로그인한다. */
        return isMember ? {} : { statusNote: '주문하려면 로그인이 필요해요' };
      case 'bundle':
        if (isMember) return {};
        return {
          statusNote: '로그인하면 이용할 수 있어요',
          action: (
            <Link href={`/login?from=${encodeURIComponent(s.href)}`} prefetch={false} className={`${buttonClass.secondary} w-full sm:w-auto`}>
              로그인 후 {s.cta}
            </Link>
          ),
        };
      default:
        return {};
    }
  };

  const renderGroup = (group: ServiceGroup, cols = 'lg:grid-cols-3') => (
    <ul className={`grid grid-cols-1 gap-4 md:grid-cols-2 ${cols}`}>
      {servicesInGroup(group).map((s) => (
        <li key={s.id}>
          <ServiceCard service={s} {...cardProps(s)} />
        </li>
      ))}
    </ul>
  );

  const groupMeta = (id: ServiceGroup) => SERVICE_GROUPS.find((g) => g.id === id)!;

  return (
    <>
      <AppBar />
      <HomeNoticeModal showApplyCta={auth.status === 'guest'} />
      {/* 문의 버튼 아래 여백은 KakaoFab 이 페이지 끝에 둔다 */}
      <div className="min-h-screen pb-8 motion-safe:scroll-smooth" style={{ backgroundColor: '#F8FAFC' }}>
        <div className="container mx-auto max-w-6xl px-4 py-8 md:py-10">
          {/* 관리자 공지 한 줄 — 누르면 상세 */}
          <HomeNoticeBar />

          {/* 머리말 — 목적별 바로가기 */}
          <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 sm:text-[1.75rem]">어떤 자료가 필요하세요?</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-700">
              목적별로 모았습니다. 카드마다 <b>가격 · 받는 시점 · 파일 · 이용 조건</b>을 같은 순서로 적어 두었어요.
            </p>
            <nav aria-label="목적별 이동" className="mt-4 flex flex-wrap gap-2">
              {SERVICE_GROUPS.map((g) => (
                <a
                  key={g.id}
                  href={`#group-${g.id}`}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 hover:border-slate-500 hover:bg-slate-50"
                >
                  {g.title}
                </a>
              ))}
            </nav>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Link href="/free" prefetch={false} className={buttonClass.primary}>
                무료 PDF 받기 <span aria-hidden>→</span>
              </Link>
              <Link href={SOLBOOK_SHORTCUT.href} prefetch={false} className={buttonClass.secondary}>
                {SOLBOOK_SHORTCUT.title}
              </Link>
              <a href="#all-services" className={buttonClass.secondary}>
                전체 서비스 목록
              </a>
              <Link href="/guide" prefetch={false} className={buttonClass.secondary}>
                이용안내
              </Link>
            </div>
          </header>

          {/* 수업자료 준비 — 무료·즉시·주문 제작이 섞여 있어 카드 배지로 구분 */}
          <section id="group-class" className="mt-10 scroll-mt-20" aria-labelledby="group-class-title">
            <GroupHeading id="group-class-title" title={groupMeta('class').title} description={groupMeta('class').description} />
            {renderGroup('class', 'xl:grid-cols-4')}
          </section>

          {/* 내신 문제 준비 — 주문 제작 구역. 무료 PDF 는 아래 「무료 학습·체험」으로 분리 */}
          <section id="group-exam" className="mt-12 scroll-mt-20 border-t border-slate-200 pt-10" aria-labelledby="group-exam-title">
            <GroupHeading id="group-exam-title" title={groupMeta('exam').title} description={groupMeta('exam').description}>
              <MadeToOrderNote />
            </GroupHeading>
            {renderGroup('exam')}
          </section>

          <section id="group-compose" className="mt-12 scroll-mt-20 border-t border-slate-200 pt-10" aria-labelledby="group-compose-title">
            <GroupHeading id="group-compose-title" title={groupMeta('compose').title} description={groupMeta('compose').description} />
            {renderGroup('compose')}
          </section>

          <section id="group-free" className="mt-12 scroll-mt-20 border-t border-slate-200 pt-10" aria-labelledby="group-free-title">
            <GroupHeading id="group-free-title" title={groupMeta('free').title} description={groupMeta('free').description} />
            {renderGroup('free', 'lg:grid-cols-2')}
          </section>

          {/* 실제 자료 예시 — 공개 샘플·체험 경로만 */}
          <section id="samples" className="mt-12 scroll-mt-20 border-t border-slate-200 pt-10" aria-labelledby="samples-title">
            <GroupHeading
              id="samples-title"
              title="실제 자료 미리보기"
              description="주문 전에 결과물 모양을 확인해 보세요. 공개 샘플만 보여 드립니다."
            />
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {SAMPLES.map((s) => (
                <li key={s.href} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 break-keep">{s.title}</p>
                    <p className="text-sm text-slate-600">{s.desc}</p>
                  </div>
                  {s.external ? (
                    <a href={s.href} target="_blank" rel="noopener noreferrer" className={`${buttonClass.secondary} shrink-0`}>
                      {s.label}
                      <span className="sr-only"> — {s.title} (새 창)</span>
                    </a>
                  ) : (
                    <Link href={s.href} prefetch={false} className={`${buttonClass.secondary} shrink-0`}>
                      {s.label}
                      <span className="sr-only"> — {s.title}</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>

          {/* 전체 서비스 목록 — 재방문자용. 예전 메뉴 이름도 함께 */}
          <section id="all-services" className="mt-12 scroll-mt-20 border-t border-slate-200 pt-10" aria-labelledby="all-services-title">
            <GroupHeading
              id="all-services-title"
              title="전체 서비스 목록"
              description="찾는 메뉴가 안 보이면 여기서 확인하세요. 예전 메뉴 이름도 함께 적었습니다."
            />
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <ul className="divide-y divide-slate-100">
                {SERVICE_GROUPS.flatMap((g) =>
                  servicesInGroup(g.id).map((s) => (
                    <li key={s.id}>
                      <Link
                        href={s.id === 'ai' && isPremiumMember ? '/my/premium/variant-generate' : s.href}
                        prefetch={false}
                        className="flex flex-col gap-0.5 px-4 py-3 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4"
                      >
                        <span className="w-28 shrink-0 text-xs font-semibold text-slate-600">{g.title}</span>
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold text-slate-900">{s.title}</span>
                          {s.formerTitle && s.formerTitle !== s.title && (
                            <span className="ml-2 text-sm text-slate-600">(예전: {s.formerTitle})</span>
                          )}
                        </span>
                        <span className="text-sm text-slate-700 sm:max-w-[45%] sm:text-right">{s.facts.price}</span>
                      </Link>
                    </li>
                  )),
                )}
                <li>
                  <Link
                    href={SOLBOOK_SHORTCUT.href}
                    prefetch={false}
                    className="flex flex-col gap-0.5 px-4 py-3 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none sm:flex-row sm:items-center sm:gap-4"
                  >
                    <span className="w-28 shrink-0 text-xs font-semibold text-slate-600">바로가기</span>
                    <span className="min-w-0 flex-1 font-semibold text-slate-900">{SOLBOOK_SHORTCUT.title}</span>
                    <span className="text-sm text-slate-700 sm:text-right">{SOLBOOK_SHORTCUT.summary}</span>
                  </Link>
                </li>
              </ul>
            </div>
            <p className="mt-3 text-sm text-slate-600">
              서비스 수: {SERVICES.length + 1}개 · 사용법은{' '}
              <Link href="/guide" prefetch={false} className="font-semibold text-slate-800 underline underline-offset-2">
                이용안내
              </Link>
              , 문의는 오른쪽 아래 카카오톡 버튼으로 해 주세요.
            </p>
          </section>

          {finalGateOpen && (
            <GateModal title="내신 예비시험지" onClose={() => setFinalGateOpen(false)}>
              <p className="text-[15px] leading-relaxed text-slate-700">
                {isMember ? (
                  <>이 메뉴는 <strong>연회원</strong> 또는 <strong>월구독</strong> 회원만 이용할 수 있습니다. 가입·요금 안내는 카카오톡으로 문의해 주세요.</>
                ) : (
                  <>로그인 후 <strong>연회원</strong> 또는 <strong>월구독</strong>으로 이용할 수 있습니다.</>
                )}
                <span className="mt-2 block text-sm text-slate-600">{membershipPricingOneLiner()}</span>
              </p>
              <div className="flex flex-col gap-2">
                {!isMember && (
                  <Link href="/login?from=/unified" className={buttonClass.primary} onClick={() => setFinalGateOpen(false)}>
                    로그인
                  </Link>
                )}
                <Link href="/my/point-charge" className={buttonClass.secondary} onClick={() => setFinalGateOpen(false)}>
                  멤버십 안내
                </Link>
                <a href={KAKAO_INQUIRY_URL} target="_blank" rel="noopener noreferrer" className={buttonClass.secondary}>
                  카카오톡 문의 <span className="sr-only">(새 창)</span>
                </a>
              </div>
            </GateModal>
          )}

          {byokGateOpen && (
            <GateModal title="AI 변형문제 만들기" onClose={() => setByokGateOpen(false)}>
              <div className="space-y-2 text-[15px] leading-relaxed text-slate-700">
                <p>
                  주문이 아니라 <strong>지문을 넣고 직접 생성하는 도구</strong>입니다. 본인 <strong>Anthropic(Claude) API 키</strong>가 필요하고,
                  생성 비용은 <strong>키를 발급한 본인 Anthropic 계정</strong>에 청구됩니다.
                </p>
                {isMember ? (
                  <p>
                    회원판은 가입일 기준 <strong>7일 무료 체험</strong> 후 <strong>연회원·월구독</strong>이 필요합니다. 고난도 문항은 문항당 포인트가 추가로 차감됩니다.
                  </p>
                ) : (
                  <p>
                    로그인 없이 체험할 수 있어요. <strong>저장·내보내기(HWP/Excel)</strong>는 구독 회원 전용입니다.
                  </p>
                )}
                <p className="text-sm text-slate-600">{membershipPricingOneLiner()}</p>
              </div>
              <details className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <summary className="cursor-pointer font-semibold text-slate-900">API 키는 어떻게 쓰이나요?</summary>
                <p className="mt-2 leading-relaxed">
                  키는 이 브라우저에 저장됩니다. 생성할 때만 고미조슈아 서버를 거쳐 Anthropic으로 전달되며, 서버는 키 전체를 저장하지 않습니다
                  (비회원 생성 기록에는 키 앞 12자리만 남습니다). 키는 Anthropic 콘솔에서 발급·삭제할 수 있어요.
                </p>
              </details>
              <div className="flex flex-col gap-2">
                {isMember ? (
                  <Link href="/my" className={buttonClass.primary} onClick={() => setByokGateOpen(false)}>
                    내 정보에서 구독·API 키 설정
                  </Link>
                ) : (
                  <>
                    <Link href="/variant" className={buttonClass.primary} onClick={() => setByokGateOpen(false)}>
                      로그인 없이 체험하기
                    </Link>
                    <Link
                      href="/login?from=/my/premium/variant-generate"
                      className={buttonClass.secondary}
                      onClick={() => setByokGateOpen(false)}
                    >
                      로그인 (저장 기능 포함)
                    </Link>
                  </>
                )}
                <a href={KAKAO_INQUIRY_URL} target="_blank" rel="noopener noreferrer" className={buttonClass.secondary}>
                  카카오톡 문의 <span className="sr-only">(새 창)</span>
                </a>
              </div>
            </GateModal>
          )}
        </div>
      </div>
    </>
  );
};

function GroupHeading({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <h2 id={id} className="text-xl font-bold tracking-tight text-slate-900">
        {title}
      </h2>
      <p className="mt-1 text-[15px] leading-relaxed text-slate-700">{description}</p>
      {children}
    </div>
  );
}

/** 주문 제작 구역 공통 안내 — 주문서 하단 정책 문구와 같은 내용 */
function MadeToOrderNote() {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
      <span className="font-bold">
        <span aria-hidden>⏱ </span>주문 제작:
      </span>
      <span>{MADE_TO_ORDER_DELIVERY}.</span>
      <span>AI 변형문제 만들기는 직접 생성하는 도구라 바로 사용합니다.</span>
      <a
        href="https://blog.naver.com/englishcloud_"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-[#13294B] underline underline-offset-2"
      >
        편집 양식 안내 보기<span className="sr-only"> (새 창)</span>
      </a>
    </p>
  );
}

function GateModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            autoFocus
            className="-mr-2 -mt-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#13294B]/40"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default TextbookSelection;
