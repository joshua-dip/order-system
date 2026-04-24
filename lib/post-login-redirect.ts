/**
 * 로그인 성공 후 이동 경로. 오픈 리다이렉트·로그인 페이지 루프 방지.
 */
export function getSafeUserLoginRedirect(fromParam: string | null, mustChangePassword: boolean, role?: string): string {
  if (role === 'student') {
    const raw = (fromParam ?? '').trim();
    if (raw && raw.startsWith('/my/student')) return raw;
    return '/my/student';
  }
  if (mustChangePassword) return '/my';
  const raw = (fromParam ?? '').trim();
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  let pathname: string;
  try {
    pathname = new URL(raw, 'https://example.invalid').pathname;
  } catch {
    return '/';
  }
  if (pathname === '/login' || pathname.startsWith('/login/')) return '/';
  if (pathname === '/admin/login' || pathname.startsWith('/admin/login/')) return '/';
  return raw;
}

export function getSafeAdminLoginRedirect(fromParam: string | null): string {
  const raw = (fromParam ?? '').trim() || '/admin';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/admin';
  let pathname: string;
  try {
    pathname = new URL(raw, 'https://example.invalid').pathname;
  } catch {
    return '/admin';
  }
  if (pathname === '/admin/login' || pathname.startsWith('/admin/login/')) return '/admin';
  if (pathname === '/login' || pathname.startsWith('/login/')) return '/admin';
  return raw;
}
