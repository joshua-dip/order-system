'use client';

/**
 * 이용안내 — 하시려는 일을 고르면 그 일을 하는 화면과 방법이 나온다.
 * 본문은 lib/guide-content.ts (가격·한도는 코드가 권위, 바꾸면 거기도 고칠 것).
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppBar from '@/app/components/AppBar';
import { GUIDE_HIGHLIGHTS, GUIDE_PLAN_ROWS, GUIDE_TRACKS, type GuideArticle } from '@/lib/guide-content';

function matches(a: GuideArticle, q: string): boolean {
  if (!q) return true;
  const hay = [a.title, a.lead, ...a.tags, ...a.body].join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

function Article({ a, open, onToggle }: { a: GuideArticle; open: boolean; onToggle: () => void }) {
  return (
    <div id={a.id} className="scroll-mt-20 border-b border-[#f1f5f9] last:border-b-0">
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 px-4 py-3.5 text-left hover:bg-[#f8fafc]" aria-expanded={open}>
        <span className="mt-0.5 text-[#94a3b8]">{open ? '▾' : '▸'}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold text-[#0f172a]">{a.title}</span>
          {!open ? <span className="mt-0.5 block text-[13px] text-[#64748b]">{a.lead}</span> : null}
          {!open ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {a.tags.map((t) => (
                <span key={t} className="text-[11px] text-[#94a3b8]">
                  #{t}
                </span>
              ))}
            </span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div className="px-4 pb-4 pl-10">
          <p className="text-[14px] font-semibold text-[#1e293b]">{a.lead}</p>
          {a.body.length ? (
            <ul className="mt-2 space-y-1.5 text-[14px] leading-relaxed text-[#334155]">
              {a.body.map((b, i) =>
                b.startsWith('• ') ? (
                  <li key={i} className="flex gap-2">
                    <span className="text-[#2563eb]">•</span>
                    <span>{b.slice(2)}</span>
                  </li>
                ) : (
                  <li key={i}>{b}</li>
                ),
              )}
            </ul>
          ) : null}
          {a.href ? (
            <Link
              href={a.href}
              className="mt-3 inline-flex items-center gap-1 rounded-lg bg-[#2563eb] px-3.5 py-2 text-sm font-bold text-white no-underline hover:bg-[#1d4ed8]"
            >
              {a.hrefLabel ?? '이 기능 열기'} →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function GuidePage() {
  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  // #article-id 로 들어오면 그 글을 펼치고 스크롤
  useEffect(() => {
    const openFromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id || id.startsWith('track-')) return;
      setQuery('');
      setOpenIds((s) => new Set(s).add(id));
      setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
  }, []);

  const toggle = (id: string) =>
    setOpenIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const openArticle = (id: string) => {
    setQuery('');
    setOpenIds((s) => new Set(s).add(id));
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const q = query.trim();
  const tracks = useMemo(() => GUIDE_TRACKS.map((t) => ({ ...t, articles: t.articles.filter((a) => matches(a, q)) })), [q]);
  const hitCount = tracks.reduce((n, t) => n + t.articles.length, 0);
  const total = GUIDE_TRACKS.reduce((n, t) => n + t.articles.length, 0);

  return (
    <>
      <AppBar title="이용안내" />
      <div className="min-h-screen bg-[#f8fafc] pb-24">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-5">
          <header className="mb-6">
            <h1 className="text-2xl font-black tracking-tight text-[#0f172a]">이용안내</h1>
            <p className="mt-1 text-sm text-[#64748b]">하시려는 일을 고르세요. 수업 준비 · 문제와 시험지 · 학생 관리 — 셋이 이어집니다.</p>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="궁금한 것을 찾아보세요 (예: 판서, 예비시험지, 가격, QR)"
              className="mt-4 w-full rounded-xl border-2 border-[#e2e8f0] bg-white px-4 py-3 text-sm outline-none focus:border-[#2563eb]"
            />
          </header>

          {!q ? (
            <>
              <section className="mb-8">
                <h2 className="mb-3 text-sm font-bold text-[#0f172a]">
                  ✨ 여기서 되는 것 <span className="font-normal text-[#94a3b8]">— 고미조슈아가 잘하는 일</span>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {GUIDE_HIGHLIGHTS.map((h, i) => (
                    <button
                      key={h.title}
                      type="button"
                      onClick={() => openArticle(h.article)}
                      className="flex gap-3 rounded-2xl border border-[#bfdbfe] bg-white p-4 text-left transition-colors hover:border-[#2563eb]"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#2563eb] text-sm font-bold text-white">{i + 1}</span>
                      <span>
                        <span className="block font-bold text-[#0f172a]">{h.title}</span>
                        <span className="mt-0.5 block text-[13px] text-[#64748b]">{h.lead}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {GUIDE_TRACKS.map((t) => (
                  <a key={t.key} href={`#track-${t.key}`} className="rounded-2xl border border-[#e2e8f0] bg-white p-4 no-underline hover:border-[#94a3b8]">
                    <span className="text-xs font-semibold text-[#94a3b8]">
                      {t.no} · {t.articles.length}편
                    </span>
                    <span className="mt-1 block font-bold text-[#0f172a]">{t.title}</span>
                    <span className="mt-1 block text-[13px] text-[#64748b]">{t.lead}</span>
                    <span className="mt-2 block text-[11px] text-[#94a3b8]">{t.who}</span>
                  </a>
                ))}
              </section>
            </>
          ) : (
            <p className="mb-4 text-sm text-[#64748b]">
              「{q}」 — {hitCount}편 {hitCount === 0 ? '· 다른 말로 찾아보거나 카카오톡으로 물어봐 주세요.' : ''}
            </p>
          )}

          <div className="space-y-6">
            {tracks
              .filter((t) => t.articles.length > 0)
              .map((t) => (
                <section key={t.key} id={`track-${t.key}`} className="scroll-mt-20">
                  <div className="mb-2 flex items-baseline gap-2">
                    <h2 className="text-lg font-black text-[#0f172a]">
                      {t.no} {t.title}
                    </h2>
                    <span className="text-xs text-[#94a3b8]">{t.who}</span>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-[#e2e8f0] bg-white">
                    {t.articles.map((a) => (
                      <Article key={a.id} a={a} open={!!q || openIds.has(a.id)} onToggle={() => toggle(a.id)} />
                    ))}
                  </div>
                </section>
              ))}
          </div>

          {!q ? (
            <section className="mt-10">
              <h2 className="mb-3 text-lg font-black text-[#0f172a]">무료 · 회원 · 멤버십</h2>
              <div className="overflow-x-auto rounded-2xl border border-[#e2e8f0] bg-white">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="bg-[#f8fafc] text-left text-xs text-[#64748b]">
                      <th className="px-4 py-2.5 font-semibold" />
                      <th className="px-4 py-2.5 font-semibold">비회원</th>
                      <th className="px-4 py-2.5 font-semibold">회원(무료 가입)</th>
                      <th className="px-4 py-2.5 font-semibold text-[#2563eb]">멤버십</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GUIDE_PLAN_ROWS.map((r) => (
                      <tr key={r.label} className="border-t border-[#f1f5f9]">
                        <td className="px-4 py-2.5 font-semibold text-[#0f172a]">{r.label}</td>
                        <td className="px-4 py-2.5 text-[#475569]">{r.guest}</td>
                        <td className="px-4 py-2.5 text-[#475569]">{r.member}</td>
                        <td className="px-4 py-2.5 font-medium text-[#1e293b]">{r.premium}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-[#94a3b8]">멤버십: 월 8,900원 · 연 90,000원(기능 같음). 자세한 건 「멤버십」 글을 보세요.</p>
            </section>
          ) : null}

          <p className="mt-10 text-center text-sm text-[#64748b]">
            더 궁금한 점은 화면 오른쪽 아래 <b>카카오톡</b> 버튼으로 보내 주세요. {total}편의 안내가 있어요.
          </p>
        </div>
      </div>
    </>
  );
}
