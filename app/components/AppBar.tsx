'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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

const AppBar = ({ title = "커스터마이징 서비스", showBackButton = false, onBackClick, onHomeClick }: AppBarProps) => {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);

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
  return (
    <header className="shadow-md sticky top-0 z-50" style={{ backgroundColor: '#13294B', borderBottom: '1px solid #888B8D' }}>
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* 왼쪽 공간 (뒤로가기 버튼용) */}
          <div className="flex items-center">
            {showBackButton && onBackClick && (
              <button
                onClick={onBackClick}
                className="p-2 rounded-lg hover:bg-white hover:bg-opacity-20 transition-colors text-white"
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
          <div className="absolute left-1/2 transform -translate-x-1/2">
            <button
              onClick={handleHomeClick}
              className="text-xl font-bold text-white hover:opacity-80 transition-all cursor-pointer"
            >
              {title}
            </button>
          </div>

          {/* 우측 메뉴 */}
          <div className="flex items-center space-x-4">
            {user ? (
              <>
                {user.role === 'admin' ? (
                  <Link
                    href="/admin"
                    className="hidden md:flex items-center space-x-2 px-3 py-2 rounded-lg hover:opacity-90 transition-all text-sm font-medium border border-white border-opacity-30"
                    style={{ backgroundColor: 'transparent', color: 'white' }}
                  >
                    <span>{user.name || user.loginId}</span>
                    <span className="opacity-80">관리자</span>
                  </Link>
                ) : (
                  <Link
                    href="/my"
                    className="hidden md:flex items-center space-x-2 px-3 py-2 rounded-lg hover:opacity-90 transition-all text-sm font-medium border border-white border-opacity-30"
                    style={{ backgroundColor: 'transparent', color: 'white' }}
                  >
                    <span>{user.name || user.loginId}</span>
                    <span className="opacity-80">내정보</span>
                  </Link>
                )}
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
              <Link
                href="/login"
                className="hidden md:flex items-center space-x-2 px-3 py-2 rounded-lg hover:opacity-90 transition-all text-sm font-medium border border-white border-opacity-30"
                style={{ backgroundColor: 'transparent', color: 'white' }}
              >
                <span>로그인</span>
              </Link>
            )}
            <a
              href="https://open.kakao.com/o/sHuV7wSh"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:flex items-center space-x-2 px-3 py-2 rounded-lg hover:opacity-90 transition-all text-sm font-medium border border-white border-opacity-30"
              style={{ backgroundColor: 'transparent', color: 'white' }}
            >
              <svg 
                width="20" 
                height="20" 
                viewBox="0 0 24 24" 
                fill="none" 
                xmlns="http://www.w3.org/2000/svg"
                className="w-5 h-5"
              >
                <path 
                  d="M12 3C6.48 3 2 6.58 2 11c0 2.4 1.17 4.55 3 6.06V21l3.94-2.06c.97.27 2 .42 3.06.42 5.52 0 10-3.58 10-8s-4.48-8-10-8z" 
                  fill="currentColor"
                />
              </svg>
              <span>문의하기</span>
            </a>
            <div className="md:hidden flex items-center space-x-2">
              {user ? (
                <>
                  <Link
                    href={user.role === 'admin' ? '/admin' : '/my'}
                    className="flex items-center px-3 py-2 rounded-lg hover:opacity-90 transition-all text-sm font-medium border border-white border-opacity-30"
                    style={{ backgroundColor: 'transparent', color: 'white' }}
                  >
                    {user.role === 'admin' ? '관리자' : (user.name || user.loginId)}
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
                <Link
                  href="/login"
                  className="flex items-center px-3 py-2 rounded-lg hover:opacity-90 transition-all text-sm font-medium border border-white border-opacity-30"
                  style={{ backgroundColor: 'transparent', color: 'white' }}
                >
                  로그인
                </Link>
              )}
              <a
                href="https://open.kakao.com/o/sHuV7wSh"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1 px-3 py-2 rounded-lg hover:opacity-90 transition-all text-sm font-medium border border-white border-opacity-30"
                style={{ backgroundColor: 'transparent', color: 'white' }}
                title="카톡 문의"
              >
                <svg 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-4 h-4"
                >
                  <path 
                    d="M12 3C6.48 3 2 6.58 2 11c0 2.4 1.17 4.55 3 6.06V21l3.94-2.06c.97.27 2 .42 3.06.42 5.52 0 10-3.58 10-8s-4.48-8-10-8z" 
                    fill="currentColor"
                  />
                </svg>
                <span>문의</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default AppBar;
