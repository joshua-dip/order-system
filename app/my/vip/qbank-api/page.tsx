'use client';

import { useCallback, useEffect, useState } from 'react';
import { getPublicSiteUrl } from '@/lib/site-branding';

/** 외부에 안내할 공개(배포) 엔드포인트 — 로컬 origin 이 아니라 배포 도메인을 보여준다. */
const PUBLIC_BASE = getPublicSiteUrl() || 'https://gomijoshua.com';

interface ApiKey { id: string; key: string; label: string; createdAt: string; lastUsedAt: string | null }
interface UsageLog { id: string; keyId: string; keyLabel: string; at: string; endpoint: string; folder: string; type: string; limit: number | null; offset: number | null; count: number; status: number; ip: string; userAgent: string }
interface UsageSummary { total: number; last7d: number; last24h: number; returned: number; perKey: { keyId: string; keyLabel: string; calls: number; items: number; lastAt: string }[] }

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function QbankApiPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [max, setMax] = useState(5);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [test, setTest] = useState<{ status: number; total?: number; count?: number; sample?: unknown; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [usage, setUsage] = useState<UsageLog[]>([]);
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);

  const load = useCallback(async () => {
    const d = await fetch('/api/my/vip/api-keys', { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setKeys(d.keys); setMax(d.max ?? 5); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    try {
      const d = await fetch('/api/my/vip/api-keys/usage?limit=200', { credentials: 'include' }).then((r) => r.json());
      if (d.ok) { setUsage(d.logs); setUsageSummary(d.summary); }
    } catch { /* ignore */ }
    setUsageLoading(false);
  }, []);
  useEffect(() => { loadUsage(); }, [loadUsage]);

  const createKey = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/my/vip/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ label }) });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '발급 실패'); }
      else { setLabel(''); setReveal((p) => ({ ...p, [d.key.id]: true })); await load(); }
    } catch { alert('발급 중 오류가 발생했습니다.'); }
    setBusy(false);
  };

  const deleteKey = async (id: string) => {
    if (!confirm('이 키를 폐기할까요? 이 키를 쓰던 외부 연동이 즉시 중단됩니다.')) return;
    await fetch(`/api/my/vip/api-keys?id=${id}`, { method: 'DELETE', credentials: 'include' });
    await load();
  };

  const copy = async (text: string, id: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500); } catch { /* ignore */ }
  };

  const endpoint = `${PUBLIC_BASE}/api/public/question-bank`;

  const runTest = async () => {
    const k = keys[0];
    if (!k) return;
    setTesting(true); setTest(null);
    try {
      const res = await fetch(`/api/public/question-bank?limit=3`, { headers: { Authorization: `Bearer ${k.key}` } });
      const d = await res.json();
      setTest({ status: res.status, total: d.total, count: d.count, sample: d.items?.[0] ?? null, error: d.error });
      setTimeout(loadUsage, 600); // 방금 호출이 사용 내역에 반영되도록
    } catch (e) { setTest({ status: 0, error: String(e) }); }
    setTesting(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
            문제은행 API
            <span className="px-2 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-xs border border-[#c9a44e]/25">외부 연동</span>
          </h1>
          <p className="text-sm text-zinc-500 mt-0.5">내 문제은행(담아둔 문항)을 API 키로 외부 시스템에서 불러와 쓸 수 있습니다. 읽기 전용입니다.</p>
        </div>
        <a
          href="/docs/question-bank-api"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm hover:bg-zinc-700 transition-colors"
        >
          📖 API 문서 열기
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" /></svg>
        </a>
      </div>

      {/* API 키 */}
      <section className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-200">API 키</h2>
          <span className="text-[11px] text-zinc-600">{keys.length} / {max}</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="키 용도 (예: 우리 학원 LMS)"
            maxLength={40}
            className="flex-1 min-w-[180px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50"
          />
          <button
            onClick={createKey}
            disabled={busy || keys.length >= max}
            className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40"
          >
            {busy ? '발급 중…' : '＋ 새 키 발급'}
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center"><div className="w-5 h-5 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
        ) : keys.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-600">아직 발급한 키가 없습니다. 키를 발급하면 아래 사용법으로 외부에서 호출할 수 있어요.</div>
        ) : (
          <div className="divide-y divide-zinc-800/70 rounded-lg border border-zinc-800/70 overflow-hidden">
            {keys.map((k) => {
              const shown = reveal[k.id];
              const display = shown ? k.key : `${k.key.slice(0, 10)}${'•'.repeat(12)}${k.key.slice(-4)}`;
              return (
                <div key={k.id} className="p-3.5 bg-zinc-900/40">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-sm text-zinc-200 font-medium truncate">{k.label}</span>
                    <button onClick={() => deleteKey(k.id)} className="text-[11px] text-zinc-600 hover:text-rose-400 transition-colors shrink-0">폐기</button>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="flex-1 min-w-[200px] px-2.5 py-1.5 rounded-md bg-black/40 border border-zinc-800 text-[12px] text-zinc-300 font-mono break-all">{display}</code>
                    <button onClick={() => setReveal((p) => ({ ...p, [k.id]: !shown }))} className="px-2 py-1.5 rounded-md bg-zinc-800 text-zinc-400 text-[11px] hover:text-zinc-200 transition-colors">{shown ? '가리기' : '보기'}</button>
                    <button onClick={() => copy(k.key, k.id)} className="px-2 py-1.5 rounded-md bg-zinc-800 text-zinc-400 text-[11px] hover:text-zinc-200 transition-colors">{copied === k.id ? '복사됨!' : '복사'}</button>
                  </div>
                  <div className="mt-1.5 text-[10px] text-zinc-600">발급 {when(k.createdAt)} · 마지막 사용 {when(k.lastUsedAt)}</div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-zinc-600">키는 비밀번호처럼 다뤄 주세요. 노출되면 폐기 후 새로 발급하세요.</p>
      </section>

      {/* 사용 내역 */}
      <section className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-zinc-200">사용 내역</h2>
          <button onClick={loadUsage} className="text-[11px] px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors">새로고침</button>
        </div>

        {/* 요약 */}
        {usageSummary && (
          <div className="grid grid-cols-3 gap-2">
            {[['총 호출', usageSummary.total], ['최근 7일', usageSummary.last7d], ['최근 24시간', usageSummary.last24h]].map(([label, v]) => (
              <div key={label as string} className="rounded-lg bg-zinc-900/60 border border-zinc-800/70 px-3 py-2.5 text-center">
                <div className="text-lg font-bold text-zinc-100 tabular-nums">{(v as number).toLocaleString()}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        )}

        {/* 키별 집계 */}
        {usageSummary && usageSummary.perKey.length > 0 && (
          <div className="space-y-1">
            {usageSummary.perKey.map((p) => (
              <div key={p.keyId} className="flex items-center gap-2 text-[11px] px-3 py-1.5 rounded-md bg-zinc-900/40 border border-zinc-800/60">
                <span className="text-zinc-300 font-medium truncate flex-1">{p.keyLabel}</span>
                <span className="text-zinc-500">{p.calls.toLocaleString()}회</span>
                <span className="text-zinc-600">· {p.items.toLocaleString()}문항</span>
                <span className="text-zinc-600">· {when(p.lastAt)}</span>
              </div>
            ))}
          </div>
        )}

        {/* 호출 로그 */}
        {usageLoading ? (
          <div className="py-8 text-center"><div className="w-5 h-5 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
        ) : usage.length === 0 ? (
          <div className="py-8 text-center text-xs text-zinc-600">아직 외부 호출 기록이 없습니다. 키로 API를 호출하면 여기에 시각·건수·IP가 쌓입니다.</div>
        ) : (
          <div className="rounded-lg border border-zinc-800/70 overflow-hidden">
            <div className="grid grid-cols-[1.6fr_1.2fr_1.3fr_0.6fr_0.6fr] gap-2 px-3 py-1.5 bg-zinc-900/70 text-[10px] text-zinc-500 font-medium">
              <span>시각</span><span>키</span><span>필터</span><span className="text-right">건수</span><span className="text-right">상태</span>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-zinc-800/50">
              {usage.map((u) => (
                <div key={u.id} className="grid grid-cols-[1.6fr_1.2fr_1.3fr_0.6fr_0.6fr] gap-2 px-3 py-1.5 text-[11px] items-center">
                  <span className="text-zinc-400" title={u.ip ? `IP ${u.ip}` : ''}>{when(u.at)}</span>
                  <span className="text-zinc-300 truncate">{u.keyLabel}</span>
                  <span className="text-zinc-500 truncate">{[u.folder && `folder=${u.folder}`, u.type && `type=${u.type}`].filter(Boolean).join(' ') || '전체'}</span>
                  <span className="text-right text-zinc-300 tabular-nums">{u.count}</span>
                  <span className={`text-right tabular-nums ${u.status === 200 ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>{u.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="text-[11px] text-zinc-600">최근 200건까지 표시 · 로그는 1년간 보관됩니다.</p>
      </section>

      {/* 사용법 */}
      <section className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-200">사용법</h2>

        <div>
          <div className="text-[11px] text-zinc-500 mb-1">엔드포인트 (읽기 전용)</div>
          <code className="block px-3 py-2 rounded-md bg-black/40 border border-zinc-800 text-[12px] text-emerald-300 font-mono break-all">GET {endpoint}</code>
        </div>

        <div>
          <div className="text-[11px] text-zinc-500 mb-1">인증 — 헤더 또는 쿼리</div>
          <code className="block px-3 py-2 rounded-md bg-black/40 border border-zinc-800 text-[12px] text-zinc-300 font-mono break-all">Authorization: Bearer &lt;API_KEY&gt;{'\n'}또는  ?key=&lt;API_KEY&gt;</code>
        </div>

        <div>
          <div className="text-[11px] text-zinc-500 mb-1">쿼리 파라미터</div>
          <div className="rounded-md border border-zinc-800 overflow-hidden text-[12px]">
            {[
              ['folder', '폴더명으로 필터 (생략 시 전체)'],
              ['type', '유형으로 필터 (빈칸·순서·어법 …)'],
              ['limit', '개수 (기본 50, 최대 200)'],
              ['offset', '페이지 오프셋 (기본 0)'],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3 px-3 py-1.5 border-b border-zinc-800/60 last:border-b-0">
                <code className="text-amber-300 font-mono w-16 shrink-0">{k}</code>
                <span className="text-zinc-400">{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-[11px] text-zinc-500 mb-1">예시 (curl)</div>
          <code className="block px-3 py-2 rounded-md bg-black/40 border border-zinc-800 text-[12px] text-zinc-300 font-mono break-all whitespace-pre-wrap">{`curl -H "Authorization: Bearer ${keys[0]?.key ?? '<API_KEY>'}" \\\n  "${endpoint}?limit=10"`}</code>
        </div>

        <div className="pt-1">
          <button
            onClick={runTest}
            disabled={testing || keys.length === 0}
            className="px-3.5 py-2 rounded-lg bg-zinc-800 text-zinc-200 text-sm hover:bg-zinc-700 transition-colors disabled:opacity-40"
          >
            {testing ? '호출 중…' : keys.length === 0 ? '키를 먼저 발급하세요' : '응답 테스트 (첫 번째 키)'}
          </button>
          {test && (
            <div className="mt-3 rounded-md border border-zinc-800 bg-black/40 p-3 text-[12px]">
              <div className="text-zinc-400 mb-1">HTTP {test.status} {test.error ? <span className="text-rose-400">· {test.error}</span> : <span className="text-emerald-400">· total {test.total} · 이번 응답 {test.count}건</span>}</div>
              {test.sample != null && (
                <pre className="text-zinc-500 overflow-x-auto max-h-60 leading-relaxed">{JSON.stringify(test.sample, null, 2)}</pre>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
