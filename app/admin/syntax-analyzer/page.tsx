'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type PassageListItem = {
  _id: string;
  textbook: string;
  chapter: string;
  number: string;
  source_key?: string;
  content?: { original?: string };
};

type PassageFull = PassageListItem & {
  content?: {
    original?: string;
    sentences_en?: string[];
  };
};

function splitSentencesFromOriginal(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  return t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function deriveSentences(passage: PassageFull | null): string[] {
  if (!passage?.content) return [];
  const en = passage.content.sentences_en;
  if (Array.isArray(en) && en.length > 0) {
    return en.map((s) => String(s).trim()).filter(Boolean);
  }
  return splitSentencesFromOriginal(passage.content.original || '');
}

function listProgressPct(map: Record<string, number>, id: string): number {
  const v = map[id.trim().toLowerCase()];
  return typeof v === 'number' && !Number.isNaN(v) ? Math.min(100, Math.max(0, v)) : 0;
}

function PassageListRow({
  p,
  selected,
  progressPercent,
  onPick,
}: {
  p: PassageListItem;
  selected: boolean;
  progressPercent: number;
  onPick: (id: string) => void;
}) {
  const half = progressPercent >= 50;
  const full = (p.content?.original || '');
  const orig = full.slice(0, 72);
  const truncated = full.length > 72;
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(p._id)}
        className={`w-full min-w-0 text-left px-3 py-2 text-sm transition-colors ${
          selected
            ? 'bg-sky-900/30 text-sky-100 border-l-2 border-sky-500/40'
            : half
              ? 'bg-emerald-950/25 border-l-2 border-emerald-500/50 text-slate-200'
              : 'text-slate-200 border-l-2 border-transparent'
        } hover:bg-slate-900/60`}
      >
        <span
          className={`font-mono text-xs mr-2 tabular-nums ${half ? 'text-emerald-400 font-semibold' : 'text-slate-400'}`}
        >
          {p.chapter} · {p.number}
        </span>
        {orig}
        {truncated ? '…' : ''}
      </button>
    </li>
  );
}

/** 교재 링크 폴더: 미분류 또는 폴더 id면 교재 없이도 passages 목록 조회 */
function linkFolderLoadsPassages(scope: string): boolean {
  if (scope === 'unassigned') return true;
  return scope.length === 24 && /^[a-f0-9]{24}$/i.test(scope);
}

