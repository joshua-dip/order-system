'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PassageFolderScopeBar, type PassageAdminFolder } from '@/app/components/admin/PassageFolderScopeBar';
import { TextbookLinkFolderScopeBar, type TextbookLinkFolder } from '@/app/components/admin/TextbookLinkFolderScopeBar';
import { passageAnalysisFileNameForPassageId } from '@/lib/passage-analyzer-types';

const SOLBOOK_PUBLISHERS = ['YBM', '쎄듀', 'NE능률'] as const;
type SolbookPublisher = typeof SOLBOOK_PUBLISHERS[number];

type PassageListItem = {
  _id: string;
  textbook: string;
  chapter: string;
  number: string;
  source_key?: string;
  page?: number;
  page_label?: string;
  order?: number;
  publisher?: SolbookPublisher | null;
  content?: { original?: string };
  created_at?: string;
  updated_at?: string;
  folder_id?: string | null;
};

type PassageFull = PassageListItem & {
  publisher?: SolbookPublisher | null;
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
  publisher: '' as SolbookPublisher | '',
  original: '',
  translation: '',
};

/* ── 교재 JSON 데이터 구조 패널 ────────────────────────────────────── */

type TextbookJsonTree = Record<string, Record<string, unknown>>;

function buildSummaryTree(raw: Record<string, unknown>): TextbookJsonTree {
  const out: TextbookJsonTree = {};
  for (const [tbKey, tbVal] of Object.entries(raw)) {
    if (!tbVal || typeof tbVal !== 'object') continue;
    // 최상위 키 수준 집계 (강 목록)
    const chapterMap: Record<string, unknown> = {};
    const collectChapters = (obj: Record<string, unknown>, depth = 0) => {
      if (depth > 5) return;
      for (const [k, v] of Object.entries(obj)) {
        if (k === '부교재' && v && typeof v === 'object') {
          const inner = v as Record<string, unknown>;
          for (const [tbk, tbv] of Object.entries(inner)) {
            if (tbk === tbKey || !tbv || typeof tbv !== 'object') continue;
            collectChapters(tbv as Record<string, unknown>, depth + 1);
          }
          // 같은 교재키 하위
          if (inner[tbKey] && typeof inner[tbKey] === 'object') {
            const chapters = inner[tbKey] as Record<string, unknown>;
            for (const [ck, cv] of Object.entries(chapters)) {
              chapterMap[ck] = Array.isArray(cv) ? `${cv.length}개 번호` : typeof cv;
            }
          }
          continue;
        }
        if (Array.isArray(v)) {
          chapterMap[k] = `${v.length}개 번호`;
        } else if (v && typeof v === 'object') {
          collectChapters(v as Record<string, unknown>, depth + 1);
        } else {
          chapterMap[k] = v;
        }
      }
    };
    collectChapters(tbVal as Record<string, unknown>);
    out[tbKey] = chapterMap;
  }
  return out;
}

/* ── 쏠북 교재 구분 패널 ────────────────────────────────────────────── */

const SOLBOOK_TYPE_LABELS: Record<string, string> = {
  교과서: '교과서',
  부교재: '부교재',
};

