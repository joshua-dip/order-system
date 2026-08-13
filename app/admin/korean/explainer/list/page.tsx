'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../../../_components/AdminSidebar';

interface ListItem {
  _id: string;
  textbook: string;
  sourceKey: string;
  setRange: string;
  genre: string;
  workTitle: string;
  examTitle: string;
  status: '대기' | '검수완료' | '검수불일치';
  folder: string;
  blockCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function KoreanExplainerListPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState('');
  const [authChecked, setAuthChecked] = useState(false);

  const [items, setItems] = useState<ListItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [filterTextbook, setFilterTextbook] = useState('');
  const [filterFolder, setFilterFolder] = useState('');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (!d?.user || d.user.role !== 'admin') { router.replace('/admin/login'); return; }
        setLoginId(d.user.loginId ?? '');
        setAuthChecked(true);
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  const fetchList = useCallback(async () => {
    if (!authChecked) return;
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    if (filterFolder) params.set('folder', filterFolder);
    const qs = params.toString();
    try {
      const res = await fetch(`/api/admin/korean-explainer/list${qs ? `?${qs}` : ''}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setItems(data.items ?? []);
      setFolders(data.folders ?? []);
      setTextbooks(data.textbooks ?? []);
      setLoadErr(null);
    } catch (e) {
      setLoadErr(`목록 로드 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [authChecked, filterTextbook, filterFolder]);

  useEffect(() => { fetchList(); }, [fetchList]);

  async function handleDelete(id: string, label: string) {
    if (!confirm(`정말 삭제하시겠습니까?\n\n${label}`)) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/korean-explainer/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `${res.status}`);
      }
      await fetchList();
    } catch (e) {
      alert(`삭제 실패: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusyId(null);
    }
  }

  const grouped = useMemo(() => {
    const m = new Map<string, ListItem[]>();
    for (const it of items) {
      const k = it.folder || '기본';
      const arr = m.get(k) ?? [];
      arr.push(it);
      m.set(k, arr);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b, 'ko'));
  }, [items]);

  if (!authChecked) {
    return <div className="min-h-svh flex items-center justify-center text-gray-500">인증 확인 중…</div>;
  }

  return (
    <div className="flex min-h-svh bg-gray-100">
      <AdminSidebar loginId={loginId} />
      <main className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-300 mb-2">
                KOREAN · 국어
              </div>
              <h1 className="text-2xl font-bold text-gray-900">국어 해설지 목록</h1>
              <p className="text-sm text-gray-600 mt-1">총 {items.length}개</p>
            </div>
            <Link
              href="/admin/korean/explainer"
              className="inline-flex items-center px-4 py-2 rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700"
            >
              + 새 해설지
            </Link>
          </div>

          <div className="flex flex-wrap gap-2 mb-4 bg-white p-3 rounded-lg border border-gray-200">
            <select
              className="text-sm px-3 py-1.5 border border-gray-300 rounded-md bg-white"
              value={filterTextbook}
              onChange={e => setFilterTextbook(e.target.value)}
            >
              <option value="">모든 교재</option>
              {textbooks.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select
              className="text-sm px-3 py-1.5 border border-gray-300 rounded-md bg-white"
              value={filterFolder}
              onChange={e => setFilterFolder(e.target.value)}
            >
              <option value="">모든 폴더</option>
              {folders.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <button
              type="button"
              onClick={() => { setFilterTextbook(''); setFilterFolder(''); }}
              className="text-sm px-3 py-1.5 border border-gray-300 rounded-md bg-white hover:bg-gray-50"
            >
              필터 초기화
            </button>
          </div>

          {loadErr && (
            <div className="mb-4 bg-red-50 text-red-800 px-4 py-2 text-sm border border-red-200 rounded">
              {loadErr}
            </div>
          )}

          {items.length === 0 && !loadErr && (
            <div className="rounded-xl border-2 border-dashed border-rose-300 bg-white p-10 text-center">
              <p className="text-gray-600">아직 저장된 해설지가 없습니다.</p>
              <Link
                href="/admin/korean/explainer"
                className="inline-flex items-center mt-4 px-4 py-2 rounded-lg bg-rose-600 text-white font-medium hover:bg-rose-700"
              >
                + 첫 해설지 만들기
              </Link>
            </div>
          )}

          {grouped.map(([folder, list]) => (
            <section key={folder} className="mb-6">
              <h2 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-rose-100 text-rose-700 rounded text-xs">📁 {folder}</span>
                <span className="text-gray-500 text-xs">({list.length})</span>
              </h2>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-700 text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">범위</th>
                      <th className="px-3 py-2 text-left font-semibold">갈래</th>
                      <th className="px-3 py-2 text-left font-semibold">작품</th>
                      <th className="px-3 py-2 text-left font-semibold">교재 · sourceKey</th>
                      <th className="px-3 py-2 text-center font-semibold w-16">블록</th>
                      <th className="px-3 py-2 text-center font-semibold w-24">갱신</th>
                      <th className="px-3 py-2 text-right font-semibold w-32">동작</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {list.map(it => (
                      <tr key={it._id} className="hover:bg-rose-50/30">
                        <td className="px-3 py-2 font-mono text-xs">[{it.setRange}]</td>
                        <td className="px-3 py-2 text-xs">{it.genre}</td>
                        <td className="px-3 py-2">{it.workTitle}</td>
                        <td className="px-3 py-2 text-xs text-gray-600">
                          <div className="truncate max-w-[280px]">{it.textbook}</div>
                          <code className="text-[10px] text-gray-500">{it.sourceKey}</code>
                        </td>
                        <td className="px-3 py-2 text-center text-xs">{it.blockCount}</td>
                        <td className="px-3 py-2 text-center text-[10px] text-gray-500">{it.updatedAt ? it.updatedAt.slice(0, 10) : ''}</td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            href={`/admin/korean/explainer?id=${it._id}`}
                            className="inline-block px-2 py-1 text-xs rounded bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 mr-1"
                          >
                            편집
                          </Link>
                          <button
                            type="button"
                            disabled={busyId === it._id}
                            onClick={() => handleDelete(it._id, `[${it.setRange}] ${it.workTitle}`)}
                            className="inline-block px-2 py-1 text-xs rounded bg-white border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            {busyId === it._id ? '…' : '삭제'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
