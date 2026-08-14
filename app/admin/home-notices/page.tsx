'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../_components/AdminSidebar';
import type { HomeNoticeAudienceTarget } from '@/lib/home-notices';

interface NoticeRow {
  id: string;
  title: string;
  body: string;
  badge?: string;
  linkUrl?: string;
  linkLabel?: string;
  audience: HomeNoticeAudienceTarget;
  active: boolean;
  pinned: boolean;
  order: number;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt?: string;
}

type Draft = {
  title: string;
  body: string;
  badge: string;
  linkUrl: string;
  linkLabel: string;
  audience: HomeNoticeAudienceTarget;
  active: boolean;
  pinned: boolean;
  order: number;
  startsAt: string;
  endsAt: string;
};

const EMPTY: Draft = {
  title: '',
  body: '',
  badge: '',
  linkUrl: '',
  linkLabel: '',
  audience: 'all',
  active: true,
  pinned: false,
  order: 0,
  startsAt: '',
  endsAt: '',
};

const AUDIENCE_LABEL: Record<HomeNoticeAudienceTarget, string> = {
  all: '전체',
  guest: '비로그인만',
  member: '회원만',
};

/** ISO → <input type="datetime-local"> 값 */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AdminHomeNoticesPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [adminLoginId, setAdminLoginId] = useState('');
  const [items, setItems] = useState<NoticeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

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
    try {
      const r = await fetch('/api/admin/home-notices', { credentials: 'include' });
      const d = await r.json();
      if (d.ok) setItems(d.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  const flash = (t: string) => {
    setMsg(t);
    window.setTimeout(() => setMsg(''), 2500);
  };

  const startEdit = (row: NoticeRow) => {
    setEditingId(row.id);
    setDraft({
      title: row.title,
      body: row.body ?? '',
      badge: row.badge ?? '',
      linkUrl: row.linkUrl ?? '',
      linkLabel: row.linkLabel ?? '',
      audience: row.audience,
      active: row.active,
      pinned: row.pinned,
      order: row.order ?? 0,
      startsAt: toLocalInput(row.startsAt),
      endsAt: toLocalInput(row.endsAt),
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const save = async () => {
    if (!draft.title.trim()) {
      flash('한 줄 문구를 입력해 주세요.');
      return;
    }
    const url = editingId ? `/api/admin/home-notices/${editingId}` : '/api/admin/home-notices';
    const r = await fetch(url, {
      method: editingId ? 'PATCH' : 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const d = await r.json();
    if (!d.ok) {
      flash(d.error ?? '저장에 실패했습니다.');
      return;
    }
    flash(editingId ? '수정했습니다.' : '등록했습니다.');
    setEditingId(null);
    setDraft(EMPTY);
    void load();
  };

  const remove = async (row: NoticeRow) => {
    if (!window.confirm(`「${row.title}」 공지를 삭제할까요?`)) return;
    const r = await fetch(`/api/admin/home-notices/${row.id}`, { method: 'DELETE', credentials: 'include' });
    const d = await r.json();
    if (!d.ok) {
      flash(d.error ?? '삭제에 실패했습니다.');
      return;
    }
    flash('삭제했습니다.');
    if (editingId === row.id) {
      setEditingId(null);
      setDraft(EMPTY);
    }
    void load();
  };

  const toggle = async (row: NoticeRow, patch: Partial<Draft>) => {
    await fetch(`/api/admin/home-notices/${row.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: row.title,
        body: row.body,
        badge: row.badge,
        linkUrl: row.linkUrl,
        linkLabel: row.linkLabel,
        audience: row.audience,
        active: row.active,
        pinned: row.pinned,
        order: row.order,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        ...patch,
      }),
    });
    void load();
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <span className="text-sm text-slate-400">인증 확인 중…</span>
      </div>
    );
  }

  const field = 'w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500';

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      <AdminSidebar loginId={adminLoginId} />

      <main className="flex-1 p-6 overflow-y-auto min-w-0">
        <div className="mb-6 flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">📢 홈 공지</h1>
            <p className="text-sm text-slate-400 mt-1">
              홈 화면 맨 위에 한 줄로 나오고, 누르면 상세가 열립니다. 여러 개면 6초마다 돌아가며 표시돼요.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg border border-slate-600 text-sm text-slate-300 hover:bg-slate-700/60 disabled:opacity-50"
          >
            {loading ? '⏳' : '↻ 새로고침'}
          </button>
        </div>

        {msg && (
          <div className="mb-4 rounded-lg border border-emerald-700 bg-emerald-900/40 px-4 py-2 text-sm text-emerald-200">
            {msg}
          </div>
        )}

        {/* 작성 · 수정 */}
        <div className="mb-6 rounded-xl border border-slate-700 bg-slate-800 p-4">
          <h2 className="mb-3 text-sm font-bold text-white">
            {editingId ? '✏️ 공지 수정' : '➕ 새 공지 작성'}
          </h2>

          <div className="grid gap-3 sm:grid-cols-[7rem_1fr]">
            <input
              value={draft.badge}
              onChange={(e) => setDraft({ ...draft, badge: e.target.value })}
              placeholder="꼬리표"
              className={field}
            />
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="한 줄 문구 (홈 배너에 그대로 나옵니다)"
              className={field}
            />
          </div>

          <textarea
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            rows={6}
            placeholder="상세 본문 — 배너를 누르면 보이는 내용입니다. 줄바꿈은 그대로 유지됩니다."
            className={`${field} mt-3 resize-y leading-relaxed`}
          />

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={draft.linkUrl}
              onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
              placeholder="바로가기 링크 (선택) — /unified 또는 https://…"
              className={field}
            />
            <input
              value={draft.linkLabel}
              onChange={(e) => setDraft({ ...draft, linkLabel: e.target.value })}
              placeholder="링크 버튼 문구 (선택) — 기본 「바로가기 →」"
              className={field}
            />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <label className="text-xs text-slate-400">
              대상
              <select
                value={draft.audience}
                onChange={(e) => setDraft({ ...draft, audience: e.target.value as HomeNoticeAudienceTarget })}
                className={`${field} mt-1`}
              >
                <option value="all">전체</option>
                <option value="guest">비로그인만</option>
                <option value="member">회원만</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              정렬 (작을수록 먼저)
              <input
                type="number"
                value={draft.order}
                onChange={(e) => setDraft({ ...draft, order: Number(e.target.value) || 0 })}
                className={`${field} mt-1`}
              />
            </label>
            <label className="text-xs text-slate-400">
              게시 시작 (선택)
              <input
                type="datetime-local"
                value={draft.startsAt}
                onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })}
                className={`${field} mt-1`}
              />
            </label>
            <label className="text-xs text-slate-400">
              게시 종료 (선택)
              <input
                type="datetime-local"
                value={draft.endsAt}
                onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })}
                className={`${field} mt-1`}
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
              게시 중
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={draft.pinned}
                onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
              />
              상단 고정
            </label>
            <div className="flex-1" />
            {editingId && (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setDraft(EMPTY);
                }}
                className="px-3 py-2 rounded-lg border border-slate-600 text-sm text-slate-300 hover:bg-slate-700/60"
              >
                취소
              </button>
            )}
            <button
              type="button"
              onClick={() => void save()}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-500"
            >
              {editingId ? '수정 저장' : '등록'}
            </button>
          </div>

          {/* 홈에서 어떻게 보이는지 */}
          {draft.title.trim() && (
            <div className="mt-4">
              <p className="mb-1.5 text-[11px] text-slate-500">홈 배너 미리보기</p>
              <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5">
                <span className="text-base leading-none">📢</span>
                {draft.badge && (
                  <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                    {draft.badge}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-slate-700">
                  {draft.title}
                </span>
                <span className="shrink-0 text-[12px] font-bold text-indigo-600">자세히 →</span>
              </div>
            </div>
          )}
        </div>

        {/* 목록 */}
        <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-slate-400">
              아직 공지가 없습니다. 위에서 첫 공지를 작성해 보세요.
            </p>
          ) : (
            <ul className="divide-y divide-slate-700">
              {items.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.pinned && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                          고정
                        </span>
                      )}
                      {!row.active && (
                        <span className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">
                          숨김
                        </span>
                      )}
                      <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">
                        {AUDIENCE_LABEL[row.audience]}
                      </span>
                      {row.badge && (
                        <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300">
                          {row.badge}
                        </span>
                      )}
                      <span className="truncate text-sm font-semibold text-white">{row.title}</span>
                    </div>
                    {row.body && (
                      <p className="mt-0.5 truncate text-[11px] text-slate-400">{row.body.replace(/\n/g, ' ')}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggle(row, { active: !row.active })}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-600 text-[12px] text-slate-300 hover:bg-slate-700/60"
                  >
                    {row.active ? '숨기기' : '게시'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void toggle(row, { pinned: !row.pinned })}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-600 text-[12px] text-slate-300 hover:bg-slate-700/60"
                  >
                    {row.pinned ? '고정 해제' : '고정'}
                  </button>
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    className="px-2.5 py-1.5 rounded-lg bg-sky-600 text-[12px] font-bold text-white hover:bg-sky-500"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(row)}
                    className="px-2.5 py-1.5 rounded-lg border border-rose-700 text-[12px] font-bold text-rose-300 hover:bg-rose-900/40"
                  >
                    삭제
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
