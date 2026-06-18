'use client';

/**
 * 강의용자료 — "한 지문 = 한 화면" 강의/판서용 자료 (gangui_kit 톤).
 * 지문을 불러와 페이퍼릭 그린 헤더 + 문장번호 단락으로 미리보기 →
 * 새 창(프로젝터/전자칠판) 또는 인쇄.
 * (DB 저장 없음 — 그때그때 지문을 골라 띄우는 용도.)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import PassagePickerModal, { PassageItem } from '../../_components/PassagePickerModal';
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
  IconMonitor,
  IconPdf,
  IconBooks,
  IconPrint,
  IconSpinner,
} from '../_components/ClassKitUI';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import { buildLectureMaterialHtml, clampLineHeight } from '@/lib/lecture-material-html';
import {
  loadPresetsForTextbook,
  savePresetForTextbook,
  deletePresetForTextbook,
  newPresetId,
  type ClassKitDownloadPreset,
} from '@/lib/class-kit-download-presets';

const KICKER_KEY = 'class_kit_lecture_kicker';
const TITLE_KEY = 'class_kit_lecture_title';
const NUMBER_KEY = 'class_kit_lecture_number';
const LINE_HEIGHT_KEY = 'class_kit_lecture_line_height';
const LAST_PASSAGE_KEY = 'class_kit_lecture_last_passage_id';
const DEFAULT_LINE_HEIGHT = 2.6;

/** passage.number 에서 워터마크용 숫자만 추출 (없으면 원문 그대로). */
function deriveNumber(raw?: string): string {
  const s = (raw ?? '').trim();
  const m = s.match(/\d+/);
  return m ? m[0] : s;
}

export interface ClassKitLectureViewProps {
  passagesApiBase?: string;
  classKitApiBase?: string;
  onGuestGate?: () => void;
  /** 사용자용 `/class-kit`, 관리자용 `/admin/class-kit` */
  routeBase?: string;
  homeHref?: string;
}

