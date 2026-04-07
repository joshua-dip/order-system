'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

export type OrderHubCardProps = {
  title: string;
  description: ReactNode;
  icon: ReactNode;
  accentColor: string;
  gridClassName?: string;
  href?: string;
  interactive: boolean;
  bottomSlot?: ReactNode;
};

function ArrowRight() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 motion-safe:transition-transform motion-safe:duration-200 group-hover:translate-x-1 motion-reduce:group-hover:translate-x-0"
      aria-hidden
    >
      <path d="M5 12h14" />
      <path d="M12 5l7 7-7 7" />
    </svg>
  );
}

export function OrderHubCard({
  title,
  description,
  icon,
  accentColor,
  href,
  interactive,
  bottomSlot,
}: OrderHubCardProps) {
  const isActive = interactive && href;

  const defaultBottom = isActive ? (
    <span
      className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold tracking-wide text-white motion-safe:transition-all motion-safe:duration-200 group-hover:gap-3"
      style={{ backgroundColor: accentColor }}
    >
      이동하기
      <ArrowRight />
    </span>
  ) : null;

  const bottom = bottomSlot ?? defaultBottom;

  const body = (
    <>
      {/* top accent bar */}
      <div
        className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl motion-safe:transition-all motion-safe:duration-300 group-hover:h-[5px]"
        style={{ backgroundColor: accentColor }}
        aria-hidden
      />

      <div className="relative z-10 flex h-full flex-col">
        {/* icon */}
        <div
          className="mb-5 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl shadow-sm motion-safe:transition-transform motion-safe:duration-200 motion-safe:group-hover:scale-105 motion-reduce:group-hover:scale-100"
          style={{
            background: `linear-gradient(135deg, ${accentColor}1a, ${accentColor}30)`,
            border: `1px solid ${accentColor}35`,
            color: accentColor,
          }}
          aria-hidden
        >
          {icon}
        </div>

        {/* title */}
        <h3
          className="text-xl font-bold tracking-tight text-gray-900 motion-safe:transition-colors motion-safe:duration-200"
          style={{ '--hover-color': accentColor } as React.CSSProperties}
        >
          <span className="group-hover:text-[var(--hover-color)]">{title}</span>
        </h3>

        {/* description */}
        <p className="mt-2.5 min-h-[2.75rem] flex-1 text-[0.84rem] leading-relaxed text-gray-500">
          {description}
        </p>

        {/* CTA */}
        {bottom ? <div className="mt-5 flex flex-wrap items-center gap-2">{bottom}</div> : null}
      </div>

      {/* hover gradient background */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 motion-safe:transition-opacity motion-safe:duration-300 group-hover:opacity-100"
        style={{
          background: `linear-gradient(160deg, ${accentColor}06 0%, ${accentColor}10 100%)`,
        }}
        aria-hidden
      />
    </>
  );

  const base = [
    'group relative flex h-full min-h-[196px] w-full flex-col overflow-hidden rounded-2xl border bg-white p-6 text-left shadow-sm',
    'motion-safe:transition-all motion-safe:duration-200 motion-safe:ease-out',
    'hover:shadow-lg motion-safe:hover:-translate-y-1 motion-safe:hover:scale-[1.01]',
    'motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100',
    isActive ? 'cursor-pointer border-gray-200/80 hover:border-gray-300' : 'cursor-default border-gray-200/60',
  ].join(' ');

  const focusRing =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#13294B]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#F8FAFC]';

  if (isActive) {
    return (
      <Link href={href} className={`${base} ${focusRing}`} prefetch={false}>
        {body}
      </Link>
    );
  }

  return (
    <div className={base} role="region" aria-label={title} aria-disabled>
      {body}
    </div>
  );
}
