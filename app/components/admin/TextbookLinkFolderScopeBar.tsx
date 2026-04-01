'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type TextbookLinkFolder = { id: string; name: string; order: number };

type Props = {
  value: string;
  onChange: (folderScope: string) => void;
  onFoldersChange?: (folders: TextbookLinkFolder[]) => void;
  onFoldersDirty?: () => void;
};

export function TextbookLinkFolderScopeBar({
  value,
  onChange,
  onFoldersChange,
  onFoldersDirty,
}: Props) {
  const [folders, setFolders] = useState<TextbookLinkFolder[]>([]);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const onFoldersChangeRef = useRef(onFoldersChange);
  onFoldersChangeRef.current = onFoldersChange;

  const load = useCallback(() => {
    fetch('/api/admin/textbook-link-folders', { credentials: 'include' })
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
      const res = await fetch('/api/admin/textbook-link-folders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
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
    if (!confirm(`폴더 「${name}」을 삭제할까요? 이 폴더에 넣어 둔 교재 배치가 해제됩니다.`)) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/textbook-link-folders?folderId=${encodeURIComponent(id)}`,
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
        ? 'bg-violet-600 border-violet-500 text-white'
        : 'bg-slate-800/80 border-slate-600 text-slate-300 hover:border-slate-500'
    }`;

  return (
    <div className="rounded-lg border border-slate-700/80 bg-slate-900/40 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-500 font-semibold uppercase tracking-wide mr-1">링크 분류</span>
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
        {folders.map((f) => (
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
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="새 폴더 (예: Reading master)"
          className="bg-slate-950 border border-slate-600 rounded-lg px-2 py-1 text-xs text-white min-w-[180px]"
        />
        <button
          type="button"
          disabled={busy || !newName.trim()}
          onClick={createFolder}
          className="px-2 py-1 rounded-lg bg-violet-700 text-xs font-medium disabled:opacity-40"
        >
          추가
        </button>
        <p className="text-[11px] text-slate-500">
          <code className="text-slate-400">textbook_link_folders</code> · 주문 화면 링크 매칭에는 영향 없음
        </p>
      </div>
    </div>
  );
}
