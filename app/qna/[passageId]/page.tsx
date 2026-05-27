'use client';

/**
 * /qna/[passageId] — Q&A 분석 페이지 (주력 답변 화면).
 *
 * 핵심 기능
 *  - 영문/한글 문장 카드 (한글 가리기 토글, localStorage 보존)
 *  - 단어 클릭 → 미니 팝오버: 이 단어로 질문 / 복사
 *  - 문장 액션 아이콘: 영문 복사 / 한글 복사 / 문장 링크 / 질문 작성
 *  - SVOC 파스텔 오버레이 (분석 데이터 있을 때만)
 *  - thread 펼치기, 본인 글(localStorage owner token) 삭제 가능, admin 답변 폼
 *  - 3-레벨 링크 복사 (페이지/문장/thread) + #sentence-<n> · #thread-<id> 자동 스크롤·하이라이트
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppBar from '../../components/AppBar';
import {
  SVOC_COMPONENTS,
  SVOC_FIELDS,
  SVOC_WORD_BG,
  type SvocSentenceData,
} from '@/lib/passage-analyzer-types';
import { tokenizeSentence } from '../_lib/tokenize';
import { copyShareUrl, copyText } from '../_lib/share-url';
import { getOwnerToken, getOwnerTokenSet, removeOwnerToken, setOwnerToken } from '../_lib/owner-tokens';

type Me = { loginId: string; role: string; name?: string } | null;

interface ThreadAnswer {
  body: string;
  author: { name: string; role: 'admin'; userId: string };
  createdAt: string;
  updatedAt?: string;
}

interface Thread {
  id: string;
  passageId: string;
  textbook: string;
  sentenceIndex: number;
  asker: { nickname: string; role: 'guest' | 'admin'; userId?: string };
  question: string;
  selectedText?: string;
  status: 'open' | 'answered' | 'hidden';
  answers: ThreadAnswer[];
  createdAt: string;
  updatedAt: string;
  ownerToken?: string;
}

interface PassageData {
  id: string;
  textbook: string;
  sourceKey: string | null;
  sentences: string[];
  koreanSentences: string[];
}

interface FetchResponse {
  passage: PassageData;
  threads: Thread[];
  svoc?: Record<number, SvocSentenceData>;
  error?: string;
}

const HIDE_KO_LS_KEY = 'qna.hideKo';
const SVOC_LS_KEY = 'qna.showSvoc';
const LAYOUT_LS_KEY = 'qna.layout';
const FULL_PASSAGE_SENTENCE_INDEX = -1;

/** 가벼운 토스트 (페이지 우하단 자동 사라짐) */
function useToast(): {
  toast: { id: number; text: string } | null;
  showToast: (text: string) => void;
} {
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const counterRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string) => {
    counterRef.current += 1;
    const id = counterRef.current;
    setToast({ id, text });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setToast((cur) => (cur?.id === id ? null : cur));
    }, 2200);
  }, []);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
  return { toast, showToast };
}

