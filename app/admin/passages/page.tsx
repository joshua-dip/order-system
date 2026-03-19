'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [advancedJson, setAdvancedJson] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

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
  }, [filterTextbook, filterChapter, filterQ, page, limit]);

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
                  <th className="px-3 py-3 font-medium min-w-[200px]">원문 미리보기</th>
                  <th className="px-3 py-3 font-medium w-32 text-right">작업</th>
                </tr>
              </thead>
              <tbody>
                {listLoading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                      불러오는 중…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
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
