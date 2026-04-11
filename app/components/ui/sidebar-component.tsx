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
  AddLarge,
  View,
  Report,
  ChartBar,
  Flag,
  Time,
  CheckmarkOutline,
  InProgress,
  StarFilled,
  Group,
  ArrowLeft,
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

/* --------------------------- Types / Content Map -------------------------- */

interface MenuItemT {
  icon?: React.ReactNode;
  label: string;
  hasDropdown?: boolean;
  isActive?: boolean;
  children?: MenuItemT[];
  href?: string;
}
interface MenuSectionT {
  title: string;
  items: MenuItemT[];
}
interface SidebarContent {
  title: string;
  sections: MenuSectionT[];
}

const iconClass = "text-zinc-400";
const iconClassSm = "text-zinc-500";

function getSidebarContent(activeSection: string): SidebarContent {
  const contentMap: Record<string, SidebarContent> = {
    dashboard: {
      title: "대시보드",
      sections: [
        {
          title: "개요",
          items: [
            { icon: <View size={16} className={iconClass} />, label: "전체 현황", isActive: true, href: "/my/vip" },
          ],
        },
        {
          title: "빠른 시작",
          items: [
            { icon: <AddLarge size={16} className={iconClass} />, label: "학생 등록", href: "/my/vip/students" },
            { icon: <Task size={16} className={iconClass} />, label: "기출 입력", href: "/my/vip/exams" },
            { icon: <DocumentAdd size={16} className={iconClass} />, label: "변형문제 생성", href: "/my/vip/generate" },
          ],
        },
        {
          title: "최근 활동",
          items: [
            {
              icon: <Time size={16} className={iconClass} />,
              label: "최근 시험",
              hasDropdown: true,
              children: [
                { label: "시험 관리", href: "/my/vip/exams" },
                { label: "성적 입력", href: "/my/vip/scores" },
              ],
            },
            {
              icon: <Report size={16} className={iconClass} />,
              label: "최근 분석",
              hasDropdown: true,
              children: [
                { label: "시험 분석", href: "/my/vip/analysis" },
              ],
            },
          ],
        },
      ],
    },

    students: {
      title: "학생 관리",
      sections: [
        {
          title: "학생",
          items: [
            { icon: <UserMultiple size={16} className={iconClass} />, label: "전체 학생 목록", isActive: true, href: "/my/vip/students" },
            { icon: <AddLarge size={16} className={iconClass} />, label: "학생 추가", href: "/my/vip/students" },
          ],
        },
        {
          title: "학교",
          items: [
            {
              icon: <Group size={16} className={iconClass} />,
              label: "학교별 학생",
              hasDropdown: true,
              children: [
                { label: "학교 추가/검색", href: "/my/vip/students" },
                { label: "학교별 필터링", href: "/my/vip/students" },
              ],
            },
          ],
        },
        {
          title: "시험 범위",
          items: [
            { icon: <Task size={16} className={iconClass} />, label: "시험 범위 설정", href: "/my/vip/exams" },
          ],
        },
      ],
    },

    exams: {
      title: "시험 관리",
      sections: [
        {
          title: "시험 유형",
          items: [
            { icon: <Task size={16} className={iconClass} />, label: "시험 목록", isActive: true, href: "/my/vip/exams" },
            {
              icon: <Flag size={16} className={iconClass} />,
              label: "시험 유형별",
              hasDropdown: true,
              children: [
                { label: "1학기 중간고사" },
                { label: "1학기 기말고사" },
                { label: "2학기 중간고사" },
                { label: "2학기 기말고사" },
              ],
            },
          ],
        },
        {
          title: "시험 범위",
          items: [
            { icon: <DocumentAdd size={16} className={iconClass} />, label: "교재별 범위 설정", href: "/my/vip/exams" },
          ],
        },
      ],
    },

    scores: {
      title: "성적 관리",
      sections: [
        {
          title: "성적 입력",
          items: [
            { icon: <ChartBar size={16} className={iconClass} />, label: "시험별 성적 입력", isActive: true, href: "/my/vip/scores" },
          ],
        },
        {
          title: "통계",
          items: [
            {
              icon: <Analytics size={16} className={iconClass} />,
              label: "성적 통계",
              hasDropdown: true,
              children: [
                { label: "평균/최고/최저점", href: "/my/vip/analysis" },
                { label: "문항별 정답률", href: "/my/vip/analysis" },
              ],
            },
            { icon: <StarFilled size={16} className={iconClass} />, label: "학생 순위", href: "/my/vip/analysis" },
          ],
        },
      ],
    },

    generate: {
      title: "문제 생성",
      sections: [
        {
          title: "유형별 생성",
          items: [
            { icon: <DocumentAdd size={16} className={iconClass} />, label: "변형문제 생성", isActive: true, href: "/my/vip/generate" },
            {
              icon: <Flag size={16} className={iconClass} />,
              label: "유형 선택",
              hasDropdown: true,
              children: [
                { label: "빈칸 추론" },
                { label: "순서 배열" },
                { label: "문장 삽입" },
              ],
            },
          ],
        },
        {
          title: "난이도",
          items: [
            {
              icon: <ChartBar size={16} className={iconClass} />,
              label: "난이도별",
              hasDropdown: true,
              children: [
                { label: "상" },
                { label: "중" },
                { label: "하" },
              ],
            },
          ],
        },
        {
          title: "다운로드",
          items: [
            {
              icon: <InProgress size={16} className={iconClass} />,
              label: "최근 생성 이력",
              hasDropdown: true,
              children: [
                { label: "PDF 다운로드" },
                { label: "DOCX 다운로드" },
              ],
            },
          ],
        },
      ],
    },

    analysis: {
      title: "시험 분석",
      sections: [
        {
          title: "분석 리포트",
          items: [
            { icon: <Analytics size={16} className={iconClass} />, label: "시험 분석", isActive: true, href: "/my/vip/analysis" },
          ],
        },
        {
          title: "세부 분석",
          items: [
            {
              icon: <ChartBar size={16} className={iconClass} />,
              label: "유형별 출제 비율",
              hasDropdown: true,
              children: [
                { label: "객관식/서술형 분포" },
                { label: "교재별 출제 비율" },
              ],
            },
            {
              icon: <CheckmarkOutline size={16} className={iconClass} />,
              label: "정답률 분석",
              hasDropdown: true,
              children: [
                { label: "문항별 정답률" },
                { label: "학생별 정답률" },
              ],
            },
          ],
        },
        {
          title: "리포트",
          items: [
            { icon: <Report size={16} className={iconClass} />, label: "종합 리포트", href: "/my/vip/analysis" },
          ],
        },
      ],
    },
  };

  return contentMap[activeSection] || contentMap.dashboard;
}