export default function QnaPassagePage() {
  const router = useRouter();
  const params = useParams<{ passageId: string }>();
  const passageId = params?.passageId;

  const [data, setData] = useState<PassageData | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [svoc, setSvoc] = useState<Record<number, SvocSentenceData> | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [me, setMe] = useState<Me>(null);
  const isAdmin = me?.role === 'admin';

  const [hideKo, setHideKo] = useState(false);
  const [showSvoc, setShowSvoc] = useState(false);
  /** 'stack' = EN 위·KO 아래, 'side' = EN 왼쪽·KO 오른쪽 (md+ 에서만 실제 좌우, 좁은 화면은 자동 stack) */
  const [layout, setLayout] = useState<'stack' | 'side'>('stack');

  const [ownerSet, setOwnerSet] = useState<Set<string>>(new Set());
  const [expandedSentence, setExpandedSentence] = useState<number | null>(null);
  // 폼 상태: 문장 인덱스 → 단어 칩 (선택된 단어 미리보기)
  const [formSelectedText, setFormSelectedText] = useState<Record<number, string>>({});
  // 단어 클릭 팝오버: { si, wi, x, y } (페이지 좌표)
  const [wordPop, setWordPop] = useState<{ si: number; raw: string } | null>(null);
  /** 드래그·long-press 로 선택된 구. floating 「이 부분으로 질문」 버튼 위치·내용. */
  const [phraseSel, setPhraseSel] = useState<
    { si: number; text: string; top: number; left: number } | null
  >(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  /** PDF 캡처 대상. main 의 inner container (헤더 + 문장 카드들). */
  const printableRef = useRef<HTMLDivElement | null>(null);
  /** PDF 생성 후 미리보기 모달 상태. url = blob URL, filename = 저장 시 파일명. */
  const [pdfPreview, setPdfPreview] = useState<{ url: string; filename: string } | null>(null);

  const { toast, showToast } = useToast();

  // localStorage 토글 초기화
  useEffect(() => {
    try {
      setHideKo(window.localStorage.getItem(HIDE_KO_LS_KEY) === '1');
      setShowSvoc(window.localStorage.getItem(SVOC_LS_KEY) === '1');
      const savedLayout = window.localStorage.getItem(LAYOUT_LS_KEY);
      if (savedLayout === 'side' || savedLayout === 'stack') setLayout(savedLayout);
    } catch {
      /* ignore */
    }
    setOwnerSet(getOwnerTokenSet());
  }, []);

  // 컴포넌트 unmount 시 blob URL 정리 (메모리 leak 방지)
  useEffect(() => {
    return () => {
      setPdfPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return null;
      });
    };
  }, []);

  const persistHideKo = useCallback((next: boolean) => {
    setHideKo(next);
    try {
      window.localStorage.setItem(HIDE_KO_LS_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);
  const persistShowSvoc = useCallback((next: boolean) => {
    setShowSvoc(next);
    try {
      window.localStorage.setItem(SVOC_LS_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);
  const persistLayout = useCallback((next: 'stack' | 'side') => {
    setLayout(next);
    try {
      window.localStorage.setItem(LAYOUT_LS_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  // 로그인 정보
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => (j?.user ? setMe(j.user as Me) : setMe(null)))
      .catch(() => setMe(null));
  }, []);

  // 지문 + threads + svoc 로드
  const reload = useCallback(async () => {
    if (!passageId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/qna/passages/${passageId}`, { cache: 'no-store' });
      const json = (await res.json()) as FetchResponse;
      if (!res.ok || json.error) throw new Error(json.error || 'load failed');
      setData(json.passage);
      setThreads(Array.isArray(json.threads) ? json.threads : []);
      setSvoc(json.svoc);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [passageId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // URL hash 처리: #sentence-<n(1-based)> · #thread-<id>
  useEffect(() => {
    if (loading || !data) return;
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    if (!hash) return;
    let targetEl: HTMLElement | null = null;
    const sentenceMatch = hash.match(/^#sentence-(\d+)$/);
    const threadMatch = hash.match(/^#thread-([a-f0-9]{24})$/i);
    if (sentenceMatch) {
      const oneBased = parseInt(sentenceMatch[1], 10);
      if (Number.isInteger(oneBased) && oneBased >= 1) {
        const zeroBased = oneBased - 1;
        targetEl = document.getElementById(`sentence-${oneBased}`);
        setExpandedSentence(zeroBased);
      }
    } else if (threadMatch) {
      const id = threadMatch[1];
      const th = threads.find((t) => t.id === id);
      if (th) setExpandedSentence(th.sentenceIndex);
      targetEl = document.getElementById(`thread-${id}`);
    }
    if (targetEl) {
      // expand 상태가 반영된 다음 프레임에 스크롤
      requestAnimationFrame(() => {
        targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetEl?.classList.add('ring-2', 'ring-emerald-400');
        setTimeout(() => {
          targetEl?.classList.remove('ring-2', 'ring-emerald-400');
        }, 2000);
      });
    }
  }, [loading, data, threads]);

  // ===== 구 단위 질문: 네이티브 selection → floating 「이 부분으로 질문」 버튼 =====
  //
  // - selectionchange 는 document-level. 빈/collapsed 선택이면 버튼 숨김.
  // - 선택 anchor 가 [data-sentence-index] 안에 있을 때만 발동 → thread 카드·폼 안에서는 안 뜸.
  // - 좌표는 Range.getBoundingClientRect() 사용 (모바일 native toolbar 아래로 위치).
  useEffect(() => {
    if (loading || !data) return;
    const SELECTED_TEXT_MAX = 80;

    const handler = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setPhraseSel(null);
        return;
      }
      const text = sel.toString();
      if (!text.trim()) {
        setPhraseSel(null);
        return;
      }
      const node = sel.anchorNode;
      if (!node) {
        setPhraseSel(null);
        return;
      }
      const parentEl: HTMLElement | null = (node.nodeType === Node.ELEMENT_NODE
        ? (node as HTMLElement)
        : node.parentElement);
      const sentenceEl = parentEl?.closest('[data-sentence-index]') as HTMLElement | null;
      if (!sentenceEl) {
        setPhraseSel(null);
        return;
      }
      const siRaw = sentenceEl.getAttribute('data-sentence-index');
      const si = siRaw == null ? NaN : parseInt(siRaw, 10);
      if (!Number.isInteger(si)) {
        setPhraseSel(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        setPhraseSel(null);
        return;
      }
      const clamped =
        text.length > SELECTED_TEXT_MAX
          ? text.slice(0, SELECTED_TEXT_MAX)
          : text;
      // 화면 안에 클램프된 좌표
      const top = Math.min(rect.bottom + 8, window.innerHeight - 60);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 220));
      setPhraseSel({ si, text: clamped, top, left });
    };

    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [loading, data]);

  const handlePickPhraseForQuestion = useCallback(() => {
    if (!phraseSel) return;
    const { si, text } = phraseSel;
    setExpandedSentence(si);
    setFormSelectedText((prev) => ({ ...prev, [si]: text }));
    setPhraseSel(null);
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      /* ignore */
    }
    // 80자 초과로 잘렸으면 토스트로 안내
    if (text.length === 80) showToast('80자까지만 첨부했습니다');
    requestAnimationFrame(() => {
      const el = document.getElementById(`q-form-${si}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const textInput = document.getElementById(`q-text-${si}`) as HTMLTextAreaElement | null;
      textInput?.focus();
    });
  }, [phraseSel, showToast]);

  // 문장 → thread 배열
  const threadsBySentence = useMemo(() => {
    const m = new Map<number, Thread[]>();
    for (const t of threads) {
      const arr = m.get(t.sentenceIndex) ?? [];
      arr.push(t);
      m.set(t.sentenceIndex, arr);
    }
    // 각 배열 createdAt desc 정렬
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    }
    return m;
  }, [threads]);

  // ---- 액션들 ----

  /**
   * 한 번 클릭 → PDF 생성 → 미리보기 모달 표시. 사용자가 「💾 저장」 누르면 그때 다운로드.
   *
   * - `html2canvas-pro` 직접 사용 (Tailwind v4 의 oklch 색상 지원하는 fork). dynamic import.
   * - `jspdf` 로 A4 페이지에 캔버스를 슬라이스해서 multi-page PDF 생성.
   * - chrome 제외: `print:hidden` 으로 마킹된 요소를 `onclone` 단계에서 강제 display:none —
   *   `ignoreElements` 가 traversal 밖 요소(KakaoFab 같은 position:fixed 글로벌)를
   *   못 잡는 케이스도 동시에 처리.
   * - 결과 PDF 안 텍스트는 raster (캔버스 기반) — 검색은 안 되지만 인쇄·뷰잉은 정상.
   */
  const handleGeneratePdfPreview = useCallback(async () => {
    if (!data || !printableRef.current || downloadingPdf) return;
    setDownloadingPdf(true);
    showToast('PDF 생성 중…');
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas-pro'),
        import('jspdf'),
      ]);

      // 분할 불가 단위(문장 카드 + 헤더) 의 원본 CSS 좌표 수집 — 캡처 직전에 측정해야
      // clone 도큐먼트가 아닌 실제 DOM 의 layout 과 동일한 단위를 잡을 수 있다.
      const containerRect = printableRef.current.getBoundingClientRect();
      const blockEls = Array.from(
        printableRef.current.querySelectorAll<HTMLElement>(
          'article[id^="sentence-"], [data-pdf-block]',
        ),
      );
      const cssBlocks = blockEls.map((el) => {
        const r = el.getBoundingClientRect();
        return {
          topCss: r.top - containerRect.top,
          bottomCss: r.bottom - containerRect.top,
        };
      });

      const canvas = await html2canvas(printableRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        ignoreElements: (el: Element) =>
          (el as HTMLElement).classList?.contains('print:hidden') ?? false,
        // print:hidden 으로 마킹됐지만 printableRef 밖에 있는 요소(KakaoFab 등 position:fixed
        // 글로벌 element) 까지 강제로 숨기는 이중 안전망.
        onclone: (clonedDoc: Document) => {
          clonedDoc.querySelectorAll('.print\\:hidden').forEach((el) => {
            (el as HTMLElement).style.display = 'none';
          });
        },
      });

      // CSS px → canvas px 환산 (scale: 2 이므로 약 2배). containerRect.height 가
      // 0 일 일은 거의 없지만 fallback 으로 1 사용.
      const cssToCanvasScale = canvas.height / Math.max(containerRect.height, 1);
      // 분할 불가 블록을 canvas px 좌표로 변환 + top 오름차순 정렬.
      const blocks = cssBlocks
        .map((b) => ({
          top: Math.floor(b.topCss * cssToCanvasScale),
          bottom: Math.ceil(b.bottomCss * cssToCanvasScale),
        }))
        .sort((a, b) => a.top - b.top);

      // A4 portrait = 210 × 297mm. 좌우 10mm 여백.
      const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
      const margin = 10;
      const pageWidthMm = pdf.internal.pageSize.getWidth();
      const pageHeightMm = pdf.internal.pageSize.getHeight();
      const usableWidthMm = pageWidthMm - margin * 2;
      const usableHeightMm = pageHeightMm - margin * 2;
      // 캔버스 → mm 환산 비율 (캔버스 width 가 usableWidth 에 들어가도록)
      const pxPerMm = canvas.width / usableWidthMm;
      const sliceHeightPx = Math.floor(usableHeightMm * pxPerMm);

      /**
       * 페이지 경계가 분할 불가 블록의 「중간」에 떨어지면 그 블록 시작점까지
       * sliceEnd 를 끌어올려 다음 페이지로 넘긴다. 단, 한 블록이 페이지 높이보다
       * 크면 어쩔 수 없이 단순 슬라이스 (그대로 잘림 허용).
       */
      const findSafeSliceEnd = (yStart: number, hardEnd: number): number => {
        let safeEnd = hardEnd;
        for (const b of blocks) {
          if (b.bottom <= yStart) continue; // 이미 지난 블록
          if (b.top >= hardEnd) break;       // 다음 페이지로 갈 블록
          // 블록이 hardEnd 를 가로지름
          if (b.top > yStart && b.top < hardEnd && b.bottom > hardEnd) {
            // 이 블록 시작점에서 끊고 다음 페이지로 넘김
            safeEnd = Math.min(safeEnd, b.top);
          }
        }
        // 블록 자체가 페이지 전체보다 크거나, yStart 가 블록 한가운데인 경우
        // safeEnd 가 yStart 이하로 떨어질 수 있으므로 최소 진행분 보장.
        if (safeEnd - yStart < sliceHeightPx * 0.4) {
          return hardEnd;
        }
        return safeEnd;
      };

      let yOffsetPx = 0;
      let pageIndex = 0;
      while (yOffsetPx < canvas.height) {
        if (pageIndex > 0) pdf.addPage();
        const hardEnd = Math.min(yOffsetPx + sliceHeightPx, canvas.height);
        const sliceEnd =
          hardEnd >= canvas.height ? hardEnd : findSafeSliceEnd(yOffsetPx, hardEnd);
        const sliceHeight = sliceEnd - yOffsetPx;
        const slice = document.createElement('canvas');
        slice.width = canvas.width;
        slice.height = sliceHeight;
        const ctx = slice.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, slice.width, slice.height);
          ctx.drawImage(
            canvas,
            0, yOffsetPx, canvas.width, sliceHeight, // source rect
            0, 0, slice.width, slice.height,          // dest rect
          );
        }
        const dataUrl = slice.toDataURL('image/jpeg', 0.95);
        const sliceHeightMm = sliceHeight / pxPerMm;
        pdf.addImage(dataUrl, 'JPEG', margin, margin, usableWidthMm, sliceHeightMm);
        yOffsetPx = sliceEnd;
        pageIndex += 1;
      }

      const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim();
      const filename = `${sanitize(data.sourceKey || data.textbook || 'qna-passage')}.pdf`;
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      setPdfPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url);
        return { url, filename };
      });
    } catch (err) {
      console.error('[handleGeneratePdfPreview]', err);
      showToast('PDF 생성 실패 — 콘솔 확인');
    } finally {
      setDownloadingPdf(false);
    }
  }, [data, downloadingPdf, showToast]);

  /** 미리보기 모달에서 「저장」 클릭 — 임시 anchor 로 다운로드 트리거. */
  const handleSavePdfFromPreview = useCallback(() => {
    if (!pdfPreview) return;
    const a = document.createElement('a');
    a.href = pdfPreview.url;
    a.download = pdfPreview.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('PDF 저장됨');
  }, [pdfPreview, showToast]);

  /** 모달 닫기 — blob URL 해제로 메모리 leak 방지. */
  const handleClosePdfPreview = useCallback(() => {
    setPdfPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  const handleCopyPageLink = useCallback(async () => {
    if (!passageId) return;
    const url = `${window.location.origin}/qna/${passageId}`;
    const outcome = await copyShareUrl(url, { title: 'Q&A 분석지', preferShare: true });
    if (outcome === 'copied') showToast('링크 복사됨');
    else if (outcome === 'failed') showToast('복사 실패 — 브라우저 권한 확인');
    // 'shared' 는 OS 시트가 피드백
  }, [passageId, showToast]);

  const handleCopySentenceLink = useCallback(
    async (si: number) => {
      if (!passageId) return;
      const oneBased = si + 1;
      const url = `${window.location.origin}/qna/${passageId}#sentence-${oneBased}`;
      const outcome = await copyShareUrl(url, { title: `Q&A — ${oneBased}번 문장`, preferShare: true });
      if (outcome === 'copied') showToast('링크 복사됨');
      else if (outcome === 'failed') showToast('복사 실패');
    },
    [passageId, showToast],
  );

  const handleCopyThreadLink = useCallback(
    async (threadId: string) => {
      if (!passageId) return;
      const url = `${window.location.origin}/qna/${passageId}#thread-${threadId}`;
      const outcome = await copyShareUrl(url, { title: 'Q&A 질문 링크', preferShare: true });
      if (outcome === 'copied') showToast('링크 복사됨');
      else if (outcome === 'failed') showToast('복사 실패');
    },
    [passageId, showToast],
  );

  const handleCopyEn = useCallback(
    async (s: string) => {
      const ok = await copyText(s);
      showToast(ok ? '문장 복사됨' : '복사 실패');
    },
    [showToast],
  );
  const handleCopyKo = useCallback(
    async (s: string) => {
      if (!s) return;
      const ok = await copyText(s);
      showToast(ok ? '문장 복사됨' : '복사 실패');
    },
    [showToast],
  );
  const handleCopyWord = useCallback(
    async (raw: string) => {
      const ok = await copyText(raw);
      const preview = raw.length > 12 ? raw.slice(0, 12) + '…' : raw;
      showToast(ok ? `복사: ${preview}` : '복사 실패');
    },
    [showToast],
  );

  const handlePickWordForQuestion = useCallback((si: number, word: string) => {
    setExpandedSentence(si);
    setFormSelectedText((prev) => ({ ...prev, [si]: word }));
    setWordPop(null);
    // 폼으로 부드럽게 스크롤
    requestAnimationFrame(() => {
      const el = document.getElementById(`q-form-${si}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const nicknameInput = document.getElementById(`q-nick-${si}`) as HTMLInputElement | null;
      const textInput = document.getElementById(`q-text-${si}`) as HTMLTextAreaElement | null;
      // 닉네임이 비어있으면 닉네임에, 아니면 질문에 포커스
      (nicknameInput && !nicknameInput.value ? nicknameInput : textInput)?.focus();
    });
  }, []);

  const handleAskHere = useCallback((si: number) => {
    setExpandedSentence(si);
    setFormSelectedText((prev) => ({ ...prev, [si]: '' }));
    requestAnimationFrame(() => {
      const el = document.getElementById(`q-form-${si}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  const handleSubmitThread = useCallback(
    async (si: number, payload: { nickname: string; question: string }) => {
      if (!passageId) return;
      const res = await fetch('/api/qna/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          passageId,
          sentenceIndex: si,
          nickname: payload.nickname,
          question: payload.question,
          selectedText: formSelectedText[si] || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        showToast(json.error || '저장 실패');
        return;
      }
      const created: Thread = json.thread;
      if (created.ownerToken) {
        setOwnerToken(created.id, created.ownerToken);
        setOwnerSet((prev) => new Set(prev).add(created.id));
      }
      // 폼 초기화
      setFormSelectedText((prev) => {
        const next = { ...prev };
        delete next[si];
        return next;
      });
      showToast('질문이 등록되었습니다');
      void reload();
    },
    [passageId, formSelectedText, reload, showToast],
  );

  const handleDeleteThread = useCallback(
    async (thread: Thread) => {
      if (!confirm('이 질문을 삭제하시겠어요?')) return;
      const ownerToken = getOwnerToken(thread.id);
      const headers: Record<string, string> = {};
      if (ownerToken) headers['x-qna-owner-token'] = ownerToken;
      const res = await fetch(`/api/qna/threads/${thread.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.error) {
        showToast(json.error || '삭제 실패');
        return;
      }
      if (json.mode === 'deleted') {
        removeOwnerToken(thread.id);
        setOwnerSet((prev) => {
          const next = new Set(prev);
          next.delete(thread.id);
          return next;
        });
        showToast('삭제되었습니다');
      } else if (json.mode === 'hidden') {
        showToast('답변이 있어 숨김 처리되었습니다');
      }
      void reload();
    },
    [reload, showToast],
  );

  const handleAdminHide = useCallback(
    async (thread: Thread) => {
      if (!confirm('이 질문을 숨김 처리할까요?')) return;
      const res = await fetch(`/api/qna/threads/${thread.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: 'hidden' }),
      });
      if (!res.ok) {
        showToast('숨김 실패');
        return;
      }
      showToast('숨김 처리됨');
      void reload();
    },
    [reload, showToast],
  );

  const handleSubmitAnswer = useCallback(
    async (thread: Thread, body: string) => {
      const res = await fetch(`/api/qna/threads/${thread.id}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ body }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        showToast(json.error || '답변 저장 실패');
        return false;
      }
      showToast('답변이 등록되었습니다');
      void reload();
      return true;
    },
    [reload, showToast],
  );

  const handleDeleteAnswer = useCallback(
    async (thread: Thread, idx: number) => {
      if (!confirm('이 답변을 삭제할까요?')) return;
      const res = await fetch(`/api/qna/threads/${thread.id}/answers/${idx}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        showToast('답변 삭제 실패');
        return;
      }
      showToast('답변이 삭제되었습니다');
      void reload();
    },
    [reload, showToast],
  );

  // SVOC 표시 가능 여부
  const svocAvailable = !!svoc && Object.keys(svoc).length > 0;

  // ===== 렌더 =====

  if (!passageId) {
    return (
      <>
        <AppBar title="Q&A 분석지" showBackButton onBackClick={() => router.push('/qna')} />
        <div className="p-8 text-center text-slate-600">잘못된 경로입니다.</div>
      </>
    );
  }

  return (
    <>
      <div className="print:hidden">
        <AppBar title="Q&A 분석지" showBackButton onBackClick={() => router.push('/qna')} />
      </div>
      <main
        className="min-h-screen bg-slate-50 py-6 print:bg-white print:py-0"
        onClick={() => setWordPop(null)}
      >
        <div ref={printableRef} className="container mx-auto max-w-3xl px-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-200" />
              ))}
            </div>
          ) : loadError ? (
            <p className="text-sm text-rose-600">불러오기에 실패했습니다: {loadError}</p>
          ) : !data ? (
            <p className="text-sm text-slate-500">지문을 찾을 수 없습니다.</p>
          ) : (
            <>
              {/* 상단 툴바 */}
              <header
                data-pdf-block
                className="mb-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {data.textbook}
                    </p>
                    <h1 className="text-xl font-bold text-slate-900">
                      {data.sourceKey || '(번호 없음)'}
                    </h1>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 print:hidden">
                  <ToggleButton
                    active={hideKo}
                    onClick={() => persistHideKo(!hideKo)}
                    label={hideKo ? '한글 해석 보이기' : '한글 해석 숨기기'}
                  />
                  {svocAvailable && (
                    <ToggleButton
                      active={showSvoc}
                      onClick={() => persistShowSvoc(!showSvoc)}
                      label={showSvoc ? 'SVOC 끄기' : 'SVOC 보기'}
                    />
                  )}
                  {/* 좌우 ↔ 위아래 — 모바일에서는 의미 없으므로 md+ 에서만 노출 */}
                  <button
                    type="button"
                    onClick={() => persistLayout(layout === 'stack' ? 'side' : 'stack')}
                    className={
                      'hidden md:inline-flex rounded-full px-3 py-1.5 text-xs font-medium transition ' +
                      (layout === 'side'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100')
                    }
                    title={layout === 'side' ? '위아래 보기로 전환' : '좌우 보기로 전환'}
                  >
                    {layout === 'side' ? '↕ 위아래 보기' : '↔ 좌우 보기'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyPageLink}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"
                    title="페이지 링크 복사"
                  >
                    🔗 페이지 링크
                  </button>
                  <button
                    type="button"
                    onClick={handleGeneratePdfPreview}
                    disabled={downloadingPdf}
                    className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
                    title="PDF 미리보기 후 저장"
                  >
                    {downloadingPdf ? '⏳ 생성 중…' : '📄 PDF 미리보기'}
                  </button>
                </div>
              </header>

              {/* 문장 카드 리스트 */}
              <section className="space-y-3">
                {data.sentences.map((en, si) => {
                  const ko = data.koreanSentences[si] || '';
                  const enTokens = tokenizeSentence(en);
                  const koTokens = ko ? tokenizeSentence(ko) : [];
                  const sentenceThreads = threadsBySentence.get(si) ?? [];
                  const expanded = expandedSentence === si;
                  const oneBased = si + 1;
                  const svocSentence = svoc?.[si];
                  return (
                    <article
                      key={si}
                      id={`sentence-${oneBased}`}
                      className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 transition"
                    >
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 inline-flex h-6 min-w-[1.5rem] select-none items-center justify-center rounded-full bg-slate-100 px-2 text-xs font-semibold text-slate-600">
                          {oneBased}
                        </span>
                        <div className="min-w-0 flex-1">
                          {/*
                           * phrase 선택 대상은 「본문(영/한) paragraph」 만.
                           * data-sentence-index 를 이 wrapper 에 두어 selectionchange 가 본문 텍스트
                           * 밖(액션 아이콘·배지·thread 영역 등)을 잡으면 floating 버튼이 안 뜬다.
                           *
                           * layout='side' + md 이상 → 좌(EN) 우(KO) grid. 그 외엔 stack(위/아래).
                           * 인쇄 시(@media print)엔 항상 stack — 한 페이지 안에서 가독성 우선.
                           */}
                          <div
                            data-sentence-index={si}
                            className={
                              layout === 'side'
                                ? 'md:grid md:grid-cols-2 md:gap-4 print:block print:!grid-cols-1'
                                : ''
                            }
                          >
                            {/* 영문 토큰들 */}
                            <p className="leading-relaxed text-slate-900">
                              <WordTokens
                                tokens={enTokens}
                                svocSentence={showSvoc ? svocSentence : undefined}
                                onPickWord={(word) =>
                                  setWordPop({ si, raw: word })
                                }
                              />
                            </p>
                            {/* 한글 — 어절 단위 클릭 가능 (SVOC 미적용). 인쇄 시엔 hide 토글 무시하고 항상 보이게. */}
                            {ko && (
                              <p
                                className={
                                  'text-sm text-slate-600 transition print:!blur-none print:!pointer-events-auto ' +
                                  (layout === 'side' ? 'md:mt-0' : 'mt-1') +
                                  (hideKo ? ' pointer-events-none select-none blur-sm' : '')
                                }
                                aria-hidden={hideKo}
                              >
                                <WordTokens
                                  tokens={koTokens}
                                  svocSentence={undefined}
                                  onPickWord={(word) =>
                                    setWordPop({ si, raw: word })
                                  }
                                />
                              </p>
                            )}
                          </div>

                          {/* 문장 액션 아이콘 (데스크톱 4개, 모바일 1개 + ⋯) — chrome, 선택 대상 아님 */}
                          <div className="select-none print:hidden">
                            <SentenceActions
                              onCopyEn={() => handleCopyEn(en)}
                              onCopyKo={() => {
                                if (ko) void handleCopyKo(ko);
                              }}
                              onCopyLink={() => handleCopySentenceLink(si)}
                              onAsk={() => handleAskHere(si)}
                              hasKo={!!ko}
                            />
                          </div>
                        </div>
                        {/* 우측 질문 N 배지 — chrome, 선택 대상 아님 */}
                        <button
                          type="button"
                          onClick={() => setExpandedSentence(expanded ? null : si)}
                          className={
                            'inline-flex flex-shrink-0 select-none items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition print:hidden ' +
                            (sentenceThreads.length > 0
                              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200')
                          }
                        >
                          질문 {sentenceThreads.length}
                          <span className={expanded ? 'rotate-180 transition' : 'transition'}>▾</span>
                        </button>
                      </div>

                      {/* 펼침 영역 — 인쇄에선 항상 숨김 (v1 PDF 는 지문만) */}
                      {expanded && (
                        <div className="mt-4 border-t border-slate-200 pt-3 print:hidden">
                          <ThreadList
                            threads={sentenceThreads}
                            ownerSet={ownerSet}
                            isAdmin={!!isAdmin}
                            onCopyLink={handleCopyThreadLink}
                            onDeleteThread={handleDeleteThread}
                            onAdminHide={handleAdminHide}
                            onSubmitAnswer={handleSubmitAnswer}
                            onDeleteAnswer={handleDeleteAnswer}
                          />
                          <QuestionForm
                            sentenceIndex={si}
                            me={me}
                            selectedText={formSelectedText[si] || ''}
                            onSelectedTextClear={() =>
                              setFormSelectedText((prev) => {
                                const n = { ...prev };
                                delete n[si];
                                return n;
                              })
                            }
                            onSubmit={(payload) => handleSubmitThread(si, payload)}
                          />
                        </div>
                      )}
                    </article>
                  );
                })}
              </section>

              {/* 「지문 전체에 대한 질문」 별도 영역 (sentenceIndex = -1) — 인쇄 숨김 */}
              <section className="mt-6 print:hidden">
                <div className="rounded-xl border border-dashed border-emerald-300 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-baseline justify-between gap-2">
                    <h2 className="text-sm font-semibold text-emerald-700">지문 전체에 대한 질문</h2>
                    <span className="text-xs text-slate-500">
                      {(threadsBySentence.get(FULL_PASSAGE_SENTENCE_INDEX) ?? []).length}건
                    </span>
                  </div>
                  <ThreadList
                    threads={threadsBySentence.get(FULL_PASSAGE_SENTENCE_INDEX) ?? []}
                    ownerSet={ownerSet}
                    isAdmin={!!isAdmin}
                    onCopyLink={handleCopyThreadLink}
                    onDeleteThread={handleDeleteThread}
                    onAdminHide={handleAdminHide}
                    onSubmitAnswer={handleSubmitAnswer}
                    onDeleteAnswer={handleDeleteAnswer}
                  />
                  <QuestionForm
                    sentenceIndex={FULL_PASSAGE_SENTENCE_INDEX}
                    me={me}
                    selectedText={formSelectedText[FULL_PASSAGE_SENTENCE_INDEX] || ''}
                    onSelectedTextClear={() =>
                      setFormSelectedText((prev) => {
                        const n = { ...prev };
                        delete n[FULL_PASSAGE_SENTENCE_INDEX];
                        return n;
                      })
                    }
                    onSubmit={(payload) => handleSubmitThread(FULL_PASSAGE_SENTENCE_INDEX, payload)}
                  />
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      {/* 단어 클릭 팝오버 — phrase 선택이 떠 있으면 숨김 (UX 충돌 방지) */}
      {wordPop && !phraseSel && (
        <WordPopover
          word={wordPop.raw}
          onPickForQuestion={() => handlePickWordForQuestion(wordPop.si, wordPop.raw)}
          onCopy={() => {
            void handleCopyWord(wordPop.raw);
            setWordPop(null);
          }}
        />
      )}

      {/* 구 단위 「이 부분으로 질문」 floating 버튼 — 인쇄 시 숨김 */}
      {phraseSel && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handlePickPhraseForQuestion();
          }}
          // pointerdown 이 selectionchange 를 트리거하지 않도록 mousedown 도 preventDefault
          onMouseDown={(e) => e.preventDefault()}
          style={{ top: phraseSel.top, left: phraseSel.left }}
          className="fixed z-40 inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-lg hover:bg-emerald-700 print:hidden"
        >
          📝 이 부분으로 질문
          <span className="ml-1 max-w-[8rem] truncate text-emerald-100/90">
            “{phraseSel.text}”
          </span>
        </button>
      )}

      {/* 토스트 — 인쇄 숨김 */}
      {toast && (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-sm text-white shadow-lg print:hidden">
          {toast.text}
        </div>
      )}

      {/* PDF 미리보기 모달 — iframe 으로 blob URL 표시. 「저장」 / 「닫기」 */}
      {pdfPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 print:hidden"
          onClick={handleClosePdfPreview}
        >
          <div
            className="flex h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900">PDF 미리보기</h2>
                <p className="truncate text-xs text-slate-500">{pdfPreview.filename}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleSavePdfFromPreview}
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  💾 저장
                </button>
                <button
                  type="button"
                  onClick={handleClosePdfPreview}
                  className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100"
                >
                  닫기
                </button>
              </div>
            </header>
            <iframe
              src={pdfPreview.url}
              title="PDF 미리보기"
              className="flex-1 border-0 bg-slate-100"
            />
          </div>
        </div>
      )}
    </>
  );
}

