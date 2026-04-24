'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AdminSidebar from '../_components/AdminSidebar';
import { ESSAY_DIFFICULTY_APPENDIX_TEXT } from '@/lib/essay-generator-difficulty-appendix';

// ── 타입 ───────────────────────────────────────────────────────────────────────

interface PassageItem {
  _id: string;
  textbook: string;
  chapter: string;
  number: string;
  source_key?: string;
  content?: { original?: string };
}

interface ExamQuestion {
  id: string;
  points: number;
  prompt: string;
  conditions: string[];
  bogi: string;
  answer_lines?: number;
  answer: {
    text: string;
    structure_analysis?: { label: string; content: string }[];
    grammar_points: { title: string; content: string }[];
    word_count: { total: number; words: string[]; note: string | null };
    intent_title?: string;
    intent_content: string;
  };
}

interface ExamData {
  meta: {
    title: string;
    difficulty?: string;
    subtitle: string;
    answer_subtitle?: string;
    info: { label: string; value: string }[];
  };
  question_set: { tag: string; instruction: string };
  passage: string;
  questions: ExamQuestion[];
}

// ── 지문 선택 모달 ─────────────────────────────────────────────────────────────

function PassagePickerModal({
  onSelect,
  onClose,
}: {
  onSelect: (p: PassageItem) => void;
  onClose: () => void;
}) {
  const LAST_TB_KEY = 'essay_generator_last_textbook';

  const [textbooks, setTextbooks] = useState<string[]>([]);
  /** SSR·첫 클라이언트 페인트와 동일해야 hydration 오류가 나지 않음 — localStorage는 mount 후 복원 */
  const [selectedTb, setSelectedTb] = useState('');
  const [passages, setPassages] = useState<PassageItem[]>([]);
  const [examCounts, setExamCounts] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [tbLoading, setTbLoading] = useState(true);

  useEffect(() => {
    try {
      const v = localStorage.getItem(LAST_TB_KEY);
      if (v) setSelectedTb(v);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetch('/api/admin/passages/textbooks', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setTextbooks(d.textbooks ?? []))
      .finally(() => setTbLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedTb) { setPassages([]); setExamCounts({}); return; }
    localStorage.setItem(LAST_TB_KEY, selectedTb);
    setLoading(true);
    Promise.all([
      fetch(`/api/admin/passages?textbook=${encodeURIComponent(selectedTb)}&limit=500`, { credentials: 'include' }).then(r => r.json()),
      fetch(`/api/admin/essay-generator/passage-exam-counts?textbook=${encodeURIComponent(selectedTb)}`, { credentials: 'include' }).then(r => r.json()).catch(() => ({ counts: {} })),
    ]).then(([pd, cd]) => {
      setPassages(pd.items ?? []);
      setExamCounts(cd.counts ?? {});
    }).finally(() => setLoading(false));
  }, [selectedTb]);

  const filtered = passages.filter(p => {
    if (!q.trim()) return true;
    const lq = q.toLowerCase();
    return (
      (p.source_key ?? '').toLowerCase().includes(lq) ||
      p.chapter.toLowerCase().includes(lq) ||
      p.number.toLowerCase().includes(lq) ||
      (p.content?.original ?? '').toLowerCase().includes(lq)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700 rounded-2xl w-[720px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <span className="font-bold text-white">지문 불러오기</span>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-4 flex gap-3 border-b border-slate-700">
          {/* 교재 선택 */}
          <select
            value={selectedTb}
            onChange={e => { setSelectedTb(e.target.value); setQ(''); }}
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-slate-400"
          >
            <option value="">{tbLoading ? '교재 불러오는 중...' : '교재 선택'}</option>
            {textbooks.map(tb => (
              <option key={tb} value={tb}>{tb}</option>
            ))}
          </select>

          {/* 검색 */}
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="지문 검색 (소스키, 챕터, 내용)"
            className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-400"
          />
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {!selectedTb && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">교재를 먼저 선택하세요</div>
          )}
          {selectedTb && loading && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">불러오는 중...</div>
          )}
          {selectedTb && !loading && filtered.length === 0 && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">지문이 없습니다</div>
          )}
          {filtered.map(p => {
            const sk = p.source_key ?? `${p.chapter} ${p.number}`;
            const cnt = examCounts[sk] ?? 0;
            return (
              <button
                key={p._id}
                type="button"
                onClick={() => onSelect(p)}
                className="w-full text-left px-5 py-3 border-b border-slate-700/60 hover:bg-slate-700/50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-mono bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                    {p.chapter} · {p.number}
                  </span>
                  {p.source_key && (
                    <span className="text-xs text-blue-400">{p.source_key}</span>
                  )}
                  {cnt > 0 && (
                    <span className="text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded-full">
                      문제 {cnt}개
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-300 line-clamp-2 leading-relaxed">
                  {p.content?.original ?? '(지문 없음)'}
                </p>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-slate-700 text-xs text-slate-500">
          {selectedTb && !loading && `${filtered.length}개`}
        </div>
      </div>
    </div>
  );
}

// ── 저장 목록 타입 ──────────────────────────────────────────────────────────────

interface SavedExamItem {
  _id: string;
  title: string;
  textbook: string;
  sourceKey: string;
  difficulty: string;
  folder: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

// ── 저장된 목록 패널 ───────────────────────────────────────────────────────────

function SavedListPanel({
  onLoad,
  onClose,
  currentId,
}: {
  onLoad: (item: { data: ExamData; html: string; id: string; title: string }) => void;
  onClose: () => void;
  currentId: string | null;
}) {
  const [items, setItems] = useState<SavedExamItem[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [printingFolder, setPrintingFolder] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/essay-generator/exams', { credentials: 'include' });
    const d = await res.json();
    setItems(d.items ?? []);
    setFolders(d.folders ?? ['기본']);
    setLoading(false);
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleLoad = async (id: string) => {
    const res = await fetch(`/api/admin/essay-generator/exams/${id}`, { credentials: 'include' });
    const d = await res.json();
    if (d.item) onLoad({ data: d.item.data as ExamData, html: d.item.html, id, title: d.item.title });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    setDeletingId(id);
    await fetch(`/api/admin/essay-generator/exams/${id}`, { method: 'DELETE', credentials: 'include' });
    setItems(prev => prev.filter(i => i._id !== id));
    setDeletingId(null);
  };

  const handleMove = async (id: string, dir: 'up' | 'down') => {
    setMovingId(id);
    await fetch(`/api/admin/essay-generator/exams/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ move: dir }),
    });
    await fetchList();
    setMovingId(null);
  };

  const handleFolderPrint = async (folder: string) => {
    setPrintingFolder(folder);
    const res = await fetch(`/api/admin/essay-generator/folder-print?folder=${encodeURIComponent(folder)}`, { credentials: 'include' });
    const d = await res.json();
    setPrintingFolder(null);
    if (!d.html) { alert('출력 실패'); return; }
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(d.html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  };

  const handleCreateFolder = async () => {
    const folderName = prompt('새 폴더 이름을 입력하세요:');
    if (!folderName || !folderName.trim()) return;
    const trimmed = folderName.trim();
    if (folders.includes(trimmed)) {
      alert('이미 존재하는 폴더 이름입니다.');
      return;
    }
    setCreatingFolder(true);
    try {
      // 빈 플레이스홀더 문서를 만들어서 폴더 생성
      await fetch('/api/admin/essay-generator/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: `[${trimmed}] 폴더`,
          textbook: '',
          sourceKey: '',
          difficulty: '고난도',
          folder: trimmed,
          data: {
            meta: { title: `[${trimmed}] 폴더`, subtitle: '', info: [] },
            question_set: { tag: '[01]', instruction: '' },
            passage: '',
            questions: [],
          },
          html: `<html><body><p>[${trimmed}] 폴더가 생성되었습니다.</p></body></html>`,
        }),
      });
      await fetchList();
    } catch (error) {
      alert('폴더 생성 실패');
      console.error(error);
    }
    setCreatingFolder(false);
  };

  const handleRenameFolder = async (oldName: string) => {
    const newName = prompt(`폴더 이름 변경:\n현재: ${oldName}\n\n새 이름을 입력하세요:`, oldName);
    if (!newName || !newName.trim() || newName.trim() === oldName) return;
    const trimmed = newName.trim();
    if (folders.includes(trimmed)) {
      alert('이미 존재하는 폴더 이름입니다.');
      return;
    }
    setRenamingFolder(oldName);
    try {
      const res = await fetch('/api/admin/essay-generator/rename-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ oldName, newName: trimmed }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        alert(d.error || '폴더 이름 변경 실패');
        return;
      }
      await fetchList();
    } catch (error) {
      alert('폴더 이름 변경 실패');
      console.error(error);
    }
    setRenamingFolder(null);
  };

  const fmt = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const toggleFolder = (f: string) =>
    setCollapsed(prev => { const n = new Set(prev); n.has(f) ? n.delete(f) : n.add(f); return n; });

  // 폴더별로 그룹
  const grouped = folders.reduce<Record<string, SavedExamItem[]>>((acc, f) => {
    acc[f] = items.filter(i => (i.folder || '기본') === f);
    return acc;
  }, {});
  // items 중 폴더 목록에 없는 폴더 처리
  items.forEach(i => {
    const f = i.folder || '기본';
    if (!grouped[f]) grouped[f] = [];
    if (!grouped[f].find(x => x._id === i._id)) grouped[f].push(i);
  });
  const allFolders = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'ko'));

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1" />
      <div
        className="w-[460px] h-full bg-slate-800 border-l border-slate-700 flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
          <span className="font-bold text-white">저장된 문제 목록</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCreateFolder}
              disabled={creatingFolder}
              className="text-sm px-3 py-1.5 rounded-lg bg-emerald-700/60 text-white hover:bg-emerald-600 transition-colors font-medium disabled:opacity-50 flex items-center gap-1.5"
            >
              {creatingFolder ? '생성 중...' : '📁 새 폴더'}
            </button>
            <button type="button" onClick={onClose} className="text-slate-400 hover:text-white text-xl">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loading && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">불러오는 중...</div>
          )}
          {!loading && items.length === 0 && (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">저장된 문제가 없습니다</div>
          )}

          {!loading && allFolders.map(folder => {
            const folderItems = grouped[folder] ?? [];
            const isCollapsed = collapsed.has(folder);
            return (
              <div key={folder}>
                {/* 폴더 헤더 */}
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-750 border-b border-slate-700 sticky top-0 bg-slate-800/95 backdrop-blur-sm z-10">
                  <button
                    type="button"
                    onClick={() => toggleFolder(folder)}
                    className="flex items-center gap-2 text-sm font-semibold text-slate-200 hover:text-white transition-colors"
                  >
                    <span className="text-slate-500 text-xs">{isCollapsed ? '▶' : '▼'}</span>
                    📁 {folder}
                    <span className="text-xs text-slate-500 font-normal">({folderItems.length}개)</span>
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleRenameFolder(folder)}
                      disabled={renamingFolder === folder}
                      className="text-xs px-2.5 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white transition-colors font-medium disabled:opacity-50"
                      title="폴더 이름 변경"
                    >
                      {renamingFolder === folder ? '변경 중...' : '✏️'}
                    </button>
                    {folderItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleFolderPrint(folder)}
                        disabled={printingFolder === folder}
                        className="text-xs px-3 py-1 rounded-lg bg-slate-600 text-slate-200 hover:bg-slate-500 hover:text-white transition-colors font-medium disabled:opacity-50"
                      >
                        {printingFolder === folder ? '생성 중...' : '🖨 전체 출력'}
                      </button>
                    )}
                  </div>
                </div>

                {/* 폴더 내 항목 */}
                {!isCollapsed && folderItems.map((item, idx) => (
                  <div
                    key={item._id}
                    className={`border-b border-slate-700/50 px-4 py-3 ${currentId === item._id ? 'bg-blue-600/10 border-l-2 border-l-blue-500' : ''}`}
                  >
                    <div className="flex items-start gap-2">
                      {/* 순서 조작 */}
                      <div className="flex flex-col gap-0.5 shrink-0 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleMove(item._id, 'up')}
                          disabled={idx === 0 || movingId === item._id}
                          className="w-5 h-5 flex items-center justify-center rounded text-slate-600 hover:text-slate-300 disabled:opacity-20 text-xs"
                        >▲</button>
                        <span className="text-[10px] text-slate-600 text-center">{idx + 1}</span>
                        <button
                          type="button"
                          onClick={() => handleMove(item._id, 'down')}
                          disabled={idx === folderItems.length - 1 || movingId === item._id}
                          className="w-5 h-5 flex items-center justify-center rounded text-slate-600 hover:text-slate-300 disabled:opacity-20 text-xs"
                        >▼</button>
                      </div>

                      {/* 정보 */}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-white text-sm truncate">{item.title || '(제목 없음)'}</p>
                        <p className="text-xs text-slate-400 mt-0.5 truncate">
                          {item.textbook}{item.sourceKey ? ` · ${item.sourceKey}` : ''}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {item.difficulty && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${item.difficulty === '고난도' ? 'bg-red-700/50 text-red-300' : 'bg-amber-700/50 text-amber-300'}`}>
                              {item.difficulty}
                            </span>
                          )}
                          <span className="text-[10px] text-slate-500">{fmt(item.updatedAt)}</span>
                        </div>
                      </div>

                      {/* 액션 */}
                      <div className="flex flex-col gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleLoad(item._id)}
                          className="text-xs px-3 py-1 rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors font-medium"
                        >
                          불러오기
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item._id)}
                          disabled={deletingId === item._id}
                          className="text-xs px-3 py-1 rounded-lg border border-slate-600 text-slate-400 hover:border-red-500 hover:text-red-400 transition-colors"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {!isCollapsed && folderItems.length === 0 && (
                  <div className="px-4 py-3 text-xs text-slate-600">비어 있음</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 메인 페이지 ────────────────────────────────────────────────────────────────

export default function EssayGeneratorPage() {
  const router = useRouter();
  const [adminLoginId, setAdminLoginId] = useState('');

  const EXAM_TITLE_KEY = 'essay_generator_exam_title';
  const SCHOOL_NAME_KEY = 'essay_generator_school_name';
  const GRADE_KEY = 'essay_generator_grade';
  const SYSTEM_PROMPT_KEY = 'essay_generator_system_prompt';
  /** localStorage는 mount 후 복원 — 초기값은 서버·클라이언트 동일해야 hydration 일치 */
  const [examTitle, setExamTitle] = useState('영어 서·논술형 평가');
  const [schoolName, setSchoolName] = useState('');
  const [grade, setGrade] = useState('');
  const [passage, setPassage] = useState('');
  const [selectedPassageInfo, setSelectedPassageInfo] = useState<{ textbook: string; sourceKey: string; passageId?: string } | null>(null);
  const [essaySentenceIndices, setEssaySentenceIndices] = useState<number[]>([]);
  const [sentenceListExpanded, setSentenceListExpanded] = useState(false);
  const [difficulty, setDifficulty] = useState<'고난도' | '중난도'>('고난도');
  const [questionNumber, setQuestionNumber] = useState('서·논술형 1');
  const [examSubtitle, setExamSubtitle] = useState('');
  const [totalPoints, setTotalPoints] = useState<number | ''>('');
  const [targetSentences, setTargetSentences] = useState<Set<string>>(new Set());
  /** Claude system — 비우면 서버에서 기본 파일 사용 */
  const [systemPrompt, setSystemPrompt] = useState('');
  const [conditionPromptOpen, setConditionPromptOpen] = useState(false);
  /** Claude Code CLI 사용예 모달 */
  const [ccEssayModalOpen, setCcEssayModalOpen] = useState(false);
  const [copiedHint, setCopiedHint] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [examData, setExamData] = useState<ExamData | null>(null);
  const [examHtml, setExamHtml] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [jsonEdit, setJsonEdit] = useState('');
  const [showPicker, setShowPicker] = useState(false);

  // 저장/불러오기
  const [currentSavedId, setCurrentSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [showSavedList, setShowSavedList] = useState(false);
  const [saveFolder, setSaveFolder] = useState('기본');
  const [folderOptions, setFolderOptions] = useState<string[]>(['기본']);

  // 사이드패널 접기
  const [collapsed, setCollapsed] = useState(false);

  /** 미리보기 확대 (1 = 100%) */
  const [previewScale, setPreviewScale] = useState(1);
  const PREVIEW_BASE_W = 794;
  const PREVIEW_BASE_H = 1300;

  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    try {
      const t = localStorage.getItem(EXAM_TITLE_KEY);
      if (t !== null) setExamTitle(t);
      const s = localStorage.getItem(SCHOOL_NAME_KEY);
      if (s !== null) setSchoolName(s);
      const g = localStorage.getItem(GRADE_KEY);
      if (g !== null) setGrade(g);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (!d?.user || d.user.role !== 'admin') { router.replace('/admin/login'); return; }
        setAdminLoginId(d.user.loginId ?? '');
      })
      .catch(() => router.replace('/admin/login'));
  }, [router]);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(SYSTEM_PROMPT_KEY) : null;
    if (saved != null && saved !== '') {
      setSystemPrompt(saved);
      return;
    }
    fetch('/api/admin/essay-generator/generation-prompt', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (typeof d.prompt === 'string') setSystemPrompt(d.prompt);
      })
      .catch(() => {});
  }, []);

  // 지문 → 문장 배열 파싱
  const parseSentences = useCallback((text: string): string[] => {
    // 마침표/느낌표/물음표 + 공백 기준 분리, 단 약어(Mr. Dr. 등) 오류 최소화
    return text
      .replace(/\s+/g, ' ')
      .trim()
      .split(/(?<=[.!?])\s+(?=[A-Z"'(])/)
      .map(s => s.trim())
      .filter(s => s.length > 10);
  }, []);

  const sentences = parseSentences(passage);

  const toggleSentence = useCallback((s: string) => {
    setTargetSentences(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  }, []);

  const handlePickPassage = useCallback(async (p: PassageItem) => {
    const original = p.content?.original ?? '';
    setPassage(original);
    setTargetSentences(new Set());
    setEssaySentenceIndices([]);
    setSentenceListExpanded(false);
    setSelectedPassageInfo({ textbook: p.textbook, sourceKey: p.source_key ?? `${p.chapter} ${p.number}`, passageId: p._id });
    setExamSubtitle(prev => prev || p.textbook);
    setShowPicker(false);

    // 구문 분석기에서 서술형 대비로 체크한 문장 인덱스 가져오기
    try {
      const res = await fetch(`/api/admin/essay-generator/passage-essay-sentences?passageId=${p._id}`, { credentials: 'include' });
      const d = await res.json();
      if (d.indices?.length > 0) setEssaySentenceIndices(d.indices);
    } catch { /* 조용히 무시 */ }
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!passage.trim()) { setError('지문을 입력하세요.'); return; }
    setLoading(true);
    setError('');
    setExamData(null);
    setExamHtml('');
    setShowJson(false);

    const targetArr = [...targetSentences];

    try {
      const res = await fetch('/api/admin/essay-generator/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passage,
          examTitle,
          schoolName,
          grade,
          difficulty,
          questionNumber,
          examSubtitle,
          ...(totalPoints !== '' ? { totalPoints } : {}),
          targetSentences: targetArr,
          ...(systemPrompt.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? '생성 실패');
      setExamData(body.data);
      setExamHtml(body.html);
      setJsonEdit(JSON.stringify(body.data, null, 2));
      setPreviewScale(1);
      setCurrentSavedId(null); // 새로 생성했으므로 저장 ID 초기화
    } catch (e) {
      setError(e instanceof Error ? e.message : '오류 발생');
    } finally {
      setLoading(false);
    }
  }, [passage, examTitle, schoolName, grade, difficulty, questionNumber, examSubtitle, totalPoints, targetSentences, systemPrompt]);

  const handleJsonApply = useCallback(() => {
    try {
      const parsed: ExamData = JSON.parse(jsonEdit);
      setExamData(parsed);
      setError('');
    } catch {
      setError('JSON 파싱 오류: 형식을 확인하세요.');
    }
  }, [jsonEdit]);

  // ── 저장 ────────────────────────────────────────────────────────────────────

  const getCurrentHtml = useCallback(() => {
    const iframeDoc = iframeRef.current?.contentDocument;
    return iframeDoc ? '<!DOCTYPE html>' + iframeDoc.documentElement.outerHTML : examHtml;
  }, [examHtml]);

  const handleSave = useCallback(async () => {
    if (!examData) return;
    setSaving(true);
    setSaveMsg('');
    const html = getCurrentHtml();
    const title = examData.meta.subtitle || examData.meta.title || '';

    try {
      if (currentSavedId) {
        // 덮어쓰기
        await fetch(`/api/admin/essay-generator/exams/${currentSavedId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ data: examData, html }),
        });
        setSaveMsg('저장됨');
      } else {
        // 신규 저장
        const res = await fetch('/api/admin/essay-generator/exams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            title,
            textbook: selectedPassageInfo?.textbook ?? '',
            sourceKey: selectedPassageInfo?.sourceKey ?? '',
            difficulty,
            folder: saveFolder || '기본',
            data: examData,
            html,
          }),
        });
        const d = await res.json();
        setCurrentSavedId(d.id);
        setSaveMsg('저장됨');
      }
    } catch {
      setSaveMsg('저장 실패');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 2000);
    }
  }, [examData, currentSavedId, difficulty, selectedPassageInfo, getCurrentHtml]);

  const handleLoadSaved = useCallback(({ data, html, id, title }: { data: ExamData; html: string; id: string; title: string }) => {
    setExamData(data);
    setExamHtml(html);
    setJsonEdit(JSON.stringify(data, null, 2));
    setCurrentSavedId(id);
    setShowSavedList(false);
    setSaveMsg(`"${title}" 불러옴`);
    setTimeout(() => setSaveMsg(''), 2000);
  }, []);

  // 폴더 목록 새로고침
  const refreshFolders = useCallback(async () => {
    const res = await fetch('/api/admin/essay-generator/exams', { credentials: 'include' });
    const d = await res.json();
    if (d.folders) setFolderOptions(d.folders);
  }, []);

  const enableEditing = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.designMode = 'on';
  }, []);

  const handlePrint = useCallback(() => {
    // 편집된 내용이 있으면 iframe 현재 HTML로, 없으면 원본으로 출력
    const iframeDoc = iframeRef.current?.contentDocument;
    const htmlToPrint = iframeDoc
      ? '<!DOCTYPE html>' + iframeDoc.documentElement.outerHTML
      : examHtml;
    if (!htmlToPrint) return;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(htmlToPrint);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }, [examHtml]);

  return (
    <div className="min-h-screen bg-slate-900 flex text-white">
      <AdminSidebar loginId={adminLoginId} />

      {showPicker && (
        <PassagePickerModal
          onSelect={handlePickPassage}
          onClose={() => setShowPicker(false)}
        />
      )}

      {showSavedList && (
        <SavedListPanel
          onLoad={handleLoadSaved}
          onClose={() => setShowSavedList(false)}
          currentId={currentSavedId}
        />
      )}

      {/* ── cc:essay CLI 모달 ── */}
      {ccEssayModalOpen && (() => {
        const pid = selectedPassageInfo?.passageId ?? '<passageId>';
        const tb = selectedPassageInfo?.textbook ?? '<교재명>';
        const sk = selectedPassageInfo?.sourceKey ?? `${tb} 21번`;
        const draftPath = `.essay-drafts/${(selectedPassageInfo?.sourceKey ?? 'draft').replace(/[^A-Za-z0-9가-힣]/g, '_')}.json`;
        const sampleJson = JSON.stringify({
          passageId: pid, textbook: tb, sourceKey: sk, difficulty,
          folder: '기본', examTitle: examTitle || '직전보강 서술형 파이널',
          ...(schoolName ? { schoolName } : {}), ...(grade ? { grade } : {}),
          ...(examSubtitle ? { examSubtitle } : {}),
          data: {
            meta: { title: examTitle || '직전보강 서술형 파이널', subtitle: examSubtitle || tb, info: [] },
            question_set: { tag: '[01]', instruction: '다음 글을 읽고 질문에 답하시오.' },
            passage: '...본문 영문...',
            questions: [{
              id: '1', points: 6,
              prompt: '밑줄 친 (A)를 아래 조건과 보기에 맞게 영어로 쓰시오.',
              conditions: ['7개의 단어를 모두 사용할 것', '...'],
              bogi: 'chunk1 / chunk2 / ...',
              answer: { text: 'Final answer sentence.', grammar_points: [{ title: '관계대명사', content: 'who' }], word_count: { total: 7, words: ['Final','answer','sentence','...'], note: null }, intent_content: '출제 의도 설명' },
            }],
          },
        }, null, 2);

        const copy = async (text: string, label: string) => {
          try { await navigator.clipboard.writeText(text); setCopiedHint(label); setTimeout(() => setCopiedHint(null), 1500); } catch { /* ignore */ }
        };

        const buildFullCmd = () => {
          if (!selectedPassageInfo?.passageId) return '';
          const parts = [`"${tb} ${sk}" 지문을 ${difficulty}로 만들어줘.`];
          if (examTitle && examTitle !== '영어 서·논술형 평가') parts.push(`제목은 "${examTitle}"`);
          if (schoolName) parts.push(`학교는 "${schoolName}"`);
          if (grade) parts.push(`학년은 "${grade}"`);
          const metaParts = parts.slice(1);
          if (metaParts.length > 0) { parts[0] = parts[0] + ' ' + metaParts.join(', ') + '로 설정하고,'; parts.splice(1, metaParts.length); }
          const selected = Array.from(targetSentences);
          if (selected.length > 0) {
            const indices = sentences.map((s, i) => (selected.includes(s) ? i : -1)).filter(i => i >= 0);
            parts.push(`문장 [${indices.join('], [')}]을 반드시 포함해서 출제해줘.`);
          }
          if (questionNumber && questionNumber !== '서·논술형 1') parts.push(`문항번호는 "${questionNumber}".`);
          if (typeof totalPoints === 'number') parts.push(`총배점 ${totalPoints}점.`);
          parts.push(`완성되면 cc:essay save 로 저장까지 진행해줘 (passageId: ${pid})`);
          return parts.join(' ');
        };

        const CmdBlock = ({ cmd, label }: { cmd: string; label: string }) => (
          <div className="flex items-start gap-2">
            <pre className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono overflow-x-auto scrollbar-thin whitespace-pre-wrap break-all">
              <code>{cmd}</code>
            </pre>
            <button
              type="button"
              onClick={() => copy(cmd, label)}
              className="shrink-0 text-sm font-bold px-4 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 border border-emerald-500"
            >
              {copiedHint === label ? '복사됨 ✓' : '복사'}
            </button>
          </div>
        );

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setCcEssayModalOpen(false)}>
            <div
              className="bg-slate-800 border border-slate-600 rounded-2xl w-[640px] max-h-[85vh] flex flex-col shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
                <div>
                  <h3 className="text-lg font-bold text-white">Claude Code 자동화 (cc:essay)</h3>
                  <p className="text-sm text-slate-400 mt-0.5">Anthropic API 키 없이 · Pro 무과금</p>
                </div>
                <button type="button" onClick={() => setCcEssayModalOpen(false)} className="text-slate-400 hover:text-white text-2xl leading-none px-2">×</button>
              </div>

              {/* 본문 — 스크롤 */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 scrollbar-thin">

                <p className="text-sm text-slate-300 leading-relaxed">
                  각 단계의 <span className="font-bold text-emerald-300">「복사」</span> 버튼을 누르면
                  바로 왼쪽 회색 칸의 명령 전체가 클립보드에 들어갑니다.
                </p>

                {/* 1 */}
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white">1. 부족 지문 확인 (선택)</h4>
                  <CmdBlock label="shortage" cmd={`npm run cc:essay -- shortage --textbook "${tb}" --required 1 --difficulty ${difficulty}`} />
                </div>

                {/* 2 */}
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white">2. 지문 받기 (문장표 + 서술형대비 인덱스)</h4>
                  <CmdBlock label="passage" cmd={`npm run cc:essay -- passage --id ${pid}`} />
                </div>

                {/* 3 */}
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white">3. ExamData JSON 작성 → 파일로 저장</h4>
                  <p className="text-xs text-slate-400">채팅에서 JSON 을 만들고 <code className="text-slate-300">{draftPath}</code> 에 저장합니다.</p>
                  <details className="border border-slate-600 rounded-lg bg-slate-900/50">
                    <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-200 hover:text-white select-none">JSON 스키마 예시 보기</summary>
                    <div className="px-3 pb-3 pt-1">
                      <CmdBlock label="schema" cmd={sampleJson} />
                    </div>
                  </details>
                </div>

                {/* 4 */}
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white">4. 검증 (dry-run)</h4>
                  <CmdBlock label="dry-run" cmd={`npm run cc:essay -- save --json ${draftPath} --dry-run`} />
                </div>

                {/* 5 */}
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white">5. 저장 (HTML 자동 생성)</h4>
                  <CmdBlock label="save" cmd={`npm run cc:essay -- save --json ${draftPath}`} />
                  <p className="text-xs text-slate-400">
                    검증 실패 시 <code className="text-slate-300">--force</code> 우회 가능. stdin: <code className="text-slate-300">cat draft.json | npm run cc:essay -- save --json -</code>
                  </p>
                </div>

                {/* Claude Code 채팅용 한 줄 */}
                <div className="rounded-xl border border-amber-600/50 bg-amber-950/20 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-amber-200">Claude Code 채팅용 (한국어 한 줄)</h4>
                    <button
                      type="button"
                      disabled={!selectedPassageInfo?.passageId}
                      onClick={() => copy(buildFullCmd(), 'full-cmd')}
                      className="text-sm font-bold px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed border border-amber-500"
                    >
                      {copiedHint === 'full-cmd' ? '복사됨 ✓' : '명령어 복사'}
                    </button>
                  </div>
                  {selectedPassageInfo?.passageId ? (
                    <code className="block text-xs text-emerald-300 font-mono break-all whitespace-pre-wrap leading-relaxed bg-slate-950 rounded-lg p-3 border border-slate-700">
                      {buildFullCmd()}
                    </code>
                  ) : (
                    <p className="text-sm text-amber-200/80">
                      위 <span className="font-bold text-white">「영어 지문 → DB에서 불러오기」</span>로 지문을 먼저 고르면 활성화됩니다.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <main className="flex-1 flex min-h-0 overflow-hidden" style={{ height: '100vh' }}>
        {/* ── 좌측 입력 패널 ── (min-h-0 + 내부 스크롤로 flex 자식이 뷰포트 밖으로 잘리지 않게) */}
        <div
          className={`shrink-0 flex min-h-0 min-w-0 flex-col border-r border-slate-700 overflow-hidden transition-all duration-200 ${
            collapsed ? 'w-0 overflow-hidden border-r-0' : 'w-[380px]'
          }`}
        >
          <div className="shrink-0 p-6 border-b border-slate-700 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-white tracking-tight">서술형 출제기</h2>
              <p className="text-slate-400 text-sm mt-0.5">배열 쓰기(서·논술형) 문제 자동 생성</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => setCcEssayModalOpen(true)}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-emerald-600/70 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/50 hover:border-emerald-500 transition-colors font-medium whitespace-nowrap"
                title="Claude Code CLI 사용 안내 모달"
              >
                cc:essay CLI
              </button>
              <button
                type="button"
                onClick={() => setShowSavedList(true)}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors font-medium whitespace-nowrap"
              >
                📂 목록
              </button>
            </div>
          </div>

          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 flex flex-col gap-5 scrollbar-thin"
          >
            {/* 제목 */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">시험지 제목</label>
              <input
                value={examTitle}
                onChange={e => {
                  setExamTitle(e.target.value);
                  localStorage.setItem(EXAM_TITLE_KEY, e.target.value);
                }}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                placeholder="영어 서·논술형 평가"
              />
            </div>

            {/* 학교명 / 학년 */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">고등학교 이름</label>
                <input
                  value={schoolName}
                  onChange={e => {
                    setSchoolName(e.target.value);
                    localStorage.setItem(SCHOOL_NAME_KEY, e.target.value);
                  }}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                  placeholder="○○고등학교"
                />
              </div>
              <div className="w-24">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">학년</label>
                <input
                  value={grade}
                  onChange={e => {
                    setGrade(e.target.value);
                    localStorage.setItem(GRADE_KEY, e.target.value);
                  }}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                  placeholder="2학년"
                />
              </div>
            </div>

            {/* 지문 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-slate-300">
                  영어 지문 <span className="text-red-400">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowPicker(true)}
                  className="text-xs px-2.5 py-1 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white transition-colors font-medium"
                >
                  DB에서 불러오기
                </button>
              </div>

              {selectedPassageInfo && (
                <div className="mb-1.5 flex items-center gap-2 text-xs bg-blue-500/15 border border-blue-500/30 rounded-lg px-3 py-1.5">
                  <span className="text-blue-400 font-medium truncate">
                    {selectedPassageInfo.textbook} · {selectedPassageInfo.sourceKey}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setSelectedPassageInfo(null); setPassage(''); }}
                    className="ml-auto shrink-0 text-slate-500 hover:text-white"
                  >×</button>
                </div>
              )}

              <textarea
                value={passage}
                onChange={e => { setPassage(e.target.value); setSelectedPassageInfo(null); setTargetSentences(new Set()); }}
                placeholder="영어 원문 지문을 붙여넣거나 DB에서 불러오세요..."
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500 font-mono leading-relaxed resize-none h-44 overflow-y-auto scrollbar-thin"
              />
            </div>

            {/* 난이도 */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">난이도</label>
              <div className="flex gap-2">
                {(['고난도', '중난도'] as const).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDifficulty(d)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors border ${
                      difficulty === d
                        ? d === '고난도'
                          ? 'bg-red-700 text-white border-red-700'
                          : 'bg-amber-600 text-white border-amber-600'
                        : 'border-slate-600 text-slate-400 hover:bg-slate-700/60 hover:text-white'
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="mt-2 rounded-xl border border-slate-700/80 bg-slate-900/40 p-2.5">
                <p className="text-[11px] text-slate-500 mb-1.5 leading-snug">
                  이 난이도로 생성할 때 Claude <span className="text-slate-400">user</span> 메시지 끝에 붙는{' '}
                  <span className="text-slate-400">추가 출제 지시</span>입니다. (시험지에 찍히는 문항 조건 문장과는 별개)
                </p>
                <pre className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap leading-relaxed max-h-44 overflow-y-auto scrollbar-thin">
                  {ESSAY_DIFFICULTY_APPENDIX_TEXT[difficulty]}
                </pre>
              </div>
            </div>

            {/* 문항 번호 + 배점 */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">문항 번호</label>
                <input
                  value={questionNumber}
                  onChange={e => setQuestionNumber(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                  placeholder="서·논술형 1"
                />
              </div>
              <div className="w-28">
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  총 배점 <span className="text-slate-500 font-normal">(최대 10)</span>
                </label>
                <input
                  type="number"
                  value={totalPoints}
                  onChange={e => setTotalPoints(e.target.value === '' ? '' : Math.min(10, Number(e.target.value)))}
                  placeholder="자동"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                  min={1}
                  max={10}
                />
              </div>
            </div>

            {/* 시험지 부제 */}
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">
                시험지 부제 <span className="text-slate-500 font-normal">(선택)</span>
              </label>
              <input
                value={examSubtitle}
                onChange={e => setExamSubtitle(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
                placeholder="예: 2026학년도 모의고사 3회 · Lyceum"
              />
            </div>

            {/* 조건·출제 프롬프트 (Claude system) */}
            <div className="rounded-xl border border-slate-700 overflow-hidden bg-slate-800/40">
              <button
                type="button"
                onClick={() => setConditionPromptOpen(v => !v)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-slate-300 hover:bg-slate-700/40 transition-colors"
              >
                <span>조건·출제 프롬프트 <span className="text-slate-500 font-normal">(Claude system)</span></span>
                <span className="text-slate-500 shrink-0">{conditionPromptOpen ? '접기 ▲' : '펼치기 ▼'}</span>
              </button>
              {conditionPromptOpen && (
                <div className="px-3 pb-3 pt-0 border-t border-slate-700/80 space-y-2">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    출제 규칙·JSON 형식 등이 정의된 시스템 프롬프트입니다. 비우고 생성하면 저장소 기본 파일(<code className="text-slate-400">generation_prompt.md</code>)이 적용됩니다. 수정 내용은 이 브라우저에 저장됩니다.
                  </p>
                  <textarea
                    value={systemPrompt}
                    onChange={e => {
                      const v = e.target.value;
                      setSystemPrompt(v);
                      if (typeof window !== 'undefined') localStorage.setItem(SYSTEM_PROMPT_KEY, v);
                    }}
                    spellCheck={false}
                    className="w-full min-h-[200px] max-h-72 overflow-y-auto scrollbar-thin bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-slate-500"
                    placeholder="불러오는 중…"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const r = await fetch('/api/admin/essay-generator/generation-prompt', { credentials: 'include' });
                          const d = await r.json();
                          if (typeof d.prompt === 'string') {
                            setSystemPrompt(d.prompt);
                            if (typeof window !== 'undefined') localStorage.removeItem(SYSTEM_PROMPT_KEY);
                          }
                        } catch { /* ignore */ }
                      }}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                      기본 파일로 되돌리기
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSystemPrompt('');
                        if (typeof window !== 'undefined') localStorage.removeItem(SYSTEM_PROMPT_KEY);
                      }}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                    >
                      비우기 (서버 기본)
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 반드시 포함할 문장 */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-medium text-slate-300">
                    반드시 포함할 문장 <span className="text-slate-500 font-normal">(선택)</span>
                  </label>
                  {essaySentenceIndices.length > 0 && (
                    <span className="text-xs text-emerald-400 font-medium">
                      ● 서술형대비 {essaySentenceIndices.length}개
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {sentences.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSentenceListExpanded(v => !v)}
                      className="text-xs text-slate-500 hover:text-white transition-colors"
                    >
                      {sentenceListExpanded ? '접기 ▲' : '펼치기 ▼'}
                    </button>
                  )}
                  {targetSentences.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setTargetSentences(new Set())}
                      className="text-xs text-slate-500 hover:text-white transition-colors"
                    >
                      선택 해제
                    </button>
                  )}
                </div>
              </div>

              {sentences.length === 0 ? (
                <p className="text-xs text-slate-600 px-1">지문을 입력하면 문장 목록이 나타납니다</p>
              ) : (
                <div className={`flex flex-col gap-1 overflow-y-auto pr-1 transition-all scrollbar-thin ${sentenceListExpanded ? 'max-h-[36rem]' : 'max-h-44'}`}>
                  {sentences.map((s, i) => {
                    const selected = targetSentences.has(s);
                    const isEssay = essaySentenceIndices.includes(i);
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => toggleSentence(s)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs leading-relaxed transition-colors border font-mono ${
                          selected
                            ? 'bg-blue-600/25 border-blue-500/60 text-blue-200'
                            : isEssay
                            ? 'bg-emerald-900/30 border-emerald-600/50 text-emerald-200 hover:bg-emerald-800/40 hover:border-emerald-500/70'
                            : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200'
                        }`}
                      >
                        <span className={`inline-block mr-1.5 font-bold ${selected ? 'text-blue-400' : isEssay ? 'text-emerald-400' : 'text-slate-600'}`}>
                          {selected ? '✓' : isEssay ? '★' : `${i + 1}.`}
                        </span>
                        {s}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 오류 */}
            {error && (
              <div className="bg-red-500/20 border border-red-500/50 rounded-xl px-4 py-3 text-sm text-red-300">
                {error}
              </div>
            )}

            {/* 생성 버튼 */}
            <button
              type="button"
              onClick={handleGenerate}
              disabled={loading}
              className="w-full py-3 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 transition-colors text-sm"
            >
              {loading ? '생성 중 (약 20~40초)...' : '✦ 서술형 문제 생성'}
            </button>
          </div>
        </div>

        {/* ── 우측 프리뷰 패널 ── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="shrink-0 flex items-center justify-between px-4 py-4 border-b border-slate-700">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setCollapsed(v => !v)}
                title={collapsed ? '패널 펼치기' : '패널 접기'}
                className="text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700"
              >
                {collapsed ? '→|' : '|←'}
              </button>
              <span className="font-semibold text-white">미리보기</span>
              {examData && (
                <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium">
                  생성 완료
                </span>
              )}
              {examData && !showJson && (
                <div className="flex items-center gap-1 ml-1 border-l border-slate-600 pl-3">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wide">보기</span>
                  <button
                    type="button"
                    title="축소"
                    onClick={() => setPreviewScale(s => Math.max(0.6, Math.round((s - 0.1) * 10) / 10))}
                    className="w-7 h-7 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white text-sm font-bold leading-none"
                  >
                    −
                  </button>
                  <span className="text-xs text-slate-400 tabular-nums w-11 text-center">{Math.round(previewScale * 100)}%</span>
                  <button
                    type="button"
                    title="확대"
                    onClick={() => setPreviewScale(s => Math.min(1.8, Math.round((s + 0.1) * 10) / 10))}
                    className="w-7 h-7 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white text-sm font-bold leading-none"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    title="100%로 초기화"
                    onClick={() => setPreviewScale(1)}
                    className="px-2 py-1 rounded-md text-[10px] font-medium border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700"
                  >
                    초기화
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {saveMsg && (
                <span className="text-xs text-emerald-400 font-medium">{saveMsg}</span>
              )}
              {examData && (
                <>
                  {/* 폴더 선택 */}
                  <div className="flex items-center gap-1">
                    <select
                      value={saveFolder}
                      onChange={e => setSaveFolder(e.target.value)}
                      onClick={refreshFolders}
                      className="text-xs bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-slate-300 focus:outline-none focus:border-slate-400 max-w-[110px]"
                    >
                      {folderOptions.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                    <input
                      value={folderOptions.includes(saveFolder) ? '' : saveFolder}
                      onChange={e => setSaveFolder(e.target.value || '기본')}
                      placeholder="새 폴더"
                      className="text-xs bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-white placeholder-slate-500 focus:outline-none focus:border-slate-400 w-20"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors font-semibold"
                  >
                    {saving ? '저장 중...' : currentSavedId ? '💾 덮어쓰기' : '💾 저장'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowJson(v => !v)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors font-medium"
                  >
                    {showJson ? '← 프리뷰' : 'JSON 편집'}
                  </button>
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="px-4 py-1.5 text-xs rounded-lg bg-white text-slate-900 hover:bg-slate-200 transition-colors font-bold"
                  >
                    🖨 인쇄 / PDF
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-6">
            {!examData && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <p className="text-base font-medium text-slate-400">지문을 입력하고 생성 버튼을 누르세요</p>
                <p className="text-sm mt-1">배열 쓰기(서·논술형) 문제와 해설이 자동 생성됩니다</p>
              </div>
            )}

            {loading && (
              <div className="flex flex-col items-center justify-center h-full text-slate-500">
                <div className="w-10 h-10 border-4 border-slate-700 border-t-blue-500 rounded-full animate-spin mb-4" />
                <p className="font-medium text-slate-300">Claude가 문제를 출제 중입니다...</p>
                <p className="text-sm mt-1">지문 분석 → 문법 포인트 선정 → JSON 생성</p>
              </div>
            )}

            {examData && !loading && (
              <>
                {showJson ? (
                  <div className="flex flex-col gap-3 h-full">
                    <textarea
                      value={jsonEdit}
                      onChange={e => setJsonEdit(e.target.value)}
                      className="flex-1 w-full bg-slate-800 border border-slate-700 rounded-xl p-4 text-xs font-mono text-slate-200 resize-none focus:outline-none focus:border-slate-500 leading-relaxed"
                      style={{ minHeight: '500px' }}
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleJsonApply}
                        className="px-5 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors font-semibold"
                      >
                        JSON 적용
                      </button>
                      <span className="text-xs text-slate-500">수정 후 적용하면 미리보기가 갱신됩니다</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 w-full">
                    <div
                      className="bg-white shadow-2xl rounded overflow-hidden mx-auto"
                      style={{
                        width: PREVIEW_BASE_W * previewScale,
                        height: PREVIEW_BASE_H * previewScale,
                      }}
                    >
                      <iframe
                        ref={iframeRef}
                        srcDoc={examHtml}
                        title="서술형 문제 프리뷰"
                        className="border-0 rounded block"
                        style={{
                          width: PREVIEW_BASE_W,
                          height: PREVIEW_BASE_H,
                          transform: `scale(${previewScale})`,
                          transformOrigin: 'top left',
                        }}
                        sandbox="allow-same-origin allow-scripts"
                        onLoad={enableEditing}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
