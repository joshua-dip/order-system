'use client';

/**
 * 클래스키트 — 개요/랜딩.
 * 수업 운영용 자료 모음. 강의용자료·수업용자료로 나뉜다.
 */

import Link from 'next/link';

const SECTIONS = [
  {
    href: '/admin/class-kit/lecture',
    label: '강의용자료',
    desc: '교사가 강의할 때 쓰는 자료 (슬라이드·판서·강의 노트 등)',
    accent: 'border-sky-700/50 hover:border-sky-500 bg-sky-950/20',
    badge: 'bg-sky-500/20 text-sky-200',
  },
  {
    href: '/admin/class-kit/lesson',
    label: '수업용자료',
    desc: '수업·배부용 자료 (학생 핸드아웃·연습지·과제 등)',
    accent: 'border-emerald-700/50 hover:border-emerald-500 bg-emerald-950/20',
    badge: 'bg-emerald-500/20 text-emerald-200',
  },
];

export default function ClassKitPage() {
  return (
    <div className="p-6 sm:p-10 max-w-4xl">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white">클래스키트</h1>
        <p className="text-slate-400 text-sm mt-2 leading-relaxed">
          수업 운영에 쓰는 자료를 모아두는 공간입니다. 용도에 따라 강의용·수업용으로 나뉩니다.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className={`block rounded-xl border p-5 transition-colors ${s.accent}`}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold text-white">{s.label}</h2>
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${s.badge}`}>
                준비 중
              </span>
            </div>
            <p className="text-slate-400 text-sm mt-2 leading-relaxed">{s.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
