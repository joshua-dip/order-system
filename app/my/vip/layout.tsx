'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { VipSidebar } from '@/app/components/ui/sidebar-component';

interface VipUser {
  loginId: string;
  name: string;
  isVip: boolean;
}

export default function VipLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<VipUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d.user) { router.replace('/login?from=/my/vip'); return; }
        if (!d.user.isVip) { router.replace('/my'); return; }
        setUser(d.user);
      })
      .catch(() => router.replace('/login?from=/my/vip'))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[#09090b] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      {/* Mobile header */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0c0c0f] border-b border-zinc-800/80">
        <button
          onClick={() => router.push('/my')}
          className="text-[13px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          ← 마이페이지
        </button>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 rounded bg-gradient-to-br from-[#c9a44e] to-[#e8d48b] flex items-center justify-center">
            <svg width="8" height="8" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L10.5 6.5L15 7.5L11.5 11L12.5 15.5L8 13L3.5 15.5L4.5 11L1 7.5L5.5 6.5L8 2Z" fill="#1a1500" fillOpacity="0.9" />
            </svg>
          </div>
          <span className="text-[13px] font-medium text-[#c9a44e]">VIP</span>
        </div>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors">
          <svg className="w-5 h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d={sidebarOpen ? 'M6 18L18 6M6 6l12 12' : 'M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5'} />
          </svg>
        </button>
      </div>

      <div className="flex">
        {/* Desktop: 2-level sidebar */}
        <div className="hidden lg:flex sticky top-0 h-screen z-40">
          <VipSidebar userName={user.name || user.loginId} />
        </div>

        {/* Mobile: overlay sidebar */}
        {sidebarOpen && (
          <>
            <div
              className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="fixed top-0 left-0 z-40 h-screen lg:hidden shadow-2xl shadow-black/50">
              <VipSidebar userName={user.name || user.loginId} />
            </div>
          </>
        )}

        {/* Main content */}
        <main className="flex-1 min-h-screen">
          <div className="max-w-6xl mx-auto px-6 py-8 lg:px-10 lg:py-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