// ============================ 보조 컴포넌트들 ============================

/**
 * 영문/한글 문장의 토큰을 클릭 가능한 span 들로 렌더링.
 *
 * - `<button>` 이 아닌 `<span role="button" tabIndex={0}>` 사용 — iOS Safari 에서 long-press 시
 *   button 의 Copy/Share callout 이 native 텍스트 선택을 가로채는 문제를 회피.
 * - 클릭 시 이미 활성 선택이 있으면 popover 를 띄우지 않음 → phrase 선택 흐름 우선.
 * - SVOC 배경색은 svocSentence 가 있을 때만 적용 (KO 문장은 자연스럽게 색칠 안 됨).
 */
function WordTokens({
  tokens,
  svocSentence,
  onPickWord,
}: {
  tokens: ReturnType<typeof tokenizeSentence>;
  svocSentence: SvocSentenceData | undefined;
  onPickWord: (word: string) => void;
}) {
  const handleActivate = (word: string) => {
    if (typeof window !== 'undefined') {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString().trim().length > 0) {
        // 사용자가 텍스트 선택 중 → popover 띄우지 말고 phrase 흐름에 양보
        return;
      }
    }
    onPickWord(word);
  };
  return (
    <>
      {tokens.map((tk, idx) => {
        const paint = svocSentence ? svocBgFor(tk.wordIndex, svocSentence) : undefined;
        const isClickable = tk.core.length > 0;
        return (
          <span key={idx} className="inline">
            {tk.leading}
            {isClickable ? (
              <span
                role="button"
                tabIndex={0}
                data-word-idx={tk.wordIndex}
                onClick={(e) => {
                  e.stopPropagation();
                  handleActivate(tk.core);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleActivate(tk.core);
                  }
                }}
                className="cursor-pointer rounded-sm px-0.5 outline-none transition hover:bg-emerald-100 focus-visible:ring-2 focus-visible:ring-emerald-400"
                style={paint ? { backgroundColor: paint } : undefined}
                title={paint ? svocLabelFor(tk.wordIndex, svocSentence) : undefined}
              >
                {tk.core}
              </span>
            ) : (
              <span>{tk.core}</span>
            )}
            {tk.trailing}
            {idx < tokens.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-full px-3 py-1.5 text-xs font-medium transition ' +
        (active
          ? 'bg-emerald-600 text-white shadow-sm'
          : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100')
      }
    >
      {label}
    </button>
  );
}

function SentenceActions({
  onCopyEn,
  onCopyKo,
  onCopyLink,
  onAsk,
  hasKo,
}: {
  onCopyEn: () => void;
  onCopyKo: () => void | undefined;
  onCopyLink: () => void;
  onAsk: () => void;
  hasKo: boolean;
}) {
  const [openMenu, setOpenMenu] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
      {/* 데스크톱: 전부 노출 */}
      <div className="hidden gap-1 sm:flex">
        <IconButton onClick={onCopyEn} title="영문 복사" label="EN" />
        {hasKo && <IconButton onClick={onCopyKo} title="한글 복사" label="KO" />}
        <IconButton onClick={onCopyLink} title="이 문장 링크 복사" label="🔗" />
        <IconButton onClick={onAsk} title="이 문장에 질문하기" label="질문" />
      </div>
      {/* 모바일: 질문 + ⋯ 메뉴 */}
      <div className="flex gap-1 sm:hidden relative">
        <IconButton onClick={onAsk} title="이 문장에 질문하기" label="질문" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setOpenMenu((o) => !o);
          }}
          className="rounded px-2 py-1 ring-1 ring-slate-200 hover:bg-slate-100"
        >
          ⋯
        </button>
        {openMenu && (
          <div className="absolute right-0 top-full z-10 mt-1 flex flex-col gap-1 rounded-md bg-white p-1 shadow-md ring-1 ring-slate-200">
            <MenuItem onClick={() => { setOpenMenu(false); onCopyEn(); }}>영문 복사</MenuItem>
            {hasKo && <MenuItem onClick={() => { setOpenMenu(false); onCopyKo(); }}>한글 복사</MenuItem>}
            <MenuItem onClick={() => { setOpenMenu(false); onCopyLink(); }}>🔗 문장 링크</MenuItem>
          </div>
        )}
      </div>
    </div>
  );
}

