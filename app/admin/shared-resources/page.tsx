'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SharedResourceLink } from '@/lib/shared-resources-shared';

interface DraftState {
  title: string;
  subtitle: string;
  blogUrl: string;
}

const EMPTY_DRAFT: DraftState = { title: '', subtitle: '', blogUrl: '' };

export default function AdminSharedResourcesPage() {
  const [items, setItems] = useState<SharedResourceLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/shared-resources', { credentials: 'include' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? '목록 조회 실패');
      setItems(d.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록 조회 실패');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchList(); }, [fetchList]);

  async function handleCreate() {
    if (saving) return;
    const title = draft.title.trim();
    const blogUrl = draft.blogUrl.trim();
    if (!title) { setError('자료명을 입력해 주세요.'); return; }
    if (!blogUrl) { setError('블로그 링크를 입력해 주세요.'); return; }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/shared-resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title,
          subtitle: draft.subtitle.trim() || undefined,
          blogUrl,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? '저장 실패');
      setDraft(EMPTY_DRAFT);
      await fetchList();
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(item: SharedResourceLink) {
    setEditingId(item._id);
    setEditingDraft({
      title: item.title,
      subtitle: item.subtitle ?? '',
      blogUrl: item.blogUrl,
    });
    setError('');
  }

  function cancelEdit() {
    setEditingId(null);
    setEditingDraft(EMPTY_DRAFT);
  }

  async function saveEdit(id: string) {
    if (busyId) return;
    setBusyId(id);
    setError('');
    try {
      const res = await fetch(`/api/admin/shared-resources/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: editingDraft.title.trim(),
          subtitle: editingDraft.subtitle.trim(),
          blogUrl: editingDraft.blogUrl.trim(),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? '수정 실패');
      setEditingId(null);
      setEditingDraft(EMPTY_DRAFT);
      await fetchList();
    } catch (e) {
      setError(e instanceof Error ? e.message : '수정 실패');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string, title: string) {
    if (busyId) return;
    if (!confirm(`「${title}」 항목을 삭제하시겠습니까?\n(공개 페이지에서도 사라집니다.)`)) return;
    setBusyId(id);
    setError('');
    try {
      const res = await fetch(`/api/admin/shared-resources/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? '삭제 실패');
      await fetchList();
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제 실패');
    } finally {
      setBusyId(null);
    }
  }

  async function handleMove(id: string, direction: 'up' | 'down') {
    if (busyId) return;
    setBusyId(id);
    setError('');
    try {
      const res = await fetch(`/api/admin/shared-resources/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ move: direction }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? '이동 실패');
      }
      await fetchList();
    } catch (e) {
      setError(e instanceof Error ? e.message : '이동 실패');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white">공유자료</h1>
        <p className="mt-1 text-sm text-slate-400">
          블로그 글 URL 을 등록하면 공개 페이지 <a href="/shared-resources" target="_blank" className="underline text-emerald-300 hover:text-emerald-200">/shared-resources</a> 에 카드로 노출됩니다. 카드 클릭 시 새 탭으로 블로그 글이 열립니다.
        </p>
      </header>

      {/* 새로 추가 */}
      <section className="mb-8 rounded-xl border border-slate-700 bg-slate-800/60 p-4">
        <h2 className="font-bold text-white mb-3">+ 새 항목 추가</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400">
            자료명 *
            <input
              type="text"
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="2026학년도 5월 고3 영어모의고사"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="text-xs text-slate-400">
            부제 (선택)
            <input
              type="text"
              value={draft.subtitle}
              onChange={e => setDraft(d => ({ ...d, subtitle: e.target.value }))}
              placeholder="전국연합학력평가"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:border-emerald-500"
            />
          </label>
          <label className="text-xs text-slate-400 sm:col-span-2">
            블로그 링크 * (https://…)
            <input
              type="url"
              value={draft.blogUrl}
              onChange={e => setDraft(d => ({ ...d, blogUrl: e.target.value }))}
              placeholder="https://blog.naver.com/.../..."
              className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:border-emerald-500"
            />
          </label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold disabled:opacity-50"
          >
            {saving ? '저장 중…' : '추가'}
          </button>
          {error && <span className="text-xs text-rose-400">{error}</span>}
        </div>
      </section>

      {/* 목록 */}
      <section>
        <h2 className="font-bold text-white mb-3">등록된 자료 ({items.length})</h2>
        {loading ? (
          <div className="text-sm text-slate-500">불러오는 중…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-500 rounded-xl border border-dashed border-slate-600 p-8 text-center">
            아직 등록된 자료가 없습니다.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((it, idx) => {
              const isEditing = editingId === it._id;
              const isBusy = busyId === it._id;
              return (
                <li
                  key={it._id}
                  className="rounded-xl border border-slate-700 bg-slate-800/60 p-4"
                >
                  {isEditing ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="text-xs text-slate-400 sm:col-span-2">
                        자료명
                        <input
                          type="text"
                          value={editingDraft.title}
                          onChange={e => setEditingDraft(d => ({ ...d, title: e.target.value }))}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:border-emerald-500"
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        부제
                        <input
                          type="text"
                          value={editingDraft.subtitle}
                          onChange={e => setEditingDraft(d => ({ ...d, subtitle: e.target.value }))}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:border-emerald-500"
                        />
                      </label>
                      <label className="text-xs text-slate-400">
                        블로그 링크
                        <input
                          type="url"
                          value={editingDraft.blogUrl}
                          onChange={e => setEditingDraft(d => ({ ...d, blogUrl: e.target.value }))}
                          className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-600 text-white text-sm focus:outline-none focus:border-emerald-500"
                        />
                      </label>
                      <div className="sm:col-span-2 flex items-center gap-2 mt-1">
                        <button
                          type="button"
                          onClick={() => void saveEdit(it._id)}
                          disabled={isBusy}
                          className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50"
                        >
                          {isBusy ? '저장 중…' : '저장'}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isBusy}
                          className="px-3 py-1.5 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 text-xs"
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <h3 className="font-bold text-white text-base break-keep">{it.title}</h3>
                          {it.subtitle && (
                            <span className="text-xs text-slate-400">{it.subtitle}</span>
                          )}
                        </div>
                        <a
                          href={it.blogUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block text-xs text-emerald-300 hover:text-emerald-200 underline break-all"
                        >
                          {it.blogUrl}
                        </a>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => void handleMove(it._id, 'up')}
                          disabled={isBusy || idx === 0}
                          title="위로"
                          className="px-2 py-1 rounded text-sm text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                        >▲</button>
                        <button
                          type="button"
                          onClick={() => void handleMove(it._id, 'down')}
                          disabled={isBusy || idx === items.length - 1}
                          title="아래로"
                          className="px-2 py-1 rounded text-sm text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
                        >▼</button>
                        <button
                          type="button"
                          onClick={() => startEdit(it)}
                          disabled={isBusy}
                          className="px-2 py-1 rounded text-xs text-slate-300 hover:bg-slate-700 hover:text-white"
                        >편집</button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(it._id, it.title)}
                          disabled={isBusy}
                          className="px-2 py-1 rounded text-xs text-rose-300 hover:bg-rose-900/40"
                        >삭제</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
