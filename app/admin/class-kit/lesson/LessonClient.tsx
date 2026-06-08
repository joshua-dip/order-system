'use client';

/**
 * 수업용자료 — "한 지문 = 한 화면" 수업용 자료 (페이퍼릭 마젠타 톤).
 * 영어 원문(좌) + 한국어 해석(우) 2단. 강의용자료와 동일한 편집 UI.
 * (DB 저장 없음 — 그때그때 지문을 골라 띄우는 용도.)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import PassagePickerModal, { PassageItem } from '../../_components/PassagePickerModal';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import {
  loadPresetsForTextbook,
  savePresetForTextbook,
  deletePresetForTextbook,
  newPresetId,
  type ClassKitDownloadPreset,
} from '@/lib/class-kit-download-presets';
import {
  buildLessonMaterialHtml,
  clampLineHeight,
  clampSplitPct,
  clampFontScale,
  normalizeLessonMode,
  normalizeLineLayout,
  normalizeEnFont,
  normalizeKoFont,
  lessonModeIsLandscape,
  LESSON_MODE_LABELS,
  type LessonSentencePair,
  type LessonMode,
  type LineLayout,
  type EnFontKey,
  type KoFontKey,
} from '@/lib/lesson-material-html';
import {
  type ClassKitAccessLevel,
  enFontOptionsForAccess,
  koFontOptionsForAccess,
  normalizeEnFontForAccess,
  normalizeKoFontForAccess,
  CLASS_KIT_GUEST_FONT_NOTICE,
} from '@/lib/class-kit-access';
import ClassKitTabs from '../ClassKitTabs';
import {
  ClassKitRoot,
  ClassKitAccessBanner,
  ClassKitHeader,
  ClassKitPassageNav,
  ClassKitIconButton,
  ClassKitPreviewPane,
  ClassKitSettingsAside,
  ClassKitField,
  ClassKitDivider,
  ClassKitSliderSection,
  ClassKitPrimaryButton,
  ClassKitSecondaryButton,
  ckInputClass,
  ckSelectClass,
  ckSectionTitleClass,
  IconMonitor,
  IconPdf,
  IconBooks,
  IconPrint,
  IconSpinner,
} from '../_components/ClassKitUI';

const TITLE_KEY = 'class_kit_lesson_title';
const NUMBER_KEY = 'class_kit_lesson_number';
const LINE_HEIGHT_KEY = 'class_kit_lesson_line_height';
const SPLIT_KEY = 'class_kit_lesson_split';
const MODE_KEY = 'class_kit_lesson_mode';
const LINE_LAYOUT_KEY = 'class_kit_lesson_line_layout';
const EN_FONT_KEY = 'class_kit_lesson_en_font';
const KO_FONT_KEY = 'class_kit_lesson_ko_font';
/** [Deprecated] 영·한 통합 배율 — 신규 키 둘 다 비어 있을 때만 초기값으로 사용. */
const FONT_SCALE_KEY = 'class_kit_lesson_font_scale';
const EN_FONT_SCALE_KEY = 'class_kit_lesson_en_font_scale';
const KO_FONT_SCALE_KEY = 'class_kit_lesson_ko_font_scale';
const LAST_PASSAGE_KEY = 'class_kit_lesson_last_passage_id';
const DEFAULT_LINE_HEIGHT = 2.6;
const DEFAULT_SPLIT = 60;
const DEFAULT_FONT_SCALE = 1.0;

/** passage.number 에서 숫자만 추출 (없으면 원문 그대로). */
function deriveNumber(raw?: string): string {
  const s = (raw ?? '').trim();
  const m = s.match(/\d+/);
  return m ? m[0] : s;
}

/** passage.content 로 영어 문장 배열 (sentences_en 우선, 없으면 original split). */
function enSentencesOf(item: PassageItem | null): string[] {
  if (!item?.content) return [];
  return tokenizePassageFromContent(item.content).map(s => s.text);
}

export interface LessonClientProps {
  forcedMode?: LessonMode;
  /** API 베이스. 기본 admin (/api/admin/passages + /api/admin/class-kit). 사용자용은 /api/class-kit/passages + /api/class-kit. */
  passagesApiBase?: string;
  classKitApiBase?: string;
  /** 비회원/회원 모드 알림 — 게스트면 다운로드·저장 시도 시 회원가입 모달 표시(부모 콜백). */
  onGuestGate?: () => void;
  routeBase?: string;
  homeHref?: string;
}