export function ClassKitLectureView({
  passagesApiBase = '/api/admin/passages',
  classKitApiBase = '/api/admin/class-kit',
  routeBase = '/admin/class-kit',
  homeHref,
  onGuestGate,
}: ClassKitLectureViewProps = {}) {
  const [passage, setPassage] = useState<PassageItem | null>(null);
  const [kicker, setKicker] = useState('강의용자료');
  const [title, setTitle] = useState('');
  const [number, setNumber] = useState('');
  const [lineHeight, setLineHeight] = useState(DEFAULT_LINE_HEIGHT);
  const [showPicker, setShowPicker] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  /** 다운로드 옵션 모달 — lesson 의 모달과 동일한 UX. */
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkScope, setBulkScope] = useState<'current' | 'all' | 'range' | 'manual'>('all');
  const [bulkRangeFrom, setBulkRangeFrom] = useState('');
  const [bulkRangeTo, setBulkRangeTo] = useState('');
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  /** 개별 선택(manual) 다교재 묶음: 담긴 지문 메타(요약·정렬 표시용) — bulkSelectedIds 와 동기. */
  const [bulkSelectedMeta, setBulkSelectedMeta] = useState<Map<string, { textbook: string; chapter: string; number: string; source_key?: string }>>(new Map());
  /** manual 패널 — 교재 드롭다운/검색/지문목록(여러 교재를 오가며 누적 선택). */
  const [manualTextbooks, setManualTextbooks] = useState<string[]>([]);
  const [manualTextbook, setManualTextbook] = useState('');
  const [manualPassages, setManualPassages] = useState<PassageItem[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [bulkFormat, setBulkFormat] = useState<'pdf' | 'zip'>('pdf');
  const [bulkPresets, setBulkPresets] = useState<ClassKitDownloadPreset[]>([]);
  const [msg, setMsg] = useState('');
  /** 저장된 디폴트 줄 간격 — 새 지문을 불러오면 이 값으로 적용. */
  const [defaultLineHeight, setDefaultLineHeight] = useState(DEFAULT_LINE_HEIGHT);
  const [lhSaved, setLhSaved] = useState(false);
  /** 같은 교재의 지문 목록 — 좌우 화살표로 이전/다음 지문 이동. */
  const [siblings, setSiblings] = useState<PassageItem[]>([]);
  const [siblingsTextbook, setSiblingsTextbook] = useState('');
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  // localStorage 복원 + 마지막 지문 자동 불러오기
  useEffect(() => {
    try {
      const k = localStorage.getItem(KICKER_KEY);
      if (k !== null) setKicker(k);
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
      const pid = localStorage.getItem(LAST_PASSAGE_KEY);
      if (pid) {
        fetch(`${passagesApiBase}/${encodeURIComponent(pid)}`, { credentials: 'include' })
          .then(r => (r.ok ? r.json() : null))
          .then(d => { if (d?.item) setPassage(d.item as PassageItem); })
          .catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, []);

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

  // 개별 선택(manual) 패널에서 교재를 고르면 그 교재 지문 목록 로드(다교재 혼합 선택용).
  useEffect(() => {
    if (!bulkOpen || !manualTextbook) { setManualPassages([]); return; }
    let cancelled = false;
    setManualLoading(true);
    fetch(`${passagesApiBase}?textbook=${encodeURIComponent(manualTextbook)}&limit=500`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setManualPassages(d && Array.isArray(d.items) ? (d.items as PassageItem[]) : []); })
      .catch(() => { if (!cancelled) setManualPassages([]); })
      .finally(() => { if (!cancelled) setManualLoading(false); });
    return () => { cancelled = true; };
  }, [bulkOpen, manualTextbook, passagesApiBase]);

  const sentences = useMemo(() => {
    if (!passage?.content) return [];
    return tokenizePassageFromContent(passage.content).map(s => ({ idx: s.idx, text: s.text }));
  }, [passage]);

  const curIndex = useMemo(
    () => (passage ? siblings.findIndex(s => s._id === passage._id) : -1),
    [siblings, passage],
  );
  const hasPrev = curIndex > 0;
  const hasNext = curIndex >= 0 && curIndex < siblings.length - 1;

  const previewHtml = useMemo(
    () => buildLectureMaterialHtml({ kicker, title, number, sentences, lineHeight }),
    [kicker, title, number, sentences, lineHeight],
  );

  /** manual 묶음에 담긴 지문들의 교재 집합 — 혼합 여부·요약 표시. */
  const bulkSelectedTextbooks = useMemo(() => {
    const s = new Set<string>();
    bulkSelectedMeta.forEach((m) => { if (m.textbook) s.add(m.textbook); });
    return s;
  }, [bulkSelectedMeta]);
  /** manual 선택이 현재 화면 교재가 아닌 지문을 포함하는지(혼합/타교재 묶음) → 프리셋 저장 제외. */
  const hasForeignTextbook = useMemo(
    () => bulkScope === 'manual' && Array.from(bulkSelectedTextbooks).some((t) => t !== (passage?.textbook ?? '')),
    [bulkScope, bulkSelectedTextbooks, passage?.textbook],
  );
  const manualFiltered = useMemo(() => {
    const lq = manualQuery.trim().toLowerCase();
    if (!lq) return manualPassages;
    return manualPassages.filter((p) =>
      (p.source_key ?? '').toLowerCase().includes(lq) ||
      p.chapter.toLowerCase().includes(lq) ||
      p.number.toLowerCase().includes(lq) ||
      (p.content?.original ?? '').toLowerCase().includes(lq),
    );
  }, [manualPassages, manualQuery]);

  const filenameBase = useMemo(() => {
    const parts = [title.trim(), number.trim()]
      .filter(Boolean)
      .map(s => s.replace(/[\\/:*?"<>|]/g, '_'));
    const body = parts.join('_');
    return body ? `강의용자료_${body}` : '강의용자료';
  }, [title, number]);

  const persist = (key: string, v: string) => {
    try { localStorage.setItem(key, v); } catch { /* ignore */ }
  };

  const handlePick = (p: PassageItem) => {
    setPassage(p);
    setShowPicker(false);
    try { localStorage.setItem(LAST_PASSAGE_KEY, p._id); } catch { /* ignore */ }
    // 시험정보(title) 비어 있으면 교재명으로 채움 / 문항번호는 지문 번호로 갱신
    setTitle(prev => {
      if (prev.trim()) return prev;
      persist(TITLE_KEY, p.textbook);
      return p.textbook;
    });
    const num = deriveNumber(p.number);
    setNumber(num);
    persist(NUMBER_KEY, num);
    // 새 지문은 저장된 디폴트 줄 간격으로 적용
    setLineHeight(defaultLineHeight);
    const cnt = tokenizePassageFromContent(p.content).length;
    setMsg(`📂 ${p.chapter} · ${p.number} 불러옴 — ${cnt}문장`);
    setTimeout(() => setMsg(''), 3000);
  };

  /** 같은 교재 내 이전(-1)/다음(+1) 지문으로 이동. */
  const goSibling = (dir: -1 | 1) => {
    if (curIndex < 0) return;
    const ni = curIndex + dir;
    if (ni < 0 || ni >= siblings.length) return;
    handlePick(siblings[ni]);
  };

  const updKicker = (v: string) => { setKicker(v); persist(KICKER_KEY, v); };
  const updTitle = (v: string) => { setTitle(v); persist(TITLE_KEY, v); };
  const updNumber = (v: string) => { setNumber(v); persist(NUMBER_KEY, v); };
  // 슬라이더는 현재(미리보기) 값만 변경 — 디폴트는 「디폴트로 저장」을 눌러야 갱신
  const updLineHeight = (v: number) => setLineHeight(clampLineHeight(v));
  const saveLineHeightDefault = () => {
    const v = clampLineHeight(lineHeight);
    setDefaultLineHeight(v);
    persist(LINE_HEIGHT_KEY, String(v));
    setLhSaved(true);
    setTimeout(() => setLhSaved(false), 2000);
  };

  const downloadPdf = async () => {
    if (!sentences.length || pdfBusy) return;
    setPdfBusy(true);
    try {
      const res = await fetch(`${classKitApiBase}/lecture-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ kicker, title, number, lineHeight, sentences: sentences.map(s => s.text) }),
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

  const openBulkDialog = () => {
    setBulkScope(siblings.length > 0 ? 'all' : 'current');
    setBulkRangeFrom('');
    setBulkRangeTo('');
    setBulkSelectedIds(new Set());
    setBulkSelectedMeta(new Map());
    setManualTextbook(passage?.textbook ?? '');
    setManualQuery('');
    if (manualTextbooks.length === 0) {
      fetch(`${passagesApiBase}/textbooks`, { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => setManualTextbooks(Array.isArray(d.textbooks) ? d.textbooks : []))
        .catch(() => {});
    }
    setBulkFormat('pdf');
    setBulkPresets(passage?.textbook ? loadPresetsForTextbook(passage.textbook) : []);
    setBulkOpen(true);
  };

  /** manual 묶음 토글(체크) — id 와 메타를 함께 갱신. 선택 순서 = 삽입 순서. */
  const toggleManualPick = (p: PassageItem) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(p._id)) next.delete(p._id);
      else next.add(p._id);
      return next;
    });
    setBulkSelectedMeta((prev) => {
      const next = new Map(prev);
      if (next.has(p._id)) next.delete(p._id);
      else next.set(p._id, { textbook: p.textbook, chapter: p.chapter, number: p.number, source_key: p.source_key });
      return next;
    });
  };
  const removeManualPick = (id: string) => {
    setBulkSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setBulkSelectedMeta((prev) => { const n = new Map(prev); n.delete(id); return n; });
  };
  const clearManualPicks = () => { setBulkSelectedIds(new Set()); setBulkSelectedMeta(new Map()); };

  const applyPreset = (p: ClassKitDownloadPreset) => {
    setBulkScope(p.scope);
    if (p.scope === 'manual' && Array.isArray(p.passageIds)) setBulkSelectedIds(new Set(p.passageIds));
    else setBulkSelectedIds(new Set());
    if (p.scope === 'range') {
      setBulkRangeFrom(p.rangeFrom ?? '');
      setBulkRangeTo(p.rangeTo ?? '');
    } else {
      setBulkRangeFrom('');
      setBulkRangeTo('');
    }
    if (p.format === 'pdf' || p.format === 'zip') setBulkFormat(p.format);
  };

  const saveCurrentAsPreset = () => {
    if (!passage?.textbook) return;
    if (hasForeignTextbook) {
      alert('여러 교재가 섞인 묶음은 프리셋으로 저장할 수 없습니다(같은 교재 묶음만 저장 가능).');
      return;
    }
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
      format: bulkFormat,
    });
    setBulkPresets(loadPresetsForTextbook(passage.textbook));
  };

  const removePreset = (id: string) => {
    if (!passage?.textbook) return;
    deletePresetForTextbook(passage.textbook, id);
    setBulkPresets(loadPresetsForTextbook(passage.textbook));
  };

  /** scope 에 따라 다운로드 대상 passageIds 산출. 'current' 는 단건 PDF 경로 사용. */
  const resolveBulkPassageIds = (): string[] => {
    if (bulkScope === 'current') return passage ? [passage._id] : [];
    if (bulkScope === 'all') return siblings.map((s) => s._id);
    if (bulkScope === 'manual') return Array.from(bulkSelectedIds);
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
      const res = await fetch(`${classKitApiBase}/lecture-pdf-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          textbook: passage.textbook,
          passageIds: ids,
          kicker,
          lineHeight,
          format: bulkFormat,
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
      const tbForName =
        bulkScope === 'manual'
          ? bulkSelectedTextbooks.size === 1
            ? Array.from(bulkSelectedTextbooks)[0]
            : bulkSelectedTextbooks.size > 1
              ? '여러교재'
              : passage.textbook
          : passage.textbook;
      const safe = tbForName.replace(/[\\/:*?"<>|]/g, '_');
      const date = new Date().toISOString().slice(0, 10);
      a.download = `강의용자료_${safe}_${date}.${bulkFormat === 'pdf' ? 'pdf' : 'zip'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // 여러 교재가 섞인 묶음은 단일 교재 키에 담을 수 없어 「최근」 자동 저장에서 제외.
      if (!hasForeignTextbook) {
        try {
          savePresetForTextbook(passage.textbook, {
            id: 'recent',
            name: '최근',
            scope: bulkScope,
            passageIds: bulkScope === 'manual' ? ids : undefined,
            rangeFrom: bulkScope === 'range' ? bulkRangeFrom : undefined,
            rangeTo: bulkScope === 'range' ? bulkRangeTo : undefined,
            format: bulkFormat,
          });
        } catch {
          /* ignore */
        }
      }
      setBulkOpen(false);
    } catch {
      alert('다운로드 중 오류가 발생했습니다.');
    } finally {
      setBulkBusy(false);
    }
  };

  const openInNewTab = () => {
    if (!sentences.length) return;
    const blob = new Blob([previewHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) { alert('팝업이 차단되어 새 창을 열 수 없습니다.'); }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  const printPreview = () => {
    if (!sentences.length) return;
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
  const isUserClassKit = passagesApiBase.includes('/api/class-kit/');

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
              sentenceCount={sentences.length}
              position={curIndex >= 0 && siblings.length > 0 ? `${curIndex + 1}/${siblings.length}` : undefined}
            />
          ) : undefined
        }
        actions={
          <>
            <ClassKitIconButton
              onClick={openInNewTab}
              disabled={!sentences.length}
              title="새 창에서 열기 (프로젝터·전자칠판)"
              label="새 창에서 열기"
            >
              <IconMonitor />
            </ClassKitIconButton>
            <ClassKitIconButton
              onClick={downloadPdf}
              disabled={!sentences.length || pdfBusy}
              title={pdfBusy ? 'PDF 생성 중…' : 'PDF 다운로드 (현재 지문)'}
              label="PDF 다운로드"
            >
              {pdfBusy ? <IconSpinner /> : <IconPdf />}
            </ClassKitIconButton>
            <ClassKitIconButton
              onClick={openBulkDialog}
              disabled={!passage}
              title="다운로드 옵션 (범위·형식)"
              label="다운로드 옵션"
            >
              <IconBooks />
            </ClassKitIconButton>
            <ClassKitIconButton
              onClick={printPreview}
              disabled={!sentences.length}
              title="인쇄"
              label="인쇄"
            >
              <IconPrint />
            </ClassKitIconButton>
          </>
        }
        tabs={<ClassKitTabs current="lecture" routeBase={routeBase} />}
      />

      <div className="flex min-h-0 flex-1">
        <ClassKitPreviewPane empty={sentences.length === 0} onLoadPassage={() => setShowPicker(true)}>
          {sentences.length > 0 ? (
            <iframe
              ref={previewIframeRef}
              srcDoc={previewHtml}
              title="강의용자료 미리보기"
              className="w-full bg-white"
              style={{ height: '78vh', border: 'none' }}
            />
          ) : null}
        </ClassKitPreviewPane>

        <ClassKitSettingsAside>
          <div className="space-y-3">
            <ClassKitField label="카테고리">
              <input
                value={kicker}
                onChange={(e) => updKicker(e.target.value)}
                placeholder="강의용자료"
                className={ckInputClass}
              />
            </ClassKitField>
            <ClassKitField label="시험정보">
              <input
                value={title}
                onChange={(e) => updTitle(e.target.value)}
                placeholder="예: 26년 고3 5월 영어모의고사"
                className={ckInputClass}
              />
            </ClassKitField>
            <ClassKitField label="문항번호 (워터마크)">
              <input
                value={number}
                onChange={(e) => updNumber(e.target.value)}
                placeholder="21"
                className={`${ckInputClass} w-28`}
              />
            </ClassKitField>
          </div>

          <ClassKitDivider />

          <ClassKitSliderSection
            title="줄 간격"
            hint="판서 공간"
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
                  title="현재 줄 간격을 디폴트로 저장"
                >
                  {lhSaved ? '디폴트로 저장됨' : '현재 값을 디폴트로 저장'}
                </ClassKitPrimaryButton>
                <ClassKitSecondaryButton onClick={() => updLineHeight(DEFAULT_LINE_HEIGHT)}>
                  2.6으로 초기화
                </ClassKitSecondaryButton>
              </div>
            }
          />
        </ClassKitSettingsAside>
      </div>

      {showPicker && (
        <PassagePickerModal
          onSelect={handlePick}
          onClose={() => setShowPicker(false)}
          lastTextbookKey="class_kit_lecture_last_textbook"
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
                            title={`${p.scope} · ${p.format ?? ''}`}
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
                  <div className="mt-3 space-y-2">
                    <p className="text-[11px] text-slate-500">교재를 바꿔가며 여러 회차 지문을 담을 수 있습니다. 담은 순서대로 출력됩니다.</p>
                    <select
                      value={manualTextbook}
                      onChange={(e) => { setManualTextbook(e.target.value); setManualQuery(''); }}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2.5 py-1.5 text-sm text-white"
                    >
                      <option value="">{manualTextbooks.length ? '교재 선택' : '교재 불러오는 중…'}</option>
                      {manualTextbooks.map((tb) => (
                        <option key={tb} value={tb}>{tb}</option>
                      ))}
                    </select>
                    <input
                      value={manualQuery}
                      onChange={(e) => setManualQuery(e.target.value)}
                      placeholder="지문 검색 (소스키, 챕터, 내용)"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500"
                    />
                    <div className="border border-slate-700 rounded-lg max-h-40 overflow-y-auto p-2 space-y-1">
                      {!manualTextbook ? (
                        <p className="text-slate-500 text-sm text-center py-3">교재를 선택하세요</p>
                      ) : manualLoading ? (
                        <p className="text-slate-500 text-sm text-center py-3">불러오는 중…</p>
                      ) : manualFiltered.length === 0 ? (
                        <p className="text-slate-500 text-sm text-center py-3">지문이 없습니다</p>
                      ) : (
                        manualFiltered.map((p) => {
                          const checked = bulkSelectedIds.has(p._id);
                          return (
                            <label key={p._id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-700/40 cursor-pointer">
                              <input type="checkbox" checked={checked} onChange={() => toggleManualPick(p)} className="accent-emerald-500" />
                              <span className="text-xs text-slate-300 font-mono">{p.chapter} · {p.number}</span>
                              {p.source_key && <span className="text-[10px] text-emerald-400 truncate">{p.source_key}</span>}
                            </label>
                          );
                        })
                      )}
                    </div>
                    {bulkSelectedIds.size > 0 && (
                      <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/20 p-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-semibold text-emerald-200">
                            담긴 {bulkSelectedIds.size}건{bulkSelectedTextbooks.size > 1 ? ` · ${bulkSelectedTextbooks.size}개 교재` : ''}
                          </span>
                          <button type="button" onClick={clearManualPicks} className="text-[10px] text-slate-400 hover:text-rose-300">전체 해제</button>
                        </div>
                        <div className="max-h-28 overflow-y-auto space-y-1">
                          {Array.from(bulkSelectedIds).map((id, i) => {
                            const m = bulkSelectedMeta.get(id);
                            if (!m) return null;
                            return (
                              <div key={id} className="flex items-center gap-1.5 text-[11px] text-slate-300">
                                <span className="text-slate-500 tabular-nums w-5 text-right">{i + 1}.</span>
                                <span className="font-mono shrink-0">{m.chapter} · {m.number}</span>
                                <span className="text-emerald-400/80 truncate flex-1">{m.textbook}</span>
                                <button type="button" onClick={() => removeManualPick(id)} className="text-slate-500 hover:text-rose-300 shrink-0" aria-label="제거">×</button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

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
              <span className="text-[11px] text-slate-500">현재 줄 간격·카테고리 설정 그대로 적용됩니다.</span>
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

// 라우트 진입은 page.tsx 가 담당 — 이 파일은 view 컴포넌트만 export.