/* ---------------------------- Left Icon Nav Rail -------------------------- */

interface NavItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  href: string;
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", icon: <Dashboard size={18} />, label: "대시보드", href: "/my/vip", exact: true },
  { id: "students", icon: <UserMultiple size={18} />, label: "학생 관리", href: "/my/vip/students" },
  { id: "exams", icon: <Task size={18} />, label: "시험 관리", href: "/my/vip/exams" },
  { id: "scores", icon: <ChartBar size={18} />, label: "성적 관리", href: "/my/vip/scores" },
  { id: "generate", icon: <DocumentAdd size={18} />, label: "문제 생성", href: "/my/vip/generate" },
  { id: "analysis", icon: <Analytics size={18} />, label: "시험 분석", href: "/my/vip/analysis" },
];

function IconNavButton({
  children,
  isActive = false,
  onClick,
  title,
}: {
  children: React.ReactNode;
  isActive?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`relative flex items-center justify-center rounded-xl w-10 h-10 transition-all duration-200
        ${isActive
          ? "bg-zinc-800 text-zinc-100 shadow-sm"
          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60"
        }`}
      onClick={onClick}
    >
      {isActive && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[1px] w-[3px] h-4 bg-zinc-100 rounded-r-full" />
      )}
      {children}
    </button>
  );
}

