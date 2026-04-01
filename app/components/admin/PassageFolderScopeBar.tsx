'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type PassageAdminFolder = { id: string; name: string; order: number };

type Props = {
  loginId: string;
  value: string;
  onChange: (folderScope: string) => void;
  onFoldersChange?: (folders: PassageAdminFolder[]) => void;
  onFoldersDirty?: () => void;
  /** manage: 폴더 추가·삭제(원문 관리). pick: 목록·필터만(지문분석기) */
  mode?: 'manage' | 'pick';
};

export function PassageFolderScopeBar({
  loginId,
  value,
  onChange,
  onFoldersChange,
  onFoldersDirty,
  mode = 'manage',
}: Props) {
  const [folders, setFolders] = useState<PassageAdminFolder[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const onFoldersChangeRef = useRef(onFoldersChange);
  onFoldersChangeRef.current = onFoldersChange;

  const load = useCallback(() => {
    fetch('/api/admin/passage-analyzer/folders', {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d.folders) ? d.folders : [];
        setFolders(list);
        onFoldersChangeRef.current?.(list);
      })
      .catch(() => {
        setFolders([]);
        onFoldersChangeRef.current?.([]);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createFolder = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await fetch('/api/admin/passage-analyzer/folders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: loginId, name }),
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d.message || '생성 실패');
        return;
      }
      setNewName('');
      load();
      onFoldersDirty?.();
    } finally {
      setBusy(false);
    }
  };

  const deleteFolder = async (id: string, name: string) => {
    if (!confirm(`폴더 「${name}」을 삭제할까요? 이 폴더에 넣어 둔 지문·파일 배치가 해제됩니다.`)) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/passage-analyzer/folders?folderId=${encodeURIComponent(id)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      if (!res.ok) {
        const d = await res.json();
        alert(d.message || '삭제 실패');
        return;
      }
      if (value === id) onChange('');
      load();
      onFoldersDirty?.();
    } finally {
      setBusy(false);
    }
  };

  const btn = (active: boolean) =>
    `px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
      active
        ? 'bg-sky-600 border-sky-500 text-white'
        : 'bg-slate-800/80 border-slate-600 text-slate-300 hover:border-slate-500'
    }`;

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide mr-1">분류 폴더</span>
        <button type="button" className={btn(value === '')} onClick={() => onChange('')} disabled={busy}>
          전체
        </button>
        <button
          type="button"
          className={btn(value === 'unassigned')}
          onClick={() => onChange('unassigned')}
          disabled={busy}
        >
          미분류
        </button>
        {folders.map((f) =>
          mode === 'pick' ? (
            <button
              key={f.id}
              type="button"
              className={btn(value === f.id)}
              onClick={() => onChange(f.id)}
              disabled={busy}
            >
              {f.name}
            </button>
          ) : (
            <span key={f.id} className="inline-flex items-center gap-0.5">
              <button
                type="button"
                className={btn(value === f.id)}
                onClick={() => onChange(f.id)}
                disabled={busy}
              >
                {f.name}
              </button>
              <button
                type="button"
                className="text-slate-500 hover:text-red-400 text-[10px] px-1"
                title="폴더 삭제"
                disabled={busy}
                onClick={() => deleteFolder(f.id, f.name)}
              >
                ×
              </button>
            </span>
          )
        )}
      </div>
      {mode === 'manage' ? (
        <div className="flex flex-wrap gap-2 items-center">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="새 폴더 이름"
            className="bg-slate-900 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white min-w-[140px]"
          />
          <button
            type="button"
            disabled={busy || !newName.trim()}
            onClick={createFolder}
            className="px-2 py-1 rounded-lg bg-emerald-700 text-xs font-medium disabled:opacity-40"
          >
            추가
          </button>
          <p className="text-[11px] text-slate-500">
            <code className="text-slate-400">passage_analyzer_folders</code> · 지문은{' '}
            <code className="text-slate-400">passage:ObjectId</code> 키로 저장되어 지문 분석기와 동일 분류입니다.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-700/60">
          폴더는 <strong className="text-slate-400">원문 관리</strong>에서 추가·삭제합니다. 여기서는 같은 분류를 기준으로
          지문만 고릅니다.
        </p>
      )}
    </div>
  );
}