function IconButton({ onClick, title, label }: { onClick: () => void; title: string; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className="rounded px-2 py-1 ring-1 ring-slate-200 hover:bg-emerald-50 hover:text-emerald-700"
    >
      {label}
    </button>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-3 py-1.5 text-left text-xs hover:bg-slate-100"
    >
      {children}
    </button>
  );
}

function WordPopover({
  word,
  onPickForQuestion,
  onCopy,
}: {
  word: string;
  onPickForQuestion: () => void;
  onCopy: () => void;
}) {
  // 단순 인라인 — 페이지 자체 onClick 으로 닫힘. 위치는 단어 옆 자연스럽게 따라가도록 fixed top-right 으로 둘 수도 있지만, 우선 모달처럼 보이지 않게 가벼운 floating 카드로.
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-white p-2 shadow-lg ring-1 ring-slate-200 print:hidden"
    >
      <div className="px-2 pt-1 text-[11px] text-slate-500">선택: <strong className="text-slate-800">{word}</strong></div>
      <div className="mt-1 flex gap-1">
        <button
          type="button"
          onClick={onPickForQuestion}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
        >
          이 단어로 질문
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
        >
          복사
        </button>
      </div>
    </div>
  );
}

// ===== thread 리스트 + answer + 폼 =====

function ThreadList({
  threads,
  ownerSet,
  isAdmin,
  onCopyLink,
  onDeleteThread,
  onAdminHide,
  onSubmitAnswer,
  onDeleteAnswer,
}: {
  threads: Thread[];
  ownerSet: Set<string>;
  isAdmin: boolean;
  onCopyLink: (threadId: string) => void;
  onDeleteThread: (t: Thread) => void;
  onAdminHide: (t: Thread) => void;
  onSubmitAnswer: (t: Thread, body: string) => Promise<boolean>;
  onDeleteAnswer: (t: Thread, idx: number) => void;
}) {
  if (threads.length === 0) {
    return <p className="mb-3 text-xs text-slate-500">아직 질문이 없습니다. 가장 먼저 남겨보세요.</p>;
  }
  return (
    <ul className="mb-3 space-y-3">
      {threads.map((t) => (
        <ThreadCard
          key={t.id}
          thread={t}
          isOwner={ownerSet.has(t.id)}
          isAdmin={isAdmin}
          onCopyLink={() => onCopyLink(t.id)}
          onDelete={() => onDeleteThread(t)}
          onAdminHide={() => onAdminHide(t)}
          onSubmitAnswer={(body) => onSubmitAnswer(t, body)}
          onDeleteAnswer={(idx) => onDeleteAnswer(t, idx)}
        />
      ))}
    </ul>
  );
}