function IconNavigation({
  activeSection,
  onSectionChange,
}: {
  activeSection: string;
  onSectionChange: (section: string) => void;
}) {
  const router = useRouter();

  return (
    <aside className="bg-[#0c0c0f] flex flex-col items-center py-4 px-2 w-[60px] h-screen border-r border-zinc-800/80">
      {/* Logo */}
      <div className="mb-4 flex items-center justify-center">
        <div className="w-8 h-8 rounded-[10px] bg-gradient-to-br from-[#c9a44e] via-[#e8d48b] to-[#c9a44e] flex items-center justify-center shadow-[0_0_16px_rgba(201,164,78,0.15)]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 2L10.5 6.5L15 7.5L11.5 11L12.5 15.5L8 13L3.5 15.5L4.5 11L1 7.5L5.5 6.5L8 2Z" fill="#1a1500" fillOpacity="0.9" />
          </svg>
        </div>
      </div>

      <div className="w-8 h-px bg-zinc-800 mb-3" />

      {/* Navigation Icons */}
      <div className="flex flex-col gap-1.5 w-full items-center">
        {NAV_ITEMS.map((item) => (
          <IconNavButton
            key={item.id}
            isActive={activeSection === item.id}
            title={item.label}
            onClick={() => {
              onSectionChange(item.id);
              router.push(item.href);
            }}
          >
            {item.icon}
          </IconNavButton>
        ))}
      </div>

      <div className="flex-1" />

      {/* Bottom actions */}
      <div className="flex flex-col gap-1.5 w-full items-center">
        <button
          type="button"
          title="마이페이지"
          onClick={() => router.push("/my")}
          className="flex items-center justify-center rounded-xl w-10 h-10 text-zinc-600 hover:text-zinc-400 hover:bg-zinc-800/60 transition-all duration-200"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="mt-1">
          <AvatarCircle size={30} />
        </div>
      </div>
    </aside>
  );
}

/* ------------------------------ Detail Panel ----------------------------- */

