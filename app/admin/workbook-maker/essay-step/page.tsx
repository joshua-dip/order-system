'use client';

/**
 * 서술형집중 워크북 — 한 지문 종합 8섹션 워크북. 프리미엄 판매용.
 *
 * 흐름:
 *   1. 지문 불러오기 (passage + 한국어)
 *   2. 메타 (학원명·발행처·원하는 영문 제목) 입력
 *   3. ✨ AI 생성 — Claude 가 8섹션 JSON 을 만든다 (ANTHROPIC_API_KEY 필요, 별 과금)
 *   4. JSON 편집기에서 다듬기 (선택)
 *   5. A4 미리보기 — 학생용 / 학생+정답 토글, 줌, designMode, 인쇄/Word
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PassagePickerModal, { PassageItem } from '../../_components/PassagePickerModal';
import { tokenizePassageFromContent } from '@/lib/block-workbook-tokenize';
import {
  buildEssayStepCombinedHtml,
  buildEssayStepStudentHtml,
  emptyEssayStepData,
  EssayStepWorkbookData,
} from '@/lib/essay-step-workbook';
import { ESSAY_STEP_SYSTEM_PROMPT } from '@/lib/essay-step-prompt';
import {
  validateEssayStepData,
  EssayStepValidationResult,
} from '@/lib/essay-step-validator';

export default function EssayStepWorkbookPage() {
  const [showPicker, setShowPicker] = useState(false);
  const [passage, setPassage] = useState<PassageItem | null>(null);
  const [academy, setAcademy] = useState('고미조슈아 영어 학원');
  const [publisher, setPublisher] = useState('Payperic');
  const [topicHint, setTopicHint] = useState('');
  const [data, setData] = useState<EssayStepWorkbookData | null>(null);
  const [jsonText, setJsonText] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [previewMode, setPreviewMode] = useState<'all' | 'student'>('all');
  /** 「✓ 지금 검증」 결과. null = 아직 안 누름. */
  const [validation, setValidation] = useState<EssayStepValidationResult | null>(null);
  /** DB 저장용 폴더 */
  const [folder, setFolder] = useState('기본');
  /** 저장/목록 상태 */
  const [saving, setSaving] = useState(false);
  const [showList, setShowList] = useState(false);
  const [listItems, setListItems] = useState<Array<{
    _id: string;
    title: string;
    textbook: string;
    sourceKey: string;
    folder: string;
    createdAt: string;
    updatedAt: string;
  }>>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState('');

  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
  const PREVIEW_BASE_W = 794;
  const PREVIEW_BASE_H = 1100;
  const [previewScale, setPreviewScale] = useState(0.6);
  /** 미리보기 풀스크린 오버레이 — 입력·메타 패널을 가리고 화면 가득 차게 표시. ESC 로 닫기. */
  const [previewMaximized, setPreviewMaximized] = useState(false);

  /** ESC 키로 최대화 해제 */
  useEffect(() => {
    if (!previewMaximized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewMaximized(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewMaximized]);

  /** 지문에서 영문/한국어 문장 배열 추출 (AI 호출용 input 구성) */
  const sentenceObjs = useMemo(() => {
    if (!passage?.content) return [];
    return tokenizePassageFromContent(passage.content);
  }, [passage]);

  const passageText = useMemo(
    () => sentenceObjs.map(s => s.text).join(' '),
    [sentenceObjs],
  );
  const koreanText = useMemo(
    () => sentenceObjs.map(s => s.korean ?? '').filter(Boolean).join(' '),
    [sentenceObjs],
  );
  const sourceKey = passage?.source_key ?? `${passage?.chapter ?? ''} ${passage?.number ?? ''}`.trim();

  /**
   * 지문/메타가 바뀌면 미리보기를 즉시 반영.
   * - 아직 데이터가 없으면 → emptyEssayStepData 로 본문만 채워 표지/Section 1 노출
   * - AI 생성으로 이미 데이터가 있으면 → meta·passage 만 갱신 (다른 섹션은 보존)
   */
  useEffect(() => {
    if (!passage || sentenceObjs.length === 0) return;
    setData(prev => {
      const base = prev ?? emptyEssayStepData();
      const nextTopic =
        topicHint.trim() ||
        (base.meta.topic && base.meta.topic !== '제목 미입력' ? base.meta.topic : passage.textbook);
      const koArr = sentenceObjs.map(s => (s.korean ?? '').trim());
      return {
        ...base,
        meta: {
          ...base.meta,
          topic: nextTopic,
          topic_ko: base.meta.topic_ko || sourceKey,
          academy,
          publisher,
        },
        passage: sentenceObjs.map(s => s.text),
        // DB sentences_ko 자동 fallback — 한 줄이라도 있으면 좌우 2단으로 노출
        passage_ko: koArr.some(Boolean) ? koArr : (base.passage_ko ?? []),
      };
    });
  }, [passage, sentenceObjs, topicHint, academy, publisher, sourceKey]);

  /** data 가 바뀌면 JSON 편집기에 동기화 — 단, 편집기가 펼쳐져 있으면 사용자 입력 보존을 위해 건너뜀. */
  useEffect(() => {
    if (data && !showJson) {
      setJsonText(JSON.stringify(data, null, 2));
    }
  }, [data, showJson]);

  const handlePickPassage = async (p: PassageItem) => {
    setPassage(p);
    setStatusMsg('');
    setShowPicker(false);
    try {
      const r = await fetch(`/api/admin/passages/${p._id}/korean`, { credentials: 'include' });
      const d = await r.json();
      if (!r.ok) return;
      const sentences_en = Array.isArray(d.sentences_en) ? (d.sentences_en as string[]) : [];
      const sentences_ko = Array.isArray(d.sentences_ko) ? (d.sentences_ko as string[]) : [];
      setPassage(prev =>
        prev
          ? {
              ...prev,
              content: {
                ...(prev.content ?? {}),
                sentences_en: sentences_en.length ? sentences_en : prev.content?.sentences_en,
                sentences_ko,
              },
            }
          : prev,
      );
    } catch {
      /* ignore */
    }
  };

  /** AI 생성 호출 */
  const handleGenerate = async () => {
    if (!passageText.trim()) {
      setStatusMsg('지문을 먼저 불러오세요.');
      return;
    }
    setGenerating(true);
    setStatusMsg('Claude 가 8섹션 워크북을 생성 중입니다… (30~60초)');
    try {
      const r = await fetch('/api/admin/workbook-maker/essay-step/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passage: passageText,
          korean: koreanText,
          academy,
          publisher,
          topic: topicHint.trim() || undefined,
        }),
      });
      const json = await r.json();
      if (!r.ok || !json.data) {
        throw new Error(json.error || '생성 실패');
      }
      setData(json.data);
      setJsonText(JSON.stringify(json.data, null, 2));
      setStatusMsg('✨ 생성 완료. JSON 편집으로 세부 다듬기 가능.');
      window.setTimeout(() => setStatusMsg(''), 4000);
    } catch (e) {
      setStatusMsg(`오류: ${(e as Error).message ?? '알 수 없음'}`);
    } finally {
      setGenerating(false);
    }
  };

  /** JSON 편집 → data 동기화 */
  const handleJsonApply = () => {
    try {
      const parsed = JSON.parse(jsonText) as EssayStepWorkbookData;
      setData(parsed);
      setValidation(null);
      setStatusMsg('JSON 적용 완료');
      window.setTimeout(() => setStatusMsg(''), 2500);
    } catch (e) {
      setStatusMsg(`JSON 파싱 오류: ${(e as Error).message ?? ''}`);
    }
  };

  /** 「✓ 지금 검증」 — 현재 data 를 lib/essay-step-validator 로 검사. */
  const handleValidate = () => {
    if (!data) {
      setValidation(null);
      return;
    }
    setValidation(validateEssayStepData(data));
  };

  /** AI 자동 수정 진행 상태 */
  const [fixing, setFixing] = useState(false);

  /** 「🔧 AI 자동 수정」 — 검증 errors/warnings 를 Claude 가 핀셋 수정. */
  const handleAutoFix = async () => {
    if (!data) return;
    const v = validation ?? validateEssayStepData(data);
    if (v.errors.length === 0 && v.warnings.length === 0) {
      setStatusMsg('수정할 항목이 없습니다.');
      return;
    }
    setFixing(true);
    setStatusMsg('🔧 Claude 가 보고된 오류만 핀셋 수정 중… (15~40초)');
    try {
      const r = await fetch('/api/admin/workbook-maker/essay-step/fix', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, errors: v.errors, warnings: v.warnings }),
      });
      const j = await r.json();
      if (!r.ok || !j.data) throw new Error(j.error || '수정 실패');
      setData(j.data);
      setJsonText(JSON.stringify(j.data, null, 2));
      if (j.validation) setValidation(j.validation);
      const before = j.before ?? { errorCount: v.errors.length, warningCount: v.warnings.length };
      const after = j.after ?? { errorCount: 0, warningCount: 0 };
      setStatusMsg(
        `✅ 자동 수정 완료 — errors ${before.errorCount}→${after.errorCount}, warnings ${before.warningCount}→${after.warningCount}`,
      );
      window.setTimeout(() => setStatusMsg(''), 5000);
    } catch (e) {
      setStatusMsg(`오류: ${(e as Error).message ?? '알 수 없음'}`);
    } finally {
      setFixing(false);
    }
  };

  /** 「💾 저장」 — DB 저장 (essay_step_workbooks). 검증 실패 시 force 확인. */
  const handleSave = async () => {
    if (!data) {
      setStatusMsg('저장할 데이터가 없습니다.');
      return;
    }
    if (!passage) {
      setStatusMsg('지문을 먼저 불러오세요.');
      return;
    }
    setSaving(true);
    setStatusMsg('저장 중…');
    try {
      const r = await fetch('/api/admin/workbook-maker/essay-step/save', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passageId: passage._id,
          textbook: passage.textbook,
          sourceKey,
          folder: folder.trim() || '기본',
          data,
        }),
      });
      const j = await r.json();
      if (r.status === 422 && j.validation) {
        setValidation(j.validation as EssayStepValidationResult);
        const ok = window.confirm(
          `검증 실패 (${j.validation.errors?.length ?? 0}건). 그래도 저장할까요?\n\n` +
            (j.validation.errors ?? []).slice(0, 3).join('\n'),
        );
        if (!ok) {
          setStatusMsg('저장 취소');
          return;
        }
        // force 재시도
        const r2 = await fetch('/api/admin/workbook-maker/essay-step/save', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            passageId: passage._id,
            textbook: passage.textbook,
            sourceKey,
            folder: folder.trim() || '기본',
            data,
            force: true,
          }),
        });
        const j2 = await r2.json();
        if (!r2.ok || !j2.id) throw new Error(j2.error || '저장 실패');
        setStatusMsg(`✅ 강제 저장 완료 (id: ${j2.id})`);
      } else if (!r.ok || !j.id) {
        throw new Error(j.error || '저장 실패');
      } else {
        setStatusMsg(`✅ 저장 완료 (id: ${j.id})`);
        if (j.validation) setValidation(j.validation as EssayStepValidationResult);
      }
      window.setTimeout(() => setStatusMsg(''), 4000);
    } catch (e) {
      setStatusMsg(`오류: ${(e as Error).message ?? '알 수 없음'}`);
    } finally {
      setSaving(false);
    }
  };

  /** 목록 fetch */
  const fetchList = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const r = await fetch('/api/admin/workbook-maker/essay-step/list', { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j.items) throw new Error(j.error || '목록 조회 실패');
      setListItems(j.items);
    } catch (e) {
      setListError((e as Error).message ?? '오류');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { if (showList) void fetchList(); }, [showList, fetchList]);

  /** 목록에서 한 항목 로드 → data + 메타 채움 */
  const handleLoadItem = async (id: string) => {
    try {
      const r = await fetch(`/api/admin/workbook-maker/essay-step/${id}`, { credentials: 'include' });
      const j = await r.json();
      if (!r.ok || !j.item) throw new Error(j.error || '로드 실패');
      const item = j.item as {
        _id: string;
        textbook: string;
        sourceKey: string;
        passageId?: string;
        folder: string;
        data: EssayStepWorkbookData;
        title: string;
      };
      setData(item.data);
      setJsonText(JSON.stringify(item.data, null, 2));
      setFolder(item.folder ?? '기본');
      // passage 까지 복원하면 좋지만 _id 만 가지고 PassageItem 전체를 만들기 어려우니 가벼운 형태로
      setPassage({
        _id: item.passageId ?? '',
        textbook: item.textbook,
        chapter: '',
        number: '',
        source_key: item.sourceKey,
        content: { sentences_en: item.data.passage },
      });
      setShowList(false);
      setStatusMsg(`불러옴: ${item.title}`);
      window.setTimeout(() => setStatusMsg(''), 2500);
    } catch (e) {
      setListError((e as Error).message ?? '오류');
    }
  };

  /** 목록에서 한 항목 삭제 */
  const handleDeleteItem = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return;
    try {
      const r = await fetch(`/api/admin/workbook-maker/essay-step/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || '삭제 실패');
      void fetchList();
    } catch (e) {
      setListError((e as Error).message ?? '오류');
    }
  };

  /** 빈 데이터로 시작 */
  const handleSampleEmpty = () => {
    const empty = emptyEssayStepData();
    empty.meta.academy = academy;
    empty.meta.publisher = publisher;
    if (passage) {
      empty.meta.topic = topicHint || passage.textbook;
      empty.meta.topic_ko = sourceKey;
      empty.passage = sentenceObjs.map(s => s.text);
    }
    setData(empty);
    setJsonText(JSON.stringify(empty, null, 2));
    setStatusMsg('빈 템플릿 로드. JSON 편집으로 채워 보세요.');
  };

  const previewHtml = useMemo(() => {
    if (!data) return '';
    return previewMode === 'all'
      ? buildEssayStepCombinedHtml({ data })
      : buildEssayStepStudentHtml({ data });
  }, [data, previewMode]);

  const enableEditing = useCallback(() => {
    const doc = previewIframeRef.current?.contentDocument;
    if (!doc) return;
    try { doc.designMode = 'on'; } catch { /* ignore */ }
  }, []);

  const downloadAsDoc = () => {
    if (!previewHtml) return;
    const blob = new Blob([previewHtml], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data?.meta.topic || 'essay-step'}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /** 미리보기 iframe 본문을 html2canvas 로 캡처해 jsPDF 로 다운로드.
   *  - 인쇄 다이얼로그·팝업·OS 인쇄 흐름 안 거침 → 임베드 환경(Claude Preview)에서도 동작.
   *  - designMode 편집 결과는 iframe DOM 에 살아 있어 그대로 캡처.
   *  - **좌우/상하 10mm 여백** + **스마트 페이지 분할**:
   *    iframe 안의 "page-break-inside: avoid" 후보 element 들의 bottom 좌표를 미리 모아두고,
   *    슬라이스 경계가 원소 중간을 자르려 하면 원소 시작 직전(=직전 원소의 bottom)으로
   *    슬라이스 위치를 끌어올린다. 행·문항·표 cell 이 페이지 사이에 잘리지 않도록.
   *  - **JPEG 0.92 압축**: PNG 슬라이스는 워크북 한 권 110MB+ 크기. JPEG 으로 ~10배 축소.
   *  - **폰트 안전 대기**: 캡처 전 iframe 의 document.fonts.ready 를 await. */
  const downloadAsPdf = async () => {
    const iframeDoc = previewIframeRef.current?.contentDocument;
    const target = iframeDoc?.body;
    if (!iframeDoc || !target) {
      alert('미리보기를 먼저 로드하세요.');
      return;
    }
    setStatusMsg('PDF 생성 중…');
    try {
      // 1) fonts 로딩 완료 대기
      try {
        const fonts = (iframeDoc as Document).fonts;
        if (fonts && typeof fonts.ready === 'object') {
          await fonts.ready;
        }
      } catch { /* 미지원 브라우저 무시 */ }

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      // 2) 페이지 분할 후보 — body 기준 좌표(px) 수집.
      //    원칙:
      //    - **강제 break (page-break-after: always 가 박힌 .cover)**: bottom 을 강제 후보로
      //    - **콘텐츠 블록**: bottom 을 후보로 (그 블록까지 한 페이지)
      //    - **헤더** (h1~h3, .sub-header, .section-header): TOP 을 후보로
      //      (단, .cover 의 자식 헤더는 제외 — cover 안에서 잘리지 않도록)
      const bodyRect = target.getBoundingClientRect();
      const contentSelectors = [
        '.vocab-row', '.q', '.grammar-row', '.q-en',
        'tr', '.sub-section', '.section', '.answer-section',
        '.grammar-box-passage', '.choice-box', '.cond-box', '.dashed-box',
      ];
      const headerSelectors = [
        'h1', 'h2', 'h3',
        '.sub-header', '.section-header',
      ];
      const breakPoints: number[] = [];

      // 강제: .cover 의 bottom — 표지 끝 = 새 페이지 시작
      const coverEl = iframeDoc.querySelector('.cover') as HTMLElement | null;
      if (coverEl) {
        const r = coverEl.getBoundingClientRect();
        const bottom = r.bottom - bodyRect.top;
        breakPoints.push(bottom);
      }

      for (const el of Array.from(iframeDoc.querySelectorAll(contentSelectors.join(','))) as HTMLElement[]) {
        // .cover 안에 있으면 break 후보에서 제외 — 표지 내부에서 자르지 않음
        if (coverEl && coverEl.contains(el)) continue;
        const r = el.getBoundingClientRect();
        const bottom = r.bottom - bodyRect.top;
        const top = r.top - bodyRect.top;
        if (bottom > top + 1) breakPoints.push(bottom);
      }
      for (const el of Array.from(iframeDoc.querySelectorAll(headerSelectors.join(','))) as HTMLElement[]) {
        if (coverEl && coverEl.contains(el)) continue;  // 표지 내부 헤더는 제외
        const r = el.getBoundingClientRect();
        const top = r.top - bodyRect.top;
        if (top > 4) breakPoints.push(top);
      }
      // 중복 제거 + 오름차순
      breakPoints.sort((a, b) => a - b);
      const dedupedBreaks: number[] = [];
      for (const p of breakPoints) {
        if (dedupedBreaks.length === 0 || p - dedupedBreaks[dedupedBreaks.length - 1] > 1) {
          dedupedBreaks.push(p);
        }
      }

      // 3) 본문 전체 캡처
      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        windowWidth: PREVIEW_BASE_W,
      });

      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();   // 210mm
      const pageH = pdf.internal.pageSize.getHeight();  // 297mm
      const margin = 10;
      const imgWmm = pageW - margin * 2;        // 190mm
      const pageHmm = pageH - margin * 2;       // 277mm

      // canvas.width 는 css width × scale. iframe 의 body width 와 canvas.width 비율로
      // body-좌표계(css px) 를 canvas-좌표계(scaled px) 로 변환.
      const cssW = bodyRect.width || PREVIEW_BASE_W;
      const cssToCanvas = canvas.width / cssW;
      const sliceHpxIdeal = Math.floor((pageHmm / imgWmm) * canvas.width);
      const minSliceHpx = Math.floor(sliceHpxIdeal * 0.55);

      // 4) 스마트 슬라이스: 슬라이스 끝 위치를 자연 경계점에 맞춤
      const sliceCanvas = document.createElement('canvas');
      const sctx = sliceCanvas.getContext('2d');
      if (!sctx) throw new Error('Canvas 2D 컨텍스트를 가져올 수 없습니다.');

      let yPx = 0;
      let firstPage = true;
      while (yPx < canvas.height) {
        const remain = canvas.height - yPx;
        let thisSliceHpx: number;
        if (remain <= sliceHpxIdeal) {
          // 마지막 슬라이스: 남은 전부
          thisSliceHpx = remain;
        } else {
          const idealEndPx = yPx + sliceHpxIdeal;
          // idealEndPx 부근의 자연 break point 후보 중, [yPx + minSliceHpx, idealEndPx]
          // 범위 안에 들어오는 가장 큰 값
          let bestEnd = -1;
          for (const cssY of dedupedBreaks) {
            const canvasY = cssY * cssToCanvas;
            if (canvasY <= yPx) continue;
            if (canvasY > idealEndPx) break;
            if (canvasY >= yPx + minSliceHpx) {
              if (canvasY > bestEnd) bestEnd = canvasY;
            }
          }
          if (bestEnd > 0) {
            thisSliceHpx = Math.floor(bestEnd) - yPx;
          } else {
            // 자연 경계점이 없으면 ideal 그대로 (강제 잘림)
            thisSliceHpx = sliceHpxIdeal;
          }
        }

        sliceCanvas.width = canvas.width;
        sliceCanvas.height = thisSliceHpx;
        sctx.fillStyle = '#ffffff';
        sctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        sctx.drawImage(
          canvas,
          0, yPx, canvas.width, thisSliceHpx,
          0, 0, canvas.width, thisSliceHpx,
        );
        // PNG 대신 JPEG — 파일 크기 ~10배 ↓, 시각 품질 거의 차이 없음
        const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.92);
        const sliceHmm = thisSliceHpx / canvas.width * imgWmm;
        if (!firstPage) pdf.addPage();
        pdf.addImage(sliceData, 'JPEG', margin, margin, imgWmm, sliceHmm);
        firstPage = false;
        yPx += thisSliceHpx;
      }

      const filename = (data?.meta.topic || 'essay-step').replace(/[\/\\?%*:|"<>]/g, '_');
      pdf.save(`${filename}.pdf`);
      setStatusMsg('PDF 다운로드 완료.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'PDF 생성 실패';
      alert(msg);
      setStatusMsg('');
    }
  };

  const ready = !!data;

  return (
    <>
      {showPicker && (
        <PassagePickerModal
          onSelect={handlePickPassage}
          onClose={() => setShowPicker(false)}
          lastTextbookKey="essay_step_workbook_last_textbook"
        />
      )}

      <main className="flex-1 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">서술형집중 워크북 <span className="text-xs text-amber-300 ml-2">★ Premium</span></h1>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowList(true)}
              className="text-sm px-3 py-1.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/60"
            >
              📂 목록
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !data || !passage}
              className="text-sm px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
              title={!passage ? '지문을 먼저 불러오세요' : !data ? '데이터가 없습니다' : 'DB(essay_step_workbooks) 에 저장'}
            >
              {saving ? '저장 중…' : '💾 저장'}
            </button>
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="text-sm px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-500"
            >
              지문 불러오기
            </button>
          </div>
        </div>

        <details className="mb-4 bg-slate-800/60 border border-slate-700 rounded-xl text-sm" open>
          <summary className="cursor-pointer select-none px-4 py-2.5 font-bold text-slate-200 hover:bg-slate-700/40 rounded-xl">
            ❓ 사용 안내
          </summary>
          <div className="px-4 pb-4 pt-1 space-y-2 text-[13px] text-slate-300 leading-relaxed">
            <p>한 지문으로 <b>8 섹션 종합 서술형 워크북</b>(표지 + 본문 + 어휘 + 어법 + 영작 + 빈칸 + 해석/구문 + 주제/요약/제목 + 종합) 을 자동 생성합니다.</p>
            <ol className="list-decimal pl-5 space-y-0.5">
              <li>「지문 불러오기」 → 미리보기 우측에 표지 + Section 1(본문)이 <b>즉시 노출</b> (다른 섹션은 빈 상태)</li>
              <li>학원명/발행처/(선택) 영문 제목 입력 — 표지에 자동 반영</li>
              <li>「✨ AI로 생성」 → Claude opus-4-7 가 나머지 7개 섹션 JSON 작성 (30~60초)</li>
              <li>(선택) 「JSON 편집」 으로 세부 다듬기 → 「적용」 / 「✓ 지금 검증」 으로 오류 확인</li>
              <li>(선택) 검증에 errors/warnings 가 있으면 「🔧 AI 자동 수정」 — Claude 가 보고된 항목만 핀셋 수정 (별 과금)</li>
              <li>「학생용 / 학생+정답」 토글, 줌, 미리보기에서 직접 편집(designMode), 「🖨 인쇄/PDF」 또는 「📝 Word」, 「💾 저장」/「📂 목록」</li>
            </ol>
            <p className="text-amber-300/80 text-[12px]">⚠ AI 생성은 Anthropic API 호출이라 <b>Pro 구독과 별도 과금</b>됩니다. 한 번 생성에 약 8000~15000 토큰. 「JSON 편집」 만으로도 사용 가능 (수동 작성).</p>
          </div>
        </details>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 좌: 입력 + AI 생성 */}
          <section className="space-y-3">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">지문</label>
                <div className="text-xs text-slate-300 truncate">
                  {passage ? `${passage.textbook} · ${sourceKey}` : '— 지문 미선택 —'}
                </div>
                {passage && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    문장 {sentenceObjs.length}개 · 한국어 {sentenceObjs.filter(s => (s.korean ?? '').trim()).length}개
                  </p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">학원명</label>
                  <input
                    value={academy}
                    onChange={e => setAcademy(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">발행처</label>
                  <input
                    value={publisher}
                    onChange={e => setPublisher(e.target.value)}
                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">원하는 영문 제목 (선택)</label>
                  <input
                    value={topicHint}
                    onChange={e => setTopicHint(e.target.value)}
                    placeholder="예: Streamlining Your Kid's Play Space"
                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">저장 폴더</label>
                  <input
                    value={folder}
                    onChange={e => setFolder(e.target.value)}
                    placeholder="기본"
                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={generating || !passage}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-rose-500 text-white text-sm font-bold hover:from-amber-400 hover:to-rose-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                  title="Claude opus-4-7 호출 — Anthropic API 별 과금"
                >
                  {generating ? '⏳ 생성 중…' : '✨ AI로 8섹션 워크북 생성'}
                </button>
                <button
                  type="button"
                  onClick={handleSampleEmpty}
                  disabled={generating}
                  className="px-3 py-2.5 rounded-lg border border-slate-600 text-xs text-slate-300 hover:bg-slate-700/60 disabled:opacity-50"
                  title="AI 생성 결과를 비우고 빈 8섹션으로 되돌림 (지문/메타는 유지)"
                >
                  초기화
                </button>
              </div>
              {statusMsg && (
                <div className={`text-[11px] ${statusMsg.includes('오류') ? 'text-rose-300' : 'text-emerald-300'}`}>
                  {statusMsg}
                </div>
              )}
            </div>

            {/* JSON 편집기 */}
            {data && (
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold">JSON 편집</h2>
                  <button
                    type="button"
                    onClick={() => setShowJson(v => !v)}
                    className="text-[11px] px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/60"
                  >
                    {showJson ? '접기 ▴' : '펼치기 ▾'}
                  </button>
                </div>
                {showJson && (
                  <>
                    <textarea
                      value={jsonText}
                      onChange={e => setJsonText(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-[11px] font-mono text-slate-200 leading-relaxed min-h-[300px] resize-y"
                      spellCheck={false}
                    />
                    <div className="flex gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={handleJsonApply}
                        className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-500 font-semibold"
                      >
                        JSON 적용 → 미리보기 갱신
                      </button>
                      <button
                        type="button"
                        onClick={handleValidate}
                        className="px-3 py-1.5 text-xs rounded-lg bg-amber-600 text-white hover:bg-amber-500 font-semibold"
                        title="현재 data 를 검증 (errors / warnings)"
                      >
                        ✓ 지금 검증
                      </button>
                      <span className="text-[10px] text-slate-500 self-center">스키마: <code>lib/essay-step-workbook.ts</code></span>
                    </div>
                    {validation && (
                      <div className="mt-2 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[11px] px-2 py-0.5 rounded-full font-bold ${
                            validation.valid
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          }`}>
                            {validation.valid ? '✓ 통과' : `✗ 오류 ${validation.errors.length}건`}
                          </span>
                          {validation.warnings.length > 0 && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                              ⚠ 경고 {validation.warnings.length}건
                            </span>
                          )}
                          {(validation.errors.length > 0 || validation.warnings.length > 0) && (
                            <button
                              type="button"
                              onClick={handleAutoFix}
                              disabled={fixing}
                              className="ml-auto text-[11px] px-2.5 py-1 rounded-md bg-gradient-to-r from-rose-500 to-amber-500 text-white font-bold hover:opacity-90 disabled:opacity-50"
                              title="Claude 가 위 오류·경고만 핀셋 수정 (Anthropic API 별 과금)"
                            >
                              {fixing ? '🔧 수정 중…' : '🔧 AI 자동 수정'}
                            </button>
                          )}
                        </div>
                        {validation.errors.length > 0 && (
                          <div className="text-[11px] bg-rose-950/40 border border-rose-800/60 rounded-md p-2.5 space-y-1">
                            <div className="font-bold text-rose-300">Errors</div>
                            <ul className="list-disc pl-5 space-y-0.5 text-rose-200/90">
                              {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
                            </ul>
                          </div>
                        )}
                        {validation.warnings.length > 0 && (
                          <div className="text-[11px] bg-amber-950/40 border border-amber-800/60 rounded-md p-2.5 space-y-1">
                            <div className="font-bold text-amber-300">Warnings</div>
                            <ul className="list-disc pl-5 space-y-0.5 text-amber-200/90">
                              {validation.warnings.map((w, i) => <li key={i}>{w}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* AI 시스템 프롬프트 뷰어 — 운영자가 어떤 규칙으로 생성되는지 확인·복사용 */}
            <details className="bg-slate-800 border border-slate-700 rounded-xl p-0 group">
              <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between text-sm font-bold text-slate-200 hover:bg-slate-700/40 rounded-xl">
                <span>📜 사용 중인 AI 프롬프트 ({ESSAY_STEP_SYSTEM_PROMPT.length.toLocaleString()}자)</span>
                <span className="text-[11px] text-slate-500 group-open:rotate-180 transition-transform">▾</span>
              </summary>
              <div className="px-4 pb-4 pt-1 space-y-2">
                <p className="text-[11px] text-slate-400">
                  AI 생성에 사용되는 시스템 프롬프트입니다. Pro 채팅에서 직접 출제할 때 그대로 붙여넣어 사용 가능. 수정하려면 <code>lib/essay-step-prompt.ts</code> 편집.
                </p>
                <textarea
                  value={ESSAY_STEP_SYSTEM_PROMPT}
                  readOnly
                  className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-[11px] font-mono text-slate-300 leading-relaxed min-h-[260px] resize-y"
                  spellCheck={false}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(ESSAY_STEP_SYSTEM_PROMPT);
                        setStatusMsg('✅ 프롬프트를 클립보드에 복사했습니다.');
                        window.setTimeout(() => setStatusMsg(''), 2500);
                      } catch {
                        setStatusMsg('클립보드 복사 실패 — 텍스트 영역에서 직접 선택·복사하세요.');
                      }
                    }}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/60 font-medium"
                  >
                    📋 클립보드로 복사
                  </button>
                  <span className="text-[10px] text-slate-500 self-center">웹 AI 와 CLI(<code>cc-essay-step-prompt.md</code>) 가 같은 규칙 동기화</span>
                </div>
              </div>
            </details>
          </section>

          {/* 우: 미리보기 — previewMaximized 시 화면 전체를 덮는 오버레이로 전환 */}
          <section
            className={
              previewMaximized
                ? 'fixed inset-0 z-[60] bg-slate-800 border-0 rounded-none flex flex-col overflow-hidden'
                : 'bg-slate-800 border border-slate-700 rounded-xl flex flex-col overflow-hidden lg:sticky lg:top-20 lg:self-start lg:max-h-[calc(100vh-6rem)]'
            }
          >
            <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-700 flex-wrap">
              <div className="flex items-center gap-3">
                <span className="font-bold text-white">미리보기</span>
                {ready && (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-medium">
                    {previewMode === 'all' ? '학생+정답' : '학생용'}
                  </span>
                )}
                {ready && (
                  <div className="flex items-center gap-1 ml-1 border-l border-slate-600 pl-3">
                    <button
                      type="button"
                      onClick={() => setPreviewScale(s => Math.max(0.4, Math.round((s - 0.1) * 10) / 10))}
                      className="w-7 h-7 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white text-sm font-bold leading-none"
                    >−</button>
                    <span className="text-xs text-slate-400 tabular-nums w-11 text-center">{Math.round(previewScale * 100)}%</span>
                    <button
                      type="button"
                      onClick={() => setPreviewScale(s => Math.min(1.6, Math.round((s + 0.1) * 10) / 10))}
                      className="w-7 h-7 rounded-md border border-slate-600 text-slate-300 hover:bg-slate-700 hover:text-white text-sm font-bold leading-none"
                    >+</button>
                    <button
                      type="button"
                      onClick={() => setPreviewScale(0.6)}
                      className="px-2 py-1 rounded-md text-[10px] font-medium border border-slate-600 text-slate-400 hover:text-white hover:bg-slate-700"
                    >초기화</button>
                  </div>
                )}
              </div>
              {ready && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewMode(previewMode === 'all' ? 'student' : 'all')}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/60 transition-colors font-medium"
                  >
                    {previewMode === 'all' ? '👨‍🎓 학생용만' : '🧑‍🏫 학생+정답'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMaximized(v => !v)}
                    title={previewMaximized ? '최대화 해제 (Esc)' : '미리보기 최대화'}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/60 transition-colors font-medium"
                  >
                    {previewMaximized ? '🗗 축소' : '⛶ 최대화'}
                  </button>
                  <button
                    type="button"
                    onClick={downloadAsDoc}
                    className="px-3 py-1.5 text-xs rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700/60 transition-colors font-medium"
                  >
                    📝 Word
                  </button>
                  <button
                    type="button"
                    onClick={downloadAsPdf}
                    className="px-4 py-1.5 text-xs rounded-lg bg-white text-slate-900 hover:bg-slate-200 transition-colors font-bold"
                    title="미리보기를 그대로 캡처해 PDF 로 저장 (designMode 편집 결과 반영)"
                  >
                    📥 PDF 다운로드
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-auto bg-slate-900/60 p-6">
              {ready ? (
                <div className="flex flex-col items-center gap-2 w-full">
                  <div
                    className="bg-white shadow-2xl rounded overflow-hidden mx-auto"
                    style={{
                      width: PREVIEW_BASE_W * previewScale,
                      height: PREVIEW_BASE_H * previewScale,
                    }}
                  >
                    <iframe
                      ref={previewIframeRef}
                      srcDoc={previewHtml}
                      title="서술형집중 워크북 미리보기"
                      className="border-0 block"
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
                  <p className="text-[10px] text-slate-500">미리보기 위에서 직접 편집 가능 (designMode). 인쇄·Word 에 반영.</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-500 py-16">
                  <p className="text-base font-medium text-slate-400">지문을 불러오면 미리보기가 시작됩니다</p>
                  <p className="text-sm mt-1">우측 상단 「지문 불러오기」 클릭</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {showList && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowList(false)}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-2xl w-[860px] max-w-[95vw] max-h-[80vh] flex flex-col shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 shrink-0">
              <span className="font-bold text-white">📂 저장된 서술형집중 워크북</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fetchList()}
                  disabled={listLoading}
                  className="text-[11px] px-2 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-700/60 disabled:opacity-50"
                >
                  {listLoading ? '⏳' : '↻ 새로고침'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowList(false)}
                  className="text-slate-400 hover:text-white text-xl leading-none"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {listLoading && <div className="p-8 text-sm text-slate-500 text-center">불러오는 중…</div>}
              {listError && (
                <div className="m-4 p-3 text-sm text-red-300 bg-red-950/40 border border-red-800/60 rounded">
                  {listError}
                </div>
              )}
              {!listLoading && !listError && listItems.length === 0 && (
                <div className="p-8 text-sm text-slate-500 text-center">
                  저장된 워크북이 없습니다. 좌측 상단 「💾 저장」 으로 첫 워크북을 만들어 보세요.
                </div>
              )}
              {!listLoading && listItems.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-left text-xs border-b border-slate-700 sticky top-0 bg-slate-800">
                      <th className="px-4 py-2 font-medium">제목</th>
                      <th className="px-2 py-2 font-medium">교재 · 출처</th>
                      <th className="px-2 py-2 font-medium">폴더</th>
                      <th className="px-2 py-2 font-medium">생성일</th>
                      <th className="px-3 py-2 font-medium text-right">액션</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listItems.map(it => (
                      <tr key={it._id} className="border-b border-slate-700/60 hover:bg-slate-700/30">
                        <td className="px-4 py-2.5 font-medium text-white truncate max-w-[200px]" title={it.title}>
                          {it.title}
                        </td>
                        <td className="px-2 py-2.5 text-xs text-slate-300 truncate max-w-[200px]" title={`${it.textbook} · ${it.sourceKey}`}>
                          <div>{it.textbook}</div>
                          <div className="text-slate-500">{it.sourceKey}</div>
                        </td>
                        <td className="px-2 py-2.5 text-xs text-slate-300">{it.folder}</td>
                        <td className="px-2 py-2.5 text-xs text-slate-400 tabular-nums">
                          {it.createdAt ? new Date(it.createdAt).toLocaleDateString('ko-KR') : ''}
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => void handleLoadItem(it._id)}
                            className="text-[11px] px-2 py-1 rounded border border-slate-600 text-slate-200 hover:bg-slate-700/60 mr-1"
                          >
                            불러오기
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteItem(it._id)}
                            className="text-[11px] px-2 py-1 rounded border border-red-700 text-red-300 hover:bg-red-900/30"
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-700 text-[11px] text-slate-500 shrink-0">
              총 {listItems.length}건 · 콜렉션: <code>essay_step_workbooks</code>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
