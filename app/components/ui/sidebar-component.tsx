"use client";

import React, { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search as SearchIcon,
  Dashboard,
  Task,
  UserMultiple,
  Analytics,
  DocumentAdd,
  User as UserIcon,
  ChevronDown as ChevronDownIcon,
  ChartBar,
  CheckmarkOutline,
  ArrowLeft,
  Catalog,
} from "@carbon/icons-react";

/* ----------------------------- Brand / Logo ----------------------------- */

function VipLogoBadge({ userName }: { userName: string }) {
  return (
    <div className="w-full px-1">
      <div className="flex items-center gap-3 px-2 py-1.5">
        <div className="relative">
          <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-[#c9a44e] via-[#e8d48b] to-[#c9a44e] flex items-center justify-center shadow-[0_0_12px_rgba(201,164,78,0.2)]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L10.5 6.5L15 7.5L11.5 11L12.5 15.5L8 13L3.5 15.5L4.5 11L1 7.5L5.5 6.5L8 2Z" fill="#1a1500" fillOpacity="0.9" />
            </svg>
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-zinc-100 truncate leading-tight">
            {userName}
          </div>
          <div className="text-[11px] text-[#c9a44e] font-medium leading-tight mt-0.5">
            VIP
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Avatar -------------------------------- */

function AvatarCircle({ size = 32 }: { size?: number }) {
  return (
    <div
      className="relative rounded-full shrink-0 bg-zinc-800 ring-1 ring-zinc-700/50"
      style={{ width: size, height: size }}
    >
      <div className="flex items-center justify-center w-full h-full">
        <UserIcon size={size * 0.5} className="text-zinc-400" />
      </div>
    </div>
  );
}

/* ------------------------------ Search Input ----------------------------- */

function SearchContainer({ isCollapsed = false }: { isCollapsed?: boolean }) {
  const [searchValue, setSearchValue] = useState("");

  if (isCollapsed) {
    return (
      <div className="w-full flex justify-center">
        <div className="w-9 h-9 rounded-lg bg-zinc-800/50 flex items-center justify-center cursor-pointer hover:bg-zinc-800 transition-colors">
          <SearchIcon size={14} className="text-zinc-500" />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-3">
      <div className="relative h-9 rounded-lg bg-zinc-900 flex items-center ring-1 ring-zinc-800 focus-within:ring-zinc-700 transition-all">
        <div className="pl-2.5 flex items-center justify-center">
          <SearchIcon size={14} className="text-zinc-500" />
        </div>
        <input
          type="text"
          placeholder="검색..."
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          className="flex-1 bg-transparent border-none outline-none text-[13px] text-zinc-200 placeholder:text-zinc-600 px-2 py-1"
        />
      </div>
    </div>
  );
}

/* --------------------------------- Layout -------------------------------- */

function getActiveSectionFromPath(pathname: string): string {
  if (pathname === "/my/vip") return "dashboard";
  if (pathname.startsWith("/my/vip/attendance")) return "attendance";
  if (pathname.startsWith("/my/vip/students")) return "students";
  if (pathname.startsWith("/my/vip/exams")) return "exams";
  if (pathname.startsWith("/my/vip/scores")) return "scores";
  if (pathname.startsWith("/my/vip/questions")) return "questions";
  if (pathname.startsWith("/my/vip/generate")) return "generate";
  if (pathname.startsWith("/my/vip/analysis")) return "analysis";
  return "dashboard";
}

/* ----------------------- 통합 사이드바 (단일 패널) ----------------------- */

interface UnifiedNavItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  href: string;
  exact?: boolean;
  /** 실제 하위 페이지가 있는 섹션만 — 활성 시 인라인으로 펼침 */
  children?: { label: string; href: string }[];
}

const UNIFIED_NAV: UnifiedNavItem[] = [
  { id: "dashboard", icon: <Dashboard size={18} />, label: "대시보드", href: "/my/vip", exact: true },
  { id: "students", icon: <UserMultiple size={18} />, label: "학생 관리", href: "/my/vip/students" },
  {
    id: "attendance",
    icon: <CheckmarkOutline size={18} />,
    label: "출결관리",
    href: "/my/vip/attendance",
    children: [
      { label: "출결 입력", href: "/my/vip/attendance" },
      { label: "반 관리", href: "/my/vip/attendance/classes" },
      { label: "출결 통계", href: "/my/vip/attendance/history" },
    ],
  },
  {
    id: "exams",
    icon: <Task size={18} />,
    label: "시험 관리",
    href: "/my/vip/exams",
    children: [
      { label: "시험 준비", href: "/my/vip/exams" },
      { label: "기출 분석·예측", href: "/my/vip/exams/analysis" },
    ],
  },
  { id: "scores", icon: <ChartBar size={18} />, label: "성적 관리", href: "/my/vip/scores" },
  {
    id: "generate",
    icon: <DocumentAdd size={18} />,
    label: "문제 생성",
    href: "/my/vip/generate",
    children: [
      { label: "학생별 시험지 만들기", href: "/my/vip/generate/student" },
      { label: "학교별 시험지 만들기", href: "/my/vip/generate/school" },
      { label: "QR 자가채점 결과", href: "/my/vip/generate/grade-results" },
    ],
  },
  { id: "questions", icon: <Catalog size={18} />, label: "문제 관리", href: "/my/vip/questions" },
  { id: "analysis", icon: <Analytics size={18} />, label: "시험 분석", href: "/my/vip/analysis" },
];

function UnifiedSidebar({ userName }: { userName: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const activeId = getActiveSectionFromPath(pathname);

  return (
    <aside
      className={`bg-[#111113] flex flex-col h-screen border-r border-zinc-800/80 overflow-hidden transition-all duration-300 ease-out ${
        collapsed ? "w-[60px] py-4 px-2 items-center" : "w-[244px] py-4"
      }`}
    >
      {/* 헤더: 로고 + 접기 토글 */}
      {collapsed ? (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="사이드바 펼치기"
          aria-label="사이드바 펼치기"
          className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-[#c9a44e] via-[#e8d48b] to-[#c9a44e] flex items-center justify-center shadow-[0_0_12px_rgba(201,164,78,0.2)] mb-3"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 2L10.5 6.5L15 7.5L11.5 11L12.5 15.5L8 13L3.5 15.5L4.5 11L1 7.5L5.5 6.5L8 2Z" fill="#1a1500" fillOpacity="0.9" />
          </svg>
        </button>
      ) : (
        <div className="w-full flex items-center justify-between pr-2">
          <VipLogoBadge userName={userName} />
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="사이드바 접기"
            aria-label="사이드바 접기"
            className="shrink-0 flex items-center justify-center rounded-lg w-7 h-7 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ChevronDownIcon size={14} className="rotate-90" />
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="w-full px-4 mt-2 mb-2">
          <div className="h-px bg-zinc-800/80" />
        </div>
      )}

      <div className={`${collapsed ? "mb-2" : "w-full mb-2"}`}>
        <SearchContainer isCollapsed={collapsed} />
      </div>

      {/* 네비게이션 */}
      <nav className={`flex-1 overflow-y-auto w-full flex flex-col ${collapsed ? "items-center gap-1" : "gap-0.5 px-2"}`}>
        {UNIFIED_NAV.map((item) => {
          const active = item.exact ? pathname === item.href : item.id === activeId;
          const expanded = !collapsed && item.id === activeId && !!item.children;
          return (
            <div key={item.id} className="w-full">
              <button
                type="button"
                onClick={() => router.push(item.href)}
                title={collapsed ? item.label : undefined}
                className={`relative flex items-center rounded-lg transition-colors ${
                  collapsed ? "justify-center w-10 h-10" : "w-full gap-3 px-3 py-2"
                } ${
                  active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                {active && !collapsed && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-[#c9a44e] rounded-r-full" />
                )}
                <span className="shrink-0">{item.icon}</span>
                {!collapsed && <span className="text-[13.5px] font-medium flex-1 text-left">{item.label}</span>}
                {!collapsed && item.children && (
                  <ChevronDownIcon size={14} className={`text-zinc-600 transition-transform ${expanded ? "" : "-rotate-90"}`} />
                )}
              </button>
              {expanded && (
                <div className="ml-[2.1rem] mt-0.5 mb-1 flex flex-col gap-0.5 border-l border-zinc-800 pl-2">
                  {item.children!.map((c) => {
                    const cActive = pathname === c.href;
                    return (
                      <button
                        key={c.href + c.label}
                        type="button"
                        onClick={() => router.push(c.href)}
                        className={`text-left text-[12.5px] rounded-md px-2.5 py-1.5 transition-colors ${
                          cActive ? "text-zinc-100 bg-zinc-800/70" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40"
                        }`}
                      >
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* 푸터: 마이페이지 */}
      {collapsed ? (
        <button
          type="button"
          title="마이페이지"
          aria-label="마이페이지"
          onClick={() => router.push("/my")}
          className="mt-2 flex items-center justify-center rounded-xl w-10 h-10 text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/60 transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
      ) : (
        <div className="w-full mt-2 px-3">
          <div className="h-px bg-zinc-800/80 mb-2" />
          <Link
            href="/my"
            className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-zinc-800/60 transition-colors group"
          >
            <AvatarCircle size={28} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-zinc-300 group-hover:text-zinc-100 transition-colors truncate">{userName}</div>
              <div className="text-[11px] text-zinc-600">마이페이지</div>
            </div>
          </Link>
        </div>
      )}
    </aside>
  );
}

export function VipSidebar({ userName }: { userName: string }) {
  return <UnifiedSidebar userName={userName} />;
}

export default VipSidebar;
