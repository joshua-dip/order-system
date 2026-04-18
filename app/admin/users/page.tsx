'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminSidebar from '../_components/AdminSidebar';

interface ListUser {
  id: string;
  loginId: string;
  name: string;
  email: string;
  phone: string;
  points: number;
  annualMemberSince: string | null;
  monthlyMemberSince: string | null;
  monthlyMemberUntil: string | null;
  signupPremiumTrialUntil: string | null;
  isVip: boolean;
  createdAt: string;
}

function membershipLabel(u: ListUser): { text: string; cls: string } | null {
  const now = new Date();
  if (u.isVip) return { text: 'VIP', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
  if (u.annualMemberSince) return { text: '연회원', cls: 'bg-violet-500/20 text-violet-300 border-violet-500/40' };
  if (u.monthlyMemberUntil) {
    const until = new Date(u.monthlyMemberUntil);
    if (until > now) return { text: '월구독', cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' };
    return { text: '구독만료', cls: 'bg-slate-600/40 text-slate-400 border-slate-600' };
  }
  if (u.signupPremiumTrialUntil && new Date(u.signupPremiumTrialUntil) > now) {
    return { text: '체험중', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' };
  }
  return null;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [adminLoginId, setAdminLoginId] = useState('');
  const [users, setUsers] = useState<ListUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d?.role !== 'admin') { router.replace('/admin/login'); return; }
        setAdminLoginId(d.loginId ?? '');
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  useEffect(() => {
    fetch('/api/admin/users')
      .then((r) => r.json())
      .then((d) => {
        if (d?.users) setUsers(d.users);
        else setError('회원 목록을 불러오는 데 실패했습니다.');
      })
      .catch(() => setError('네트워크 오류'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.loginId.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.phone.includes(q)
    );
  }, [users, search]);

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      <AdminSidebar loginId={adminLoginId} />
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto">
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">회원상세관리</h2>
              <p className="text-slate-400 text-sm mt-0.5">
                회원을 선택하면 상세 페이지로 이동합니다.
              </p>
            </div>
            <span className="text-slate-500 text-sm">전체 {users.length}명</span>
          </div>

          {/* 검색 */}
          <div className="relative mb-4">
            <input
              type="text"
              placeholder="이름, 아이디, 이메일, 전화번호 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-lg leading-none"
              >
                ×
              </button>
            )}
          </div>

          {/* 로딩/에러 */}
          {loading && (
            <div className="text-center py-16 text-slate-500">불러오는 중...</div>
          )}
          {error && !loading && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-xl px-4 py-3 text-red-300">
              {error}
            </div>
          )}

          {/* 테이블 */}
          {!loading && !error && (
            <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase tracking-wider">
                    <th className="text-left px-5 py-3 font-medium">이름 / 아이디</th>
                    <th className="text-left px-5 py-3 font-medium">이메일</th>
                    <th className="text-left px-5 py-3 font-medium hidden md:table-cell">전화</th>
                    <th className="text-left px-5 py-3 font-medium hidden lg:table-cell">멤버십</th>
                    <th className="text-right px-5 py-3 font-medium hidden lg:table-cell">포인트</th>
                    <th className="text-left px-5 py-3 font-medium hidden xl:table-cell">가입일</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-10 text-slate-500">
                        {search ? '검색 결과가 없습니다.' : '회원이 없습니다.'}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((u) => {
                      const badge = membershipLabel(u);
                      return (
                        <tr
                          key={u.id}
                          onClick={() => router.push(`/admin/users/${u.id}`)}
                          className="border-b border-slate-700/50 last:border-0 hover:bg-slate-700/40 cursor-pointer transition-colors"
                        >
                          <td className="px-5 py-3.5">
                            <p className="font-semibold text-white">{u.name}</p>
                            <p className="text-slate-400 text-xs font-mono">{u.loginId}</p>
                          </td>
                          <td className="px-5 py-3.5 text-slate-300 truncate max-w-[180px]">
                            {u.email || <span className="text-slate-600">—</span>}
                          </td>
                          <td className="px-5 py-3.5 text-slate-300 hidden md:table-cell">
                            {u.phone || <span className="text-slate-600">—</span>}
                          </td>
                          <td className="px-5 py-3.5 hidden lg:table-cell">
                            {badge ? (
                              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${badge.cls}`}>
                                {badge.text}
                              </span>
                            ) : (
                              <span className="text-slate-600 text-xs">일반</span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right text-slate-300 hidden lg:table-cell">
                            {u.points.toLocaleString()}P
                          </td>
                          <td className="px-5 py-3.5 text-slate-400 text-xs hidden xl:table-cell">
                            {u.createdAt
                              ? new Date(u.createdAt).toLocaleDateString('ko-KR')
                              : '—'}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {!loading && !error && search && (
            <p className="text-slate-500 text-xs mt-3 text-right">
              {filtered.length}/{users.length}명 표시
            </p>
          )}

          <div className="mt-6">
            <Link href="/admin" className="text-slate-500 hover:text-white text-sm transition-colors">
              ← 관리자 대시보드로
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
