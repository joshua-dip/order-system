'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  APP_BAR_ACCENT_LINE,
  APP_BAR_GRADIENT_END,
  APP_BAR_GRADIENT_START,
  DEFAULT_APP_BAR_TITLE,
} from '@/lib/site-branding';
import MembershipApplyModal from './MembershipApplyModal';

interface AppBarProps {
  title?: string;
  showBackButton?: boolean;
  onBackClick?: () => void;
  onHomeClick?: () => void;
}

interface AuthUser {
  loginId: string;
  role: string;
  name: string;
}

const AppBar = ({ title = DEFAULT_APP_BAR_TITLE, showBackButton = false, onBackClick, onHomeClick }: AppBarProps) => {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  };

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => data.user && setUser(data.user))
      .catch(() => {});
  }, []);

  const handleHomeClick = () => {
    if (onHomeClick) {
      onHomeClick();
    } else {
      // 페이지 새로고침으로 초기화면으로 이동
      window.location.href = '/';
    }
  };

  // 사용자 영역 표시 정책 — 데스크톱·모바일 동일하게:
  //  · 이름(name) 또는 로그인아이디(loginId) 한 번
  //  · 역할(관리자/내정보) 작은 배지 한 번
  //  · 단, 표시 이름이 역할 텍스트와 동일하면 배지 생략 → "관리자 관리자" 중복 방지
  const displayName = (user?.name || user?.loginId || '').trim();
  const roleLabel = user?.role === 'admin' ? '관리자' : user?.role === 'student' ? '학생' : '내정보';
  const showRoleBadge = !!displayName && displayName !== roleLabel;
  const myHref = user?.role === 'admin' ? '/admin' : user?.role === 'student' ? '/my/student' : '/my';

  return (
    <header
      className="shadow-md sticky top-0 z-50"
      style={{
        background: `linear-gradient(90deg, ${APP_BAR_GRADIENT_START} 0%, ${APP_BAR_GRADIENT_END} 100%)`,
        borderBottom: `2px solid ${APP_BAR_ACCENT_LINE}`,
      }}
    >
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* 왼쪽 공간 (뒤로가기 버튼용) */}
          <div className="flex items-center">
            {showBackButton && onBackClick && (
              <button
                onClick={onBackClick}
                className="p-2 rounded-lg hover:bg-black/15 transition-colors text-white drop-shadow-sm"
                title="이전 페이지"
              >
                <svg 
                  width="24" 
                  height="24" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-6 h-6"
                >
                  <path 
                    d="M15 18L9 12L15 6" 
                    stroke="currentColor" 
                    strokeWidth="2" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>

          {/* 중앙 제목 */}
          <div className="absolute left-1/2 -translate-x-1/2 max-w-[min(92vw,20rem)] sm:max-w-none text-center px-2">
            <button
              type="button"
              onClick={handleHomeClick}
              className="text-base sm:text-xl font-bold text-white hover:opacity-90 transition-all cursor-pointer leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
            >
              {title}
            </button>
          </div>

          {/* 우측 메뉴 */}
          <div className="flex items-center space-x-2">
            {user ? (
              <>
                <Link
                  href={myHref}
                  className="hidden md:inline-flex items-center gap-2 px-3 py-2 rounded-lg hover:opacity-90 transition-all text-sm font-medium border border-white border-opacity-30"
                  style={{ backgroundColor: 'transparent', color: 'white' }}
                >
                  <span className="font-semibold">{displayName}</span>
                  {showRoleBadge && (
                    <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide opacity-90">
                      {roleLabel}
                    </span>
                  )}
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="hidden md:flex items-center px-3 py-2 rounded-lg hover:opacity-90 hover:bg-white hover:bg-opacity-10 transition-all text-sm font-medium border border-white border-opacity-30"
                  style={{ color: 'white' }}
                >
                  로그아웃
                </button>
              </>
            ) : (
              <>
                {/* 가입신청 버튼 — 비로그인에만 노출, 데스크톱 */}
                <button
                  type="button"
                  onClick={() => setApplyOpen(true)}
                  className="hidden md:flex items-center px-3 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                  style={{ backgroundColor: '#FEE500', color: '#1a1a1a' }}
                >
                  가입신청
                </button>
                <Link
                  href="/login"
                  className="hidden md:flex items-center space-x-2 px-3 py-2 rounded-lg hover:opacity-90 transition-all text-sm font-medium border border-white border-opacity-30"
                  style={{ backgroundColor: 'transparent', color: 'white' }}
                >
                  <span>로그인</span>
                </Link>
              </>
            )}
            <div className="md:hidden flex items-center space-x-2">
              {user ? (
                <>
                  <Link
                    href={myHref}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg hover:opacity-90 transition-all text-sm font-medium border border-white border-opacity-30"
                    style={{ backgroundColor: 'transparent', color: 'white' }}
                  >
                    <span className="font-semibold truncate max-w-[6rem]">{displayName}</span>
                    {showRoleBadge && (
                      <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide opacity-90">
                        {roleLabel}
                      </span>
                    )}
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex items-center px-3 py-2 rounded-lg hover:opacity-90 hover:bg-white hover:bg-opacity-10 transition-all text-sm font-medium border border-white border-opacity-30"
                    style={{ color: 'white' }}
                  >
                    로그아웃
                  </button>
                </>
              ) : (
                <>
                  {/* 가입신청 버튼 — 모바일 */}
                  <button
                    type="button"
                    onClick={() => setApplyOpen(true)}
                    className="flex items-center px-3 py-2 rounded-lg text-sm font-bold transition-all hover:opacity-90"
                    style={{ backgroundColor: '#FEE500', color: '#1a1a1a' }}
                  >
                    가입신청
                  </button>
                  <Link
                    href="/login"
                    className="flex items-center px-3 py-2 rounded-lg hover:opacity-90 transition-all text-sm font-medium border border-white border-opacity-30"
                    style={{ backgroundColor: 'transparent', color: 'white' }}
                  >
                    로그인
                  </Link>
                </>
              )}
            </div>
          </div>
          <MembershipApplyModal open={applyOpen} onClose={() => setApplyOpen(false)} />
        </div>
      </div>
    </header>
  );
};

export default AppBar;
