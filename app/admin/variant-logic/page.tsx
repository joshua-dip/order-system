'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

type FlowStep = { n: number; title: string; detail: string };

type McpTool = {
  name: string;
  step: string;
  inputs: string[];
  description: string;
  apiKey: 'pro-only' | 'no-api' | 'api-key-required';
};

type SourceFileEntry = {
  key: string;
  label: string;
  description: string;
  path: string;
  language: string;
  content: string | null;
  lineCount: number;
  bytes: number;
  error: string | null;
};

type MemoryEntry = { name: string; content: string; bytes: number };

type ApiResp = {
  flow: FlowStep[];
  mcpTools: McpTool[];
  sourceFiles: SourceFileEntry[];
  memory: { available: boolean; dir: string; entries: MemoryEntry[]; error: string | null };
  rootDir: string;
};

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function CopyButton({ text, label = '복사' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  }, [text]);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
        done
          ? 'bg-emerald-700 border-emerald-500 text-white'
          : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {done ? '✓' : label}
    </button>
  );
}

const API_BADGE: Record<McpTool['apiKey'], { text: string; cls: string }> = {
  'no-api': { text: 'API 호출 없음', cls: 'bg-emerald-900/50 border-emerald-700 text-emerald-200' },
  'api-key-required': {
    text: 'Anthropic API 호출 (Pro 정책 ⛔)',
    cls: 'bg-rose-900/50 border-rose-700 text-rose-200',
  },
  'pro-only': { text: 'Pro 전용', cls: 'bg-indigo-900/50 border-indigo-700 text-indigo-200' },
};