/** Claude Code Pro 채팅용 cc:syntax CLI 사용 가이드 패널 (접힘/펼침). */
function CcSyntaxCliPanel() {
  const [open, setOpen] = useState(false);
  return (
    <section className="bg-violet-950/30 border border-violet-700/40 rounded-xl p-4">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full text-left flex items-center justify-between gap-2"
        aria-expanded={open}
      >
        <span className="text-sm font-bold text-violet-200">
          🤖 Claude Code 자동화 (<code className="text-violet-100">cc:syntax</code>) — 한 지문 전 항목 분석 (Pro 전용)
        </span>
        <span className="text-violet-300 text-xs">{open ? '▼ 접기' : '▶ 펼치기'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 text-xs text-violet-100/90">
          <p className="leading-relaxed">
            <strong className="text-violet-200">ANTHROPIC API 키 호출 없음</strong> — Pro 채팅에서 분석 JSON 을 작성하고 CLI 가 검증·저장만. 종합분석·주제문장·서술형대비·어법·문맥·끊어읽기·SVOC·구문·문법태그·문법포인트·단어장 등 모든 카테고리를 한 번에 채워 저장.
          </p>

          <div className="rounded-lg bg-slate-950/60 border border-violet-700/30 p-3 space-y-2">
            <div className="text-[11px] text-violet-300 font-semibold uppercase tracking-wide">기본 명령</div>
            <CmdBlock cmd="npm run cc:syntax -- textbooks" desc="교재 목록" />
            <CmdBlock cmd='npm run cc:syntax -- passages --textbook "..."' desc="교재의 지문 목록 + 진척률" />
            <CmdBlock cmd="npm run cc:syntax -- passage --id <passageId>" desc="지문 원문·문장표·현재 진척률" />
            <CmdBlock cmd='npm run cc:syntax -- shortage --textbook "..." [--required 100]' desc="진척률 100% 미만 지문 목록" />
            <CmdBlock cmd='npm run cc:syntax -- next-empty --textbook "..."' desc="자동 루프용 — 다음 빈 지문 1 건" />
          </div>

          <div className="rounded-lg bg-slate-950/60 border border-violet-700/30 p-3 space-y-2">
            <div className="text-[11px] text-violet-300 font-semibold uppercase tracking-wide">저장</div>
            <CmdBlock cmd="npm run cc:syntax -- save --json draft.json --dry-run" desc="검증만 (DB 변경 X)" />
            <CmdBlock cmd="npm run cc:syntax -- save --json draft.json" desc="검증 통과 시 passage_analyses 갱신" />
            <CmdBlock cmd="npm run cc:syntax -- save-all draft1.json draft2.json" desc="여러 파일 일괄" />
            <CmdBlock cmd="npm run cc:syntax -- export <passageId>" desc="기존 분석 main JSON 덤프 (백업용)" />
          </div>

          <div className="rounded-lg bg-slate-950/60 border border-violet-700/30 p-3 space-y-1">
            <div className="text-[11px] text-violet-300 font-semibold uppercase tracking-wide">작성 흐름 (Pro 채팅)</div>
            <ol className="list-decimal list-inside text-[11px] space-y-0.5 text-violet-100/85">
              <li><code className="text-emerald-300">passage --id …</code> 로 지문·문장표 받기</li>
              <li><code className="text-emerald-300">scripts/cc-syntax-prompt.md</code> 규칙대로 JSON 작성 (<code>.syntax-drafts/&lt;pid&gt;.json</code>)</li>
              <li><code className="text-emerald-300">save --dry-run</code> 으로 검증</li>
              <li>통과 시 <code className="text-emerald-300">save</code> 로 실제 저장</li>
            </ol>
            <p className="text-[10px] text-violet-300/70 mt-2">
              자동 채움 루프 (10 분마다 1 지문) — 채팅에 첨부:
              <code className="text-violet-200"> @scripts/cc-syntax-loop-prompt.md 워크플로우대로 교재 "&lt;textbook&gt;" 1 cycle 돌려줘.</code>
            </p>
          </div>

          <div className="rounded-lg bg-rose-950/30 border border-rose-700/30 p-3">
            <div className="text-[11px] text-rose-300 font-semibold uppercase tracking-wide mb-1">금지</div>
            <ul className="text-[11px] text-rose-200/85 list-disc list-inside space-y-0.5">
              <li><code>passage-analyzer-cli.ts run-ai</code> (ANTHROPIC API) 호출</li>
              <li><code>/api/admin/passage-analyzer/comprehensive-analysis</code> 등 AI 라우트 직접 호출</li>
              <li>검증 실패 시 <code>--force</code> 같은 우회 (옵션 없음, 추가 요청 시에도 거부)</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

function CmdBlock({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="flex-1 text-[11px] text-emerald-300 bg-slate-900/60 px-2 py-1 rounded font-mono break-all">{cmd}</code>
      <span className="text-[10px] text-violet-300/70 shrink-0 mt-1">{desc}</span>
    </div>
  );
}

export default function AdminSyntaxAnalyzerPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ loginId: string; role: string } | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [textbooks, setTextbooks] = useState<string[]>([]);
  const [filterTextbook, setFilterTextbook] = useState('');
  const [passageItems, setPassageItems] = useState<PassageListItem[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [selectedPassage, setSelectedPassage] = useState<PassageFull | null>(null);
  const [passageLoading, setPassageLoading] = useState(false);

  const [sentences, setSentences] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [progressByPassageId, setProgressByPassageId] = useState<Record<string, number>>({});

  /** 원문 관리·교재 구매 링크와 동일한 textbook_link_folders */
  const [linkFolderScope, setLinkFolderScope] = useState('');
  const [linkFolders, setLinkFolders] = useState<{ id: string; name: string }[]>([]);
  const [linkFoldersLoading, setLinkFoldersLoading] = useState(false);
  /** textbookKey → folderId (교재 링크 분류, passages 필터·드롭다운과 동일) */
  const [linkAssignments, setLinkAssignments] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.user || d.user.role !== 'admin') {
          router.replace('/admin/login?from=/admin/syntax-analyzer');
          return;
        }
        setUser(d.user);
      })
      .catch(() => router.replace('/admin/login?from=/admin/syntax-analyzer'))
      .finally(() => setLoadingAuth(false));
  }, [router]);

  const fetchTextbooks = useCallback(() => {
    fetch('/api/admin/passages/textbooks', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setTextbooks(Array.isArray(d.textbooks) ? d.textbooks : []))
      .catch(() => setTextbooks([]));
  }, []);

  const fetchLinkFolders = useCallback(() => {
    if (!user) return;
    setLinkFoldersLoading(true);
    fetch('/api/admin/textbook-link-folders', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const list = Array.isArray(d.folders) ? d.folders : [];
        setLinkFolders(
          list.map((f: { id?: string; name?: string }) => ({
            id: String(f.id || '').toLowerCase(),
            name: String(f.name || ''),
          }))
        );
      })
      .catch(() => setLinkFolders([]))
      .finally(() => setLinkFoldersLoading(false));
  }, [user]);

  const fetchLinkAssignments = useCallback(() => {
    if (!user) return;
    fetch('/api/admin/textbook-link-folder-assignments', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const raw = d?.assignments;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const next: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof v === 'string' && v.trim()) next[k] = v.trim().toLowerCase();
          }
          setLinkAssignments(next);
        } else {
          setLinkAssignments({});
        }
      })
      .catch(() => setLinkAssignments({}));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchTextbooks();
    fetchLinkFolders();
    fetchLinkAssignments();
  }, [user, fetchTextbooks, fetchLinkFolders, fetchLinkAssignments]);

  useEffect(() => {
    if (!filterTextbook) return;
    if (!textbooks.includes(filterTextbook)) {
      setFilterTextbook('');
      setSelectedPassage(null);
      setSentences([]);
    }
  }, [textbooks, filterTextbook]);

  const textbooksForPicker = useMemo(() => {
    const sorted = [...textbooks].sort((a, b) => a.localeCompare(b, 'ko'));
    if (!linkFolderScope) return sorted;
    if (linkFolderScope === 'unassigned') {
      return sorted.filter((t) => !linkAssignments[t]);
    }
    if (/^[a-f0-9]{24}$/i.test(linkFolderScope)) {
      const norm = linkFolderScope.toLowerCase();
      return sorted.filter((t) => (linkAssignments[t] || '') === norm);
    }
    return sorted;
  }, [textbooks, linkFolderScope, linkAssignments]);

  useEffect(() => {
    if (!linkFolderScope) return;
    if (linkFolderScope === 'unassigned') {
      setFilterTextbook((prev) => {
        if (!prev) return prev;
        return linkAssignments[prev] ? '' : prev;
      });
      return;
    }
    if (!/^[a-f0-9]{24}$/i.test(linkFolderScope)) return;
    const norm = linkFolderScope.toLowerCase();
    setFilterTextbook((prev) => {
      if (!prev) return prev;
      return (linkAssignments[prev] || '') === norm ? prev : '';
    });
  }, [linkFolderScope, linkAssignments]);

  const fetchPassageList = useCallback(() => {
    const byLinkFolder = linkFolderLoadsPassages(linkFolderScope);
    if (!filterTextbook && !byLinkFolder) {
      setPassageItems([]);
      return;
    }
    setListLoading(true);
    const params = new URLSearchParams();
    if (filterTextbook) params.set('textbook', filterTextbook);
    if (linkFolderScope) {
      const scopeParam =
        linkFolderScope === 'unassigned'
          ? 'unassigned'
          : /^[a-f0-9]{24}$/i.test(linkFolderScope)
            ? linkFolderScope.toLowerCase()
            : linkFolderScope;
      params.set('linkFolderScope', scopeParam);
    }
    params.set('page', '1');
    params.set('limit', '500');
    fetch(`/api/admin/passages?${params}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setPassageItems(Array.isArray(d.items) ? d.items : []))
      .catch(() => setPassageItems([]))
      .finally(() => setListLoading(false));
  }, [filterTextbook, linkFolderScope]);

  useEffect(() => {
    if (!user) return;
    fetchPassageList();
  }, [user, fetchPassageList]);

  useEffect(() => {
    if (!passageItems.length) {
      setProgressByPassageId({});
      return;
    }
    let cancelled = false;
    const ids = passageItems.map((p) => p._id);
    fetch('/api/admin/passage-analyzer/list-progress', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passageIds: ids }),
    })
      .then((r) => r.json())
      .then((d: { progress?: Record<string, number> }) => {
        if (cancelled) return;
        const pr = d.progress;
        setProgressByPassageId(pr && typeof pr === 'object' ? pr : {});
      })
      .catch(() => {
        if (!cancelled) setProgressByPassageId({});
      });
    return () => {
      cancelled = true;
    };
  }, [passageItems]);

  const loadPassage = async (id: string) => {
    setPassageLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/admin/passages/${id}`, { credentials: 'include' });
      const d = await res.json();
      if (!res.ok || !d.item) {
        setErrorMsg(d.error || '지문을 불러오지 못했습니다.');
        setSelectedPassage(null);
        setSentences([]);
        return;
      }
      const p = d.item as PassageFull;
      setSelectedPassage(p);
      const sents = deriveSentences(p);
      setSentences(sents);
    } catch {
      setErrorMsg('지문 요청 실패');
      setSelectedPassage(null);
      setSentences([]);
    } finally {
      setPassageLoading(false);
    }
  };

  const passageListByTextbook = useMemo(() => {
    const m = new Map<string, PassageListItem[]>();
    for (const p of passageItems) {
      const t = p.textbook || '—';
      if (!m.has(t)) m.set(t, []);
      m.get(t)!.push(p);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'));
  }, [passageItems]);

  const groupPassageListByTextbook = passageListByTextbook.length > 1;

  const listDrivenByLinkFolder = linkFolderLoadsPassages(linkFolderScope);
  const canShowPassageList = listDrivenByLinkFolder || !!filterTextbook;

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-spin w-10 h-10 border-4 border-slate-600 border-t-white rounded-full" />
      </div>
    );
  }

  return (
    <div className="text-white">
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        <header className="mb-2">
          <h1 className="text-lg font-bold text-white">지문분석기 홈</h1>
          <p className="text-slate-400 text-sm mt-1">
            지문을 고른 뒤{' '}
            <strong className="text-slate-300">분석 작업대</strong>에서 구문·SVOC·저장 등을 진행합니다.
          </p>
        </header>
        <CcSyntaxCliPanel />
        <div className="space-y-6">
          <section className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <h2 className="text-sm font-bold text-slate-200 mb-1">지문 선택 (passages)</h2>
            <p className="text-[11px] text-slate-500 mb-3">
              <strong className="text-slate-400">폴더</strong>는 원문 관리 맨 위{' '}
              <strong className="text-slate-400">교재 구매 링크</strong>에서 쓰는 것과{' '}
              <strong className="text-slate-400">같은 목록</strong>입니다(교재명 기준). 「미분류」·특정 폴더를 고르면
              해당 교재의 지문만 나옵니다. 「전체」는 교재를 골라 주세요. 폴더 이름 추가·삭제도 그 링크 섹션에서
              합니다.
            </p>
            <p className="text-[10px] text-emerald-500/85 mb-3 leading-relaxed">
              분석 작업대 진행(10단계·자동 감지 기준)이 <strong className="text-emerald-400/95">50% 이상</strong>인
              지문은 <strong className="text-emerald-400/95">회차·번호</strong>가 초록으로 강조되고, 행 왼쪽에
              초록 띠가 보입니다.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-1">
              <div>
                <label className="block text-xs text-slate-400 mb-1">폴더 (링크 분류)</label>
                <select
                  value={linkFolderScope}
                  onChange={(e) => {
                    const v = e.target.value;
                    setLinkFolderScope(v);
                    setSelectedPassage(null);
                    setSentences([]);
                  }}
                  disabled={!user || linkFoldersLoading}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
                >
                  <option value="">전체 (교재 선택 필요)</option>
                  <option value="unassigned">미분류</option>
                  {linkFolders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name || f.id}
                    </option>
                  ))}
                </select>
                {user && !linkFoldersLoading && linkFolders.length === 0 ? (
                  <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                    링크용 폴더가 없습니다.{' '}
                    <Link href="/admin/passages" className="text-sky-400/90 hover:underline">
                      원문 관리 → 교재 구매 링크
                    </Link>
                    에서 「링크 분류」로 폴더를 추가하세요.
                  </p>
                ) : null}
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">교재 (선택)</label>
                <p className="text-[10px] text-slate-500 mb-1.5 leading-relaxed">
                  단어장 탭에서 추출·저장된 지문이 하나라도 있는 교재만 목록에 나옵니다.
                </p>
                <select
                  value={filterTextbook}
                  onChange={(e) => {
                    setFilterTextbook(e.target.value);
                    setSelectedPassage(null);
                    setSentences([]);
                  }}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value="">{listDrivenByLinkFolder ? '전체 교재 (폴더 기준)' : '교재를 선택하세요'}</option>
                  {textbooksForPicker.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4 max-h-[min(24rem,50vh)] overflow-y-auto rounded-lg border border-slate-700">
              {!canShowPassageList ? (
                <p className="p-4 text-slate-500 text-sm">
                  폴더에서 「미분류」·특정 폴더를 고르거나, 교재를 선택하면 지문 목록이 표시됩니다.
                </p>
              ) : listLoading ? (
                <p className="p-4 text-slate-400 text-sm">불러오는 중…</p>
              ) : passageItems.length === 0 ? (
                <p className="p-4 text-slate-500 text-sm">조건에 맞는 지문이 없습니다.</p>
              ) : groupPassageListByTextbook ? (
                <div className="divide-y divide-slate-700/80">
                  {passageListByTextbook.map(([tb, rows]) => (
                    <div key={tb}>
                      <div className="sticky top-0 z-[1] px-3 py-1.5 text-xs font-semibold text-slate-300 bg-slate-800/95 border-b border-slate-600/80 backdrop-blur-sm">
                        {tb}
                      </div>
                      <ul className="divide-y divide-slate-700/60">
                        {rows.map((p) => (
                          <PassageListRow
                            key={p._id}
                            p={p}
                            selected={selectedPassage?._id === p._id}
                            progressPercent={listProgressPct(progressByPassageId, p._id)}
                            onPick={loadPassage}
                          />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : (
                <ul className="divide-y divide-slate-700/80">
                  {passageItems.map((p) => (
                    <PassageListRow
                      key={p._id}
                      p={p}
                      selected={selectedPassage?._id === p._id}
                      progressPercent={listProgressPct(progressByPassageId, p._id)}
                      onPick={loadPassage}
                    />
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            <h2 className="text-sm font-bold text-slate-200 mb-3">다음 단계</h2>
            {passageLoading && <p className="text-slate-400 text-sm mb-3">지문 로딩…</p>}
            {errorMsg && <p className="text-red-400 text-sm mb-3">{errorMsg}</p>}

            {!selectedPassage && !passageLoading ? (
              <p className="text-slate-500 text-sm">위 지문 목록에서 항목을 선택하면 작업대로 이동할 수 있습니다.</p>
            ) : selectedPassage ? (
              <div className="space-y-4">
                <p className="text-slate-300 text-sm">
                  <span className="text-slate-500">선택됨</span>{' '}
                  <span className="font-medium text-white">
                    {selectedPassage.textbook} · {selectedPassage.chapter} {selectedPassage.number}
                  </span>
                  {sentences.length > 0 ? (
                    <span className="text-slate-500"> · 문장 {sentences.length}개</span>
                  ) : null}
                </p>
                <Link
                  href={`/admin/syntax-analyzer/analyze?passageId=${selectedPassage._id}`}
                  className="inline-flex items-center justify-center w-full sm:w-auto px-6 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-base font-semibold shadow-lg shadow-sky-950/40 transition"
                >
                  이 지문을 분석 작업대에서 열기
                </Link>
                {sentences.length > 0 ? (
                  <details className="rounded-lg border border-slate-700/80 bg-slate-900/30">
                    <summary className="cursor-pointer select-none px-3 py-2 text-xs text-slate-400 hover:text-slate-300">
                      문장 미리보기 ({sentences.length}개)
                    </summary>
                    <ul className="px-3 pb-3 pt-1 space-y-2 border-t border-slate-700/60 max-h-[min(18rem,40vh)] overflow-y-auto">
                      {sentences.map((sent, idx) => (
                        <li key={idx} className="text-slate-400 text-sm">
                          <span className="text-slate-600 text-xs mr-2">{idx + 1}.</span>
                          <span className="text-slate-300">{sent}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}
