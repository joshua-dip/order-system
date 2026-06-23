"use client";

import React, { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { getCurrentSubject, setCurrentSubject, DEFAULT_VIP_SUBJECT, ENGLISH_ONLY_MENU_IDS } from "@/lib/vip-subject";
import {
  Search as SearchIcon,
  Dashboard,
  Task,
  UserMultiple,
  Api,
  Notebook,
  Report,
  Money,
  Education,
  Chat,
  Book,
  DocumentAdd,
  User as UserIcon,
  ChevronDown as ChevronDownIcon,
  ChartBar,
  CheckmarkOutline,
  ArrowLeft,
  Catalog,
  Settings as SettingsIcon,
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
  if (pathname.startsWith("/my/vip/qbank-api")) return "qbank-api";
  if (pathname.startsWith("/my/vip/review")) return "review";
  if (pathname.startsWith("/my/vip/homework")) return "homework";
  if (pathname.startsWith("/my/vip/report")) return "report";
  if (pathname.startsWith("/my/vip/tuition")) return "tuition";
  if (pathname.startsWith("/my/vip/counseling")) return "counseling";
  if (pathname.startsWith("/my/vip/lessons")) return "lessons";
  if (pathname.startsWith("/my/vip/attendance")) return "attendance";
  if (pathname.startsWith("/my/vip/students")) return "students";
  if (pathname.startsWith("/my/vip/exams")) return "exams";
  if (pathname.startsWith("/my/vip/analysis")) return "exams"; // 시험 분석은 「시험 관리」 하위
  if (pathname.startsWith("/my/vip/scores")) return "scores";
  if (pathname.startsWith("/my/vip/questions")) return "questions";
  if (pathname.startsWith("/my/vip/generate")) return "generate";
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
  children?: { label: string; href: string; id?: string }[];
}

/** 사이드바 섹션 — 메뉴가 늘어나 학습/운영/도구로 그룹화. */
interface NavSection {
  title?: string;
  items: UnifiedNavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { id: "dashboard", icon: <Dashboard size={18} />, label: "대시보드", href: "/my/vip", exact: true },
    ],
  },
  {
    title: "학습",
    items: [
      {
        id: "exams",
        icon: <Task size={18} />,
        label: "시험 관리",
        href: "/my/vip/exams",
        children: [
          { label: "시험 준비", href: "/my/vip/exams" },
          { label: "기출 분석·예측", href: "/my/vip/exams/analysis" },
          { label: "시험 분석", href: "/my/vip/analysis", id: "analysis" },
        ],
      },
      { id: "scores", icon: <ChartBar size={18} />, label: "성적 관리", href: "/my/vip/scores" },
      { id: "report", icon: <Report size={18} />, label: "성적표", href: "/my/vip/report" },
      { id: "review", icon: <Notebook size={18} />, label: "오답노트", href: "/my/vip/review" },
      { id: "homework", icon: <Education size={18} />, label: "숙제 관리", href: "/my/vip/homework" },
    ],
  },
  {
    title: "운영",
    items: [
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
      { id: "tuition", icon: <Money size={18} />, label: "수강료 관리", href: "/my/vip/tuition" },
      { id: "counseling", icon: <Chat size={18} />, label: "상담일지", href: "/my/vip/counseling" },
      { id: "lessons", icon: <Book size={18} />, label: "수업일지", href: "/my/vip/lessons" },
    ],
  },
  {
    title: "도구",
    items: [
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
      { id: "qbank-api", icon: <Api size={18} />, label: "문제은행 API", href: "/my/vip/qbank-api" },
    ],
  },
];