export default function LessonClient({
  forcedMode,
  passagesApiBase = '/api/admin/passages',
  classKitApiBase = '/api/admin/class-kit',
  onGuestGate,
  routeBase = '/admin/class-kit',
  homeHref,
}: LessonClientProps) {
  const isUserClassKit = passagesApiBase.includes('/api/class-kit/');
  const [accessLevel, setAccessLevel] = useState<ClassKitAccessLevel>(isUserClassKit ? 'guest' : 'admin');

  const [passage, setPassage] = useState<PassageItem | null>(null);
  const [pairs, setPairs] = useState<LessonSentencePair[]>([]);
  // 카테고리(kicker)는 현재 유형 라벨을 따라감 (한줄해석/영작하기/해석쓰기 …)
  const [kicker, setKicker] = useState(LESSON_MODE_LABELS[forcedMode ?? 'parallel']);
  const [title, setTitle] = useState('');
  const [number, setNumber] = useState('');
  const [lineHeight, setLineHeight] = useState(DEFAULT_LINE_HEIGHT);
  const [splitPct, setSplitPct] = useState(DEFAULT_SPLIT);
  const [mode, setMode] = useState<LessonMode>(forcedMode ?? 'parallel');
  const [lineLayout, setLineLayout] = useState<LineLayout>('stack');
  const [enFont, setEnFont] = useState<EnFontKey>('sans');
  const [koFont, setKoFont] = useState<KoFontKey>('pen');
  const [enFontScale, setEnFontScale] = useState(DEFAULT_FONT_SCALE);
  const [koFontScale, setKoFontScale] = useState(DEFAULT_FONT_SCALE);
  const [showPicker, setShowPicker] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  /** 모달 내 선택: 'current'=현재 지문만 / 'all'=교재 전체 / 'range'=번호 범위 / 'manual'=체크박스. */
  const [bulkScope, setBulkScope] = useState<'current' | 'all' | 'range' | 'manual'>('all');
  const [bulkRangeFrom, setBulkRangeFrom] = useState('');
  const [bulkRangeTo, setBulkRangeTo] = useState('');
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMode, setBulkMode] = useState<LessonMode>('parallel');
  const [bulkFormat, setBulkFormat] = useState<'pdf' | 'zip'>('pdf');
  /** 현재 교재 기준 저장된 프리셋 목록. 모달이 열릴 때마다 다시 로드. */
  const [bulkPresets, setBulkPresets] = useState<ClassKitDownloadPreset[]>([]);
  const [msg, setMsg] = useState('');
  const [defaultLineHeight, setDefaultLineHeight] = useState(DEFAULT_LINE_HEIGHT);
  const [lhSaved, setLhSaved] = useState(false);
  const [siblings, setSiblings] = useState<PassageItem[]>([]);
  const [siblingsTextbook, setSiblingsTextbook] = useState('');
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  const persist = (key: string, v: string) => {
    try { localStorage.setItem(key, v); } catch { /* ignore */ }
  };

  /** 한국어 해석(/korean) 까지 합쳐 영/한 문장 쌍을 만든다. */
  const loadPairs = async (item: PassageItem) => {
    let en = enSentencesOf(item);
    let ko: string[] = [];
    try {
      const r = await fetch(`${passagesApiBase}/${encodeURIComponent(item._id)}/korean`, { credentials: 'include' });
      if (r.ok) {
        const d = await r.json();
        const rEn = Array.isArray(d.sentences_en) ? (d.sentences_en as string[]) : [];
        const rKo = Array.isArray(d.sentences_ko) ? (d.sentences_ko as string[]) : [];
        if (rEn.length) en = rEn;
        ko = rKo;
      }
    } catch {
      /* ignore */
    }
    setPairs(en.map((t, i) => ({ idx: i, en: t, ko: (ko[i] ?? '').trim() })));
  };

  // localStorage 복원 + 마지막 지문 자동 불러오기
  useEffect(() => {
    try {
      const t = localStorage.getItem(TITLE_KEY);
      if (t !== null) setTitle(t);
      const n = localStorage.getItem(NUMBER_KEY);
      if (n !== null) setNumber(n);
      const lh = localStorage.getItem(LINE_HEIGHT_KEY);
      if (lh !== null) {
        const v = clampLineHeight(parseFloat(lh));
        setDefaultLineHeight(v);
        setLineHeight(v);
      }
      const sp = localStorage.getItem(SPLIT_KEY);
      if (sp !== null) setSplitPct(clampSplitPct(parseInt(sp, 10)));
      const ll = localStorage.getItem(LINE_LAYOUT_KEY);
      if (ll !== null) setLineLayout(normalizeLineLayout(ll));
      const ef = localStorage.getItem(EN_FONT_KEY);
      if (ef !== null) setEnFont(normalizeEnFont(ef));
      const kf = localStorage.getItem(KO_FONT_KEY);
      if (kf !== null) setKoFont(normalizeKoFont(kf));
      // EN/KO 분리 배율 — 신규 키 우선, 둘 다 없으면 레거시 단일 키로 초기화.
      const legacy = localStorage.getItem(FONT_SCALE_KEY);
      const legacyV = legacy !== null ? clampFontScale(parseFloat(legacy)) : DEFAULT_FONT_SCALE;
      const enFs = localStorage.getItem(EN_FONT_SCALE_KEY);
      setEnFontScale(enFs !== null ? clampFontScale(parseFloat(enFs)) : legacyV);
      const koFs = localStorage.getItem(KO_FONT_SCALE_KEY);
      setKoFontScale(koFs !== null ? clampFontScale(parseFloat(koFs)) : legacyV);
      // 강제 모드(하위 경로)면 localStorage 모드보다 우선. 카테고리는 유형 라벨을 따름.
      const effMode = forcedMode ?? normalizeLessonMode(localStorage.getItem(MODE_KEY));
      setMode(effMode);
      setKicker(LESSON_MODE_LABELS[effMode]);
      const pid = localStorage.getItem(LAST_PASSAGE_KEY);
      if (pid) {
        fetch(`${passagesApiBase}/${encodeURIComponent(pid)}`, { credentials: 'include' })
          .then(r => (r.ok ? r.json() : null))
          .then(d => {
            if (d?.item) {
              const item = d.item as PassageItem;
              setPassage(item);
              void loadPairs(item);
            }
          })
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isUserClassKit) {
      setAccessLevel('admin');
      return;
    }
    fetch(`${passagesApiBase}/textbooks`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        const level = d.accessLevel as ClassKitAccessLevel | undefined;
        if (level === 'admin' || level === 'member' || level === 'guest') {
          setAccessLevel(level);
        } else {
          setAccessLevel(d.guest ? 'guest' : 'member');
        }
      })
      .catch(() => {});
  }, [passagesApiBase, isUserClassKit]);

  useEffect(() => {
    if (accessLevel !== 'guest') return;
    setEnFont((prev) => {
      const next = normalizeEnFontForAccess(prev, 'guest');
      if (next !== prev) persist(EN_FONT_KEY, next);
      return next;
    });
    setKoFont((prev) => {
      const next = normalizeKoFontForAccess(prev, 'guest');
      if (next !== prev) persist(KO_FONT_KEY, next);
      return next;
    });
  }, [accessLevel]);

  // 현재 지문의 교재가 바뀌면 그 교재의 지문 목록(좌우 이동용)을 불러옴
  useEffect(() => {
    const tb = passage?.textbook;
    if (!tb || tb === siblingsTextbook) return;
    let cancelled = false;
    fetch(`${passagesApiBase}?textbook=${encodeURIComponent(tb)}&limit=500`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d) return;
        setSiblings(Array.isArray(d.items) ? (d.items as PassageItem[]) : []);
        setSiblingsTextbook(tb);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [passage?.textbook, siblingsTextbook]);

  const curIndex = useMemo(
    () => (passage ? siblings.findIndex(s => s._id === passage._id) : -1),
    [siblings, passage],
  );
  const hasPrev = curIndex > 0;
  const hasNext = curIndex >= 0 && curIndex < siblings.length - 1;

  const koCount = useMemo(() => pairs.filter(p => (p.ko ?? '').trim()).length, [pairs]);

  const enFontOptions = useMemo(() => enFontOptionsForAccess(accessLevel), [accessLevel]);
  const koFontOptions = useMemo(() => koFontOptionsForAccess(accessLevel), [accessLevel]);

  const isLandscape = lessonModeIsLandscape(mode);

  const previewHtml = useMemo(
    () => buildLessonMaterialHtml({ kicker, title, number, sentences: pairs, lineHeight, splitPct, lineLayout, enFont, koFont, enFontScale, koFontScale, mode }),
    [kicker, title, number, pairs, lineHeight, splitPct, lineLayout, enFont, koFont, enFontScale, koFontScale, mode],
  );

  const filenameBase = useMemo(() => {
    const label = LESSON_MODE_LABELS[mode];
    const parts = [...(label !== '수업용자료' ? [label] : []), title.trim(), number.trim()]
      .filter(Boolean)
      .map(s => s.replace(/[\\/:*?"<>|]/g, '_'));
    return ['수업용자료', ...parts].join('_');
  }, [mode, title, number]);

  const handlePick = (p: PassageItem) => {
    setPassage(p);
    setShowPicker(false);
    try { localStorage.setItem(LAST_PASSAGE_KEY, p._id); } catch { /* ignore */ }
    setTitle(prev => {
      if (prev.trim()) return prev;
      persist(TITLE_KEY, p.textbook);
      return p.textbook;
    });
    const num = deriveNumber(p.number);
    setNumber(num);
    persist(NUMBER_KEY, num);
    setLineHeight(defaultLineHeight);
    void loadPairs(p);
    const cnt = enSentencesOf(p).length;
    setMsg(`📂 ${p.chapter} · ${p.number} 불러옴 — ${cnt}문장`);
    setTimeout(() => setMsg(''), 3000);
  };

  const goSibling = (dir: -1 | 1) => {
    if (curIndex < 0) return;
    const ni = curIndex + dir;
    if (ni < 0 || ni >= siblings.length) return;
    handlePick(siblings[ni]);
  };

  const updKicker = (v: string) => setKicker(v); // 카테고리는 유형 라벨 자동 — 임시 수정만
  const updTitle = (v: string) => { setTitle(v); persist(TITLE_KEY, v); };
  const updNumber = (v: string) => { setNumber(v); persist(NUMBER_KEY, v); };
  const updLineHeight = (v: number) => setLineHeight(clampLineHeight(v));
  const updSplit = (v: number) => {
    const sp = clampSplitPct(v);
    setSplitPct(sp);
    persist(SPLIT_KEY, String(sp));
  };
  const updLineLayout = (l: LineLayout) => { setLineLayout(l); persist(LINE_LAYOUT_KEY, l); };
  const updEnFont = (f: EnFontKey) => { setEnFont(f); persist(EN_FONT_KEY, f); };
  const updKoFont = (f: KoFontKey) => { setKoFont(f); persist(KO_FONT_KEY, f); };
  const updEnFontScale = (v: number) => { const s = clampFontScale(v); setEnFontScale(s); persist(EN_FONT_SCALE_KEY, String(s)); };
  const updKoFontScale = (v: number) => { const s = clampFontScale(v); setKoFontScale(s); persist(KO_FONT_SCALE_KEY, String(s)); };
  // 유형 전환 시 카테고리(kicker)도 해당 유형 라벨로 자동 갱신
  const updMode = (m: LessonMode) => { setMode(m); persist(MODE_KEY, m); setKicker(LESSON_MODE_LABELS[m]); };
  const saveLineHeightDefault = () => {
    const v = clampLineHeight(lineHeight);
    setDefaultLineHeight(v);
    persist(LINE_HEIGHT_KEY, String(v));
    setLhSaved(true);
    setTimeout(() => setLhSaved(false), 2000);
  };

  /** 모달 열 때 현재 화면 모드를 디폴트로, 선택 ID 셋을 초기화. */
  const openBulkDialog = () => {
    setBulkMode(mode);
    setBulkScope(siblings.length > 0 ? 'all' : 'current');
    setBulkRangeFrom('');
    setBulkRangeTo('');
    setBulkSelectedIds(new Set());
    setBulkFormat('pdf');
    setBulkPresets(passage?.textbook ? loadPresetsForTextbook(passage.textbook) : []);
    setBulkOpen(true);
  };

  /** 프리셋을 모달 상태로 복원. lesson 은 mode 도 함께. */
  const applyPreset = (p: ClassKitDownloadPreset) => {
    setBulkScope(p.scope);
    if (p.scope === 'manual' && Array.isArray(p.passageIds)) {
      setBulkSelectedIds(new Set(p.passageIds));
    } else {
      setBulkSelectedIds(new Set());
    }
    if (p.scope === 'range') {
      setBulkRangeFrom(p.rangeFrom ?? '');
      setBulkRangeTo(p.rangeTo ?? '');
    } else {
      setBulkRangeFrom('');
      setBulkRangeTo('');
    }
    if (p.mode === 'parallel' || p.mode === 'lineByLine' || p.mode === 'writeEn' || p.mode === 'writeKo') {
      setBulkMode(p.mode);
    }
    if (p.format === 'pdf' || p.format === 'zip') setBulkFormat(p.format);
  };

  /** 현재 모달 상태를 프리셋으로 저장. 이름 입력 prompt. */
  const saveCurrentAsPreset = () => {
    if (!passage?.textbook) return;
    const ids = resolveBulkPassageIds();
    const defaultName =
      bulkScope === 'manual'
        ? `선택 ${ids.length}건`
        : bulkScope === 'range'
          ? `${bulkRangeFrom}~${bulkRangeTo}`
          : bulkScope === 'all'
            ? '교재 전체'
            : '현재 지문';
    const raw = window.prompt('프리셋 이름 (최대 30자):', defaultName);
    if (raw === null) return;
    const name = raw.trim().slice(0, 30);
    if (!name) return;
    savePresetForTextbook(passage.textbook, {
      id: newPresetId(),
      name,
      scope: bulkScope,
      passageIds: bulkScope === 'manual' ? ids : undefined,
      rangeFrom: bulkScope === 'range' ? bulkRangeFrom : undefined,
      rangeTo: bulkScope === 'range' ? bulkRangeTo : undefined,
      mode: bulkMode,
      format: bulkFormat,
    });
    setBulkPresets(loadPresetsForTextbook(passage.textbook));
  };

  const removePreset = (id: string) => {
    if (!passage?.textbook) return;
    deletePresetForTextbook(passage.textbook, id);
    setBulkPresets(loadPresetsForTextbook(passage.textbook));
  };

  /** scope 에 따라 다운로드 대상 passageIds 산출. 'current' 는 빈 배열을 반환하지만
   *  실제로는 단건 lesson-pdf 라우트로 보내므로 호출자에서 분기. */
  const resolveBulkPassageIds = (): string[] => {
    if (bulkScope === 'current') return passage ? [passage._id] : [];
    if (bulkScope === 'all') return siblings.map((s) => s._id);
    if (bulkScope === 'manual') return Array.from(bulkSelectedIds);
    // range: from~to 의 number 가 포함된 sibling 만
    const from = parseInt(bulkRangeFrom.trim(), 10);
    const to = parseInt(bulkRangeTo.trim(), 10);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return [];
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    return siblings
      .filter((s) => {
        const m = String(s.number ?? '').match(/\d+/);
        if (!m) return false;
        const n = parseInt(m[0], 10);
        return n >= lo && n <= hi;
      })
      .map((s) => s._id);
  };

  const runBulkDownload = async () => {
    if (!passage?.textbook || bulkBusy) return;
    const ids = resolveBulkPassageIds();
    // 'current' 단일 지문은 기존 단건 lesson-pdf 로 처리 — 멀티페이지 빌더로 가지 않음.
    if (bulkScope === 'current') {
      setBulkOpen(false);
      await downloadPdf();
      return;
    }
    if (ids.length === 0) {
      alert('대상 지문이 없습니다. 범위/선택을 확인해 주세요.');
      return;
    }
    setBulkBusy(true);
    try {
      const res = await fetch(`${classKitApiBase}/lesson-pdf-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          textbook: passage.textbook,
          passageIds: ids,
          mode: bulkMode,
          format: bulkFormat,
          kicker,
          lineHeight,
          splitPct,
          lineLayout,
          enFont,
          koFont,
          enFontScale,
          koFontScale,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(`다운로드 실패: ${d?.error || res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeTb = passage.textbook.replace(/[\\/:*?"<>|]/g, '_');
      const safeMode = LESSON_MODE_LABELS[bulkMode].replace(/[\\/:*?"<>|]/g, '_');
      const date = new Date().toISOString().slice(0, 10);
      a.download = `수업용자료_${safeMode}_${safeTb}_${date}.${bulkFormat === 'pdf' ? 'pdf' : 'zip'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // 「최근」 프리셋 자동 저장 — 다음 모달 진입 시 한 번에 복원 가능.
      try {
        savePresetForTextbook(passage.textbook, {
          id: 'recent',
          name: '최근',
          scope: bulkScope,
          passageIds: bulkScope === 'manual' ? ids : undefined,
          rangeFrom: bulkScope === 'range' ? bulkRangeFrom : undefined,
          rangeTo: bulkScope === 'range' ? bulkRangeTo : undefined,
          mode: bulkMode,
          format: bulkFormat,
        });
      } catch {
        /* ignore */
      }
      setBulkOpen(false);
    } catch {
      alert('다운로드 중 오류가 발생했습니다.');
    } finally {
      setBulkBusy(false);
    }
  };

  const downloadPdf = async () => {
    if (!pairs.length || pdfBusy) return;
    setPdfBusy(true);
    try {
      const res = await fetch(`${classKitApiBase}/lesson-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kicker, title, number, mode, lineHeight, splitPct, lineLayout, enFont, koFont, enFontScale, koFontScale, sentences: pairs.map(p => ({ en: p.en, ko: p.ko })) }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(`PDF 생성 실패: ${d?.error || res.status}`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filenameBase}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('PDF 생성 중 오류가 발생했습니다.');
    } finally {
      setPdfBusy(false);
    }
  };

  const openInNewTab = () => {
    if (!pairs.length) return;
    const blob = new Blob([previewHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) { alert('팝업이 차단되어 새 창을 열 수 없습니다.'); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const printPreview = () => {
    if (!pairs.length) return;
    const iframeDoc = previewIframeRef.current?.contentDocument;
    const html = iframeDoc ? '<!DOCTYPE html>' + iframeDoc.documentElement.outerHTML : previewHtml;
    const w = window.open('', '_blank');
    if (!w) { alert('팝업이 차단되어 인쇄 창을 열 수 없습니다.'); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch { /* ignore */ } }, 400);
  };

  const resolvedHomeHref = homeHref ?? (routeBase === '/class-kit' ? '/class-kit/lecture' : undefined);
  const tabCurrent: 'lecture' | LessonMode = forcedMode ?? mode;

  return (
    <ClassKitRoot>
      {isUserClassKit ? (
        <ClassKitAccessBanner passagesApiBase={passagesApiBase} onSignup={onGuestGate} />
      ) : null}
      <ClassKitHeader
        homeHref={resolvedHomeHref}
        onLoadPassage={() => setShowPicker(true)}
        message={msg || undefined}
        passageInfo={
          passage ? (
            <ClassKitPassageNav
              onPrev={() => goSibling(-1)}
              onNext={() => goSibling(1)}
              hasPrev={hasPrev}
              hasNext={hasNext}
              chapter={passage.chapter}
              number={passage.number}
              sourceKey={passage.source_key}
              sentenceCount={pairs.length}
              position={curIndex >= 0 && siblings.length > 0 ? `${curIndex + 1}/${siblings.length}` : undefined}
              extra={
                pairs.length > 0 ? (
                  <span className={koCount === pairs.length ? 'text-emerald-400/90' : 'text-amber-400'}>
                    해석 {koCount}/{pairs.length}
                  </span>
                ) : undefined
              }
            />
          ) : undefined
        }
        actions={
          <>
            <ClassKitIconButton
              onClick={openInNewTab}
              disabled={!pairs.length}
              title="새 창에서 열기 (프로젝터·전자칠판)"
              label="새 창에서 열기"
            >
              <IconMonitor />
            </ClassKitIconButton>
            <ClassKitIconButton
              onClick={downloadPdf}
              disabled={!pairs.length || pdfBusy}
              title={pdfBusy ? 'PDF 생성 중…' : 'PDF 다운로드 (현재 지문)'}
              label="PDF 다운로드"
            >
              {pdfBusy ? <IconSpinner /> : <IconPdf />}
            </ClassKitIconButton>
            <ClassKitIconButton
              onClick={openBulkDialog}
              disabled={!passage}
              title="다운로드 옵션 (범위·유형·형식)"
              label="다운로드 옵션"
            >
              <IconBooks />
            </ClassKitIconButton>
            <ClassKitIconButton
              onClick={printPreview}
              disabled={!pairs.length}
              title="인쇄"
              label="인쇄"
            >
              <IconPrint />
            </ClassKitIconButton>
          </>
        }
        tabs={
          <ClassKitTabs
            current={tabCurrent}
            onSelectLessonMode={forcedMode ? undefined : updMode}
            routeBase={routeBase}
          />
        }
      />

      <div className="flex min-h-0 flex-1">
        <ClassKitPreviewPane empty={pairs.length === 0} onLoadPassage={() => setShowPicker(true)}>
          {pairs.length > 0 ? (
            isLandscape ? (
              <div className="w-full overflow-hidden" style={{ aspectRatio: '297 / 210', maxWidth: 1100, margin: '0 auto' }}>
                <iframe
                  ref={previewIframeRef}
                  srcDoc={previewHtml}
                  title="수업용자료 미리보기"
                  className="h-full w-full bg-white"
                  style={{ border: 'none' }}
                />
              </div>
            ) : (
              <iframe
                ref={previewIframeRef}
                srcDoc={previewHtml}
                title="수업용자료 미리보기"
                className="w-full bg-white"
                style={{ height: '80vh', border: 'none' }}
              />
            )
          ) : null}
        </ClassKitPreviewPane>

        <ClassKitSettingsAside>
          <div className="space-y-3">
            <ClassKitField label="카테고리">
              <input value={kicker} onChange={(e) => updKicker(e.target.value)} placeholder="수업용자료" className={ckInputClass} />
            </ClassKitField>
            <ClassKitField label="시험정보">
              <input
                value={title}
                onChange={(e) => updTitle(e.target.value)}
                placeholder="예: 26년 고3 5월 영어모의고사"
                className={ckInputClass}
              />
            </ClassKitField>
            <ClassKitField label="문항번호">
              <input value={number} onChange={(e) => updNumber(e.target.value)} placeholder="18" className={`${ckInputClass} w-28`} />
            </ClassKitField>
          </div>

          <ClassKitDivider />

          <div className="space-y-3">
            <span className={ckSectionTitleClass}>글씨체</span>
            {accessLevel === 'guest' ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-amber-100">
                {CLASS_KIT_GUEST_FONT_NOTICE}
                {onGuestGate ? (
                  <button
                    type="button"
                    onClick={onGuestGate}
                    className="mt-2 block rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-500"
                  >
                    회원가입하기
                  </button>
                ) : null}
              </p>
            ) : null}
            <ClassKitField label="영어 글씨체">
              <select value={enFont} onChange={(e) => updEnFont(e.target.value as EnFontKey)} className={ckSelectClass}>
                {enFontOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </ClassKitField>
            <ClassKitField label="한글 글씨체">
              <select value={koFont} onChange={(e) => updKoFont(e.target.value as KoFontKey)} className={ckSelectClass}>
                {koFontOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </ClassKitField>
            <ClassKitSliderSection
              title="영어 글자 크기"
              value={enFontScale}
              min={0.7}
              max={1.6}
              step={0.05}
              onChange={updEnFontScale}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              marks={['작게 70%', '기본 100%', '크게 160%']}
              footer={
                enFontScale !== DEFAULT_FONT_SCALE ? (
                  <ClassKitSecondaryButton onClick={() => updEnFontScale(DEFAULT_FONT_SCALE)}>
                    영어 100%로 초기화
                  </ClassKitSecondaryButton>
                ) : null
              }
            />
            <ClassKitSliderSection
              title="한글 글자 크기"
              value={koFontScale}
              min={0.7}
              max={1.6}
              step={0.05}
              onChange={updKoFontScale}
              formatValue={(v) => `${Math.round(v * 100)}%`}
              marks={['작게 70%', '기본 100%', '크게 160%']}
              footer={
                koFontScale !== DEFAULT_FONT_SCALE ? (
                  <ClassKitSecondaryButton onClick={() => updKoFontScale(DEFAULT_FONT_SCALE)}>
                    한글 100%로 초기화
                  </ClassKitSecondaryButton>
                ) : null
              }
            />
          </div>

          {mode === 'lineByLine' && (
            <>
              <ClassKitDivider />
              <div className="space-y-2">
                <span className={ckSectionTitleClass}>해석 배치</span>
                <div className="flex items-center gap-1 rounded-lg border border-zinc-700/80 bg-zinc-950/60 p-0.5">
                  <button
                    type="button"
                    onClick={() => updLineLayout('stack')}
                    className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      lineLayout === 'stack' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    위아래
                  </button>
                  <button
                    type="button"
                    onClick={() => updLineLayout('side')}
                    className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      lineLayout === 'side' ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    좌우
                  </button>
                </div>
                <p className="text-[10px] text-zinc-500">위아래: 영어 아래 해석 · 좌우: 영어 왼쪽 / 해석 오른쪽</p>
              </div>
            </>
          )}

          {mode !== 'lineByLine' && (
            <>
              <ClassKitDivider />
              <ClassKitSliderSection
                title="줄 간격"
                hint={mode === 'parallel' ? '영어 · 판서' : '작성 줄 높이'}
                value={lineHeight}
                min={1.4}
                max={3.6}
                step={0.1}
                onChange={updLineHeight}
                marks={['좁게 1.4', '기본 2.6', '넓게 3.6']}
                footer={
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-zinc-500">
                        저장된 디폴트{' '}
                        <span className="font-mono tabular-nums text-zinc-300">{defaultLineHeight.toFixed(1)}</span>
                      </span>
                      {lineHeight !== defaultLineHeight ? <span className="text-amber-400">미저장</span> : null}
                    </div>
                    <ClassKitPrimaryButton
                      onClick={saveLineHeightDefault}
                      disabled={lineHeight === defaultLineHeight}
                    >
                      {lhSaved ? '디폴트로 저장됨' : '현재 값을 디폴트로 저장'}
                    </ClassKitPrimaryButton>
                    <ClassKitSecondaryButton onClick={() => updLineHeight(DEFAULT_LINE_HEIGHT)}>
                      2.6으로 초기화
                    </ClassKitSecondaryButton>
                  </div>
                }
              />
            </>
          )}

          {isLandscape && (
            <>
              <ClassKitDivider />
              <ClassKitSliderSection
                title="구분선 위치"
                hint="영어 폭"
                value={splitPct}
                min={30}
                max={75}
                step={1}
                onChange={(v) => updSplit(Math.round(v))}
                formatValue={(v) => `${Math.round(v)}%`}
                marks={['← 한국어 넓게', '기본 60%', '영어 넓게 →']}
                footer={
                  <ClassKitSecondaryButton onClick={() => updSplit(DEFAULT_SPLIT)}>
                    기본(60%)으로
                  </ClassKitSecondaryButton>
                }
              />
            </>
          )}
        </ClassKitSettingsAside>
      </div>

      {showPicker && (
        <PassagePickerModal
          onSelect={handlePick}
          onClose={() => setShowPicker(false)}
          lastTextbookKey="class_kit_lesson_last_textbook"
          showCounts={false}
          passagesApiBase={passagesApiBase}
          onSignupRequest={onGuestGate}
        />
      )}

      {bulkOpen && passage && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
          onClick={() => !bulkBusy && setBulkOpen(false)}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[calc(100dvh-2rem)] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 px-5 py-4 border-b border-slate-700 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-white font-bold">다운로드 옵션</h3>
                <p className="text-slate-500 text-[11px] mt-0.5">{passage.textbook} · 지문 {siblings.length}건</p>
              </div>
              <button
                type="button"
                onClick={() => setBulkOpen(false)}
                disabled={bulkBusy}
                className="w-8 h-8 rounded-full text-slate-400 hover:bg-slate-700/60 disabled:opacity-40"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* 저장된 프리셋 */}
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <h4 className="text-sm font-semibold text-white">저장된 프리셋</h4>
                  <button
                    type="button"
                    onClick={saveCurrentAsPreset}
                    className="px-2.5 py-1 text-xs rounded border border-emerald-600/60 bg-emerald-900/30 hover:bg-emerald-800/40 text-emerald-100"
                    title="현재 선택을 프리셋으로 저장"
                  >
                    💾 현재 선택 저장
                  </button>
                </div>
                {bulkPresets.length === 0 ? (
                  <p className="text-[11px] text-slate-500">
                    프리셋이 없습니다. 다운로드 시 「최근」 프리셋이 자동 저장됩니다.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {bulkPresets.map((p) => {
                      const cnt =
                        p.scope === 'manual'
                          ? p.passageIds?.length ?? 0
                          : p.scope === 'range'
                            ? `${p.rangeFrom ?? '?'}~${p.rangeTo ?? '?'}`
                            : p.scope === 'all'
                              ? '전체'
                              : '현재';
                      return (
                        <span
                          key={p.id}
                          className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-lg border border-slate-600 bg-slate-900/60 text-xs text-slate-200"
                        >
                          <button
                            type="button"
                            onClick={() => applyPreset(p)}
                            title={`${p.scope} · ${p.mode ?? ''} · ${p.format ?? ''}`}
                            className="hover:text-white"
                          >
                            {p.name} <span className="text-slate-500">({String(cnt)})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removePreset(p.id)}
                            className="w-5 h-5 flex items-center justify-center rounded text-slate-500 hover:text-rose-300 hover:bg-rose-900/30"
                            title="프리셋 삭제"
                            aria-label="삭제"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 지문 범위 */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-2">지문 범위</h4>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['current', '현재 지문만'],
                    ['all', '교재 전체'],
                    ['range', '번호 범위'],
                    ['manual', '개별 선택'],
                  ] as const).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setBulkScope(k)}
                      className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                        bulkScope === k
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-slate-900 border-slate-600 text-slate-300 hover:bg-slate-700/40'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {bulkScope === 'range' && (
                  <div className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="number"
                      value={bulkRangeFrom}
                      onChange={(e) => setBulkRangeFrom(e.target.value)}
                      placeholder="부터"
                      className="w-24 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white"
                    />
                    <span className="text-slate-500">~</span>
                    <input
                      type="number"
                      value={bulkRangeTo}
                      onChange={(e) => setBulkRangeTo(e.target.value)}
                      placeholder="까지"
                      className="w-24 bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-white"
                    />
                    <span className="text-[11px] text-slate-500 ml-1">{resolveBulkPassageIds().length}건 선택됨</span>
                  </div>
                )}
                {bulkScope === 'manual' && (
                  <div className="mt-3 border border-slate-700 rounded-lg max-h-48 overflow-y-auto p-2 space-y-1">
                    {siblings.length === 0 ? (
                      <p className="text-slate-500 text-sm text-center py-3">교재 지문 목록을 불러오는 중…</p>
                    ) : (
                      siblings.map((s) => {
                        const checked = bulkSelectedIds.has(s._id);
                        return (
                          <label key={s._id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-700/40 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setBulkSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(s._id);
                                  else next.delete(s._id);
                                  return next;
                                });
                              }}
                              className="accent-emerald-500"
                            />
                            <span className="text-xs text-slate-300 font-mono">{s.chapter} · {s.number}</span>
                            {s.source_key && <span className="text-[10px] text-emerald-400 truncate">{s.source_key}</span>}
                          </label>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {/* 유형 (모드) */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-2">유형</h4>
                <div className="grid grid-cols-2 gap-2">
                  {(['parallel', 'lineByLine', 'writeEn', 'writeKo'] as LessonMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setBulkMode(m)}
                      className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                        bulkMode === m
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-slate-900 border-slate-600 text-slate-300 hover:bg-slate-700/40'
                      }`}
                    >
                      {LESSON_MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5">
                  영한대조 = A4 가로 1지문/1장 · 나머지 = A4 세로 (긴 지문은 자동 분할)
                </p>
              </div>

              {/* 형식 */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-2">출력 형식</h4>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    ['pdf', '단일 PDF (지문 순)'],
                    ['zip', 'ZIP (번호별 PDF)'],
                  ] as const).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setBulkFormat(k)}
                      className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
                        bulkFormat === k
                          ? 'bg-emerald-600 border-emerald-500 text-white'
                          : 'bg-slate-900 border-slate-600 text-slate-300 hover:bg-slate-700/40'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {bulkScope === 'current' && (
                  <p className="mt-2 text-[11px] text-amber-300">현재 지문만 = 기존 1건 PDF 라우트로 처리 (형식 무관)</p>
                )}
              </div>
            </div>

            <div className="shrink-0 px-5 py-3 border-t border-slate-700 flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-500">
                현재 설정(라인높이·split·폰트·스케일) 그대로 적용됩니다.
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setBulkOpen(false)}
                  disabled={bulkBusy}
                  className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm disabled:opacity-40"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={runBulkDownload}
                  disabled={bulkBusy}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm disabled:opacity-40"
                >
                  {bulkBusy ? '⏳ 생성 중…' : '다운로드'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ClassKitRoot>
  );
}