function ThreadCard({
  thread,
  isOwner,
  isAdmin,
  onCopyLink,
  onDelete,
  onAdminHide,
  onSubmitAnswer,
  onDeleteAnswer,
}: {
  thread: Thread;
  isOwner: boolean;
  isAdmin: boolean;
  onCopyLink: () => void;
  onDelete: () => void;
  onAdminHide: () => void;
  onSubmitAnswer: (body: string) => Promise<boolean>;
  onDeleteAnswer: (idx: number) => void;
}) {
  const [answerInput, setAnswerInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!answerInput.trim()) return;
    setSubmitting(true);
    const ok = await onSubmitAnswer(answerInput.trim());
    setSubmitting(false);
    if (ok) setAnswerInput('');
  };

  return (
    <li
      id={`thread-${thread.id}`}
      className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 transition"
    >
      <header className="mb-1 flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5 text-xs">
          <span className="font-semibold text-slate-700">{thread.asker.nickname}</span>
          {thread.asker.role === 'admin' && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">관리자</span>
          )}
          {isOwner && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">내 질문</span>
          )}
          <time className="text-slate-400">{formatRelative(thread.createdAt)}</time>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onCopyLink}
            title="이 질문 링크 복사"
            className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-200"
          >
            🔗
          </button>
          {isOwner && (
            <button
              type="button"
              onClick={onDelete}
              title={thread.answers.length > 0 ? '답변이 있어 숨김 처리됩니다' : '삭제'}
              className="rounded px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50"
            >
              {thread.answers.length > 0 ? '숨김 요청' : '삭제'}
            </button>
          )}
          {isAdmin && thread.status !== 'hidden' && (
            <>
              <button
                type="button"
                onClick={onAdminHide}
                title="숨김"
                className="rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-200"
              >
                숨김
              </button>
              <button
                type="button"
                onClick={onDelete}
                title="삭제"
                className="rounded px-2 py-0.5 text-xs text-rose-600 hover:bg-rose-50"
              >
                삭제
              </button>
            </>
          )}
        </div>
      </header>
      {thread.selectedText && (
        <div className="mb-1 inline-block rounded bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
          “{thread.selectedText}”
        </div>
      )}
      <p className="whitespace-pre-wrap text-sm text-slate-900">{thread.question}</p>

      {thread.answers.length > 0 && (
        <ul className="mt-2 space-y-2">
          {thread.answers.map((ans, idx) => (
            <li key={idx} className="rounded-md bg-white p-2 ring-1 ring-emerald-100">
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-semibold text-emerald-700">{ans.author.name}</span>
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">관리자</span>
                  <time className="text-slate-400">{formatRelative(ans.createdAt)}</time>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => onDeleteAnswer(idx)}
                    className="rounded px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50"
                  >
                    삭제
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm text-slate-800">{ans.body}</p>
            </li>
          ))}
        </ul>
      )}

      {isAdmin && (
        <div className="mt-3 rounded-md bg-white p-2 ring-1 ring-emerald-100">
          <textarea
            value={answerInput}
            onChange={(e) => setAnswerInput(e.target.value)}
            placeholder="답변을 입력하세요…"
            rows={2}
            className="w-full rounded border border-slate-200 px-2 py-1 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
          />
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!answerInput.trim() || submitting}
              className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {submitting ? '저장 중…' : '답변 등록'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function QuestionForm({
  sentenceIndex,
  me,
  selectedText,
  onSelectedTextClear,
  onSubmit,
}: {
  sentenceIndex: number;
  me: Me;
  selectedText: string;
  onSelectedTextClear: () => void;
  onSubmit: (payload: { nickname: string; question: string }) => Promise<void> | void;
}) {
  const isAdmin = me?.role === 'admin';
  const defaultNickname = isAdmin ? me?.name || me?.loginId || 'admin' : '';
  const [nickname, setNickname] = useState(defaultNickname);
  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // 로그인 정보 늦게 도착하는 경우 nickname 보정
  useEffect(() => {
    if (isAdmin && !nickname) setNickname(defaultNickname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, defaultNickname]);

  const handle = async () => {
    if (!question.trim() || !nickname.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({ nickname: nickname.trim(), question: question.trim() });
      setQuestion('');
      if (!isAdmin) {
        // nickname 은 유지 (다음 질문도 편하게)
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div id={`q-form-${sentenceIndex}`} className="rounded-md border border-emerald-200 bg-emerald-50/50 p-3">
      {selectedText && (
        <div className="mb-2 flex items-center gap-1">
          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            “{selectedText}”
          </span>
          <button
            type="button"
            onClick={onSelectedTextClear}
            className="text-[10px] text-slate-400 hover:text-slate-600"
            title="단어 칩 제거"
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={`q-nick-${sentenceIndex}`}
          type="text"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="닉네임 (2~20자)"
          maxLength={20}
          disabled={isAdmin && !!defaultNickname}
          className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400 sm:w-40 disabled:bg-slate-100 disabled:text-slate-500"
        />
        <textarea
          id={`q-text-${sentenceIndex}`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="질문을 입력하세요… (1~500자)"
          rows={2}
          maxLength={500}
          className="min-h-[2.25rem] flex-1 rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
        />
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>{question.length}/500</span>
        <button
          type="button"
          onClick={handle}
          disabled={submitting || !question.trim() || !nickname.trim()}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitting ? '등록 중…' : '질문 등록'}
        </button>
      </div>
    </div>
  );
}

// =============== utils ===============

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diffSec = Math.floor((Date.now() - t) / 1000);
  if (diffSec < 60) return '방금';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}시간 전`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

/** wordIndex 가 svocSentence 의 어느 역할 range 안에 있는지 → 배경색 반환 (없으면 undefined) */
function svocBgFor(wi: number, sv: SvocSentenceData): string | undefined {
  const hit = (s: unknown, e: unknown) =>
    typeof s === 'number' && s >= 0 && typeof e === 'number' && e >= 0 && wi >= s && wi <= e;
  for (const comp of SVOC_COMPONENTS) {
    const f = SVOC_FIELDS[comp.id];
    const st = sv[f.start] as unknown;
    const en = sv[f.end] as unknown;
    if (hit(st, en)) return SVOC_WORD_BG[comp.color];
  }
  // legacy object/complement fields
  if (hit(sv.objectStart, sv.objectEnd)) return SVOC_WORD_BG.green;
  if (hit(sv.complementStart, sv.complementEnd)) return SVOC_WORD_BG.purple;
  return undefined;
}

function svocLabelFor(wi: number, sv: SvocSentenceData | undefined): string | undefined {
  if (!sv) return undefined;
  const hit = (s: unknown, e: unknown) =>
    typeof s === 'number' && s >= 0 && typeof e === 'number' && e >= 0 && wi >= s && wi <= e;
  for (const comp of SVOC_COMPONENTS) {
    const f = SVOC_FIELDS[comp.id];
    const st = sv[f.start] as unknown;
    const en = sv[f.end] as unknown;
    if (hit(st, en)) return comp.label;
  }
  if (hit(sv.objectStart, sv.objectEnd)) return '목적어';
  if (hit(sv.complementStart, sv.complementEnd)) return '보어';
  return undefined;
}
