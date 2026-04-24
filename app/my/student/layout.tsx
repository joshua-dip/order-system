import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyToken, COOKIE_NAME } from '@/lib/auth';
import StudentBottomNav from './_components/StudentBottomNav';

export default async function StudentLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) {
    redirect('/student-login');
  }

  const payload = await verifyToken(token);
  if (!payload) {
    redirect('/student-login');
  }

  if (payload.role === 'admin') redirect('/admin');
  if (payload.role === 'user') redirect('/my');
  if (payload.role !== 'student') redirect('/student-login');

  return (
    <div className="min-h-screen bg-slate-50">
      {children}
      <StudentBottomNav />
      {/* 모바일 하단 탭바 공간 보정 */}
      <div className="h-16 md:hidden" />
    </div>
  );
}
