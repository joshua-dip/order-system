'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BOOK_VARIANT_QUESTION_TYPES } from '@/lib/book-variant-types';
import { MEMBER_ESSAY_QUESTION_TYPES } from '@/lib/member-essay-draft-claude';
import QuestionFriendlyPreview from '@/app/my/premium/variant-generate/QuestionFriendlyPreview';
import EssayQuestionPreview from '@/app/my/premium/variant-generate/EssayQuestionPreview';


type LogRow = {
  _id: string;
  created_at?: string;
  type?: string;
  difficulty?: string;
  match_status?: 'matched' | 'unknown';
  passage_id?: string;
  textbook?: string;
  chapter?: string;
  number?: string;
  source?: string;
  source_key?: string;
  input_paragraph?: string;
  question_data?: Record<string, unknown>;
  ip_hash?: string;
  user_agent?: string;
  api_key_hint?: string;
  tags?: string[];
  note?: string;
  archived?: boolean;
  promoted_to?: string;
  is_shortage_candidate?: boolean;
  paragraph_hash?: string;
};

type Stats = {
  total: number;
  matched: number;
  unknown: number;
  last_7d: number;
  unique_ip: number;
  by_type: { type: string; count: number }[];
  top_textbooks: { textbook: string; count: number }[];
};

type BlocklistRow = {
  _id: string;
  kind: 'ip_hash' | 'api_key_hint';
  value: string;
  reason?: string;
  created_at: string;
  created_by?: string;
};

const TAG_PRESETS = ['좋음', '수정필요', '중복', '저작권의심', '품질낮음'];

