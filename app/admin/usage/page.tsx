'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../_components/AdminSidebar';

interface UsageData {
  days: number;
  from: string;
  summary: { pageviews: number; events: number; visitors: number; members: number };
  menus: { key: string; label: string; group: string; pageviews: number; visitors: number; members: number }[];
  daily: { date: string; pageviews: number; visitors: number; members: number }[];
  events: { name: string; label: string; count: number; visitors: number }[];
  referrers: { host: string; count: number }[];
  hours: { hour: number; count: number }[];
  solbookTop: { productId: string; title: string; count: number }[];
  downloads: { kind: string; count: number; visitors: number; members: number }[];
  signup: {
    opens: number;
    openVisitors: number;
    submits: number;
    byMenu: { menu: string; label: string; opens: number; openVisitors: number; submits: number }[];
  };
  members: {
    loginId: string;
    name: string;
    role: string;
    total: number;
    last: string;
    activeDays: number;
    topMenus: { label: string; n: number }[];
  }[];
}

interface MemberDetail {
  member: { loginId: string; name: string; role: string };
  events: { ts: string; type: string; label: string; path: string; props: Record<string, unknown> | null }[];
}

const PERIODS = [7, 30, 90, 180];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function Bar({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-700/60">
      <div className="h-1.5 rounded-full bg-sky-500" style={{ width: `${w}%` }} />
    </div>
  );
}