export default function VariantLogicPage() {
  const [data, setData] = useState<ApiResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openFiles, setOpenFiles] = useState<Set<string>>(new Set());
  const [openMemory, setOpenMemory] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetch('/api/admin/variant-logic', { credentials: 'include' })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (cancel) return;
        if (!ok) {
          setErr(d?.error || '로딩 실패');
          setData(null);
        } else {
          setData(d as ApiResp);
        }
      })
      .catch((e) => {
        if (cancel) return;
        setErr(e instanceof Error ? e.message : '로딩 실패');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const toggleFile = useCallback((key: string) => {
    setOpenFiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleMemory = useCallback((key: string) => {
    setOpenMemory((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const filteredTools = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    if (!q) return data.mcpTools;
    return data.mcpTools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.step.toLowerCase().includes(q)
    );
  }, [data, filter]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">변형문제 작성 로직</h1>
            <p className="text-slate-400 text-sm mt-1">
              Claude Code(Pro 플랜) 가 변형문제를 만들 때 따르는 흐름·도구·규칙·소스 코드를 한 화면에서 봅니다.
              오류가 보이면 해당 파일 경로를 클릭해 수정하세요.
            </p>
          </div>
          <Link
            href="/admin"
            className="text-sm text-teal-400 hover:text-teal-300 shrink-0"
          >
            ← 관리자 홈
          </Link>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-10 h-10 border-4 border-slate-700 border-t-teal-400 rounded-full" />
          </div>
        )}

        {err && (
          <div className="rounded-xl border border-rose-700 bg-rose-950/40 p-4 text-rose-200 text-sm">
            {err}
          </div>
        )}

        {data && !loading && (
          <div className="space-y-8">
            {/* 흐름 */}
            <section>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
                ① 작성 흐름
              </h2>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {data.flow.map((s) => (
                  <div
                    key={s.n}
                    className="rounded-xl border border-slate-700 bg-slate-800/40 p-4"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-teal-600 text-white text-xs font-bold">
                        {s.n}
                      </span>
                      <h3 className="text-sm font-semibold text-white">{s.title}</h3>
                    </div>
                    <p className="text-xs text-slate-400 leading-relaxed">{s.detail}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* MCP 도구 */}
            <section>
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                  ② 사용 중인 MCP 도구 ({data.mcpTools.length}개)
                </h2>
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="도구 이름·설명 검색"
                  className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-1.5 text-xs text-white w-60"
                />
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-800/40 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-800 text-slate-400 uppercase tracking-wide text-[10px]">
                    <tr>
                      <th className="text-left px-3 py-2 w-[180px]">단계</th>
                      <th className="text-left px-3 py-2 w-[260px]">도구</th>
                      <th className="text-left px-3 py-2">설명 / 입력</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTools.map((t) => {
                      const badge = API_BADGE[t.apiKey];
                      return (
                        <tr key={t.name} className="border-t border-slate-700 align-top">
                          <td className="px-3 py-2 text-slate-300 font-medium">{t.step}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <code className="font-mono text-teal-300 text-xs">{t.name}</code>
                              <span
                                className={`text-[10px] rounded px-1.5 py-0.5 border ${badge.cls}`}
                              >
                                {badge.text}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-slate-300 leading-relaxed">
                            <p>{t.description}</p>
                            {t.inputs.length > 0 && (
                              <p className="mt-1 text-[10px] text-slate-500">
                                <span className="text-slate-400">inputs:</span>{' '}
                                <code className="font-mono">{t.inputs.join(', ')}</code>
                              </p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {filteredTools.length === 0 && (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                          일치하는 도구가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* 메모리 규칙 */}
            <section>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
                ③ 작성 규칙 (Claude Code 메모리)
              </h2>
              {data.memory.available ? (
                <div className="space-y-2">
                  <p className="text-[11px] text-slate-500">
                    위치:{' '}
                    <code className="font-mono text-slate-400">{data.memory.dir}</code> ·{' '}
                    {data.memory.entries.length}개 파일
                  </p>
                  {data.memory.entries.map((m) => {
                    const open = openMemory.has(m.name);
                    return (
                      <div
                        key={m.name}
                        className="rounded-lg border border-slate-700 bg-slate-800/40 overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => toggleMemory(m.name)}
                          className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-800 transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-slate-400 text-xs">{open ? '▾' : '▸'}</span>
                            <code className="font-mono text-xs text-amber-200 truncate">
                              {m.name}
                            </code>
                            <span className="text-[10px] text-slate-500 shrink-0">
                              {fmtBytes(m.bytes)}
                            </span>
                          </div>
                          <span onClick={(e) => e.stopPropagation()}>
                            <CopyButton text={m.content} />
                          </span>
                        </button>
                        {open && (
                          <pre className="bg-slate-950 px-4 py-3 text-[11px] text-slate-200 whitespace-pre-wrap break-words border-t border-slate-700 leading-relaxed">
                            {m.content}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-amber-700 bg-amber-950/30 p-3 text-xs text-amber-200">
                  메모리 디렉터리를 읽지 못했습니다. (배포 환경에서는 보이지 않을 수 있습니다.)
                  <br />
                  <code className="font-mono text-[10px] text-amber-300">
                    {data.memory.dir} — {data.memory.error}
                  </code>
                </div>
              )}
            </section>

            {/* 소스 파일 */}
            <section>
              <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                  ④ 관련 코드 ({data.sourceFiles.length}개)
                </h2>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenFiles(new Set(data.sourceFiles.map((f) => f.key)))}
                    className="text-xs px-2.5 py-1 rounded border border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    모두 펼치기
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenFiles(new Set())}
                    className="text-xs px-2.5 py-1 rounded border border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-300"
                  >
                    모두 접기
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mb-3">
                루트:{' '}
                <code className="font-mono text-slate-400">{data.rootDir}</code> · 파일을 수정하면 즉시
                MCP/CLI 동작에 반영됩니다 (개발 서버 재기동 또는 배포 필요).
              </p>
              <div className="space-y-2">
                {data.sourceFiles.map((f) => {
                  const open = openFiles.has(f.key);
                  return (
                    <div
                      key={f.key}
                      className="rounded-xl border border-slate-700 bg-slate-800/40 overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => toggleFile(f.key)}
                        className="w-full text-left px-4 py-3 hover:bg-slate-800/70 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-slate-400 text-xs">{open ? '▾' : '▸'}</span>
                              <h3 className="text-sm font-semibold text-white">{f.label}</h3>
                            </div>
                            <p className="text-xs text-slate-400 mb-1.5 ml-5">{f.description}</p>
                            <div className="flex items-center gap-2 flex-wrap ml-5 text-[11px]">
                              <code className="font-mono text-teal-300">{f.path}</code>
                              {f.error ? (
                                <span className="text-rose-300">읽기 실패: {f.error}</span>
                              ) : (
                                <>
                                  <span className="text-slate-500">{f.lineCount}줄</span>
                                  <span className="text-slate-600">·</span>
                                  <span className="text-slate-500">{fmtBytes(f.bytes)}</span>
                                  <span className="text-slate-600">·</span>
                                  <span className="text-slate-500">{f.language}</span>
                                </>
                              )}
                            </div>
                          </div>
                          {f.content !== null && (
                            <span onClick={(e) => e.stopPropagation()} className="shrink-0">
                              <CopyButton text={f.content} label="전체 복사" />
                            </span>
                          )}
                        </div>
                      </button>
                      {open && f.content !== null && (
                        <div className="border-t border-slate-700 bg-slate-950">
                          <pre className="overflow-x-auto text-[11px] text-slate-200 leading-relaxed px-4 py-3 max-h-[600px] overflow-y-auto">
                            <code>{f.content}</code>
                          </pre>
                        </div>
                      )}
                      {open && f.content === null && (
                        <div className="border-t border-slate-700 bg-rose-950/20 px-4 py-3 text-xs text-rose-300">
                          파일을 읽지 못했습니다 — {f.error}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
