import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const COOKIE_NAME = 'admin_session';
const JWT_SECRET = () => {
  const secret = process.env.AUTH_SECRET || process.env.JWT_SECRET || 'next-order-admin-secret';
  return new TextEncoder().encode(secret);
};

async function getRole(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET());
    return (payload as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /admin 보호
  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/login') return NextResponse.next();
    const role = await getRole(request);
    if (role !== 'admin') {
      const url = new URL('/admin/login', request.url);
      url.searchParams.set('from', pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // /my/student 보호 — student 전용
  if (pathname.startsWith('/my/student')) {
    const role = await getRole(request);
    if (!role) {
      const url = new URL('/student-login', request.url);
      url.searchParams.set('from', pathname);
      return NextResponse.redirect(url);
    }
    if (role === 'admin') return NextResponse.redirect(new URL('/admin', request.url));
    if (role === 'user') return NextResponse.redirect(new URL('/my', request.url));
    if (role !== 'student') return NextResponse.redirect(new URL('/student-login', request.url));
    return NextResponse.next();
  }

  // /my 및 /my/premium — student 접근 시 /my/student 로 리다이렉트
  if (pathname.startsWith('/my') && !pathname.startsWith('/my/student')) {
    const role = await getRole(request);
    if (role === 'student') {
      return NextResponse.redirect(new URL('/my/student', request.url));
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin', '/admin/:path*', '/my', '/my/:path*'],
};
