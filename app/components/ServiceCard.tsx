'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ServiceBadge, ServiceDef } from '@/lib/service-catalog';

/**
 * 홈 서비스 카드 — 가격 / 받는 시점 / 파일 / 이용 조건을 같은 모양으로 보여 준다.
 * 상태 배지는 색만으로 구분하지 않도록 기호+글자를 함께 쓴다.
 */

const BADGE: Record<ServiceBadge, { label: string; mark: string; cls: string }> = {
  free: { label: '무료', mark: '₩0', cls: 'border-sky-300 bg-sky-50 text-sky-900' },
  instant: { label: '바로 이용', mark: '⚡', cls: 'border-emerald-300 bg-emerald-50 text-emerald-900' },
  'made-to-order': { label: '주문 제작', mark: '⏱', cls: 'border-amber-300 bg-amber-50 text-amber-900' },
  member: { label: '회원', mark: '👤', cls: 'border-slate-300 bg-white text-slate-800' },
  premium: { label: '구독 회원 전용', mark: '👑', cls: 'border-violet-300 bg-violet-50 text-violet-900' },
  tool: { label: '직접 생성 도구', mark: '✎', cls: 'border-slate-300 bg-slate-100 text-slate-900' },
};

export function ServiceBadgeChip({ badge }: { badge: ServiceBadge }) {
  const b = BADGE[badge];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-semibold ${b.cls}`}>
      <span aria-hidden>{b.mark}</span>
      {b.label}
    </span>
  );
}

const PRIMARY_BTN =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-[#13294B] px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-[#0c1c36] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#13294B]/40 focus-visible:ring-offset-2';
const SECONDARY_BTN =
  'inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition-colors hover:border-slate-500 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#13294B]/40 focus-visible:ring-offset-2';

export const buttonClass = { primary: PRIMARY_BTN, secondary: SECONDARY_BTN };

type ServiceCardProps = {
  service: ServiceDef;
  /** 기본 CTA(링크) 대신 쓸 행동 — 권한 안내 모달 열기·로그인 유도 등 */
  action?: ReactNode;
  /** 조건 줄 옆에 덧붙일 현재 사용자 기준 상태 (예: 「로그인하면 이용 가능」) */
  statusNote?: string;
  /** 오른쪽 위 모서리(자주 쓰는 메뉴 ☆ 등) */
  corner?: ReactNode;
};

export function ServiceCard({ service, action, statusNote, corner }: ServiceCardProps) {
  const { title, summary, facts, badges, note, links, href, cta } = service;
  const titleId = `svc-${service.id}-title`;

  const rows: { dt: string; dd: string }[] = [
    { dt: '가격', dd: facts.price },
    { dt: '받는 시점', dd: facts.delivery },
    ...(facts.format ? [{ dt: '파일', dd: facts.format }] : []),
    { dt: '이용 조건', dd: facts.condition },
  ];

  return (
    <article
      aria-labelledby={titleId}
      className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start gap-1.5">
        <div className="flex flex-1 flex-wrap items-center gap-1.5">
          {badges.map((b) => (
            <ServiceBadgeChip key={b} badge={b} />
          ))}
        </div>
        {corner ? <div className="-mr-2 -mt-2">{corner}</div> : null}
      </div>
      <h3 id={titleId} className="mt-2.5 text-lg font-bold tracking-tight text-slate-900 break-keep">
        {title}
      </h3>
      <p className="mt-1 text-[15px] leading-relaxed text-slate-700 break-keep">{summary}</p>

      <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
        {rows.map((r) => (
          <div key={r.dt} className="grid grid-cols-[4.75rem_1fr] gap-2">
            <dt className="font-semibold text-slate-600">{r.dt}</dt>
            <dd className="text-slate-900 break-keep">{r.dd}</dd>
          </div>
        ))}
      </dl>

      {note && (
        <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 break-keep">
          <span aria-hidden>ⓘ </span>
          {note}
        </p>
      )}
      {statusNote && (
        <p className="mt-2 text-sm font-semibold text-slate-800 break-keep" role="status">
          → {statusNote}
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-4">
        {action ??
          (links && links.length > 0 ? (
            links.map((l) => (
              <Link key={l.href} href={l.href} prefetch={false} className={`${PRIMARY_BTN} flex-1`} aria-label={`${l.label} ${cta}`}>
                {l.label}
              </Link>
            ))
          ) : (
            <Link href={href} prefetch={false} className={`${PRIMARY_BTN} w-full sm:w-auto`}>
              {cta}
              <span aria-hidden>→</span>
            </Link>
          ))}
      </div>
    </article>
  );
}

/**
 * 상세 화면 상단 요약 — 홈 카드와 같은 네 줄(가격·받는 시점·파일·이용 조건)을 같은 모양으로.
 * 값은 lib/service-catalog 에서 가져온다.
 */
export function ServiceFactsPanel({ service, className = '' }: { service: ServiceDef; className?: string }) {
  const { facts, note } = service;
  const rows: { dt: string; dd: string }[] = [
    { dt: '가격', dd: facts.price },
    { dt: '받는 시점', dd: facts.delivery },
    ...(facts.format ? [{ dt: '파일', dd: facts.format }] : []),
    { dt: '이용 조건', dd: facts.condition },
  ];
  return (
    <section aria-label={`${service.title} 이용 정보`} className={`rounded-xl border border-slate-200 bg-white px-4 py-3 ${className}`}>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {service.badges.map((b) => (
          <ServiceBadgeChip key={b} badge={b} />
        ))}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
        {rows.map((r) => (
          <div key={r.dt} className="grid grid-cols-[4.75rem_1fr] gap-2">
            <dt className="font-semibold text-slate-600">{r.dt}</dt>
            <dd className="text-slate-900 break-keep">{r.dd}</dd>
          </div>
        ))}
      </dl>
      {note && (
        <p className="mt-2 text-sm font-medium text-slate-800 break-keep">
          <span aria-hidden>ⓘ </span>
          {note}
        </p>
      )}
    </section>
  );
}