function UnifiedSidebar({ userName, theme = 'dark', onToggleTheme }: { userName: string; theme?: 'dark' | 'light'; onToggleTheme?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const activeId = getActiveSectionFromPath(pathname);
  // 접근 가능한 메뉴(무료 + 언락) — null=로딩중(전체 표시). 로드 후 유료·미언락 메뉴 숨김.
  const [accessible, setAccessible] = useState<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/my/vip/menus', { credentials: 'include' }).then((r) => r.json()).then((d) => {
      if (!alive || !d.ok) return;
      const s = new Set<string>(['dashboard']);
      for (const m of d.menus as { id: string; paid: boolean; unlocked: boolean }[]) {
        if (!m.paid || m.unlocked) s.add(m.id);
      }
      setAccessible(s);
    }).catch(() => {});
    return () => { alive = false; };
  }, [pathname]);
  // 전역 과목 컨텍스트
  const [subject, setSubject] = useState<string>(DEFAULT_VIP_SUBJECT);
  const [subjects, setSubjects] = useState<string[]>([]);
  useEffect(() => {
    setSubject(getCurrentSubject());
    fetch('/api/my/vip/subjects', { credentials: 'include' }).then((r) => r.json()).then((d) => {
      if (d.ok && Array.isArray(d.subjects)) setSubjects(d.subjects.map((s: { name: string }) => s.name));
    }).catch(() => {});
  }, []);
  const changeSubject = (s: string) => { if (s === subject) return; setCurrentSubject(s); window.location.reload(); };

  // 섹션별 메뉴 = 접근가능(엔타이틀먼트) ∩ 과목 적용(영어전용 메뉴는 영어일 때만). 빈 섹션은 숨김.
  const visibleSections = NAV_SECTIONS
    .map((sec) => ({
      title: sec.title,
      items: sec.items
        .filter((it) => !accessible || accessible.has(it.id))
        .filter((it) => subject === DEFAULT_VIP_SUBJECT || !ENGLISH_ONLY_MENU_IDS.has(it.id)),
    }))
    .filter((sec) => sec.items.length > 0);

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

      {/* 전역 과목 스위처 */}
      {subjects.length > 0 && (collapsed ? (
        <div className="mb-2 w-9 h-9 rounded-lg bg-zinc-800/70 border border-zinc-700/60 flex items-center justify-center text-[12px] font-bold text-[#c9a44e]" title={`과목: ${subject}`}>
          {subject.slice(0, 1)}
        </div>
      ) : (
        <div className="w-full px-3 mb-2">
          <label className="block text-[10px] text-zinc-600 mb-1 px-0.5">과목</label>
          <div className="relative">
            <select value={subject} onChange={(e) => changeSubject(e.target.value)}
              className="w-full appearance-none pl-3 pr-8 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 focus:outline-none focus:border-[#c9a44e]/50 [&>option]:bg-zinc-900 cursor-pointer">
              {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDownIcon size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          </div>
        </div>
      ))}

      {/* 네비게이션 */}
      <nav className={`flex-1 overflow-y-auto w-full flex flex-col ${collapsed ? "items-center gap-1" : "gap-0.5 px-2"}`}>
        {visibleSections.map((sec, si) => (
          <div key={sec.title ?? `__top-${si}`} className="w-full flex flex-col gap-0.5">
            {sec.title && !collapsed && (
              <div className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-zinc-600 select-none">{sec.title}</div>
            )}
            {sec.title && collapsed && si > 0 && (
              <div className="my-2 w-5 h-px bg-zinc-800/80 mx-auto" />
            )}
            {sec.items.map((item) => {
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
                  {item.children!
                    .filter((c) => !c.id || (accessible ? accessible.has(c.id) : true))
                    .filter((c) => !c.id || subject === DEFAULT_VIP_SUBJECT || !ENGLISH_ONLY_MENU_IDS.has(c.id))
                    .map((c) => {
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
          </div>
        ))}

        {/* 메뉴 설정(상점) — 메뉴 추가/구매 */}
        <button
          type="button"
          onClick={() => router.push("/my/vip/menu-store")}
          title={collapsed ? "메뉴 설정" : undefined}
          className={`relative flex items-center rounded-lg transition-colors mt-1 ${
            collapsed ? "justify-center w-10 h-10" : "w-full gap-3 px-3 py-2"
          } ${pathname.startsWith("/my/vip/menu-store") ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"}`}
        >
          <span className="shrink-0"><SettingsIcon size={18} /></span>
          {!collapsed && <span className="text-[13.5px] font-medium flex-1 text-left">메뉴 설정</span>}
        </button>
      </nav>

      {/* 테마 토글 (다크/라이트) */}
      {onToggleTheme && (collapsed ? (
        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === 'light' ? '다크 모드로' : '라이트 모드로'}
          aria-label="테마 전환"
          className="mt-2 w-10 h-10 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60 transition-colors"
        >
          <span className="text-base leading-none">{theme === 'light' ? '🌙' : '☀️'}</span>
        </button>
      ) : (
        <div className="w-full px-3 mt-1">
          <button
            type="button"
            onClick={onToggleTheme}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors"
          >
            <span className="text-base leading-none">{theme === 'light' ? '🌙' : '☀️'}</span>
            <span className="font-medium">{theme === 'light' ? '다크 모드' : '라이트 모드'}</span>
          </button>
        </div>
      ))}

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

export function VipSidebar({ userName, theme, onToggleTheme }: { userName: string; theme?: 'dark' | 'light'; onToggleTheme?: () => void }) {
  return <UnifiedSidebar userName={userName} theme={theme} onToggleTheme={onToggleTheme} />;
}

export default VipSidebar;
