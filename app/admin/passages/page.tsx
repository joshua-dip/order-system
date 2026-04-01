'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PassageFolderScopeBar, type PassageAdminFolder } from '@/app/components/admin/PassageFolderScopeBar';
import { TextbookLinkFolderScopeBar, type TextbookLinkFolder } from '@/app/components/admin/TextbookLinkFolderScopeBar';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';

type PassageListItem = {
  _id: string;
  textbook: string;
  chapter: string;
  number: string;
  source_key?: string;
  page?: number;
  page_label?: string;
  order?: number;
  content?: { original?: string };
  created_at?: string;
  updated_at?: string;
  folder_id?: string | null;
};

type PassageFull = PassageListItem & {
  content?: {
    original?: string;
    translation?: string;
    sentences_en?: string[];
    sentences_ko?: string[];
    tokenized_en?: string;
    tokenized_ko?: string;
    mixed?: string;
  };
};

const emptyForm = {
  textbook: '',
  chapter: '',
  number: '',
  source_key: '',
  page: '',
  page_label: '',
  order: '0',
  original: '',
  translation: '',
};

export default function AdminPassagesPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ loginId: string; role: string } | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [filterTextbook, setFilterTextbook] = useState('');
  const [filterChapter, setFilterChapter] = useState('');
  const [filterQ, setFilterQ] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<PassageListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [folderScope, setFolderScope] = useState('');
  const [passageFolders, setPassageFolders] = useState<PassageAdminFolder[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [advancedJson, setAdvancedJson] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  /** MongoDB textbook_links — 부교재/워크북 「교재 확인」버튼 */
  const [linksPanelOpen, setLinksPanelOpen] = useState(true);
  const [linkDrafts, setLinkDrafts] = useState<Record<string, { kyoboUrl: string; description: string }>>({});
  const [linksLoading, setLinksLoading] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkSavingKey, setLinkSavingKey] = useState<string | null>(null);
  const [linkMsg, setLinkMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [linkFolderScope, setLinkFolderScope] = useState('');
  const [textbookLinkFolders, setTextbookLinkFolders] = useState<TextbookLinkFolder[]>([]);
  const [textbookLinkAssignments, setTextbookLinkAssignments] = useState<Record<string, string>>({});

  const fetchAdminTextbookLinks = useCallback(() => {
    setLinksLoading(true);
    setLinkMsg(null);
    fetch('/api/admin/textbook-links', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d.links || typeof d.links !== 'object') return;
        const map = d.links as Record<string, { kyoboUrl?: string; description?: string }>;
        const next: Record<string, { kyoboUrl: string; description: string }> = {};
        for (const [k, v] of Object.entries(map)) {
          next[k] = {
            kyoboUrl: typeof v?.kyoboUrl === 'string' ? v.kyoboUrl : '',
            description: typeof v?.description === 'string' ? v.description : '',
          };
        }
        setLinkDrafts((prev) => {
          const out: Record<string, { kyoboUrl: string; description: string }> = { ...next };
          for (const k of Object.keys(prev)) {
            if (!(k in out)) out[k] = prev[k];
          }
          return out;
        });
      })
      .catch(() => setLinkMsg({ type: 'err', text: '링크 목록을 불러오지 못했습니다.' }))
      .finally(() => setLinksLoading(false));
  }, []);

  const fetchTextbookLinkAssignments = useCallback(() => {
    fetch('/api/admin/textbook-link-folder-assignments', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.assignments && typeof d.assignments === 'object') {
          setTextbookLinkAssignments(d.assignments as Record<string, string>);
        }
      })
      .catch(() => setTextbookLinkAssignments({}));
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchAdminTextbookLinks();
    fetchTextbookLinkAssignments();
  }, [user, fetchAdminTextbookLinks, fetchTextbookLinkAssignments]);

  useEffect(() => {
    setLinkDrafts((prev) => {
      const next = { ...prev };
      for (const t of textbooks) {
        if (!(t in next)) next[t] = { kyoboUrl: '', description: '' };
      }
      return next;
    });
  }, [textbooks]);

  const setLinkField = (textbookKey: string, field: 'kyoboUrl' | 'description', value: string) => {
    setLinkDrafts((prev) => ({
      ...prev,
      [textbookKey]: {
        kyoboUrl: field === 'kyoboUrl' ? value : prev[textbookKey]?.kyoboUrl ?? '',
        description: field === 'description' ? value : prev[textbookKey]?.description ?? '',
      },
    }));
  };

  const saveTextbookLink = async (textbookKey: string) => {
    const d = linkDrafts[textbookKey];
    if (!d?.kyoboUrl?.trim()) {
      alert('구매 링크(URL)를 입력해 주세요.');
      return;
    }
    setLinkSavingKey(textbookKey);
    setLinkMsg(null);
    try {
      const res = await fetch('/api/admin/textbook-links', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          textbookKey,
          kyoboUrl: d.kyoboUrl.trim(),
          description: (d.description || '').trim(),
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setLinkMsg({ type: 'err', text: j.error || '저장 실패' });
        return;
      }
      setLinkMsg({ type: 'ok', text: `「${textbookKey}」 링크를 저장했습니다.` });
    } catch {
      setLinkMsg({ type: 'err', text: '요청 실패' });
    } finally {
      setLinkSavingKey(null);
    }
  };

  const deleteTextbookLink = async (textbookKey: string) => {
    if (!confirm(`「${textbookKey}」 구매 링크를 삭제할까요?`)) return;
    setLinkSavingKey(textbookKey);
    setLinkMsg(null);
    try {
      const res = await fetch(
        `/api/admin/textbook-links?key=${encodeURIComponent(textbookKey)}`,
        { method: 'DELETE', credentials: 'include' }
      );
      const j = await res.json();
      if (!res.ok) {
        setLinkMsg({ type: 'err', text: j.error || '삭제 실패' });
        return;
      }
      setLinkDrafts((prev) => ({
        ...prev,
        [textbookKey]: { kyoboUrl: '', description: '' },
      }));
      setLinkMsg({ type: 'ok', text: '삭제했습니다.' });
    } catch {
      setLinkMsg({ type: 'err', text: '요청 실패' });
    } finally {
      setLinkSavingKey(null);
    }
  };

  const assignTextbookLinkFolder = async (textbookKey: string, folderId: string) => {
    try {
      const res = await fetch('/api/admin/textbook-link-folder-assignments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textbookKey, folderId: folderId.trim() }),
      });
      const d = await res.json();
      if (!res.ok) {
        setLinkMsg({ type: 'err', text: d.message || '폴더 저장 실패' });
        return;
      }
      fetchTextbookLinkAssignments();
    } catch {
      setLinkMsg({ type: 'err', text: '폴더 저장 요청 실패' });
    }
  };

  const linkRowKeys = useMemo(() => {
    const keys = new Set([...textbooks, ...Object.keys(linkDrafts)]);
    const q = linkSearch.trim().toLowerCase();
    let list = Array.from(keys).filter((k) => !q || k.toLowerCase().includes(q));
    if (linkFolderScope === 'unassigned') {
      list = list.filter((k) => !textbookLinkAssignments[k]);
    } else if (linkFolderScope) {
      const norm = linkFolderScope.toLowerCase();
      list = list.filter((k) => (textbookLinkAssignments[k] || '').toLowerCase() === norm);
    }
    return list.sort((a, b) => a.localeCompare(b, 'ko'));
  }, [textbooks, linkDrafts, linkSearch, linkFolderScope, textbookLinkAssignments]);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user || d.user.role !== 'admin') {
          router.replace('/admin/login?from=/admin/passages');
          return;
        }
        setUser(d.user);
      })
      .catch(() => router.replace('/admin/login?from=/admin/passages'))
      .finally(() => setLoadingAuth(false));
  }, [router]);

  const fetchTextbooks = useCallback(() => {
    fetch('/api/admin/passages/textbooks', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setTextbooks(Array.isArray(d.textbooks) ? d.textbooks : []))
      .catch(() => setTextbooks([]));
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchTextbooks();
  }, [user, fetchTextbooks]);

  const fetchList = useCallback(() => {
    setListLoading(true);
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    if (filterChapter) params.set('chapter', filterChapter);
    if (filterQ) params.set('q', filterQ);
    if (folderScope) params.set('folderScope', folderScope);
    params.set('page', String(page));
    params.set('limit', String(limit));
    fetch(`/api/admin/passages?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        setItems(Array.isArray(d.items) ? d.items : []);
        setTotal(typeof d.total === 'number' ? d.total : 0);
      })
      .catch(() => {
        setItems([]);
        setTotal(0);
      })
      .finally(() => setListLoading(false));
  }, [filterTextbook, filterChapter, filterQ, folderScope, page, limit]);

  useEffect(() => {
    if (!user) return;
    fetchList();
  }, [user, fetchList]);

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...emptyForm,
      textbook: filterTextbook || '',
    });
    setAdvancedJson('');
    setShowAdvanced(false);
    setModalOpen(true);
  };

  const openEdit = async (id: string) => {
    setEditingId(id);
    setShowAdvanced(false);
    setAdvancedJson('');
    try {
      const res = await fetch(`/api/admin/passages/${id}`, { credentials: 'include' });
      const d = await res.json();
      if (!res.ok || !d.item) {
        alert(d.error || '불러오기 실패');
        return;
      }
      const it = d.item as PassageFull;
      const c = it.content || {};
      setForm({
        textbook: it.textbook || '',
        chapter: it.chapter || '',
        number: it.number || '',
        source_key: it.source_key || '',
        page: it.page != null ? String(it.page) : '',
        page_label: it.page_label || '',
        order: it.order != null ? String(it.order) : '0',
        original: c.original || '',
        translation: c.translation || '',
      });
      setAdvancedJson(
        JSON.stringify(
          {
            sentences_en: c.sentences_en || [],
            sentences_ko: c.sentences_ko || [],
            tokenized_en: c.tokenized_en || '',
            tokenized_ko: c.tokenized_ko || '',
            mixed: c.mixed || '',
          },
          null,
          2
        )
      );
      setModalOpen(true);
    } catch {
      alert('요청 실패');
    }
  };

  const handleSave = async () => {
    if (!form.textbook.trim() || !form.chapter.trim() || !form.number.trim()) {
      alert('교재명, 강(회차), 번호는 필수입니다.');
      return;
    }
    setSaving(true);
    try {
      let extra: Record<string, unknown> = {};
      if (showAdvanced && advancedJson.trim()) {
        try {
          extra = JSON.parse(advancedJson) as Record<string, unknown>;
        } catch {
          alert('고급 JSON 형식이 올바르지 않습니다.');
          setSaving(false);
          return;
        }
      }

      const payload: Record<string, unknown> = {
        textbook: form.textbook.trim(),
        chapter: form.chapter.trim(),
        number: form.number.trim(),
        source_key: form.source_key.trim() || `${form.chapter.trim()} ${form.number.trim()}`,
        page: form.page.trim() ? parseInt(form.page, 10) : undefined,
        page_label: form.page_label.trim(),
        order: form.order.trim() ? parseInt(form.order, 10) : 0,
        original: form.original,
        translation: form.translation,
      };

      if (showAdvanced && Object.keys(extra).length > 0) {
        payload.content = {
          original: form.original,
          translation: form.translation,
          sentences_en: Array.isArray(extra.sentences_en) ? extra.sentences_en : [],
          sentences_ko: Array.isArray(extra.sentences_ko) ? extra.sentences_ko : [],
          tokenized_en: typeof extra.tokenized_en === 'string' ? extra.tokenized_en : '',
          tokenized_ko: typeof extra.tokenized_ko === 'string' ? extra.tokenized_ko : '',
          mixed: typeof extra.mixed === 'string' ? extra.mixed : '',
        };
      }

      const url = editingId ? `/api/admin/passages/${editingId}` : '/api/admin/passages';
      const method = editingId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '저장 실패');
        return;
      }
      setModalOpen(false);
      fetchList();
      fetchTextbooks();
    } catch {
      alert('요청 중 오류');
    } finally {
      setSaving(false);
    }
  };

  const assignPassageFolder = async (passageId: string, folderId: string) => {
    if (!user) return;
    try {
      const res = await fetch('/api/admin/passage-analyzer/file-folders', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.loginId,
          fileName: passageAnalysisFileNameForPassageId(passageId),
          folderId: folderId.trim(),
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d.message || '폴더 저장 실패');
        return;
      }
      fetchList();
    } catch {
      alert('요청 실패');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 원문을 삭제할까요? 되돌릴 수 없습니다.')) return;
    try {
      const res = await fetch(`/api/admin/passages/${id}`, { method: 'DELETE', credentials: 'include' });
      const d = await res.json();
      if (!res.ok) {
        alert(d.error || '삭제 실패');
        return;
      }
      fetchList();
    } catch {
      alert('요청 실패');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (loadingAuth || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin w-10 h-10 border-4 border-slate-600 border-t-white rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <header className="border-b border-slate-700 bg-slate-800/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-white">원문 관리</h1>
            <p className="text-slate-400 text-sm mt-0.5">MongoDB · gomijoshua.passages</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="text-slate-300 hover:text-white text-sm px-3 py-2 rounded-lg border border-slate-600 hover:border-slate-500"
            >
              ← 관리자 홈
            </Link>
            <button
              type="button"
              onClick={openCreate}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold px-4 py-2 rounded-lg"
            >
              + 새 원문
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        <section className="bg-slate-800/50 border border-slate-700 rounded-xl mb-6 overflow-hidden">
          <button
            type="button"
            onClick={() => setLinksPanelOpen((o) => !o)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-800/80 transition-colors"
          >
            <div>
              <h2 className="text-base font-bold text-white">교재 구매 링크 (YES24·교보문고 등)</h2>
              <p className="text-slate-400 text-xs mt-0.5">
                아래에 등록된 원문 교재명 기준으로 링크를 넣으면, 부교재·워크북 주문 화면의 「교재 확인」에 반영됩니다. MongoDB{' '}
                <code className="text-amber-200/90">textbook_links</code>
              </p>
            </div>
            <span className="text-slate-400 shrink-0">{linksPanelOpen ? '▼' : '▶'}</span>
          </button>
          {linksPanelOpen && (
            <div className="px-4 pb-4 border-t border-slate-700/80">
              <div className="flex flex-wrap gap-3 items-center py-3">
                <input
                  type="search"
                  value={linkSearch}
                  onChange={(e) => setLinkSearch(e.target.value)}
                  placeholder="교재명 검색…"
                  className="flex-1 min-w-[200px] bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => fetchAdminTextbookLinks()}
                  disabled={linksLoading}
                  className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm disabled:opacity-50"
                >
                  {linksLoading ? '불러오는 중…' : 'DB에서 다시 불러오기'}
                </button>
              </div>
              {linkMsg && (
                <p
                  className={`text-sm mb-2 ${linkMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}
                >
                  {linkMsg.text}
                </p>
              )}
              <div className="mb-3">
                <TextbookLinkFolderScopeBar
                  value={linkFolderScope}
                  onChange={setLinkFolderScope}
                  onFoldersChange={setTextbookLinkFolders}
                  onFoldersDirty={fetchTextbookLinkAssignments}
                />
              </div>
              <div className="max-h-[min(28rem,55vh)] overflow-y-auto rounded-lg border border-slate-700">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-900 z-[1] border-b border-slate-600">
                    <tr className="text-left text-slate-400">
                      <th className="px-3 py-2 font-medium w-[min(14rem,28vw)]">교재명 (passages)</th>
                      <th className="px-3 py-2 font-medium min-w-[7rem]">폴더</th>
                      <th className="px-3 py-2 font-medium min-w-[200px]">구매 URL</th>
                      <th className="px-3 py-2 font-medium min-w-[140px]">설명(툴팁)</th>
                      <th className="px-3 py-2 font-medium w-36 text-right">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linkRowKeys.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                          {textbooks.length === 0
                            ? '등록된 교재가 없습니다. 원문을 먼저 등록하면 교재명이 여기에 나타납니다.'
                            : '검색 결과가 없습니다.'}
                        </td>
                      </tr>
                    ) : (
                      linkRowKeys.map((key) => {
                        const draft = linkDrafts[key] ?? { kyoboUrl: '', description: '' };
                        const hasSaved = !!draft.kyoboUrl?.trim();
                        return (
                          <tr key={key} className="border-b border-slate-700/60 align-top hover:bg-slate-900/40">
                            <td className="px-3 py-2 text-slate-200">
                              <span className="line-clamp-3" title={key}>
                                {key}
                              </span>
                              {hasSaved && (
                                <span className="ml-1 inline-block text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300">
                                  등록됨
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top">
                              <select
                                value={textbookLinkAssignments[key] || ''}
                                onChange={(e) => assignTextbookLinkFolder(key, e.target.value)}
                                className="max-w-[9rem] w-full bg-slate-900 border border-slate-600 rounded px-1.5 py-1 text-xs text-white"
                              >
                                <option value="">미지정</option>
                                {textbookLinkFolders.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                value={draft.kyoboUrl}
                                onChange={(e) => setLinkField(key, 'kyoboUrl', e.target.value)}
                                placeholder="https://..."
                                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-xs text-white font-mono"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <input
                                value={draft.description}
                                onChange={(e) => setLinkField(key, 'description', e.target.value)}
                                placeholder="예: 2025 개정"
                                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
                              />
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              <button
                                type="button"
                                disabled={linkSavingKey === key}
                                onClick={() => saveTextbookLink(key)}
                                className="text-sky-400 hover:text-sky-300 text-xs font-semibold mr-2 disabled:opacity-40"
                              >
                                {linkSavingKey === key ? '…' : '저장'}
                              </button>
                              <button
                                type="button"
                                disabled={linkSavingKey === key || !hasSaved}
                                onClick={() => deleteTextbookLink(key)}
                                className="text-red-400 hover:text-red-300 text-xs disabled:opacity-40"
                              >
                                삭제
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-slate-500 text-xs mt-2">
                교재명은 passages에 저장된 문자열과 정확히 같아야 주문 화면에서 매칭됩니다.
              </p>
            </div>
          )}
        </section>

        {user && (
          <div className="mb-6">
            <PassageFolderScopeBar
              loginId={user.loginId}
              value={folderScope}
              onChange={(v) => {
                setFolderScope(v);
                setPage(1);
              }}
              onFoldersChange={setPassageFolders}
              onFoldersDirty={fetchList}
            />
          </div>
        )}

        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 mb-6 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">교재</label>
            <select
              value={filterTextbook}
              onChange={(e) => {
                setFilterTextbook(e.target.value);
                setPage(1);
              }}
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm min-w-[200px] text-white"
            >
              <option value="">전체</option>
              {textbooks.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">강(회차) 포함 검색</label>
            <input
              value={filterChapter}
              onChange={(e) => {
                setFilterChapter(e.target.value);
                setPage(1);
              }}
              placeholder="예: 01강"
              className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm w-32 text-white placeholder:text-slate-500"
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs text-slate-400 mb-1">번호·source_key·본문 검색</label>
            <input
              value={filterQ}
              onChange={(e) => {
                setFilterQ(e.target.value);
                setPage(1);
              }}
              placeholder="검색어"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
            />
          </div>
          <button
            type="button"
            onClick={() => fetchList()}
            className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm font-medium"
          >
            새로고침
          </button>
        </div>

        <div className="text-slate-400 text-sm mb-3">
          총 <span className="text-white font-semibold">{total}</span>건 · {page}/{totalPages}페이지
        </div>

        <div className="border border-slate-700 rounded-xl overflow-hidden bg-slate-800/30">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-800 text-left text-slate-300 border-b border-slate-700">
                  <th className="px-3 py-3 font-medium w-48">교재</th>
                  <th className="px-3 py-3 font-medium w-24">강</th>
                  <th className="px-3 py-3 font-medium w-28">번호</th>
                  <th className="px-3 py-3 font-medium w-14">p.</th>
                  <th className="px-3 py-3 font-medium min-w-[128px]">폴더</th>
                  <th className="px-3 py-3 font-medium min-w-[200px]">원문 미리보기</th>
                  <th className="px-3 py-3 font-medium w-32 text-right">작업</th>
                </tr>
              </thead>
              <tbody>
                {listLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                      불러오는 중…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                      데이터가 없습니다. 필터를 바꾸거나 새 원문을 추가해 보세요.
                    </td>
                  </tr>
                ) : (
                  items.map((row) => (
                    <tr key={row._id} className="border-b border-slate-700/80 hover:bg-slate-800/40">
                      <td className="px-3 py-2 text-slate-200 align-top max-w-[12rem] truncate" title={row.textbook}>
                        {row.textbook}
                      </td>
                      <td className="px-3 py-2 text-slate-300 align-top">{row.chapter}</td>
                      <td className="px-3 py-2 text-slate-300 align-top">{row.number}</td>
                      <td className="px-3 py-2 text-slate-400 align-top">{row.page ?? '—'}</td>
                      <td className="px-3 py-2 align-top">
                        <select
                          value={row.folder_id || ''}
                          onChange={(e) => assignPassageFolder(row._id, e.target.value)}
                          className="max-w-[10rem] bg-slate-900 border border-slate-600 rounded px-1.5 py-1 text-xs text-white"
                        >
                          <option value="">미지정</option>
                          {passageFolders.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-slate-400 align-top max-w-xl">
                        <span className="line-clamp-2">
                          {(row.content?.original || '').slice(0, 180)}
                          {(row.content?.original || '').length > 180 ? '…' : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right align-top whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openEdit(row._id)}
                          className="text-sky-400 hover:text-sky-300 mr-2"
                        >
                          수정
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(row._id)}
                          className="text-red-400 hover:text-red-300"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex justify-center gap-2 mt-6">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-600 disabled:opacity-40"
            >
              이전
            </button>
            <span className="px-4 py-2 text-slate-400">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-600 disabled:opacity-40"
            >
              다음
            </button>
          </div>
        )}
      </main>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 overflow-y-auto">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-600 px-5 py-4 flex justify-between items-center">
              <h2 className="text-lg font-bold">{editingId ? '원문 수정' : '새 원문'}</h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">교재명 *</label>
                  <input
                    value={form.textbook}
                    onChange={(e) => setForm((f) => ({ ...f, textbook: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="예: 2027수능특강 영어(2026)"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">강(회차) *</label>
                  <input
                    value={form.chapter}
                    onChange={(e) => setForm((f) => ({ ...f, chapter: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="예: 01강"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">번호 *</label>
                  <input
                    value={form.number}
                    onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="예: 01번, Gateway"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">source_key</label>
                  <input
                    value={form.source_key}
                    onChange={(e) => setForm((f) => ({ ...f, source_key: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="비우면 강+번호로 자동"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">페이지</label>
                  <input
                    value={form.page}
                    onChange={(e) => setForm((f) => ({ ...f, page: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="숫자"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">page_label</label>
                  <input
                    value={form.page_label}
                    onChange={(e) => setForm((f) => ({ ...f, page_label: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                    placeholder="예: p10"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">정렬 순서 (order)</label>
                  <input
                    value={form.order}
                    onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">영문 원문</label>
                <textarea
                  value={form.original}
                  onChange={(e) => setForm((f) => ({ ...f, original: e.target.value }))}
                  rows={8}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">한글 해석/번역</label>
                <textarea
                  value={form.translation}
                  onChange={(e) => setForm((f) => ({ ...f, translation: e.target.value }))}
                  rows={8}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white font-mono"
                />
              </div>

              <div className="border border-slate-600 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((s) => !s)}
                  className="w-full text-left px-3 py-2 bg-slate-900/80 text-sm text-amber-200/90 hover:bg-slate-900"
                >
                  {showAdvanced ? '▼' : '▶'} 고급: 문장·토큰화 필드 (JSON)
                </button>
                {showAdvanced && (
                  <div className="p-3 border-t border-slate-600">
                    <p className="text-xs text-slate-500 mb-2">
                      sentences_en / sentences_ko 배열, tokenized_*, mixed. 저장 시 원문·번역과 함께 반영됩니다.
                    </p>
                    <textarea
                      value={advancedJson}
                      onChange={(e) => setAdvancedJson(e.target.value)}
                      rows={10}
                      className="w-full bg-slate-950 border border-slate-600 rounded-lg px-3 py-2 text-xs text-green-200 font-mono"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSave}
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 font-bold disabled:opacity-50"
                >
                  {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