function SectionTitle({
  title,
  onToggleCollapse,
  isCollapsed,
}: {
  title: string;
  onToggleCollapse: () => void;
  isCollapsed: boolean;
}) {
  if (isCollapsed) {
    return (
      <div className="w-full flex justify-center">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex items-center justify-center rounded-lg w-9 h-9 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label="사이드바 펼치기"
        >
          <ChevronDownIcon size={16} className="rotate-[-90deg]" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-full px-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-zinc-100 tracking-[-0.01em]">
          {title}
        </h2>
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex items-center justify-center rounded-lg w-7 h-7 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label="사이드바 접기"
        >
          <ChevronDownIcon size={14} className="-rotate-90" />
        </button>
      </div>
    </div>
  );
}

function DetailSidebar({ activeSection, userName }: { activeSection: string; userName: string }) {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [isCollapsed, setIsCollapsed] = useState(false);
  const content = getSidebarContent(activeSection);
  const router = useRouter();

  const toggleExpanded = (itemKey: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemKey)) next.delete(itemKey);
      else next.add(itemKey);
      return next;
    });
  };

  const toggleCollapse = () => setIsCollapsed((s) => !s);

  const handleItemClick = (href?: string) => {
    if (href) router.push(href);
  };

  return (
    <aside
      className={`bg-[#111113] flex flex-col gap-3 items-start py-4 transition-all duration-300 ease-out h-screen border-r border-zinc-800/80 overflow-hidden ${
        isCollapsed ? "w-[52px] px-1.5" : "w-[260px] px-0"
      }`}
    >
      {!isCollapsed && <VipLogoBadge userName={userName} />}

      {!isCollapsed && <div className="w-full px-4"><div className="h-px bg-zinc-800/80" /></div>}

      <SectionTitle title={content.title} onToggleCollapse={toggleCollapse} isCollapsed={isCollapsed} />

      <SearchContainer isCollapsed={isCollapsed} />

      <div
        className={`flex flex-col w-full overflow-y-auto flex-1 ${
          isCollapsed ? "gap-1 items-center" : "gap-1"
        }`}
      >
        {content.sections.map((section, index) => (
          <MenuSection
            key={`${activeSection}-${index}`}
            section={section}
            expandedItems={expandedItems}
            onToggleExpanded={toggleExpanded}
            isCollapsed={isCollapsed}
            onItemClick={handleItemClick}
          />
        ))}
      </div>

      {!isCollapsed && (
        <div className="w-full mt-auto px-3">
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

/* ------------------------------ Menu Elements ---------------------------- */

function MenuItem({
  item,
  isExpanded,
  onToggle,
  onItemClick,
  isCollapsed,
}: {
  item: MenuItemT;
  isExpanded?: boolean;
  onToggle?: () => void;
  onItemClick?: (href?: string) => void;
  isCollapsed?: boolean;
}) {
  const handleClick = () => {
    if (item.hasDropdown && onToggle) onToggle();
    else onItemClick?.(item.href);
  };

  if (isCollapsed) {
    return (
      <div className="w-full flex justify-center">
        <div
          className={`rounded-lg cursor-pointer flex items-center justify-center w-9 h-9 transition-colors ${
            item.isActive ? "bg-zinc-800 text-zinc-200" : "hover:bg-zinc-800/60 text-zinc-500"
          }`}
          onClick={handleClick}
          title={item.label}
        >
          {item.icon}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-3">
      <div
        className={`rounded-lg cursor-pointer flex items-center h-8 px-2 transition-all duration-150 ${
          item.isActive
            ? "bg-zinc-800 text-zinc-100"
            : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
        }`}
        onClick={handleClick}
      >
        <div className="flex items-center justify-center shrink-0 w-5">{item.icon}</div>
        <div className="flex-1 ml-2.5 min-w-0">
          <span className="text-[13px] leading-tight truncate block">
            {item.label}
          </span>
        </div>
        {item.hasDropdown && (
          <ChevronDownIcon
            size={14}
            className={`text-zinc-600 transition-transform duration-200 shrink-0 ml-1 ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        )}
      </div>
    </div>
  );
}

function SubMenuItem({ item, onItemClick }: { item: MenuItemT; onItemClick?: (href?: string) => void }) {
  return (
    <div className="w-full px-3">
      <div
        className="h-7 w-full rounded-md cursor-pointer transition-colors text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/30 flex items-center pl-[30px] pr-2"
        onClick={() => onItemClick?.(item.href)}
      >
        <span className="text-[12px] truncate">{item.label}</span>
      </div>
    </div>
  );
}

function MenuSection({
  section,
  expandedItems,
  onToggleExpanded,
  isCollapsed,
  onItemClick,
}: {
  section: MenuSectionT;
  expandedItems: Set<string>;
  onToggleExpanded: (itemKey: string) => void;
  isCollapsed?: boolean;
  onItemClick?: (href?: string) => void;
}) {
  return (
    <div className="flex flex-col w-full">
      {!isCollapsed && (
        <div className="px-5 pt-4 pb-1">
          <span className="text-[11px] font-medium text-zinc-600 uppercase tracking-wider">
            {section.title}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {section.items.map((item, index) => {
          const itemKey = `${section.title}-${index}`;
          const isExpanded = expandedItems.has(itemKey);
          return (
            <div key={itemKey} className="w-full flex flex-col">
              <MenuItem
                item={item}
                isExpanded={isExpanded}
                onToggle={() => onToggleExpanded(itemKey)}
                onItemClick={onItemClick}
                isCollapsed={isCollapsed}
              />
              {isExpanded && item.children && !isCollapsed && (
                <div className="flex flex-col gap-0.5 mt-0.5 mb-1">
                  {item.children.map((child, childIndex) => (
                    <SubMenuItem
                      key={`${itemKey}-${childIndex}`}
                      item={child}
                      onItemClick={onItemClick}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------------- Layout -------------------------------- */

function getActiveSectionFromPath(pathname: string): string {
  if (pathname === "/my/vip") return "dashboard";
  if (pathname.startsWith("/my/vip/students")) return "students";
  if (pathname.startsWith("/my/vip/exams")) return "exams";
  if (pathname.startsWith("/my/vip/scores")) return "scores";
  if (pathname.startsWith("/my/vip/generate")) return "generate";
  if (pathname.startsWith("/my/vip/analysis")) return "analysis";
  return "dashboard";
}

export function VipSidebar({ userName }: { userName: string }) {
  const pathname = usePathname();
  const [activeSection, setActiveSection] = useState(() => getActiveSectionFromPath(pathname));

  React.useEffect(() => {
    setActiveSection(getActiveSectionFromPath(pathname));
  }, [pathname]);

  return (
    <div className="flex flex-row h-screen">
      <IconNavigation activeSection={activeSection} onSectionChange={setActiveSection} />
      <DetailSidebar activeSection={activeSection} userName={userName} />
    </div>
  );
}

export default VipSidebar;