function SolbookTypePanelSection({
  publisherByTextbook,
  textbookTypeByTextbook,
  textbookTypeSavingKey,
  onSave,
  msg,
}: {
  publisherByTextbook: Record<string, string | null>;
  textbookTypeByTextbook: Record<string, '교과서' | '부교재' | null>;
  textbookTypeSavingKey: string | null;
  onSave: (key: string, type: '교과서' | '부교재' | '') => Promise<void>;
  msg: { type: 'ok' | 'err'; text: string } | null;
}) {
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState('');

  // publisher가 설정된 교재 + textbookType이 설정된 교재 합집합
  // (지문이 없어 publisher가 passages에 없는 교재도 type 설정이 있으면 표시)
  const solbookKeySet = new Set<string>([
    ...Object.entries(publisherByTextbook).filter(([, pub]) => !!pub).map(([k]) => k),
    ...Object.keys(textbookTypeByTextbook),
  ]);
  const solbookKeys = [...solbookKeySet].sort((a, b) => a.localeCompare(b, 'ko'));

  const filtered = search.trim()
    ? solbookKeys.filter((k) => k.toLowerCase().includes(search.toLowerCase()))
    : solbookKeys;

  const typeColor = (t: '교과서' | '부교재' | null) => {
    if (t === '교과서') return 'text-amber-300';
    if (t === '부교재') return 'text-orange-300';
    return 'text-slate-500';
  };

  return (
    <section className="bg-slate-800/50 border border-slate-700 rounded-xl mb-6 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-800/80 transition-colors"
      >
        <div>
          <h2 className="text-base font-bold text-white">
            쏠북 교재 구분 관리
            <span className="ml-2 text-xs font-normal text-slate-400">
              (교과서 / 부교재)
            </span>
          </h2>
          <p className="text-slate-400 text-xs mt-0.5">
            쏠북 출판사가 지정된 교재의 교과서·부교재 구분을 설정합니다.{' '}
            <code className="text-amber-200/90">passages.textbookType</code>
          </p>
        </div>
        <span className="text-slate-400 shrink-0">{open ? '▼' : '▶'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-700/80 px-4 pb-4">
          {solbookKeys.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              설정된 쏠북 교재가 없습니다.{' '}
              <span className="text-slate-400">위 "교재 메타데이터 관리"에서 출판사를 설정하거나, 여기서 직접 교과서/부교재를 지정하세요.</span>
            </p>
          ) : (
            <>
              <div className="py-3">
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="교재명 검색…"
                  className="w-full max-w-xs bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder:text-slate-500"
                />
              </div>
              {msg && (
                <p className={`text-sm mb-2 ${msg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {msg.text}
                </p>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {filtered.map((key) => {
                  const currentType = textbookTypeByTextbook[key] ?? null;
                  const isSaving = textbookTypeSavingKey === key;
                  const publisher = publisherByTextbook[key];
                  return (
                    <div
                      key={key}
                      className="flex flex-col gap-1.5 rounded-xl border border-slate-700 bg-slate-900/60 px-3 py-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium text-white leading-tight line-clamp-2" title={key}>
                          {key}
                        </p>
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold bg-slate-700 text-slate-300">
                          {publisher}
                        </span>
                      </div>
                      <div className="flex gap-1.5 mt-0.5">
                        {(['교과서', '부교재'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            disabled={isSaving}
                            onClick={() => onSave(key, currentType === t ? '' : t)}
                            className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition-all disabled:opacity-50 ${
                              currentType === t
                                ? t === '교과서'
                                  ? 'bg-amber-500 text-white shadow'
                                  : 'bg-orange-600 text-white shadow'
                                : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-white'
                            }`}
                          >
                            {SOLBOOK_TYPE_LABELS[t]}
                          </button>
                        ))}
                      </div>
                      <p className={`text-[10px] ${typeColor(currentType)}`}>
                        {currentType ? `현재: ${currentType}` : '미지정'}
                        {isSaving && ' · 저장 중…'}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function TextbookJsonPanel() {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'tree' | 'json'>('tree');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [jsonSearch, setJsonSearch] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    fetch('/api/textbooks')
      .then((r) => r.json())
      .then((d) => setRaw(d as Record<string, unknown>))
      .catch(() => setErr('데이터를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (open && !raw) load();
  }, [open, raw, load]);

  const summaryTree = useMemo(() => (raw ? buildSummaryTree(raw) : {}), [raw]);

  const topKeys = useMemo(() => Object.keys(summaryTree).sort((a, b) => a.localeCompare(b, 'ko')), [summaryTree]);

  const filteredKeys = useMemo(() => {
    if (!jsonSearch.trim()) return topKeys;
    const q = jsonSearch.toLowerCase();
    return topKeys.filter((k) => {
      if (k.toLowerCase().includes(q)) return true;
      const chapters = summaryTree[k] || {};
      return Object.keys(chapters).some((ck) => ck.toLowerCase().includes(q));
    });
  }, [topKeys, jsonSearch, summaryTree]);

  const toggleKey = (k: string) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  return (
    <section className="bg-slate-800/50 border border-slate-700 rounded-xl mb-6 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-800/80 transition-colors"
      >
        <div>
          <h2 className="text-base font-bold text-white">교재 JSON 데이터 구조</h2>
          <p className="text-slate-400 text-xs mt-0.5">
            <code className="text-amber-200/90">/api/textbooks</code>
            {' '}— MongoDB{' '}
            <code className="text-amber-200/90">converted_textbook_json</code>
            {' '}/ converted_data.json. 주문 화면에서 강·번호 목록을 이 데이터에서 읽습니다.
          </p>
        </div>
        <span className="text-slate-400 shrink-0">{open ? '▼' : '▶'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-700/80 px-4 pb-4">
          <div className="flex flex-wrap gap-2 items-center py-3">
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm disabled:opacity-50"
            >
              {loading ? '불러오는 중…' : '새로고침'}
            </button>
            <div className="flex rounded-lg overflow-hidden border border-slate-600 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('tree')}
                className={`px-3 py-1.5 ${viewMode === 'tree' ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                트리 보기
              </button>
              <button
                type="button"
                onClick={() => setViewMode('json')}
                className={`px-3 py-1.5 ${viewMode === 'json' ? 'bg-slate-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                JSON 원본
              </button>
            </div>
            {raw && (
              <span className="text-slate-500 text-xs">
                총 {topKeys.length}개 교재
              </span>
            )}
          </div>

          {err && <p className="text-red-400 text-sm mb-3">{err}</p>}

          {raw && viewMode === 'tree' && (
            <div>
              <div className="mb-3">
                <input
                  type="search"
                  value={jsonSearch}
                  onChange={(e) => setJsonSearch(e.target.value)}
                  placeholder="교재명·강 검색…"
                  className="w-full max-w-sm bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-slate-500"
                />
              </div>
              <div className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-700 font-mono text-xs">
                {filteredKeys.length === 0 ? (
                  <p className="px-4 py-6 text-slate-500 text-center">검색 결과 없음</p>
                ) : (
                  filteredKeys.map((tbKey) => {
                    const chapters = summaryTree[tbKey] || {};
                    const chapterKeys = Object.keys(chapters);
                    const isExpanded = expandedKeys.has(tbKey);
                    return (
                      <div key={tbKey} className="border-b border-slate-700/60 last:border-0">
                        <button
                          type="button"
                          onClick={() => toggleKey(tbKey)}
                          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-800/60 text-left"
                        >
                          <span className="text-slate-500 w-3 shrink-0">{isExpanded ? '▼' : '▶'}</span>
                          <span className="text-emerald-300 flex-1 truncate">{JSON.stringify(tbKey)}</span>
                          <span className="text-slate-500 shrink-0">{chapterKeys.length}강</span>
                        </button>
                        {isExpanded && (
                          <div className="bg-slate-900/40 pl-8 pr-3 pb-2">
                            {chapterKeys.length === 0 ? (
                              <p className="text-slate-500 py-1">강 데이터 없음</p>
                            ) : (
                              chapterKeys.map((ck) => (
                                <div key={ck} className="flex items-center gap-2 py-0.5">
                                  <span className="text-sky-300 flex-1">{JSON.stringify(ck)}</span>
                                  <span className="text-amber-200/70">{String(chapters[ck])}</span>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {raw && viewMode === 'json' && (
            <div className="relative">
              <pre className="max-h-[60vh] overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-green-200 font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(raw, null, 2)}
              </pre>
            </div>
          )}

          {!raw && !loading && !err && (
            <p className="text-slate-500 text-sm py-4 text-center">패널을 열면 자동으로 데이터를 불러옵니다.</p>
          )}
        </div>
      )}
    </section>
  );
}

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

  /** 엑셀 일괄 업로드 (교재 구조 → converted_data.json) */
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSaving, setUploadSaving] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [uploadFromDbTextbook, setUploadFromDbTextbook] = useState('');
  const [uploadFromDbSaving, setUploadFromDbSaving] = useState(false);

  /** MongoDB textbook_links + 출판사 — 교재 메타데이터 종합 관리 */
  const [linksPanelOpen, setLinksPanelOpen] = useState(true);
  type LinkDraftRow = { kyoboUrl: string; description: string; extraUrl: string; extraLabel: string };
  const emptyLinkDraft = (): LinkDraftRow => ({
    kyoboUrl: '',
    description: '',
    extraUrl: '',
    extraLabel: '',
  });
  const [linkDrafts, setLinkDrafts] = useState<Record<string, LinkDraftRow>>({});
  const [publisherByTextbook, setPublisherByTextbook] = useState<Record<string, SolbookPublisher | null>>({});
  const [publisherSavingKey, setPublisherSavingKey] = useState<string | null>(null);
  const [textbookTypeByTextbook, setTextbookTypeByTextbook] = useState<Record<string, '교과서' | '부교재' | null>>({});
  const [textbookTypeSavingKey, setTextbookTypeSavingKey] = useState<string | null>(null);
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
        const map = d.links as Record<
          string,
          { kyoboUrl?: string; description?: string; extraUrl?: string; extraLabel?: string }
        >;
        const next: Record<string, LinkDraftRow> = {};
        for (const [k, v] of Object.entries(map)) {
          next[k] = {
            kyoboUrl: typeof v?.kyoboUrl === 'string' ? v.kyoboUrl : '',
            description: typeof v?.description === 'string' ? v.description : '',
            extraUrl: typeof v?.extraUrl === 'string' ? v.extraUrl : '',
            extraLabel: typeof v?.extraLabel === 'string' ? v.extraLabel : '',
          };
        }
        setLinkDrafts((prev) => {
          const out: Record<string, LinkDraftRow> = { ...next };
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

  const fetchPublisherByTextbook = useCallback(() => {
    fetch('/api/admin/passages/publisher-by-textbook', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.publishers && typeof d.publishers === 'object') {
          setPublisherByTextbook(d.publishers as Record<string, SolbookPublisher | null>);
        }
      })
      .catch(() => {});
  }, []);

  const fetchTextbookTypeByTextbook = useCallback(() => {
    fetch('/api/admin/passages/textbook-type-by-textbook', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d.textbookTypes && typeof d.textbookTypes === 'object') {
          setTextbookTypeByTextbook(d.textbookTypes as Record<string, '교과서' | '부교재' | null>);
        }
      })
      .catch(() => {});
  }, []);

  const saveTextbookTypeForTextbook = async (textbookKey: string, textbookType: '교과서' | '부교재' | '') => {
    setTextbookTypeSavingKey(textbookKey);
    setLinkMsg(null);
    try {
      const res = await fetch('/api/admin/passages/textbook-type-by-textbook', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textbookKey, textbookType: textbookType || null }),
      });
      const j = await res.json();
      if (!res.ok) {
        setLinkMsg({ type: 'err', text: j.error || '구분 저장 실패' });
        return;
      }
      setTextbookTypeByTextbook((prev) => ({ ...prev, [textbookKey]: (textbookType as '교과서' | '부교재') || null }));
      setLinkMsg({ type: 'ok', text: `「${textbookKey}」 구분이 ${j.textbookType ?? '미지정'}으로 저장됐습니다.` });
    } catch {
      setLinkMsg({ type: 'err', text: '요청 실패' });
    } finally {
      setTextbookTypeSavingKey(null);
    }
  };

  const savePublisherForTextbook = async (textbookKey: string, publisher: SolbookPublisher | '') => {
    setPublisherSavingKey(textbookKey);
    setLinkMsg(null);
    try {
      const res = await fetch('/api/admin/passages/publisher-by-textbook', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ textbookKey, publisher: publisher || null }),
      });
      const j = await res.json();
      if (!res.ok) {
        setLinkMsg({ type: 'err', text: j.error || '출판사 저장 실패' });
        return;
      }
      setPublisherByTextbook((prev) => ({ ...prev, [textbookKey]: (publisher as SolbookPublisher) || null }));
      setLinkMsg({ type: 'ok', text: `「${textbookKey}」 출판사 저장됨 (${j.modifiedCount}건 업데이트)` });
    } catch {
      setLinkMsg({ type: 'err', text: '요청 실패' });
    } finally {
      setPublisherSavingKey(null);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchAdminTextbookLinks();
    fetchTextbookLinkAssignments();
    fetchPublisherByTextbook();
    fetchTextbookTypeByTextbook();
  }, [user, fetchAdminTextbookLinks, fetchTextbookLinkAssignments, fetchPublisherByTextbook, fetchTextbookTypeByTextbook]);

  useEffect(() => {
    setLinkDrafts((prev) => {
      const next = { ...prev };
      for (const t of textbooks) {
        if (!(t in next)) next[t] = emptyLinkDraft();
      }
      return next;
    });
  }, [textbooks]);

  const setLinkField = (
    textbookKey: string,
    field: keyof LinkDraftRow,
    value: string
  ) => {
    setLinkDrafts((prev) => {
      const cur = prev[textbookKey] ?? emptyLinkDraft();
      return {
        ...prev,
        [textbookKey]: { ...cur, [field]: value },
      };
    });
  };

  const saveTextbookLink = async (textbookKey: string) => {
    const d = linkDrafts[textbookKey];
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
        [textbookKey]: emptyLinkDraft(),
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

  const openUploadModal = () => {
    setUploadFile(null);
    setUploadMessage(null);
    setUploadFromDbTextbook(filterTextbook || '');
    setUploadModalOpen(true);
  };

  const handleUploadExcel = async () => {
    if (!uploadFile) {
      setUploadMessage({ type: 'error', text: '엑셀 파일을 선택해 주세요.' });
      return;
    }
    setUploadMessage(null);
    setUploadSaving(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      const res = await fetch('/api/admin/passage-upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setUploadMessage({
          type: 'success',
          text: `교재 "${data.textbookName}"가 지문 데이터(converted_data.json)에 반영되었습니다. 목록에서 확인해 보세요.`,
        });
        setUploadFile(null);
      } else {
        setUploadMessage({
          type: 'error',
          text: data?.error || data?.detail || '업로드에 실패했습니다.',
        });
      }
    } catch {
      setUploadMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setUploadSaving(false);
    }
  };

  const handleUploadFromDb = async () => {
    if (!uploadFromDbTextbook.trim()) {
      setUploadMessage({ type: 'error', text: 'MongoDB에서 가져올 교재명을 입력해 주세요.' });
      return;
    }
    setUploadMessage(null);
    setUploadFromDbSaving(true);
    try {
      const res = await fetch('/api/admin/passage-upload/from-passages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ textbook: uploadFromDbTextbook.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setUploadMessage({
          type: 'success',
          text: `교재 "${data.textbook}"를 MongoDB 원문(passages) 기준으로 converted_data.json에 반영했습니다. (강 ${data.lessonCount}개 · 원문 ${data.passageCount}건)`,
        });
      } else {
        setUploadMessage({
          type: 'error',
          text: data?.error || '불러오기에 실패했습니다.',
        });
      }
    } catch {
      setUploadMessage({ type: 'error', text: '요청 중 오류가 발생했습니다.' });
    } finally {
      setUploadFromDbSaving(false);
    }
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
        publisher: (SOLBOOK_PUBLISHERS as readonly string[]).includes(it.publisher ?? '') ? (it.publisher as SolbookPublisher) : '',
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
        publisher: form.publisher || null,
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
          <div className="flex items-center gap-3 flex-wrap justify-end">
            <Link
              href="/admin"
              className="text-slate-300 hover:text-white text-sm px-3 py-2 rounded-lg border border-slate-600 hover:border-slate-500"
            >
              ← 관리자 홈
            </Link>
            <Link
              href="/admin/generated-questions"
              className="text-teal-200 hover:text-white text-sm font-semibold px-3 py-2 rounded-lg border border-teal-600/45 hover:border-teal-400/60 bg-teal-950/25"
            >
              변형문제 관리 →
            </Link>
            <button
              type="button"
              onClick={openUploadModal}
              className="text-sky-100 hover:text-white text-sm font-semibold px-3 py-2 rounded-lg border border-sky-600/50 hover:border-sky-400/70 bg-sky-950/30"
              title="엑셀(.xlsx)로 교재 구조(강·번호)를 일괄 업로드하거나, MongoDB 원문 → converted_data.json으로 동기화합니다."
            >
              📁 지문 업로드
            </button>
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
              <h2 className="text-base font-bold text-white">교재 메타데이터 관리</h2>
              <p className="text-slate-400 text-xs mt-0.5">
                출판사(쏠북 포함 여부) · 구매 링크 · 폴더 분류를 교재 단위로 관리합니다. MongoDB{' '}
                <code className="text-amber-200/90">textbook_links</code>
                {' '}·{' '}
                <code className="text-amber-200/90">passages.publisher</code>
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
                  onClick={() => { fetchAdminTextbookLinks(); fetchPublisherByTextbook(); fetchTextbookTypeByTextbook(); }}
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
                      <th className="px-3 py-2 font-medium w-28">쏠북 출판사</th>
                      <th className="px-3 py-2 font-medium w-28">교과서/부교재</th>
                      <th className="px-3 py-2 font-medium min-w-[7rem]">폴더</th>
                      <th className="px-3 py-2 font-medium min-w-[200px]">구매 URL / 추가 링크</th>
                      <th className="px-3 py-2 font-medium min-w-[140px]">설명(툴팁)</th>
                      <th className="px-3 py-2 font-medium w-36 text-right">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linkRowKeys.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                          {textbooks.length === 0
                            ? '등록된 교재가 없습니다. 원문을 먼저 등록하면 교재명이 여기에 나타납니다.'
                            : '검색 결과가 없습니다.'}
                        </td>
                      </tr>
                    ) : (
                      linkRowKeys.map((key) => {
                        const draft = linkDrafts[key] ?? emptyLinkDraft();
                        const hasSaved = !!(draft.kyoboUrl?.trim() || draft.extraUrl?.trim());
                        const currentPublisher = publisherByTextbook[key] ?? null;
                        const isSavingPublisher = publisherSavingKey === key;
                        const currentTextbookType = textbookTypeByTextbook[key] ?? null;
                        const isSolbook = !!currentPublisher;
                        const isSavingType = textbookTypeSavingKey === key;
                        const hasPassages = (textbooks as string[]).includes(key);
                        return (
                          <tr key={key} className={`border-b border-slate-700/60 align-top hover:bg-slate-900/40 ${!hasPassages ? 'bg-red-950/20' : ''}`}>
                            <td className="px-3 py-2 text-slate-200">
                              <span className={`line-clamp-3 ${!hasPassages ? 'text-slate-400' : ''}`} title={key}>
                                {key}
                              </span>
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {!hasPassages && (
                                  <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-red-900/60 text-red-300 border border-red-800/50">
                                    지문 없음
                                  </span>
                                )}
                                {hasSaved && (
                                  <span className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300">
                                    링크 등록됨
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 align-top">
                              <select
                                value={currentPublisher ?? ''}
                                disabled={isSavingPublisher}
                                onChange={(e) => savePublisherForTextbook(key, e.target.value as SolbookPublisher | '')}
                                className="w-full bg-slate-900 border border-slate-600 rounded px-1.5 py-1 text-xs text-white disabled:opacity-50"
                              >
                                <option value="">없음</option>
                                {SOLBOOK_PUBLISHERS.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                              {isSavingPublisher && (
                                <span className="text-[10px] text-slate-500 mt-0.5 block">저장 중…</span>
                              )}
                            </td>
                            <td className="px-3 py-2 align-top">
                              {isSolbook ? (
                                <>
                                  <select
                                    value={currentTextbookType ?? ''}
                                    disabled={isSavingType}
                                    onChange={(e) => saveTextbookTypeForTextbook(key, e.target.value as '교과서' | '부교재' | '')}
                                    className="w-full bg-slate-900 border border-slate-600 rounded px-1.5 py-1 text-xs text-white disabled:opacity-50"
                                  >
                                    <option value="">미지정</option>
                                    <option value="교과서">교과서</option>
                                    <option value="부교재">부교재</option>
                                  </select>
                                  {isSavingType && (
                                    <span className="text-[10px] text-slate-500 mt-0.5 block">저장 중…</span>
                                  )}
                                </>
                              ) : (
                                <span className="text-[10px] text-slate-600">—</span>
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
                            <td className="px-3 py-2 space-y-1.5">
                              <input
                                value={draft.kyoboUrl}
                                onChange={(e) => setLinkField(key, 'kyoboUrl', e.target.value)}
                                placeholder="구매 URL (YES24 등)"
                                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-xs text-white font-mono"
                              />
                              <input
                                value={draft.extraLabel}
                                onChange={(e) => setLinkField(key, 'extraLabel', e.target.value)}
                                placeholder="추가 링크 제목 (예: [쏠북링크] …)"
                                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
                              />
                              <input
                                value={draft.extraUrl}
                                onChange={(e) => setLinkField(key, 'extraUrl', e.target.value)}
                                placeholder="추가 URL (블로그·안내)"
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
                교재명은 passages에 저장된 문자열과 정확히 같아야 주문 화면에서 매칭됩니다. 추가 링크·제목은 구매 URL이 없어도 등록할 수 있으며, 교과서 자료 주문(/gyogwaseo) 목록에서는 <strong className="text-slate-200">쏠북 구매·안내</strong>용 주 버튼으로 쓰입니다. 쏠북 출판사 변경 시 해당 교재의 모든 지문에 일괄 적용됩니다.
              </p>
            </div>
          )}
        </section>

        {/* 쏠북 교재 구분 (교과서/부교재) 관리 패널 */}
        <SolbookTypePanelSection
          publisherByTextbook={publisherByTextbook}
          textbookTypeByTextbook={textbookTypeByTextbook}
          textbookTypeSavingKey={textbookTypeSavingKey}
          onSave={saveTextbookTypeForTextbook}
          msg={linkMsg}
        />

        {/* 교재 JSON 데이터 구조 패널 */}
        <TextbookJsonPanel />

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
                  <th className="px-3 py-3 font-medium w-20">출판사</th>
                  <th className="px-3 py-3 font-medium min-w-[128px]">폴더</th>
                  <th className="px-3 py-3 font-medium min-w-[200px]">원문 미리보기</th>
                  <th className="px-3 py-3 font-medium w-32 text-right">작업</th>
                </tr>
              </thead>
              <tbody>
                {listLoading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                      불러오는 중…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
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
                        {row.publisher ? (
                          <span className="inline-block text-[11px] px-1.5 py-0.5 rounded bg-sky-900/50 text-sky-300 font-medium">
                            {row.publisher}
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
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
                <div>
                  <label className="text-xs text-slate-400 block mb-1">쏠북 출판사</label>
                  <select
                    value={form.publisher}
                    onChange={(e) => setForm((f) => ({ ...f, publisher: e.target.value as SolbookPublisher | '' }))}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  >
                    <option value="">없음 (쏠북 미포함)</option>
                    {SOLBOOK_PUBLISHERS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    선택하면 이 교재의 지문이 쏠북 업로드 대상 교재로 자동 포함됩니다.
                  </p>
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

      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 overflow-y-auto">
          <div className="bg-slate-800 border border-slate-600 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-slate-800 border-b border-slate-600 px-5 py-4 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold">지문 업로드</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  교재 구조(강 · 번호)를 일괄 등록합니다. 본문/번역은 등록 후 개별 편집에서 입력하세요.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="text-slate-400 hover:text-white text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="p-5 space-y-5">
              {uploadMessage && (
                <div
                  className={`text-sm rounded-lg px-3 py-2 border ${
                    uploadMessage.type === 'success'
                      ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-200'
                      : 'bg-rose-950/40 border-rose-700/50 text-rose-200'
                  }`}
                >
                  {uploadMessage.text}
                </div>
              )}

              <section className="border border-slate-600 rounded-xl p-4 bg-slate-900/40">
                <h3 className="text-sm font-bold text-white">① 엑셀 파일로 업로드</h3>
                <p className="text-xs text-slate-400 mt-1 mb-3">
                  열 구조(교재 / 강·회차 / 번호)를 갖춘{' '}
                  <code className="text-amber-200/90">.xlsx</code> 또는{' '}
                  <code className="text-amber-200/90">.xls</code> 파일을 선택하세요. 파일명이 교재명이 됩니다.
                </p>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-sky-700 file:text-white hover:file:bg-sky-600"
                />
                {uploadFile && (
                  <p className="text-xs text-slate-400 mt-2">
                    선택됨: <span className="text-slate-200">{uploadFile.name}</span> ({(uploadFile.size / 1024).toFixed(1)} KB)
                  </p>
                )}
                <div className="flex justify-end mt-3">
                  <button
                    type="button"
                    disabled={uploadSaving || !uploadFile}
                    onClick={handleUploadExcel}
                    className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold disabled:opacity-50"
                  >
                    {uploadSaving ? '업로드 중…' : '엑셀 업로드'}
                  </button>
                </div>
              </section>

              <section className="border border-slate-600 rounded-xl p-4 bg-slate-900/40">
                <h3 className="text-sm font-bold text-white">② MongoDB 원문 → 교재 구조 동기화</h3>
                <p className="text-xs text-slate-400 mt-1 mb-3">
                  이미 <code className="text-amber-200/90">passages</code> 컬렉션에 저장된 교재의 강·번호를{' '}
                  <code className="text-amber-200/90">converted_data.json</code>에 반영합니다. 새 원문을 직접 추가한 뒤
                  주문 화면에 반영해야 할 때 사용하세요.
                </p>
                <div className="flex flex-wrap gap-2">
                  <input
                    list="upload-textbook-options"
                    value={uploadFromDbTextbook}
                    onChange={(e) => setUploadFromDbTextbook(e.target.value)}
                    placeholder="교재명 입력 (예: 2027수능특강 영어(2026))"
                    className="flex-1 min-w-[260px] bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                  />
                  <datalist id="upload-textbook-options">
                    {textbooks.map((tb) => (
                      <option key={tb} value={tb} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    disabled={uploadFromDbSaving || !uploadFromDbTextbook.trim()}
                    onClick={handleUploadFromDb}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold disabled:opacity-50"
                  >
                    {uploadFromDbSaving ? '동기화 중…' : 'DB → 교재 구조 반영'}
                  </button>
                </div>
              </section>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
