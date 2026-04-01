'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Stats = {
  pending_count: number;
  log_total: number;
  last_log_at: string | null;
  last_7d: { match: number; mismatch: number; errors: number };
};

type LogRow = Record<string, unknown> & {
  _id: string;
  generated_question_id: string;
  textbook?: string;
  source?: string;
  type?: string;
  is_correct?: boolean | null;
  error?: string | null;
  claude_answer?: string;
  correct_answer?: string;
  claude_response?: string;
  model?: string;
  admin_login_id?: string | null;
  created_at?: string | null;
  question_preview?: string;
};

export default function ReviewLogsPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [items, setItems] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filterTextbook, setFilterTextbook] = useState('');
  const [filterMismatch, setFilterMismatch] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const loadStats = useCallback(() => {
    fetch('/api/admin/generated-questions/review-logs/stats', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (typeof d.pending_count !== 'number') {
          if (d.error) router.replace('/admin/login?from=/admin/generated-questions/review-logs');
          return;
        }
        setStats(d as Stats);
      })
      .catch(() => {});
  }, [router]);

  const loadLogs = useCallback(() => {
    setLoading(true);
    setErr(null);
    const sp = new URLSearchParams();
    sp.set('page', String(page));
    sp.set('limit', String(limit));
    if (filterTextbook.trim()) sp.set('textbook', filterTextbook.trim());
    if (filterMismatch) sp.set('mismatch_only', '1');
    fetch(`/api/admin/generated-questions/review-logs?${sp}`, { credentials: 'include' })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) {
          if (r.status === 401) router.replace('/admin/login?from=/admin/generated-questions/review-logs');
          setErr(d.error || '조회 실패');
          return;
        }
        setItems((d.items || []) as LogRow[]);
        setTotal(d.total ?? 0);
      })
      .catch(() => setErr('네트워크 오류'))
      .finally(() => setLoading(false));
  }, [page, limit, filterTextbook, filterMismatch, router]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 w-full px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-xl font-bold text-white">Claude Code 검수 로그</h1>
          <p className="text-slate-400 text-sm mt-1">
            이 화면은 <strong className="text-slate-300">로그·통계 조회</strong>만 합니다. 검수는{' '}
            <strong className="text-slate-300">Claude Code</strong>가 문항을 풀고, MCP는{' '}
            <strong className="text-slate-300">MongoDB만</strong> 사용합니다(목록 조회·결과 기록). 별도 Anthropic API
            키로 검수를 돌리지 않습니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/generated-questions"
            className="text-sm px-3 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800"
          >
            ← 변형문제 관리
          </Link>
          <Link href="/admin" className="text-sm px-3 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800">
            관리자 홈
          </Link>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
            <p className="text-xs text-slate-500 uppercase">대기 문항</p>
            <p className="text-2xl font-bold text-amber-300">{stats.pending_count}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
            <p className="text-xs text-slate-500 uppercase">누적 로그</p>
            <p className="text-2xl font-bold text-white">{stats.log_total}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
            <p className="text-xs text-slate-500 uppercase">7일 일치</p>
            <p className="text-2xl font-bold text-emerald-400">{stats.last_7d.match}</p>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
            <p className="text-xs text-slate-500 uppercase">7일 불일치·오류</p>
            <p className="text-2xl font-bold text-rose-400">
              {stats.last_7d.mismatch + stats.last_7d.errors}
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-violet-800/40 bg-violet-950/20 p-5 mb-6 space-y-3 text-sm text-slate-300">
        <h2 className="text-sm font-semibold text-violet-200 uppercase tracking-wide">검수 실행 (Claude Code 전용)</h2>
        <ol className="list-decimal list-inside space-y-2 text-slate-400">
          <li>
            MCP 등록:{' '}
            <code className="text-slate-300 bg-slate-900/80 px-1 rounded">
              claude mcp add next-order-variant --scope project -- npm run mcp:variant
            </code>
          </li>
          <li>
            <code className="text-slate-300">variant_review_pending_list</code> — 대기 문항 목록(정답 미포함). 인자{' '}
            <code className="text-slate-500">limit</code>, <code className="text-slate-500">textbook</code>(선택).
          </li>
          <li>
            Claude Code가 각 항목을 풀이한 뒤{' '}
            <code className="text-slate-300">variant_review_pending_record</code>로 기록 —{' '}
            <code className="text-slate-500">generated_question_id</code>,{' '}
            <code className="text-slate-500">claude_answer</code>, <code className="text-slate-500">claude_response</code>
            (선택 <code className="text-slate-500">error</code>·<code className="text-slate-500">model</code>). 서버가 DB
            정답과 비교해 일치 여부를 저장합니다.
          </li>
          <li>
            스케줄러에는 위 2–3단계를 반복하도록 연결합니다. 검수 MCP만 쓸 때는{' '}
            <code className="text-slate-500">MONGODB_URI</code>만 있으면 됩니다(초안 생성 등 다른 도구는{' '}
            <code className="text-slate-500">ANTHROPIC_API_KEY</code> 필요).
          </li>
        </ol>
        <p className="text-xs text-slate-500 border-t border-violet-900/40 pt-3">
          웹 <code className="text-slate-400">POST …/review-run</code> 은 사용하지 않습니다.
        </p>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">로그 교재 필터</label>
          <input
            value={filterTextbook}
            onChange={(e) => {
              setFilterTextbook(e.target.value);
              setPage(1);
            }}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm w-48"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={filterMismatch}
            onChange={(e) => {
              setFilterMismatch(e.target.checked);
              setPage(1);
            }}
          />
          불일치만 (is_correct=false)
        </label>
        <button
          type="button"
          onClick={() => loadLogs()}
          className="text-sm px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600"
        >
          새로고침
        </button>
      </div>

      {err && <p className="text-rose-400 text-sm mb-4">{err}</p>}

      {loading ? (
        <p className="text-slate-500">불러오는 중…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/80 text-left text-xs text-slate-400 uppercase">
                <th className="p-3 w-28">시각</th>
                <th className="p-3">교재·출처·유형</th>
                <th className="p-3 w-24">일치</th>
                <th className="p-3 w-32">문항 ID</th>
                <th className="p-3 w-24">상세</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const id = row._id;
                const open = expanded.has(id);
                return (
                  <Fragment key={id}>
                    <tr className="border-b border-slate-700/80 hover:bg-slate-800/30">
                      <td className="p-3 text-slate-400 whitespace-nowrap text-xs">
                        {row.created_at
                          ? new Date(String(row.created_at)).toLocaleString('ko-KR')
                          : '—'}
                      </td>
                      <td className="p-3">
                        <div className="text-slate-200 font-medium">{row.textbook || '—'}</div>
                        <div className="text-xs text-slate-500">
                          {row.source} · <span className="text-violet-300">{row.type}</span>
                          {row.admin_login_id ? ` · ${row.admin_login_id}` : ''}
                        </div>
                        {row.question_preview && (
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2">{row.question_preview}</p>
                        )}
                      </td>
                      <td className="p-3">
                        {row.error ? (
                          <span className="text-rose-400 text-xs">오류</span>
                        ) : row.is_correct === true ? (
                          <span className="text-emerald-400 font-semibold">일치</span>
                        ) : row.is_correct === false ? (
                          <span className="text-rose-400 font-semibold">불일치</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="p-3 font-mono text-xs">
                        <Link
                          href={`/admin/generated-questions?openId=${encodeURIComponent(row.generated_question_id)}`}
                          className="text-teal-400 hover:underline break-all"
                        >
                          {row.generated_question_id?.slice(0, 8)}…
                        </Link>
                      </td>
                      <td className="p-3">
                        <button
                          type="button"
                          onClick={() => toggleExpand(id)}
                          className="text-teal-400 text-xs hover:underline"
                        >
                          {open ? '접기' : '펼치기'}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-950/50">
                        <td colSpan={5} className="p-4 text-xs space-y-3">
                          {row.error && (
                            <div className="text-rose-300">
                              <strong>오류:</strong> {row.error}
                            </div>
                          )}
                          <div className="grid sm:grid-cols-2 gap-3">
                            <div>
                              <p className="text-slate-500 mb-1">저장된 정답</p>
                              <p className="text-amber-200 font-mono">{row.correct_answer || '—'}</p>
                            </div>
                            <div>
                              <p className="text-slate-500 mb-1">Claude 답</p>
                              <p className="text-emerald-200 font-mono">{row.claude_answer || '—'}</p>
                            </div>
                          </div>
                          <div>
                            <p className="text-slate-500 mb-1">모델</p>
                            <p className="text-slate-300">{row.model || '—'}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 mb-1">Claude 풀이 전문</p>
                            <pre className="whitespace-pre-wrap text-slate-300 bg-slate-900 border border-slate-700 rounded-lg p-3 max-h-64 overflow-y-auto">
                              {row.claude_response || '—'}
                            </pre>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {items.length === 0 && <p className="p-6 text-center text-slate-500">로그가 없습니다.</p>}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="px-3 py-1 rounded-lg border border-slate-600 disabled:opacity-40"
          >
            이전
          </button>
          <span className="text-sm text-slate-400 py-1">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 py-1 rounded-lg border border-slate-600 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}