export default function AdminUsagePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [adminLoginId, setAdminLoginId] = useState('');
  const [days, setDays] = useState(30);
  const [includeAdmin, setIncludeAdmin] = useState(false);
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [memberQuery, setMemberQuery] = useState('');

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user || d.user.role !== 'admin') {
          router.replace('/admin/login');
          return;
        }
        setAdminLoginId(d.user.loginId ?? '');
        setReady(true);
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/admin/usage?days=${days}${includeAdmin ? '&includeAdmin=1' : ''}`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || '불러오지 못했습니다.');
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [days, includeAdmin]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const openMember = async (loginId: string) => {
    const r = await fetch(`/api/admin/usage?days=${days}&loginId=${encodeURIComponent(loginId)}`, { credentials: 'include' });
    const d = await r.json();
    if (d.ok) setDetail(d);
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <span className="text-sm text-slate-400">인증 확인 중…</span>
      </div>
    );
  }

  const card = 'rounded-xl border border-slate-700 bg-slate-800/60 p-5';
  const th = 'px-3 py-2 text-left text-xs font-semibold text-slate-400';
  const td = 'px-3 py-2 text-sm';
  const maxMenu = Math.max(0, ...(data?.menus.map((m) => m.pageviews) ?? [0]));
  const maxHour = Math.max(0, ...(data?.hours.map((h) => h.count) ?? [0]));
  const members = (data?.members ?? []).filter((m) => {
    const q = memberQuery.trim();
    return !q || m.name.includes(q) || m.loginId.includes(q);
  });

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      <AdminSidebar loginId={adminLoginId} />
      <main className="flex-1 p-6 overflow-y-auto min-w-0">
        <div className="mb-6 flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">📈 사용 기록</h1>
            <p className="text-sm text-slate-400 mt-1">
              어떤 메뉴를 누가 얼마나 쓰는지 — 페이지 조회와 주요 행동(주문서 생성·PDF 다운로드·가입 신청·쏠북 상품 클릭·학습실 시작)을 모았습니다.
              기록은 {`180`}일 보관, 관리자 화면(/admin)은 집계하지 않습니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDays(p)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${days === p ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
              >
                {p}일
              </button>
            ))}
            <label className="ml-2 flex items-center gap-1.5 text-xs text-slate-400">
              <input type="checkbox" checked={includeAdmin} onChange={(e) => setIncludeAdmin(e.target.checked)} />
              관리자 포함
            </label>
          </div>
        </div>

        {error && <div className="mb-4 rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</div>}
        {loading && !data && <div className="text-sm text-slate-400">불러오는 중…</div>}

        {data && (
          <div className="space-y-6">
            <p className="text-xs text-slate-500">
              {data.from} 부터 · 최근 {data.days}일
              {data.summary.pageviews === 0 && ' · 사용 기록은 이 기능을 배포한 뒤부터 쌓입니다.'}
            </p>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[
                ['페이지 조회', data.summary.pageviews, '회'],
                ['방문자(쿠키)', data.summary.visitors, '명'],
                ['로그인 회원', data.summary.members, '명'],
                ['행동 이벤트', data.summary.events, '건'],
              ].map(([label, v, unit]) => (
                <div key={String(label)} className={card}>
                  <div className="text-xs text-slate-400">{label}</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">
                    {Number(v).toLocaleString()}
                    <span className="ml-0.5 text-sm font-medium text-slate-400">{unit}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <section className={card}>
                <h2 className="mb-3 font-bold">메뉴별 사용</h2>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className={th}>메뉴</th>
                      <th className={`${th} text-right`}>조회</th>
                      <th className={`${th} text-right`}>방문자</th>
                      <th className={`${th} text-right`}>회원</th>
                      <th className={`${th} w-28`} />
                    </tr>
                  </thead>
                  <tbody>
                    {data.menus.map((m) => (
                      <tr key={m.key} className="border-b border-slate-800">
                        <td className={td}>
                          <span className="mr-1.5 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">{m.group}</span>
                          {m.label}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{m.pageviews.toLocaleString()}</td>
                        <td className={`${td} text-right tabular-nums`}>{m.visitors.toLocaleString()}</td>
                        <td className={`${td} text-right tabular-nums`}>{m.members.toLocaleString()}</td>
                        <td className="px-3">
                          <Bar value={m.pageviews} max={maxMenu} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <div className="space-y-6">
                <section className={card}>
                  <h2 className="mb-3 font-bold">주요 행동</h2>
                  {data.events.length === 0 ? (
                    <p className="text-sm text-slate-500">아직 기록이 없습니다.</p>
                  ) : (
                    <table className="w-full">
                      <tbody>
                        {data.events.map((e) => (
                          <tr key={e.name} className="border-b border-slate-800">
                            <td className={td}>{e.label}</td>
                            <td className={`${td} text-right tabular-nums`}>{e.count.toLocaleString()}건</td>
                            <td className={`${td} text-right tabular-nums text-slate-400`}>{e.visitors.toLocaleString()}명</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>

                <section className={card}>
                  <h2 className="mb-3 font-bold">가입 신청 흐름</h2>
                  {data.signup.opens === 0 ? (
                    <p className="text-sm text-slate-500">아직 기록이 없습니다.</p>
                  ) : (
                    <>
                      <div className="mb-3 flex items-baseline gap-4 text-sm">
                        <span>
                          창 연 방문자 <b className="tabular-nums">{data.signup.openVisitors.toLocaleString()}</b>명
                        </span>
                        <span aria-hidden className="text-slate-500">→</span>
                        <span>
                          신청 완료 <b className="tabular-nums">{data.signup.submits.toLocaleString()}</b>건
                        </span>
                        <span className="ml-auto text-sky-300 font-semibold tabular-nums">
                          전환 {data.signup.openVisitors ? Math.round((data.signup.submits / data.signup.openVisitors) * 100) : 0}%
                        </span>
                      </div>
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-slate-700">
                            <th className={th}>연 화면</th>
                            <th className={`${th} text-right`}>연 방문자</th>
                            <th className={`${th} text-right`}>신청</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.signup.byMenu.map((r) => (
                            <tr key={r.menu} className="border-b border-slate-800">
                              <td className={td}>{r.label}</td>
                              <td className={`${td} text-right tabular-nums`}>{r.openVisitors.toLocaleString()}</td>
                              <td className={`${td} text-right tabular-nums`}>{r.submits.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </section>

                <section className={card}>
                  <h2 className="mb-3 font-bold">PDF·파일 다운로드 (종류별)</h2>
                  {data.downloads.length === 0 ? (
                    <p className="text-sm text-slate-500">아직 기록이 없습니다.</p>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-700">
                          <th className={th}>종류</th>
                          <th className={`${th} text-right`}>다운로드</th>
                          <th className={`${th} text-right`}>방문자</th>
                          <th className={`${th} text-right`}>회원</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.downloads.map((d) => (
                          <tr key={d.kind} className="border-b border-slate-800">
                            <td className={td}>{d.kind}</td>
                            <td className={`${td} text-right tabular-nums`}>{d.count.toLocaleString()}</td>
                            <td className={`${td} text-right tabular-nums`}>{d.visitors.toLocaleString()}</td>
                            <td className={`${td} text-right tabular-nums`}>{d.members.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>

                <section className={card}>
                  <h2 className="mb-3 font-bold">시간대별 조회 (한국 시간)</h2>
                  <div className="flex h-28 items-end gap-1">
                    {Array.from({ length: 24 }, (_, h) => {
                      const c = data.hours.find((x) => x.hour === h)?.count ?? 0;
                      return (
                        <div key={h} className="flex flex-1 flex-col items-center gap-1" title={`${h}시 · ${c}회`}>
                          <div className="w-full rounded-t bg-sky-500/80" style={{ height: `${maxHour ? Math.max(2, (c / maxHour) * 96) : 0}px` }} />
                          <span className="text-[9px] text-slate-500">{h % 3 === 0 ? h : ''}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className={card}>
                  <h2 className="mb-3 font-bold">쏠북 인기 상품 (클릭)</h2>
                  {data.solbookTop.length === 0 ? (
                    <p className="text-sm text-slate-500">아직 기록이 없습니다.</p>
                  ) : (
                    <ol className="space-y-1 text-sm">
                      {data.solbookTop.map((s, i) => (
                        <li key={`${s.productId}-${i}`} className="flex items-center gap-2">
                          <span className="w-5 text-right text-xs text-slate-500">{i + 1}</span>
                          <a
                            href={`https://solvook.com/products/${s.productId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 flex-1 truncate hover:text-sky-300"
                          >
                            {s.title || s.productId}
                          </a>
                          <span className="tabular-nums text-slate-400">{s.count}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>

                <section className={card}>
                  <h2 className="mb-3 font-bold">외부 유입 출처</h2>
                  {data.referrers.length === 0 ? (
                    <p className="text-sm text-slate-500">아직 기록이 없습니다.</p>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {data.referrers.map((r) => (
                        <li key={r.host} className="flex justify-between">
                          <span>{r.host}</span>
                          <span className="tabular-nums text-slate-400">{r.count}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>

            <section className={card}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="font-bold">회원별 사용 (로그인 회원)</h2>
                <input
                  value={memberQuery}
                  onChange={(e) => setMemberQuery(e.target.value)}
                  placeholder="이름·아이디 검색"
                  className="w-48 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-white placeholder-slate-500"
                />
              </div>
              {members.length === 0 ? (
                <p className="text-sm text-slate-500">아직 기록이 없습니다.</p>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className={th}>회원</th>
                      <th className={`${th} text-right`}>활동일</th>
                      <th className={`${th} text-right`}>기록</th>
                      <th className={th}>마지막</th>
                      <th className={th}>자주 쓴 메뉴</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.loginId} onClick={() => void openMember(m.loginId)} className="cursor-pointer border-b border-slate-800 hover:bg-slate-800">
                        <td className={td}>
                          <span className="font-semibold">{m.name || '(이름 없음)'}</span>
                          <span className="ml-1.5 text-xs text-slate-500">{m.loginId}</span>
                          {m.role && m.role !== 'user' && <span className="ml-1.5 rounded bg-slate-700 px-1 text-[10px] text-slate-300">{m.role}</span>}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{m.activeDays}일</td>
                        <td className={`${td} text-right tabular-nums`}>{m.total.toLocaleString()}</td>
                        <td className={`${td} text-slate-400`}>{fmtTime(m.last)}</td>
                        <td className={`${td} text-slate-300`}>{m.topMenus.map((t) => `${t.label} ${t.n}`).join(' · ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className={card}>
              <h2 className="mb-3 font-bold">일별</h2>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className={th}>날짜</th>
                    <th className={`${th} text-right`}>조회</th>
                    <th className={`${th} text-right`}>방문자</th>
                    <th className={`${th} text-right`}>로그인 회원</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr key={d.date} className="border-b border-slate-800">
                      <td className={td}>{d.date}</td>
                      <td className={`${td} text-right tabular-nums`}>{d.pageviews.toLocaleString()}</td>
                      <td className={`${td} text-right tabular-nums`}>{d.visitors.toLocaleString()}</td>
                      <td className={`${td} text-right tabular-nums`}>{d.members.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}

        {detail && (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => setDetail(null)}>
            <div className="h-full w-full max-w-lg overflow-y-auto bg-slate-900 p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <div className="text-lg font-bold">{detail.member.name || '(이름 없음)'}</div>
                  <div className="text-xs text-slate-500">{detail.member.loginId} · 최근 {days}일 · 최대 500건</div>
                </div>
                <button type="button" onClick={() => setDetail(null)} className="text-slate-400 hover:text-white" aria-label="닫기">
                  ✕
                </button>
              </div>
              <ol className="space-y-1">
                {detail.events.map((e, i) => (
                  <li key={i} className="flex gap-3 border-b border-slate-800 py-1.5 text-sm">
                    <span className="w-24 shrink-0 text-xs tabular-nums text-slate-500">{fmtTime(e.ts)}</span>
                    <span className="min-w-0 flex-1">
                      <span className={e.type === 'event' ? 'font-semibold text-sky-300' : ''}>{e.label}</span>
                      {e.props && (
                        <span className="ml-1.5 text-xs text-slate-500">
                          {Object.entries(e.props)
                            .map(([k, v]) => `${k}=${String(v)}`)
                            .join(' · ')}
                        </span>
                      )}
                      <span className="block truncate text-[11px] text-slate-600">{e.path}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
