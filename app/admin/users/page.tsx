'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AdminSidebar from '../_components/AdminSidebar';
import { isAnnualMemberActive } from '@/lib/annual-member';

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
  /** 멤버십 회원의 이번 달 기본난도 무료 한도. 일반 회원은 null. */
  baseFreeQuota: { limit: number; used: number; remaining: number; trial: boolean } | null;
}

/**
 * 회원 등급.
 *
 * `nameCls` / `dot` 은 이름 칸에 바로 입히는 표시다 — 등급 배지 열은 좁은 화면에서
 * 숨겨지는데(hidden lg:table-cell), 이름은 항상 보이므로 유료 회원을 한눈에 가른다.
 * 유효한 월·연회원에만 점을 깜박여, 만료·일반 회원과 섞이지 않게 한다.
 */
/**
 * 무료 문항 잔량 색 — 다 쓴 회원(빨강)과 얼마 안 남은 회원(주황)만 눈에 띄게 한다.
 * 넉넉하면 굳이 강조하지 않는다(회원 목록은 이미 색이 많다).
 */
function quotaCls(q: { limit: number; remaining: number }): string {
  if (q.remaining <= 0) return 'text-red-400 font-semibold';
  if (q.remaining <= q.limit * 0.2) return 'text-amber-300 font-semibold';
  return 'text-slate-200';
}

function membershipLabel(
  u: ListUser
): { text: string; cls: string; nameCls: string; dot: string | null } | null {
  const now = new Date();
  if (u.isVip) {
    return {
      text: 'VIP',
      cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
      nameCls: 'text-amber-300',
      dot: 'bg-amber-400',
    };
  }
  /* 연회원은 등록일 기준 1년만 유효하다 — 예전엔 필드만 있으면 계속 연회원으로 보였다. */
  if (isAnnualMemberActive(u.annualMemberSince)) {
    return {
      text: '연회원',
      cls: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
      nameCls: 'text-violet-300',
      dot: 'bg-violet-400',
    };
  }
  if (u.monthlyMemberUntil) {
    const until = new Date(u.monthlyMemberUntil);
    if (until > now) {
      return {
        text: '월구독',
        cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
        nameCls: 'text-sky-300',
        dot: 'bg-sky-400',
      };
    }
    return {
      text: '구독만료',
      cls: 'bg-slate-600/40 text-slate-400 border-slate-600',
      nameCls: 'text-slate-400',
      dot: null,
    };
  }
  if (u.annualMemberSince) {
    return {
      text: '연회원만료',
      cls: 'bg-slate-600/40 text-slate-400 border-slate-600',
      nameCls: 'text-slate-400',
      dot: null,
    };
  }
  if (u.signupPremiumTrialUntil && new Date(u.signupPremiumTrialUntil) > now) {
    return {
      text: '체험중',
      cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
      nameCls: 'text-emerald-300',
      dot: null,
    };
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
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user || d.user.role !== 'admin') { router.replace('/admin/login'); return; }
        setAdminLoginId(d.user.loginId ?? '');
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  useEffect(() => {
    fetch('/api/admin/users', { credentials: 'include' })
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
                    <th className="text-right px-5 py-3 font-medium hidden lg:table-cell">무료 문항</th>
                    <th className="text-right px-5 py-3 font-medium hidden lg:table-cell">포인트</th>
                    <th className="text-left px-5 py-3 font-medium hidden xl:table-cell">가입일</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center py-10 text-slate-500">
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
                            <p className={`font-semibold flex items-center gap-1.5 ${badge?.nameCls ?? 'text-white'}`}>
                              {badge?.dot && (
                                <span
                                  className={`inline-block w-1.5 h-1.5 rounded-full animate-pulse ${badge.dot}`}
                                  title={`${badge.text} (유효)`}
                                />
                              )}
                              {u.name}
                            </p>
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
                          <td className="px-5 py-3.5 text-right hidden lg:table-cell tabular-nums">
                            {u.baseFreeQuota ? (
                              <span
                                title={`이번 달 ${u.baseFreeQuota.used.toLocaleString()}문항 사용 / 한도 ${u.baseFreeQuota.limit.toLocaleString()}${u.baseFreeQuota.trial ? ' (가입 체험)' : ''}`}
                              >
                                <span className={quotaCls(u.baseFreeQuota)}>
                                  {u.baseFreeQuota.remaining.toLocaleString()}
                                </span>
                                <span className="text-slate-600 text-xs"> / {u.baseFreeQuota.limit.toLocaleString()}</span>
                              </span>
                            ) : (
                              <span className="text-slate-600">—</span>
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