export default function GuestVariantLogsPage() {
  const router = useRouter();
  const [items, setItems] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Stats | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  /** 필터 */
  const [matchStatus, setMatchStatus] = useState<'all' | 'matched' | 'unknown'>('all');
  const [typeFilter, setTypeFilter] = useState('');
  const [textbookFilter, setTextbookFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [ipHashFilter, setIpHashFilter] = useState('');
  const [needsShortage, setNeedsShortage] = useState(false);
  const [archivedView, setArchivedView] = useState<'active' | 'archived' | 'all'>('active');
  const [promotedView, setPromotedView] = useState<'all' | 'not_yet' | 'promoted'>('all');

  /** 선택 */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  /** 모달 상태 */
  const [promoteTarget, setPromoteTarget] = useState<LogRow | null>(null);
  const [registerTarget, setRegisterTarget] = useState<LogRow | null>(null);
  const [showBlocklist, setShowBlocklist] = useState(false);
  const [blocklist, setBlocklist] = useState<BlocklistRow[]>([]);
  const [blockNew, setBlockNew] = useState<{ kind: 'ip_hash' | 'api_key_hint'; value: string; reason: string }>({
    kind: 'ip_hash',
    value: '',
    reason: '',
  });

  const flash = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    // 간단한 alert 대체 — 브라우저 alert 사용 (관리자용)
    if (kind === 'err') setErr(msg);
    else window.alert(msg);
  }, []);

  const loadList = useCallback(() => {
    setLoading(true);
    setErr(null);
    const sp = new URLSearchParams();
    sp.set('page', String(page));
    sp.set('limit', String(limit));
    if (matchStatus !== 'all') sp.set('match_status', matchStatus);
    if (typeFilter) sp.set('type', typeFilter);
    if (textbookFilter.trim()) sp.set('textbook', textbookFilter.trim());
    if (tagFilter.trim()) sp.set('tag', tagFilter.trim());
    if (q.trim()) sp.set('q', q.trim());
    if (from) sp.set('from', from);
    if (to) sp.set('to', to);
    if (ipHashFilter.trim()) sp.set('ip_hash', ipHashFilter.trim());
    if (needsShortage) sp.set('needs_shortage', '1');
    if (archivedView === 'archived') sp.set('archived', '1');
    else if (archivedView === 'active') sp.set('archived', '0');
    if (promotedView === 'not_yet') sp.set('promoted', '0');
    else if (promotedView === 'promoted') sp.set('promoted', '1');

    fetch(`/api/admin/guest-variant-logs?${sp}`, { credentials: 'include' })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) {
          if (r.status === 401) {
            router.replace('/admin/login?from=/admin/guest-variant-logs');
            return;
          }
          setErr(d.error || '조회 실패');
          return;
        }
        setItems((d.items || []) as LogRow[]);
        setTotal(d.total ?? 0);
        setStats(d.stats ?? null);
      })
      .catch(() => setErr('네트워크 오류'))
      .finally(() => setLoading(false));
  }, [
    page,
    limit,
    matchStatus,
    typeFilter,
    textbookFilter,
    tagFilter,
    q,
    from,
    to,
    ipHashFilter,
    needsShortage,
    archivedView,
    promotedView,
    router,
  ]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const loadBlocklist = useCallback(async () => {
    const r = await fetch('/api/admin/guest-variant-blocklist', { credentials: 'include' });
    const d = await r.json();
    if (r.ok) setBlocklist((d.items || []) as BlocklistRow[]);
  }, []);

  useEffect(() => {
    if (showBlocklist) void loadBlocklist();
  }, [showBlocklist, loadBlocklist]);

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const allSelected = items.length > 0 && items.every((i) => selected.has(i._id));
  const someSelected = selected.size > 0;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => {
      if (items.every((i) => prev.has(i._id))) {
        const next = new Set(prev);
        items.forEach((i) => next.delete(i._id));
        return next;
      }
      const next = new Set(prev);
      items.forEach((i) => next.add(i._id));
      return next;
    });
  };
  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteOne = async (id: string) => {
    if (!window.confirm('이 로그를 삭제할까요?')) return;
    const r = await fetch(`/api/admin/guest-variant-logs/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const d = await r.json();
    if (!r.ok) return flash(d.error || '삭제 실패', 'err');
    loadList();
  };

  const runBulk = async (action: string, extra?: Record<string, unknown>) => {
    if (selected.size === 0) return;
    const ids = Array.from(selected);
    if (action === 'delete' && !window.confirm(`${ids.length}건을 삭제합니다. 계속?`)) return;
    if (action === 'promote' && !window.confirm(`${ids.length}건을 승격 시도합니다. 계속?`)) return;

    const r = await fetch('/api/admin/guest-variant-logs/bulk', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ids, ...extra }),
    });
    const d = await r.json();
    if (!r.ok) return flash(d.error || '실패', 'err');
    let msg = `${action} 처리: 성공 ${d.affected ?? 0}건`;
    if (typeof d.failed === 'number') msg += `, 실패 ${d.failed}건`;
    window.alert(msg);
    setSelected(new Set());
    loadList();
  };

  const addOldCleanup = async () => {
    const days = window.prompt('며칠 이전 로그를 삭제할까요?', '30');
    if (!days) return;
    const r = await fetch(`/api/admin/guest-variant-logs?older_than=${encodeURIComponent(days + 'd')}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    const d = await r.json();
    if (!r.ok) return flash(d.error || '실패', 'err');
    window.alert(`${d.deleted ?? 0}건 삭제됨`);
    loadList();
  };

  const exportSelected = async () => {
    const ids = Array.from(selected);
    const body = ids.length > 0 ? { ids } : {};
    const r = await fetch('/api/admin/guest-variant-logs/export', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      flash(d.error || '내보내기 실패', 'err');
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `guest-variant-logs-${new Date().toISOString().slice(0, 10)}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const blockIp = async (ipHash: string) => {
    if (!ipHash) return;
    const reason = window.prompt(`IP 해시 ${ipHash} 를 차단합니다. 사유 (선택):`, '');
    if (reason === null) return;
    const r = await fetch('/api/admin/guest-variant-blocklist', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'ip_hash', value: ipHash, reason }),
    });
    const d = await r.json();
    if (!r.ok) return flash(d.error || '실패', 'err');
    window.alert('차단 등록됨');
  };
  const blockApiKey = async (hint: string) => {
    if (!hint) return;
    const reason = window.prompt(`API 키 힌트 ${hint} 를 차단합니다. 사유 (선택):`, '');
    if (reason === null) return;
    const r = await fetch('/api/admin/guest-variant-blocklist', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'api_key_hint', value: hint, reason }),
    });
    const d = await r.json();
    if (!r.ok) return flash(d.error || '실패', 'err');
    window.alert('차단 등록됨');
  };

  const matchRate = useMemo(() => {
    if (!stats || stats.total === 0) return 0;
    return Math.round((stats.matched / stats.total) * 1000) / 10;
  }, [stats]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 w-full px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">비회원 변형 로그</h1>
          <p className="text-slate-400 text-sm mt-1">
            <code className="text-slate-300">/variant</code> 에서 비회원이 자신의 Claude API 키로 생성한 변형문제
            로그입니다. 지문 지문(fingerprint) 으로 <code className="text-slate-300">passages</code> 와 자동 매칭해
            저장됩니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowBlocklist((v) => !v)}
            className="text-sm px-3 py-2 rounded-lg border border-rose-700 text-rose-200 hover:bg-rose-950/40"
          >
            차단 목록
          </button>
          <button
            type="button"
            onClick={addOldCleanup}
            className="text-sm px-3 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800"
          >
            30일 이전 정리
          </button>
          <Link
            href="/admin"
            className="text-sm px-3 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800"
          >
            관리자 홈
          </Link>
        </div>
      </div>

      {/* 요약 카드 */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
          <StatCard label="누적" value={stats.total} tone="slate" />
          <StatCard label="매칭" value={stats.matched} tone="emerald" sub={`${matchRate}%`} />
          <StatCard label="미매칭" value={stats.unknown} tone="amber" />
          <StatCard label="7일" value={stats.last_7d} tone="violet" />
          <StatCard label="고유 IP" value={stats.unique_ip} tone="sky" />
        </div>
      )}

      {/* TOP 교재 · 유형 */}
      {stats && (stats.top_textbooks.length > 0 || stats.by_type.length > 0) && (
        <div className="grid sm:grid-cols-2 gap-3 mb-5">
          <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">TOP 교재</p>
            <ul className="space-y-1 text-sm">
              {stats.top_textbooks.slice(0, 6).map((r) => (
                <li key={r.textbook} className="flex justify-between text-slate-300">
                  <button
                    type="button"
                    onClick={() => {
                      setTextbookFilter(r.textbook);
                      setPage(1);
                    }}
                    className="truncate pr-2 text-left hover:text-white hover:underline"
                  >
                    {r.textbook || '—'}
                  </button>
                  <span className="text-slate-500 font-mono">{r.count}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">유형별</p>
            <ul className="grid grid-cols-2 gap-y-1 text-sm">
              {stats.by_type.slice(0, 10).map((r) => (
                <li key={r.type} className="flex justify-between text-slate-300">
                  <button
                    type="button"
                    onClick={() => {
                      setTypeFilter(r.type);
                      setPage(1);
                    }}
                    className="hover:text-white hover:underline"
                  >
                    {r.type || '—'}
                  </button>
                  <span className="text-slate-500 font-mono">{r.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 필터 */}
      <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">상태</label>
          <div className="inline-flex rounded-lg border border-slate-600 overflow-hidden text-xs">
            {(['all', 'matched', 'unknown'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setMatchStatus(v);
                  setPage(1);
                }}
                className={`px-3 py-2 ${matchStatus === v ? 'bg-violet-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}
              >
                {v === 'all' ? '전체' : v === 'matched' ? '매칭' : '미매칭'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">유형</label>
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">전체</option>
            <optgroup label="객관식">
              {BOOK_VARIANT_QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </optgroup>
            <optgroup label="서술형">
              {MEMBER_ESSAY_QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">교재</label>
          <input
            value={textbookFilter}
            onChange={(e) => {
              setTextbookFilter(e.target.value);
              setPage(1);
            }}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm w-56"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">태그</label>
          <input
            value={tagFilter}
            onChange={(e) => {
              setTagFilter(e.target.value);
              setPage(1);
            }}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm w-28"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">지문 키워드</label>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setPage(1);
            }}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm w-44"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">IP 해시</label>
          <input
            value={ipHashFilter}
            onChange={(e) => {
              setIpHashFilter(e.target.value);
              setPage(1);
            }}
            className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm w-36 font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <div>
            <label className="block text-xs text-slate-500 mb-1">시작일</label>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">종료일</label>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm text-emerald-300 cursor-pointer">
            <input
              type="checkbox"
              checked={needsShortage}
              onChange={(e) => {
                setNeedsShortage(e.target.checked);
                setPage(1);
              }}
            />
            부족분만 (승격 시 신규 투입)
          </label>
          <div className="flex items-center gap-2">
            <label className="text-xs text-slate-500">아카이브</label>
            <select
              value={archivedView}
              onChange={(e) => {
                setArchivedView(e.target.value as 'active' | 'archived' | 'all');
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-xs"
            >
              <option value="active">제외</option>
              <option value="archived">아카이브만</option>
              <option value="all">전체</option>
            </select>
            <label className="text-xs text-slate-500">승격</label>
            <select
              value={promotedView}
              onChange={(e) => {
                setPromotedView(e.target.value as 'all' | 'not_yet' | 'promoted');
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-xs"
            >
              <option value="all">전체</option>
              <option value="not_yet">미승격</option>
              <option value="promoted">승격됨</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setPage(1);
            loadList();
          }}
          className="text-sm px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600"
        >
          새로고침
        </button>
      </div>

      {/* Bulk toolbar */}
      {someSelected && (
        <div className="rounded-xl border border-violet-700/60 bg-violet-950/30 p-3 mb-3 flex flex-wrap gap-2 items-center">
          <span className="text-sm text-violet-200 font-semibold">선택 {selected.size}건</span>
          <button type="button" onClick={() => runBulk('promote')} className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500">
            일괄 승격
          </button>
          <button
            type="button"
            onClick={() => {
              const tag = window.prompt('추가할 태그:');
              if (tag) runBulk('addTag', { tag });
            }}
            className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500"
          >
            태그 추가
          </button>
          <button type="button" onClick={() => runBulk('archive')} className="text-xs px-3 py-1.5 rounded-lg bg-slate-600 hover:bg-slate-500">
            아카이브
          </button>
          <button type="button" onClick={() => runBulk('unarchive')} className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600">
            아카이브 해제
          </button>
          <button type="button" onClick={exportSelected} className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500">
            Excel 내보내기
          </button>
          <button type="button" onClick={() => runBulk('delete')} className="text-xs px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600">
            삭제
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-slate-400 hover:text-white ml-2"
          >
            선택 해제
          </button>
        </div>
      )}
      {!someSelected && (
        <div className="flex justify-end mb-3">
          <button
            type="button"
            onClick={exportSelected}
            className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800"
          >
            현재 필터 Excel 내보내기
          </button>
        </div>
      )}

      {err && <p className="text-rose-400 text-sm mb-4">{err}</p>}

      {loading ? (
        <p className="text-slate-500">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-slate-500 text-sm">표시할 로그가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-slate-800/80 text-left text-xs text-slate-400 uppercase">
                <th className="p-3 w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                </th>
                <th className="p-3 w-28">시각</th>
                <th className="p-3 w-20">상태</th>
                <th className="p-3">교재·출처</th>
                <th className="p-3 w-20">유형</th>
                <th className="p-3">지문 프리뷰</th>
                <th className="p-3 w-40">태그·메타</th>
                <th className="p-3 w-44">액션</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const open = expanded.has(row._id);
                const paragraph = row.input_paragraph || '';
                const isMatched = row.match_status === 'matched';
                const promoted = !!row.promoted_to;
                return (
                  <Fragment key={row._id}>
                    <tr
                      className={`border-b border-slate-700/80 hover:bg-slate-800/30 ${row.is_shortage_candidate ? 'bg-emerald-950/20' : ''} ${row.archived ? 'opacity-60' : ''}`}
                    >
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selected.has(row._id)}
                          onChange={() => toggleOne(row._id)}
                        />
                      </td>
                      <td className="p-3 text-slate-400 whitespace-nowrap text-xs">
                        {row.created_at ? new Date(row.created_at).toLocaleString('ko-KR') : '—'}
                      </td>
                      <td className="p-3">
                        {isMatched ? (
                          <span className="inline-block rounded-full bg-emerald-700/50 text-emerald-100 text-xs px-2 py-0.5 font-semibold">
                            매칭
                          </span>
                        ) : (
                          <span className="inline-block rounded-full bg-amber-700/50 text-amber-100 text-xs px-2 py-0.5 font-semibold">
                            미매칭
                          </span>
                        )}
                        {promoted && (
                          <div className="mt-1 text-[10px] text-teal-300 font-semibold">✓ 승격됨</div>
                        )}
                        {row.is_shortage_candidate && (
                          <div className="mt-1 text-[10px] text-emerald-300 font-semibold">부족분 후보</div>
                        )}
                        {row.archived && (
                          <div className="mt-1 text-[10px] text-slate-500">아카이브</div>
                        )}
                      </td>
                      <td className="p-3 text-xs">
                        <div className="text-slate-200 font-medium truncate max-w-[18rem]">
                          {row.textbook || '—'}
                        </div>
                        <div className="text-slate-500">
                          {row.chapter ? `${row.chapter} ` : ''}
                          {row.number || ''}
                          {row.source ? ` · ${row.source}` : ''}
                        </div>
                      </td>
                      <td className="p-3 text-xs">
                        <div className="text-violet-300 font-semibold">{row.type || '—'}</div>
                        <div className="text-slate-500">{row.difficulty || ''}</div>
                      </td>
                      <td className="p-3 text-xs text-slate-400 max-w-[28rem]">
                        <p className="line-clamp-2">{paragraph.slice(0, 240)}</p>
                      </td>
                      <td className="p-3 text-[11px]">
                        {row.tags && row.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1">
                            {row.tags.map((t) => (
                              <span
                                key={t}
                                className="rounded bg-slate-700/70 text-slate-200 px-1.5 py-0.5"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        {row.ip_hash && (
                          <div className="text-slate-500 font-mono">ip:{row.ip_hash.slice(0, 10)}</div>
                        )}
                        {row.api_key_hint && (
                          <div className="text-slate-500 font-mono truncate">key:{row.api_key_hint}</div>
                        )}
                      </td>
                      <td className="p-3 text-xs space-y-1">
                        <div className="flex gap-1 flex-wrap">
                          <button
                            type="button"
                            onClick={() => toggleExpand(row._id)}
                            className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600"
                          >
                            {open ? '접기' : '펼치기'}
                          </button>
                          {isMatched && !promoted ? (
                            <button
                              type="button"
                              onClick={() => setPromoteTarget(row)}
                              className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 font-semibold"
                            >
                              승격
                            </button>
                          ) : null}
                          {!isMatched && (
                            <button
                              type="button"
                              onClick={() => setRegisterTarget(row)}
                              className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 font-semibold"
                            >
                              지문 등록
                            </button>
                          )}
                        </div>
                        <div className="flex gap-1 flex-wrap">
                          {row.ip_hash && (
                            <button
                              type="button"
                              onClick={() => blockIp(row.ip_hash!)}
                              className="px-2 py-1 rounded border border-rose-700/60 text-rose-300 hover:bg-rose-950/40"
                            >
                              IP차단
                            </button>
                          )}
                          {row.api_key_hint && (
                            <button
                              type="button"
                              onClick={() => blockApiKey(row.api_key_hint!)}
                              className="px-2 py-1 rounded border border-rose-700/60 text-rose-300 hover:bg-rose-950/40"
                            >
                              키차단
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => deleteOne(row._id)}
                            className="px-2 py-1 rounded border border-slate-600 text-slate-400 hover:bg-slate-800"
                          >
                            삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-slate-950/50">
                        <td colSpan={8} className="p-4">
                          <ExpandedLog
                            row={row}
                            onTagsNoteChange={(patch) => {
                              setItems((prev) =>
                                prev.map((r) => (r._id === row._id ? { ...r, ...patch } : r)),
                              );
                            }}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex justify-center gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-lg border border-slate-700 disabled:opacity-40"
          >
            이전
          </button>
          <span className="px-3 py-1.5 text-slate-400">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 rounded-lg border border-slate-700 disabled:opacity-40"
          >
            다음
          </button>
        </div>
      )}

      {/* Promote Modal */}
      {promoteTarget && (
        <PromoteModal
          row={promoteTarget}
          onClose={() => setPromoteTarget(null)}
          onDone={(gqId) => {
            setItems((prev) =>
              prev.map((r) => (r._id === promoteTarget._id ? { ...r, promoted_to: gqId } : r)),
            );
            setPromoteTarget(null);
          }}
        />
      )}

      {/* Register Passage Modal */}
      {registerTarget && (
        <RegisterPassageModal
          row={registerTarget}
          onClose={() => setRegisterTarget(null)}
          onDone={() => {
            setRegisterTarget(null);
            loadList();
          }}
        />
      )}

      {/* Blocklist Panel */}
      {showBlocklist && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-auto">
            <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">남용 차단 목록</h2>
              <button
                type="button"
                onClick={() => setShowBlocklist(false)}
                className="text-slate-400 hover:text-white"
              >
                닫기
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="rounded-lg border border-slate-700 p-3 space-y-2">
                <p className="text-xs text-slate-400">새 차단 추가</p>
                <div className="flex gap-2 flex-wrap">
                  <select
                    value={blockNew.kind}
                    onChange={(e) =>
                      setBlockNew((b) => ({ ...b, kind: e.target.value as 'ip_hash' | 'api_key_hint' }))
                    }
                    className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm"
                  >
                    <option value="ip_hash">IP 해시</option>
                    <option value="api_key_hint">API 키 힌트</option>
                  </select>
                  <input
                    value={blockNew.value}
                    onChange={(e) => setBlockNew((b) => ({ ...b, value: e.target.value }))}
                    placeholder="값"
                    className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm font-mono flex-1 min-w-[12rem]"
                  />
                  <input
                    value={blockNew.reason}
                    onChange={(e) => setBlockNew((b) => ({ ...b, reason: e.target.value }))}
                    placeholder="사유 (선택)"
                    className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1.5 text-sm flex-1 min-w-[10rem]"
                  />
                  <button
                    type="button"
                    onClick={async () => {
                      if (!blockNew.value.trim()) return;
                      const r = await fetch('/api/admin/guest-variant-blocklist', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(blockNew),
                      });
                      const d = await r.json();
                      if (!r.ok) return flash(d.error || '실패', 'err');
                      setBlockNew({ kind: blockNew.kind, value: '', reason: '' });
                      loadBlocklist();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-600 text-sm"
                  >
                    차단
                  </button>
                </div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-left text-xs text-slate-400 uppercase">
                    <th className="p-2">종류</th>
                    <th className="p-2">값</th>
                    <th className="p-2">사유</th>
                    <th className="p-2">등록</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {blocklist.map((r) => (
                    <tr key={r._id} className="border-b border-slate-800">
                      <td className="p-2 text-xs text-slate-300">{r.kind}</td>
                      <td className="p-2 text-xs font-mono text-slate-300 break-all">{r.value}</td>
                      <td className="p-2 text-xs text-slate-400">{r.reason || '—'}</td>
                      <td className="p-2 text-xs text-slate-500">
                        {new Date(r.created_at).toLocaleString('ko-KR')}
                      </td>
                      <td className="p-2 text-right">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!window.confirm('차단을 해제할까요?')) return;
                            const rs = await fetch(`/api/admin/guest-variant-blocklist/${r._id}`, {
                              method: 'DELETE',
                              credentials: 'include',
                            });
                            if (rs.ok) loadBlocklist();
                          }}
                          className="text-xs text-slate-400 hover:text-white"
                        >
                          해제
                        </button>
                      </td>
                    </tr>
                  ))}
                  {blocklist.length === 0 && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-slate-500 text-sm">
                        차단된 항목이 없습니다.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: number;
  tone: 'slate' | 'emerald' | 'amber' | 'violet' | 'sky';
  sub?: string;
}) {
  const toneClass = {
    slate: 'text-white',
    emerald: 'text-emerald-300',
    amber: 'text-amber-300',
    violet: 'text-violet-300',
    sky: 'text-sky-300',
  }[tone];
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-4">
      <p className="text-xs text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold ${toneClass}`}>{value.toLocaleString()}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function ExpandedLog({
  row,
  onTagsNoteChange,
}: {
  row: LogRow;
  onTagsNoteChange: (patch: Partial<LogRow>) => void;
}) {
  const [note, setNote] = useState(row.note || '');
  const [tagInput, setTagInput] = useState('');

  const saveTagsNote = async (nextTags: string[], nextNote: string) => {
    const r = await fetch(`/api/admin/guest-variant-logs/${row._id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: nextTags, note: nextNote }),
    });
    const d = await r.json();
    if (!r.ok) {
      window.alert(d.error || '저장 실패');
      return;
    }
    onTagsNoteChange({
      tags: (d.item?.tags as string[]) ?? nextTags,
      note: (d.item?.note as string) ?? nextNote,
    });
  };

  const addTag = async (t: string) => {
    const tag = t.trim();
    if (!tag) return;
    const next = Array.from(new Set([...(row.tags || []), tag]));
    await saveTagsNote(next, note);
    setTagInput('');
  };
  const removeTag = async (t: string) => {
    const next = (row.tags || []).filter((x) => x !== t);
    await saveTagsNote(next, note);
  };

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-3">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">입력 지문 (원문)</p>
          <div className="rounded border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200 max-h-60 overflow-auto whitespace-pre-wrap">
            {row.input_paragraph || '—'}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-2 text-xs">
          <Meta label="IP 해시" value={row.ip_hash || '—'} mono />
          <Meta label="API 키 힌트" value={row.api_key_hint || '—'} mono />
          <Meta label="User-Agent" value={row.user_agent || '—'} />
          <Meta label="paragraph_hash" value={row.paragraph_hash || '—'} mono />
          {row.passage_id && <Meta label="passage_id" value={row.passage_id} mono />}
          {row.promoted_to && <Meta label="promoted → generated_questions" value={row.promoted_to} mono />}
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">태그</p>
          <div className="flex flex-wrap gap-1 mb-1">
            {(row.tags || []).map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded bg-slate-700/70 text-slate-200 text-xs px-1.5 py-0.5">
                {t}
                <button type="button" onClick={() => removeTag(t)} className="text-slate-400 hover:text-rose-300">
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1 flex-wrap items-center">
            {TAG_PRESETS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => addTag(t)}
                className="text-[11px] px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700"
              >
                + {t}
              </button>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addTag(tagInput);
              }}
              placeholder="새 태그"
              className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs"
            />
          </div>
        </div>
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">메모</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => saveTagsNote(row.tags || [], note)}
            rows={3}
            className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-sm text-slate-200"
          />
        </div>
      </div>
      <div>
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">생성된 변형문제</p>
        <div className="rounded border border-slate-700 bg-slate-900 p-3 max-h-[32rem] overflow-auto">
          {row.question_data ? (
            (MEMBER_ESSAY_QUESTION_TYPES as readonly string[]).includes(row.type ?? '') ? (
              <EssayQuestionPreview
                data={row.question_data}
                editable={false}
                questionType={row.type}
              />
            ) : (
              <QuestionFriendlyPreview data={row.question_data} editable={false} />
            )
          ) : (
            <p className="text-slate-500 text-sm">—</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded border border-slate-700/60 bg-slate-900/60 p-2">
      <p className="text-[10px] text-slate-500 uppercase">{label}</p>
      <p className={`text-slate-300 ${mono ? 'font-mono text-xs' : 'text-xs'} truncate`}>{value}</p>
    </div>
  );
}

function PromoteModal({
  row,
  onClose,
  onDone,
}: {
  row: LogRow;
  onClose: () => void;
  onDone: (gqId: string) => void;
}) {
  const [qd, setQd] = useState<Record<string, unknown>>(row.question_data || {});
  const [status, setStatus] = useState<'대기' | '완료'>('대기');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const edited = useMemo(() => JSON.stringify(qd) !== JSON.stringify(row.question_data || {}), [qd, row.question_data]);

  const submit = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/guest-variant-logs/${row._id}/promote`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          question_data: edited ? qd : undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.error || '승격 실패');
        return;
      }
      onDone(d.generated_question_id);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">
              승격 — <span className="text-violet-300">{row.type}</span>
            </h2>
            <p className="text-xs text-slate-400">
              {row.textbook} · {row.chapter} {row.number}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            닫기
          </button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-xs text-slate-400">
            아래 내용을 수정 후 승격할 수 있습니다. 승격 시{' '}
            <code className="text-slate-300">generated_questions</code> 컬렉션에{' '}
            <strong className="text-slate-200">{status}</strong> 상태로 등록됩니다.
          </p>
          <div className="flex items-center gap-3 text-sm">
            <label className="text-slate-400">초기 상태</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as '대기' | '완료')}
              className="bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-sm"
            >
              <option value="대기">대기 (검수 필요)</option>
              <option value="완료">완료 (이미 검수됨)</option>
            </select>
            {edited && (
              <span className="text-amber-300 text-xs font-semibold">(편집됨)</span>
            )}
          </div>
          <div className="rounded border border-slate-700 bg-slate-950 p-3">
            {(MEMBER_ESSAY_QUESTION_TYPES as readonly string[]).includes(row.type ?? '') ? (
              <EssayQuestionPreview
                data={qd}
                editable={true}
                onDataChange={setQd}
                questionType={row.type}
              />
            ) : (
              <QuestionFriendlyPreview data={qd} editable={true} onDataChange={setQd} />
            )}
          </div>
          {err && <p className="text-rose-400 text-sm">{err}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              취소
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-semibold disabled:opacity-50"
            >
              {saving ? '승격 중…' : '승격 실행'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RegisterPassageModal({
  row,
  onClose,
  onDone,
}: {
  row: LogRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    textbook: '',
    chapter: '',
    number: '',
    source_key: '',
    publisher: '',
    page: '',
    page_label: '',
    also_promote: true,
    promote_status: '대기' as '대기' | '완료',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!form.textbook.trim() || !form.chapter.trim() || !form.number.trim()) {
      setErr('교재명·강·번호는 필수');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const r = await fetch(`/api/admin/guest-variant-logs/${row._id}/register-passage`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          page: form.page || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setErr(d.error || '등록 실패');
        return;
      }
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">지문 등록 (passages 신규 삽입)</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">
            닫기
          </button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-400">
            이 지문을 <code className="text-slate-300">passages</code> 컬렉션에 새 문서로 추가합니다. 같은 본문을 가진
            다른 미매칭 로그도 자동으로 매칭 처리됩니다.
          </p>
          <div className="rounded border border-slate-700 bg-slate-950 p-3 max-h-40 overflow-auto text-xs text-slate-300 whitespace-pre-wrap">
            {row.input_paragraph}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="교재명 *" value={form.textbook} onChange={(v) => setForm((f) => ({ ...f, textbook: v }))} />
            <Field label="강 (chapter) *" value={form.chapter} onChange={(v) => setForm((f) => ({ ...f, chapter: v }))} />
            <Field label="번호 (number) *" value={form.number} onChange={(v) => setForm((f) => ({ ...f, number: v }))} />
            <Field
              label="source_key (선택)"
              value={form.source_key}
              onChange={(v) => setForm((f) => ({ ...f, source_key: v }))}
              placeholder="비우면 자동 생성"
            />
            <div>
              <label className="block text-xs text-slate-500 mb-1">출판사 (선택)</label>
              <select
                value={form.publisher}
                onChange={(e) => setForm((f) => ({ ...f, publisher: e.target.value }))}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                <option value="YBM">YBM</option>
                <option value="쎄듀">쎄듀</option>
                <option value="NE능률">NE능률</option>
              </select>
            </div>
            <Field label="page (선택)" value={form.page} onChange={(v) => setForm((f) => ({ ...f, page: v }))} />
            <Field label="page_label (선택)" value={form.page_label} onChange={(v) => setForm((f) => ({ ...f, page_label: v }))} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.also_promote}
              onChange={(e) => setForm((f) => ({ ...f, also_promote: e.target.checked }))}
            />
            등록 후 이 로그를 바로 승격
          </label>
          {err && <p className="text-rose-400 text-sm">{err}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              취소
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 font-semibold disabled:opacity-50"
            >
              {saving ? '등록 중…' : '지문 등록'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-sm"
      />
    </div>
  );
}
