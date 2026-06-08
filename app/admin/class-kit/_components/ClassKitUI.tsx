'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/** 클래스키트 공통 UI — 헤더·툴바·설정 패널·미리보기 영역 */

export const ckInputClass =
  'w-full rounded-lg border border-zinc-700/80 bg-zinc-950/90 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 transition-colors focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20';

export const ckSelectClass =
  'w-full rounded-lg border border-zinc-700/80 bg-zinc-950/90 px-2.5 py-2 text-sm text-zinc-100 transition-colors focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20';

export const ckLabelClass = 'mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500';

export const ckSectionTitleClass = 'text-sm font-semibold text-zinc-100';

export function ClassKitAccessBanner({
  passagesApiBase,
  onSignup,
}: {
  passagesApiBase?: string;
  onSignup?: () => void;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    if (!passagesApiBase?.includes('/api/class-kit/')) return;
    fetch(`${passagesApiBase}/textbooks`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.notice === 'string' && d.notice.trim()) setNotice(d.notice.trim());
        setIsGuest(!!d.guest);
      })
      .catch(() => {});
  }, [passagesApiBase]);

  if (!notice) return null;

  return (
    <div className="shrink-0 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2.5 lg:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-relaxed text-amber-100">{notice}</p>
        {isGuest && onSignup ? (
          <button
            type="button"
            onClick={onSignup}
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            회원가입
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ClassKitRoot({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-svh flex-col bg-zinc-950 text-zinc-100">
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.35]"
        aria-hidden
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgb(63 63 70 / 0.45) 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }}
      />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

export function ClassKitHeader({
  homeHref,
  onLoadPassage,
  passageInfo,
  message,
  actions,
  tabs,
}: {
  homeHref?: string;
  onLoadPassage: () => void;
  passageInfo?: ReactNode;
  message?: string;
  actions: ReactNode;
  tabs: ReactNode;
}) {
  return (
    <header className="shrink-0 border-b border-zinc-800/90 bg-zinc-950/80 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 lg:px-5">
        <div className="flex min-w-0 items-center gap-2">
          {homeHref ? (
            <Link
              href={homeHref}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/80 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
              title="클래스키트 홈"
              aria-label="클래스키트 홈"
            >
              <IconHome />
            </Link>
          ) : null}
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-500/90">Class Kit</p>
            <h1 className="truncate text-base font-bold tracking-tight text-white">클래스키트</h1>
          </div>
        </div>

        <button
          type="button"
          onClick={onLoadPassage}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm shadow-emerald-900/30 transition-colors hover:bg-emerald-500"
        >
          <IconFolderOpen />
          지문 불러오기
        </button>

        {passageInfo}

        {message ? (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-200">
            {message}
          </span>
        ) : null}

        <div className="flex-1" />

        <div className="flex items-center gap-1 rounded-xl border border-zinc-800 bg-zinc-900/70 p-1">{actions}</div>
      </div>

      <div className="border-t border-zinc-800/70 px-4 py-2 lg:px-5">{tabs}</div>
    </header>
  );
}

export function ClassKitPassageNav({
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  chapter,
  number,
  sourceKey,
  sentenceCount,
  position,
  extra,
}: {
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  chapter: string;
  number: string;
  sourceKey?: string;
  sentenceCount: number;
  position?: string;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-900/80 p-0.5">
        <ClassKitIconButton
          onClick={onPrev}
          disabled={!hasPrev}
          title="이전 지문"
          label="이전 지문"
          size="sm"
        >
          <IconChevronLeft />
        </ClassKitIconButton>
        <ClassKitIconButton
          onClick={onNext}
          disabled={!hasNext}
          title="다음 지문"
          label="다음 지문"
          size="sm"
        >
          <IconChevronRight />
        </ClassKitIconButton>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-md border border-zinc-700/80 bg-zinc-900 px-2 py-1 font-mono text-zinc-300">
          {chapter} · {number}
        </span>
        {sourceKey ? <span className="max-w-[12rem] truncate text-emerald-400/90">{sourceKey}</span> : null}
        <span className="text-zinc-500">{sentenceCount}문장</span>
        {position ? <span className="tabular-nums text-zinc-600">{position}</span> : null}
        {extra}
      </div>
    </div>
  );
}

export function ClassKitIconButton({
  onClick,
  disabled,
  title,
  label,
  active,
  children,
  size = 'md',
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  label: string;
  active?: boolean;
  children: ReactNode;
  size?: 'sm' | 'md';
}) {
  const dim = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className={`${dim} flex items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? 'bg-emerald-600/90 text-white'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  );
}

export function ClassKitPreviewPane({
  children,
  empty,
  onLoadPassage,
}: {
  children: ReactNode;
  empty?: boolean;
  onLoadPassage?: () => void;
}) {
  if (empty) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/60 px-8 py-10 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-950 text-zinc-500">
            <IconDocument />
          </div>
          <p className="text-sm font-medium text-zinc-300">불러온 지문이 없습니다</p>
          <p className="mt-1 text-xs text-zinc-500">교재에서 지문을 선택하면 미리보기가 표시됩니다.</p>
          {onLoadPassage ? (
            <button
              type="button"
              onClick={onLoadPassage}
              className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-500"
            >
              <IconFolderOpen />
              지문 불러오기
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4 scrollbar-thin sm:p-6">
      <div className="mx-auto rounded-xl border border-zinc-700/50 bg-white shadow-2xl shadow-black/40 ring-1 ring-black/5">
        {children}
      </div>
    </div>
  );
}

export function ClassKitSettingsAside({ children }: { children: ReactNode }) {
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l border-zinc-800/90 bg-zinc-900/75 backdrop-blur-sm scrollbar-thin">
      <div className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-900/95 px-4 py-3 backdrop-blur">
        <h2 className={ckSectionTitleClass}>설정</h2>
        <p className="mt-0.5 text-[11px] text-zinc-500">미리보기·PDF에 바로 반영됩니다</p>
      </div>
      <div className="space-y-5 p-4">{children}</div>
    </aside>
  );
}

export function ClassKitField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className={ckLabelClass}>{label}</label>
      {children}
    </div>
  );
}

export function ClassKitDivider() {
  return <div className="border-t border-zinc-800/90" />;
}

export function ClassKitSliderSection({
  title,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  marks,
  footer,
  formatValue,
}: {
  title: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  marks: [string, string, string];
  footer?: ReactNode;
  formatValue?: (v: number) => string;
}) {
  const display = formatValue ? formatValue(value) : value.toFixed(1);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className={ckSectionTitleClass}>
          {title}
          {hint ? <span className="ml-1 text-xs font-normal text-zinc-500">({hint})</span> : null}
        </span>
        <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-xs tabular-nums text-emerald-300">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-emerald-500"
      />
      <div className="flex justify-between text-[10px] text-zinc-500">
        <span>{marks[0]}</span>
        <span>{marks[1]}</span>
        <span>{marks[2]}</span>
      </div>
      {footer}
    </div>
  );
}

export function ClassKitPrimaryButton({
  onClick,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function ClassKitSecondaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-lg border border-zinc-700 bg-zinc-950/60 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-800/80 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function ClassKitModal({
  open,
  onClose,
  title,
  subtitle,
  busy,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  busy?: boolean;
  children: ReactNode;
  footer: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-700/80 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <div>
            <h3 className="font-bold text-white">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-[11px] text-zinc-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-800 disabled:opacity-40"
            aria-label="닫기"
          >
            <IconClose />
          </button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
        <div className="shrink-0 border-t border-zinc-800 px-5 py-3">{footer}</div>
      </div>
    </div>
  );
}

/* ── Icons ── */

function IconHome() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

function IconFolderOpen() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 14h12" />
      <path d="M6 18h12" />
      <path d="M4 6h5l2 3h9v11H4Z" />
    </svg>
  );
}

function IconChevronLeft() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function IconChevronRight() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function IconDocument() {
  return (
    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M10 13h4" />
      <path d="M10 17h4" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export function IconMonitor() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
    </svg>
  );
}

export function IconPdf() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M10 12h1" />
      <path d="M10 16h4" />
    </svg>
  );
}

export function IconBooks() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
    </svg>
  );
}

export function IconPrint() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 9V3h12v6" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </svg>
  );
}

export function IconSpinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}
