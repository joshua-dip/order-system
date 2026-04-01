'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type Status = {
  bridgeUrl: string;
  hasToken: boolean;
  bridgeReachable: boolean;
  bridgeError: string | null;
  claudeCliHint: string;
};

type ToolRow = { name: string; description: string };

export default function AdminMcpPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [tools, setTools] = useState<ToolRow[] | null>(null);
  const [toolErr, setToolErr] = useState<string | null>(null);
  const [execName, setExecName] = useState('');
  const [execArgs, setExecArgs] = useState('{}');
  const [execBusy, setExecBusy] = useState(false);
  const [execOut, setExecOut] = useState<string | null>(null);

  const load = useCallback(async () => {
    setToolErr(null);
    try {
      const s = await fetch('/api/mcp/status', { credentials: 'include' });
      const sd = await s.json();
      if (!s.ok) throw new Error(sd.error || '상태 조회 실패');
      setStatus(sd as Status);

      if (sd.bridgeReachable && sd.hasToken) {
        const t = await fetch('/api/mcp/tools', { credentials: 'include' });
        const td = await t.json();
        if (!t.ok) throw new Error(td.error || '도구 목록 실패');
        const list = (td.tools || []) as ToolRow[];
        setTools(list);
      } else {
        setTools(null);
      }
    } catch (e) {
      setToolErr(e instanceof Error ? e.message : '오류');
      setStatus(null);
      setTools(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runExecute() {
    setExecBusy(true);
    setExecOut(null);
    try {
      let args: Record<string, unknown> = {};
      const raw = execArgs.trim();
      if (raw) args = JSON.parse(raw) as Record<string, unknown>;
      const res = await fetch('/api/mcp/execute', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: execName.trim(), arguments: args }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '실행 실패');
      setExecOut(JSON.stringify(data.result, null, 2));
    } catch (e) {
      setExecOut(e instanceof Error ? e.message : '오류');
    } finally {
      setExecBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-xl font-bold text-white">Claude MCP 브리지</h1>
          <p className="text-slate-400 text-sm mt-1">
            Next 앱이 로컬에서 <code className="text-teal-300">claude mcp serve</code> 도구를 부를 때
            쓰는 연결 상태입니다.
          </p>
        </div>
        <Link
          href="/admin"
          className="text-sm text-teal-400 hover:text-teal-300 shrink-0"
        >
          ← 관리자 홈
        </Link>
      </div>

      <div className="rounded-xl border border-teal-900/40 bg-teal-950/15 p-5 mb-6 text-sm text-slate-300 space-y-2">
        <h2 className="text-sm font-semibold text-teal-200/90 uppercase tracking-wide">
          변형문제 MCP (Claude Code)
        </h2>
        <p className="text-slate-400">
          아래 브리지와는 별도입니다. 프로젝트 루트에서 stdio MCP로 등록하면 Claude Code가 지문 조회·초안 생성·DB
          저장까지 할 수 있습니다.
        </p>
        <code className="block bg-slate-950 border border-slate-700 rounded-lg p-3 text-xs text-slate-200 whitespace-pre-wrap break-all">
          claude mcp add next-order-variant --scope project -- npm run mcp:variant
        </code>
        <p className="text-slate-500 text-xs">
          변형문제 관리 화면의 초안 생성은 웹에서 <code className="text-slate-400">/api/admin/generated-questions/generate-draft</code>
          (Anthropic API)를 씁니다. 아래 목록·실행 테스트는 <code className="text-slate-400">claude mcp serve</code> 경로 기준입니다.
        </p>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 mb-6 space-y-3">
        <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">해야 할 일 (한 번만)</h2>
        <ol className="list-decimal list-inside text-slate-300 text-sm space-y-2">
          <li>
            터미널에서 프로젝트 루트로 이동 후{' '}
            <code className="bg-slate-900 px-1.5 py-0.5 rounded text-teal-300">npm run mcp-bridge:setup</code>
            <br />
            <span className="text-slate-500">→ .env.local 에 MCP 토큰·URL 이 없으면 자동으로 넣습니다.</span>
          </li>
          <li>
            개발 서버 + 브리지를 같이 켜기:{' '}
            <code className="bg-slate-900 px-1.5 py-0.5 rounded text-teal-300">npm run dev:with-mcp</code>
            <br />
            <span className="text-slate-500">
              (또는 터미널 두 개: <code className="text-slate-400">npm run dev</code> +{' '}
              <code className="text-slate-400">npm run mcp-bridge:dev</code>)
            </span>
          </li>
          <li>
            Mac/리눅스에 <code className="text-slate-400">claude</code> CLI 가 PATH 에 있어야 합니다. (
            {status?.claudeCliHint ?? 'CLAUDE_PATH'})
          </li>
        </ol>
        <button
          type="button"
          onClick={() => load()}
          className="mt-2 text-sm px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white"
        >
          상태 새로고침
        </button>
      </div>

      {toolErr && (
        <p className="text-rose-400 text-sm mb-4">{toolErr}</p>
      )}

      {status && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 mb-6 space-y-2 text-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-slate-400">브리지 URL</span>
            <span className="text-white font-mono">{status.bridgeUrl}</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-slate-400">Next .env 토큰</span>
            <span className={status.hasToken ? 'text-emerald-400' : 'text-rose-400'}>
              {status.hasToken ? '설정됨' : '없음 → mcp-bridge:setup'}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-slate-400">브리지 프로세스</span>
            <span className={status.bridgeReachable ? 'text-emerald-400' : 'text-rose-400'}>
              {status.bridgeReachable ? '응답함' : `안 됨${status.bridgeError ? ` (${status.bridgeError})` : ''}`}
            </span>
          </div>
        </div>
      )}

      {tools && tools.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">등록된 MCP 도구</h2>
          <ul className="space-y-2 text-sm">
            {tools.map((t) => (
              <li key={t.name} className="border-b border-slate-700/80 pb-2 last:border-0">
                <span className="font-mono text-teal-300">{t.name}</span>
                <p className="text-slate-400 mt-0.5">{t.description}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status?.bridgeReachable && status.hasToken && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5">
          <h2 className="text-sm font-semibold text-slate-300 mb-3">도구 실행 (테스트)</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">도구 이름 (name)</label>
              <input
                value={execName}
                onChange={(e) => setExecName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="예: Read"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">인자 JSON (arguments)</label>
              <textarea
                value={execArgs}
                onChange={(e) => setExecArgs(e.target.value)}
                rows={4}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm font-mono"
                placeholder="{}"
              />
            </div>
            <button
              type="button"
              disabled={execBusy || !execName.trim()}
              onClick={() => runExecute()}
              className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-medium"
            >
              {execBusy ? '실행 중…' : '실행'}
            </button>
            {execOut && (
              <pre className="text-xs bg-slate-950 border border-slate-700 rounded-lg p-3 overflow-x-auto text-slate-300 whitespace-pre-wrap">
                {execOut}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
