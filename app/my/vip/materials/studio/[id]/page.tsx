'use client';

/**
 * 교재 스튜디오 편집기 — A4 캔버스 자유 배치 (드래그·리사이즈·속성·페이지·문제 불러오기·PDF/HWPX).
 * 좌표는 mm (A4 210×297). 화면 표시는 S(px/mm) 배율.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import {
  A4_W, A4_H, buildCoverPage, COVER_TEMPLATES,
  type StudioElement, type StudioPage, type StudioDifficulty, type CoverTemplateId,
} from '@/lib/vip-material-studio';

const uid = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const PT2MM = 25.4 / 72;
const CIRCLED = ['①', '②', '③', '④', '⑤'];

/** 축 스냅 — 요소의 좌/중앙/우 에지가 target 에 1.4mm 이내로 오면 자석처럼 붙임 */
function snapAxis(pos: number, size: number, targets: number[]): { pos: number; guide: number | null } {
  let best: { d: number; pos: number; guide: number } | null = null;
  for (const t of targets) {
    for (const c of [t, t - size / 2, t - size]) {
      const dd = Math.abs(c - pos);
      if (dd <= 1.4 && (!best || dd < best.d)) best = { d: dd, pos: Math.round(c * 100) / 100, guide: t };
    }
  }
  return best ? { pos: best.pos, guide: best.guide } : { pos, guide: null };
}

type DragMode = 'move' | 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se' | 'rot';

/** 그라데이션 채움 → CSS. 없으면 null (fill/bg 로 폴백) */
function gradientCss(g?: { from: string; to: string; angle?: number } | null): string | null {
  return g && g.from && g.to ? `linear-gradient(${g.angle ?? 135}deg, ${g.from}, ${g.to})` : null;
}

/** <u> 만 허용하는 안전 렌더 (그 외 태그는 이스케이프) */
function safeUnderlineHtml(s: string): string {
  const esc = (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/&lt;u&gt;/g, '<u>').replace(/&lt;\/u&gt;/g, '</u>').replace(/\n/g, '<br/>');
}

interface BankItem { id: string; questionId: string; serialNo: number | null; type: string; textbook: string; source: string; question: string; preview: string; folder: string }
interface FullQ { qid: string; serial: string; type: string; textbook: string; source: string; question: string; paragraph: string; options: string[]; answer: string; explanation: string }

/** 이미지/QR 을 dataURL 로 인라인 — PNG 내보내기(SVG 렌더는 외부 리소스를 못 불러옴) */
async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const b = await fetch(url, { credentials: 'include' }).then((r) => r.blob());
  return await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error('read'));
    fr.readAsDataURL(b);
  });
}

/** 페이지 → 자체완결 XHTML (PNG 내보내기용 — 캔버스 렌더와 동일 레이아웃을 전부 인라인 스타일로) */
function pageToXhtml(p: StudioPage, pageNo: number, E: number, srcMap: Map<string, string>): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const FONT = "font-family:'NanumGothic','Apple SD Gothic Neo',sans-serif;";
  const parts: string[] = [];
  for (const el of [...p.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) {
    const rot = el.rotation ? `transform:rotate(${el.rotation}deg);` : '';
    const base = `position:absolute;left:${el.x * E}px;top:${el.y * E}px;width:${el.w * E}px;height:${el.h * E}px;box-sizing:border-box;${rot}`;
    if (el.kind === 'text') {
      const border = el.borderColor && (el.borderWidth ?? 0) > 0 ? `border:${Math.max(1, (el.borderWidth ?? 0.3) * E)}px solid ${el.borderColor};` : '';
      const ls = el.letterSpacing ? `letter-spacing:${el.letterSpacing * PT2MM * E}px;` : '';
      const st = `${base}${FONT}font-size:${(el.fontSize ?? 11) * PT2MM * E}px;font-weight:${el.bold ? 700 : 400};color:${el.color || '#111'};background:${gradientCss(el.gradient) || el.bg || 'transparent'};text-align:${el.align ?? 'left'};line-height:${el.lineHeight ?? 1.35};padding:${1.2 * E}px;white-space:pre-wrap;word-break:break-word;overflow:hidden;${ls}${border}`;
      parts.push(`<div style="${st}">${safeUnderlineHtml((el.text ?? '').replace(/\{\{page\}\}/g, String(pageNo)))}</div>`);
    } else if (el.kind === 'rect' || el.kind === 'line') {
      const border = el.borderColor && (el.borderWidth ?? 0) > 0 ? `border:${Math.max(1, (el.borderWidth ?? 0) * E)}px solid ${el.borderColor};` : '';
      parts.push(`<div style="${base}background:${gradientCss(el.gradient) || el.fill || 'transparent'};border-radius:${(el.radius ?? 0) * E}px;${border}"></div>`);
    } else if (el.kind === 'image') {
      const src = el.src ? srcMap.get(el.src) : undefined;
      if (src) parts.push(`<div style="${base}"><img src="${src}" style="width:100%;height:100%;object-fit:contain" /></div>`);
    } else if (el.kind === 'qr') {
      const src = el.qrUrl ? srcMap.get(`qr:${el.qrUrl}`) : undefined;
      const side = Math.min(el.w, el.h - (el.qrLabel ? 5 : 0)) * E;
      const label = el.qrLabel ? `<div style="${FONT}font-size:${8 * PT2MM * E}px;color:#374151;text-align:center">${esc(el.qrLabel)}</div>` : '';
      if (src) parts.push(`<div style="${base}text-align:center"><img src="${src}" style="width:${side}px;height:${side}px;display:inline-block" />${label}</div>`);
    } else if (el.kind === 'question' && el.q) {
      const q = el.q;
      const size = (el.fontSize ?? 10) * PT2MM * E;
      const serial = q.serial ? `<span style="font-weight:400;font-size:${size * 0.75}px;color:#9ca3af"> ${esc(q.serial)}·${esc(q.type ?? '')}</span>` : '';
      const para = q.paragraph ? `<div style="border:1px solid #9ca3af;padding:${0.8 * E}px ${1.2 * E}px;margin:${0.8 * E}px 0;font-size:${size * 0.95}px">${safeUnderlineHtml(q.paragraph)}</div>` : '';
      const opts = (q.options ?? []).filter((o) => o.trim()).map((o, i) => `<div style="font-size:${size * 0.95}px">${CIRCLED[i]} ${esc(o)}</div>`).join('');
      const ans = q.showAnswer && q.answer ? `<div style="font-size:${size * 0.85}px;color:#6b7280;margin-top:${0.5 * E}px">정답 ${esc(q.answer)}${q.explanation ? ` | ${esc(q.explanation.replace(/<\/?u>/g, ''))}` : ''}</div>` : '';
      parts.push(`<div style="${base}${FONT}font-size:${size}px;color:#111;line-height:1.5;padding:${1.5 * E}px;overflow:hidden"><div style="font-weight:700">${q.num ? `${q.num}. ` : ''}${esc((q.question ?? '').replace(/<\/?u>/g, ''))}${serial}</div>${para}${opts}${ans}</div>`);
    }
  }
  return parts.join('');
}

/** pdfjs ESM 최소 타입 (public/vendor 네이티브 import 용) */
interface PdfJsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer }) => {
    promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getViewport: (o: { scale: number }) => { width: number; height: number };
        render: (o: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => { promise: Promise<void> };
      }>;
      destroy: () => Promise<void>;
    }>;
  };
}

/** PDF 파일 → 1페이지를 고해상 PNG(8MB 근접 시 JPG)로 래스터화. 표지 PDF 업로드용 — 서버에는 이미지만 올라간다.
 *  pdfjs-dist 는 webpack 번들 시 defineProperty 충돌이 있어 public/vendor 사본을 브라우저 네이티브 import 로 로드한다. */
async function pdfFileToImage(f: File): Promise<{ file: File; pageCount: number }> {
  const modUrl = '/vendor/pdfjs/pdf.min.mjs'; // pdfjs-dist@5 build 사본 (업데이트 시 node_modules 에서 재복사)
  const pdfjs = (await import(/* webpackIgnore: true */ modUrl)) as PdfJsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, 1654 / base.width); // A4 폭 기준 ≈200dpi
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await page.render({ canvas, viewport: vp }).promise;
    let blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    let ext = '.png';
    if (blob && blob.size > 7.5 * 1024 * 1024) {
      blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
      ext = '.jpg';
    }
    if (!blob) throw new Error('canvas toBlob 실패');
    const name = (f.name || 'cover').replace(/\.pdf$/i, '') + ext;
    return { file: new File([blob], name, { type: ext === '.png' ? 'image/png' : 'image/jpeg' }), pageCount: doc.numPages };
  } finally {
    doc.destroy().catch(() => {});
  }
}

export default function StudioEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState('기초');
  const [pages, setPages] = useState<StudioPage[]>([]);
  const [pi, setPi] = useState(0); // 현재 페이지 index
  /** 선택된 요소 id 목록 — Shift+클릭으로 다중 선택 */
  const [selIds, setSelIds] = useState<string[]>([]);
  /** 더블클릭 인라인 편집 중인 텍스트 요소 id */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [qrCache, setQrCache] = useState<Record<string, string>>({});
  const [qModal, setQModal] = useState(false);
  /** 왼쪽 도킹 플라이아웃 패널 — 어느 도구가 열려있는지 (미리캔버스식) */
  const [flyout, setFlyout] = useState<'text' | 'image' | 'qr' | 'cover' | 'classkit' | null>(null);
  const [imgLib, setImgLib] = useState<{ name: string; url: string }[] | null>(null);
  /** 클래스키트 자료 불러오기 패널 상태 */
  interface CkPassage { _id: string; chapter?: string; number?: string; source_key?: string; content?: { sentences_en?: string[]; sentences_ko?: string[]; original?: string } }
  const [ckTextbooks, setCkTextbooks] = useState<string[] | null>(null);
  const [ckTextbook, setCkTextbook] = useState('');
  const [ckPassages, setCkPassages] = useState<CkPassage[] | null>(null);
  type CkType = 'lecture' | 'parallel' | 'lineByLine' | 'writeEn' | 'writeKo';
  const CK_TYPES: { key: CkType; label: string }[] = [
    { key: 'lecture', label: '강의용자료' },
    { key: 'parallel', label: '수업용자료' },
    { key: 'lineByLine', label: '한줄해석' },
    { key: 'writeEn', label: '영작하기' },
    { key: 'writeKo', label: '해석쓰기' },
  ];
  const [ckType, setCkType] = useState<CkType>('lecture');
  const [ckBusy, setCkBusy] = useState(false);
  /** 우클릭/⋯ 컨텍스트 메뉴 (화면 px 좌표) */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  /** 우측 패널 탭 — 속성/레이어 */
  const [rightTab, setRightTab] = useState<'props' | 'layers'>('props');
  /** 전체화면 프레젠테이션 */
  const [present, setPresent] = useState(false);
  /** 드래그 중 여부 — 플로팅 툴바 숨김용 */
  const [dragging, setDragging] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** 다운로드 형식 드롭다운 */
  const [dlMenu, setDlMenu] = useState(false);
  /** QR 입력 폼 값 (플라이아웃 패널) — prompt() 는 임베디드 환경에서 차단되므로 사용 금지 */
  const [qrForm, setQrForm] = useState({ url: '', label: '📱 스캔해서 영상 보기' });
  /** 비차단 알림 토스트 (alert 대체) */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);
  /** 하단 페이지 스트립 — 현재 페이지 썸네일이 보이도록 스크롤 */
  const stripRef = useRef<HTMLDivElement>(null);
  /** 페이지 수 — 키보드 페이지 넘김의 상한 클램프용(effect deps 없이 최신값 참조) */
  const pagesLenRef = useRef(0);
  pagesLenRef.current = pages.length;

  const S = 3.2 * zoom; // px per mm
  /** 드래그 스냅 시 표시할 가이드라인 (mm 좌표) */
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const histRef = useRef<string[]>([]);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  /** 드래그 중 스냅 대상 계산용 — 현재 페이지 요소 스냅샷 */
  const pageElsRef = useRef<StudioElement[]>([]);
  /** 텍스트 요소별 실제 내용 높이(mm) — 「내용에 높이 맞춤」용 */
  const neededHRef = useRef<Record<string, number>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const fileModeRef = useRef<'element' | 'cover'>('element');
  const dragRef = useRef<{ mode: DragMode; elId: string; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; items: { id: string; ox: number; oy: number }[]; ratio?: number; pl: number; pt: number } | null>(null);
  const pageDivRef = useRef<HTMLDivElement>(null);
  /** 빈 캔버스 드래그 범위 선택(마퀴) 사각형 (mm) */
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const page = pages[pi];
  /** 단일 선택일 때만 속성 패널에 표시 */
  const sel = useMemo(() => (selIds.length === 1 ? page?.elements.find((e) => e.id === selIds[0]) ?? null : null), [page, selIds]);
  /** 선택 묶음 bbox — 플로팅 미니 툴바 위치용 */
  const selBox = useMemo(() => {
    const els = (page?.elements ?? []).filter((e) => selIds.includes(e.id));
    if (els.length === 0) return null;
    const x = Math.min(...els.map((e) => e.x)), y = Math.min(...els.map((e) => e.y));
    const r = Math.max(...els.map((e) => e.x + e.w)), b = Math.max(...els.map((e) => e.y + e.h));
    return { x, y, r, b, cx: (x + r) / 2, allLocked: els.every((e) => e.locked === true) };
  }, [page, selIds]);

  useEffect(() => { pageElsRef.current = page?.elements ?? []; }, [page]);

  /* ── 현재 페이지 썸네일을 하단 스트립에서 보이도록 스크롤 ── */
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>(`[data-page-idx="${pi}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [pi]);

  /** ElementView 가 측정한 텍스트 실제 높이 보고 */
  const onMeasure = useCallback((id: string, mm: number) => { neededHRef.current[id] = mm; }, []);

  /* ── 로드 ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await fetch(`/api/my/vip/materials/studio/${id}`, { credentials: 'include' }).then((r) => r.json()).catch(() => null);
      if (!alive) return;
      if (d?.ok) {
        setTitle(d.doc.title); setDifficulty(d.doc.difficulty || '기초'); setPages(d.doc.pages as StudioPage[]);
      } else { router.push('/my/vip/materials/studio'); }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [id, router]);

  /* ── QR 미리보기 데이터URL ── */
  useEffect(() => {
    const urls = new Set<string>();
    for (const p of pages) for (const e of p.elements) if (e.kind === 'qr' && e.qrUrl) urls.add(e.qrUrl);
    for (const u of urls) {
      if (qrCache[u]) continue;
      QRCode.toDataURL(u, { margin: 0, width: 256 }).then((durl) => setQrCache((c) => ({ ...c, [u]: durl }))).catch(() => {});
    }
  }, [pages, qrCache]);

  /* ── 변경 커밋 (undo 히스토리 + dirty) ── */
  const commit = useCallback((next: StudioPage[] | ((prev: StudioPage[]) => StudioPage[])) => {
    setPages((prev) => {
      histRef.current.push(JSON.stringify(prev));
      if (histRef.current.length > 60) histRef.current.shift();
      return typeof next === 'function' ? next(prev) : next;
    });
    setSaveState('dirty');
  }, []);

  const undo = useCallback(() => {
    const last = histRef.current.pop();
    if (!last) return;
    setPages(JSON.parse(last)); setSaveState('dirty');
  }, []);

  /** 캔버스 폭에 맞춰 줌 계산 (여백 48px 제외) */
  const fitZoom = useCallback((cap = 1.5) => {
    const w = canvasWrapRef.current?.clientWidth;
    if (!w) return;
    const z = Math.max(0.5, Math.min(cap, Math.round(((w - 48) / (A4_W * 3.2)) * 100) / 100));
    setZoom(z);
  }, []);

  // 최초 로드 시 화면 폭에 맞춤 (확대는 100%까지만)
  useEffect(() => {
    if (!loading) fitZoom(1);
  }, [loading, fitZoom]);

  // 트랙패드 핀치(두 손가락 벌리기/좁히기 = ctrl+휠) → 확대/축소
  useEffect(() => {
    if (loading) return;
    const node = canvasWrapRef.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); // 브라우저 페이지 줌 방지 — passive:false 필수
      setZoom((z) => Math.max(0.4, Math.min(2.5, Math.round(z * (1 - e.deltaY * 0.01) * 100) / 100)));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [loading]);

  // 저장 안 된 변경이 있으면 이탈 경고
  useEffect(() => {
    if (saveState === 'saved') return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveState]);

  /* ── 자동 저장 (1.5s 디바운스) ── */
  useEffect(() => {
    if (saveState !== 'dirty') return;
    const t = setTimeout(async () => {
      setSaveState('saving');
      try {
        await fetch(`/api/my/vip/materials/studio/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ title, difficulty, pages }),
        });
        setSaveState('saved');
      } catch { setSaveState('dirty'); }
    }, 1500);
    return () => clearTimeout(t);
  }, [saveState, pages, title, difficulty, id]);

  /* ── 요소 수정 헬퍼 ── */
  const patchEl = useCallback((elId: string, patch: Partial<StudioElement>) => {
    commit((prev) => prev.map((p, i) => i !== pi ? p : { ...p, elements: p.elements.map((e) => (e.id === elId ? { ...e, ...patch } : e)) }));
  }, [commit, pi]);

  /** 히스토리 기록 없는 실시간 수정 — 인라인 타이핑용 (undo 는 편집 시작 시 1회만 쌓음) */
  const patchElLive = useCallback((elId: string, patch: Partial<StudioElement>) => {
    setPages((prev) => prev.map((p, i) => i !== pi ? p : { ...p, elements: p.elements.map((e) => (e.id === elId ? { ...e, ...patch } : e)) }));
    setSaveState('dirty');
  }, [pi]);

  /** 텍스트 더블클릭 → 인라인 편집 시작 (undo 스냅샷 1회) */
  const beginEdit = useCallback((elId: string) => {
    histRef.current.push(JSON.stringify(pages));
    if (histRef.current.length > 60) histRef.current.shift();
    setSelIds([elId]);
    setEditingId(elId);
  }, [pages]);

  const addEl = useCallback((el: Omit<StudioElement, 'id' | 'z'>) => {
    const nid = uid();
    commit((prev) => prev.map((p, i) => {
      if (i !== pi) return p;
      const maxZ = p.elements.reduce((m, e) => Math.max(m, e.z ?? 0), 0);
      return { ...p, elements: [...p.elements, { ...el, id: nid, z: maxZ + 1 } as StudioElement] };
    }));
    setSelIds([nid]);
  }, [commit, pi]);

  /** 선택 요소 일괄 삭제 (잠긴 요소 제외) */
  const removeIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    commit((prev) => prev.map((p, i) => (i !== pi ? p : { ...p, elements: p.elements.filter((e) => !ids.includes(e.id) || e.locked === true) })));
    setSelIds([]);
  }, [commit, pi]);

  const removeEl = useCallback((elId: string) => {
    // 패널의 「삭제」는 의도적 동작이므로 잠금과 무관하게 삭제
    commit((prev) => prev.map((p, i) => (i !== pi ? p : { ...p, elements: p.elements.filter((e) => e.id !== elId) })));
    setSelIds([]);
  }, [commit, pi]);

  /** 요소 복제 — ids 전부 +5mm 오프셋으로 복제 후 복제본 선택 */
  const duplicateIds = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const newIds: string[] = [];
    commit((prev) => prev.map((p, i) => {
      if (i !== pi) return p;
      let z = p.elements.reduce((m, e) => Math.max(m, e.z ?? 0), 0);
      const copies = p.elements.filter((e) => ids.includes(e.id)).map((src) => {
        const nid = uid();
        newIds.push(nid);
        return { ...JSON.parse(JSON.stringify(src)), id: nid, x: src.x + 5, y: src.y + 5, z: ++z, locked: false } as StudioElement;
      });
      return { ...p, elements: [...p.elements, ...copies] };
    }));
    setSelIds(newIds);
  }, [commit, pi]);

  const duplicateEl = useCallback((elId: string) => duplicateIds([elId]), [duplicateIds]);

  /* ── 복사/붙여넣기 (페이지 간 이동 가능) ── */
  const clipboardRef = useRef<StudioElement[]>([]);
  const copySelection = useCallback(() => {
    const els = (page?.elements ?? []).filter((e) => selIds.includes(e.id));
    if (els.length === 0) return;
    clipboardRef.current = JSON.parse(JSON.stringify(els));
  }, [page, selIds]);
  const pasteClipboard = useCallback(() => {
    const clip = clipboardRef.current;
    if (clip.length === 0) return;
    const newIds: string[] = [];
    commit((prev) => prev.map((p, i) => {
      if (i !== pi) return p;
      let z = p.elements.reduce((m, e) => Math.max(m, e.z ?? 0), 0);
      const copies = clip.map((src) => {
        const nid = uid();
        newIds.push(nid);
        return { ...JSON.parse(JSON.stringify(src)), id: nid, x: src.x + 5, y: src.y + 5, z: ++z, locked: false } as StudioElement;
      });
      return { ...p, elements: [...p.elements, ...copies] };
    }));
    setSelIds(newIds);
  }, [commit, pi]);

  /* ── 빈 캔버스 드래그 = 범위 선택(마퀴) ── */
  const startMarquee = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return; // 요소 위 클릭은 각 요소가 처리
    const pr = pageDivRef.current?.getBoundingClientRect();
    if (!pr) return;
    e.stopPropagation();
    setEditingId(null);
    const sx = (e.clientX - pr.left) / S, sy = (e.clientY - pr.top) / S;
    let cur = { x: sx, y: sy, w: 0, h: 0 };
    setMarquee(cur);
    const onMove = (ev: PointerEvent) => {
      const px = (ev.clientX - pr.left) / S, py = (ev.clientY - pr.top) / S;
      cur = { x: Math.min(sx, px), y: Math.min(sy, py), w: Math.abs(px - sx), h: Math.abs(py - sy) };
      setMarquee(cur);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setMarquee(null);
      if (cur.w < 1.5 && cur.h < 1.5) { setSelIds([]); return; } // 단순 클릭 = 선택 해제
      const hit = (pageElsRef.current ?? [])
        .filter((el) => !el.locked && !(el.w >= A4_W * 0.95 && el.h >= A4_H * 0.95) // 전면 배경 제외
          && el.x < cur.x + cur.w && el.x + el.w > cur.x && el.y < cur.y + cur.h && el.y + el.h > cur.y)
        .map((el) => el.id);
      setSelIds(hit);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /* ── 정렬·분배 (다중 = 선택 묶음 기준, 단일 = 페이지 여백 기준) ── */
  const alignSel = useCallback((type: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => {
    const els = (page?.elements ?? []).filter((e) => selIds.includes(e.id) && !e.locked);
    if (els.length === 0) return;
    const single = els.length === 1;
    const L = single ? 15 : Math.min(...els.map((e) => e.x));
    const R = single ? 195 : Math.max(...els.map((e) => e.x + e.w));
    const T2 = single ? 15 : Math.min(...els.map((e) => e.y));
    const B = single ? 282 : Math.max(...els.map((e) => e.y + e.h));
    commit((prev) => prev.map((p, i) => i !== pi ? p : {
      ...p,
      elements: p.elements.map((x) => {
        if (!selIds.includes(x.id) || x.locked) return x;
        if (type === 'left') return { ...x, x: L };
        if (type === 'centerX') return { ...x, x: Math.round(((L + R) / 2 - x.w / 2) * 2) / 2 };
        if (type === 'right') return { ...x, x: R - x.w };
        if (type === 'top') return { ...x, y: T2 };
        if (type === 'centerY') return { ...x, y: Math.round(((T2 + B) / 2 - x.h / 2) * 2) / 2 };
        return { ...x, y: B - x.h };
      }),
    }));
  }, [page, selIds, commit, pi]);

  const distributeSel = useCallback((axis: 'h' | 'v') => {
    const els = (page?.elements ?? []).filter((e) => selIds.includes(e.id) && !e.locked);
    if (els.length < 3) return;
    const sorted = [...els].sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
    const first = sorted[0], last = sorted[sorted.length - 1];
    const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
    const total = sorted.reduce((sum, e) => sum + (axis === 'h' ? e.w : e.h), 0);
    const gap = (span - total) / (sorted.length - 1);
    const posMap = new Map<string, number>();
    let cur = axis === 'h' ? first.x : first.y;
    for (const e of sorted) { posMap.set(e.id, Math.round(cur * 2) / 2); cur += (axis === 'h' ? e.w : e.h) + gap; }
    commit((prev) => prev.map((p, i) => i !== pi ? p : {
      ...p,
      elements: p.elements.map((x) => (posMap.has(x.id) ? (axis === 'h' ? { ...x, x: posMap.get(x.id)! } : { ...x, y: posMap.get(x.id)! }) : x)),
    }));
  }, [page, selIds, commit, pi]);

  /** 잠금 일괄 설정 */
  const lockIds = useCallback((ids: string[], locked: boolean) => {
    commit((prev) => prev.map((p, i) => (i !== pi ? p : { ...p, elements: p.elements.map((e) => (ids.includes(e.id) ? { ...e, locked } : e)) })));
  }, [commit, pi]);

  /** 맨앞/맨뒤 — z 전체 재배열 (선택군을 쌓임 순서 끝으로) */
  const zExtremeIds = useCallback((ids: string[], dir: 1 | -1) => {
    commit((prev) => prev.map((p, i) => {
      if (i !== pi) return p;
      const sorted = [...p.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
      const picked = sorted.filter((e) => ids.includes(e.id));
      const rest = sorted.filter((e) => !ids.includes(e.id));
      const ordered = dir === 1 ? [...rest, ...picked] : [...picked, ...rest];
      const zMap = new Map(ordered.map((e, k) => [e.id, k]));
      return { ...p, elements: p.elements.map((e) => ({ ...e, z: zMap.get(e.id) ?? 0 })) };
    }));
  }, [commit, pi]);

  const zExtreme = (dir: 1 | -1) => { if (sel) zExtremeIds([sel.id], dir); };

  /** 레이어 패널 — 쌓임 순서에서 한 칸 위/아래 요소와 교환 */
  const moveLayer = useCallback((elId: string, dir: 1 | -1) => {
    commit((prev) => prev.map((p, i) => {
      if (i !== pi) return p;
      const sorted = [...p.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
      const idx = sorted.findIndex((e) => e.id === elId);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= sorted.length) return p;
      [sorted[idx], sorted[j]] = [sorted[j], sorted[idx]];
      const zMap = new Map(sorted.map((e, k) => [e.id, k]));
      return { ...p, elements: p.elements.map((e) => ({ ...e, z: zMap.get(e.id) ?? 0 })) };
    }));
  }, [commit, pi]);

  /* ── 드래그·리사이즈 (다중 선택 함께 이동, 잠긴 요소는 이동 제외) ── */
  const startDrag = (e: React.PointerEvent, elId: string, mode: DragMode) => {
    if (editingId === elId) return; // 인라인 편집 중엔 드래그 비활성
    e.stopPropagation(); e.preventDefault();
    const el = page?.elements.find((x) => x.id === elId);
    if (!el) return;

    // Shift+클릭 = 선택 토글(다중 선택), 드래그 시작 안 함
    if (e.shiftKey && mode === 'move') {
      setSelIds((prev) => (prev.includes(elId) ? prev.filter((x) => x !== elId) : [...prev, elId]));
      return;
    }
    // 선택 확정: 이미 선택군에 있으면 유지(그룹 드래그), 아니면 단일 선택
    const nextSel = selIds.includes(elId) ? selIds : [elId];
    setSelIds(nextSel);

    // 잠긴 요소는 선택만 하고 이동/리사이즈 없음
    if (el.locked) return;

    // 이동 대상: 선택군 중 잠기지 않은 요소들 (리사이즈는 primary 하나만)
    const items = (page?.elements ?? [])
      .filter((x) => nextSel.includes(x.id) && !x.locked)
      .map((x) => ({ id: x.id, ox: x.x, oy: x.y }));
    const pr = pageDivRef.current?.getBoundingClientRect();
    dragRef.current = {
      mode, elId, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h, items,
      ratio: el.kind === 'image' ? el.w / Math.max(0.1, el.h) : undefined,
      pl: pr?.left ?? 0, pt: pr?.top ?? 0,
    };
    histRef.current.push(JSON.stringify(pages));
    setDragging(true);
    setCtxMenu(null);

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current; if (!d) return;
      const dx = (ev.clientX - d.sx) / S, dy = (ev.clientY - d.sy) / S;
      const snap = (v: number) => Math.round(v * 2) / 2;

      if (d.mode === 'move') {
        // 스냅 가이드: 페이지 여백(15)·중앙 + 이동 중이 아닌 요소들의 에지·중앙 (primary 기준, 그룹은 같은 델타)
        const movingIds = new Set(d.items.map((it) => it.id));
        const tv: number[] = [15, A4_W / 2, A4_W - 15];
        const th: number[] = [15, A4_H / 2, 282];
        for (const o of pageElsRef.current) {
          if (movingIds.has(o.id)) continue;
          tv.push(o.x, o.x + o.w / 2, o.x + o.w);
          th.push(o.y, o.y + o.h / 2, o.y + o.h);
        }
        const rx = snapAxis(d.ox + dx, d.ow, tv);
        const ry = snapAxis(d.oy + dy, d.oh, th);
        const nx = rx.guide != null ? rx.pos : snap(d.ox + dx);
        const ny = ry.guide != null ? ry.pos : snap(d.oy + dy);
        const ddx = nx - d.ox, ddy = ny - d.oy;
        setGuides({ v: rx.guide != null ? [rx.guide] : [], h: ry.guide != null ? [ry.guide] : [] });
        setPages((prev) => prev.map((p, i) => i !== pi ? p : {
          ...p,
          elements: p.elements.map((x) => {
            const it = d.items.find((m) => m.id === x.id);
            return it ? { ...x, x: Math.round((it.ox + ddx) * 2) / 2, y: Math.round((it.oy + ddy) * 2) / 2 } : x;
          }),
        }));
      } else if (d.mode === 'rot') {
        // 회전 — 요소 중심 기준 포인터 각도 (90° 근처 4° 이내 자동 스냅)
        const cx = d.ox + d.ow / 2, cy = d.oy + d.oh / 2;
        const px = (ev.clientX - d.pl) / S, py = (ev.clientY - d.pt) / S;
        let deg = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
        deg = ((deg % 360) + 360) % 360;
        const near = (Math.round(deg / 90) * 90) % 360;
        if (Math.abs(deg - Math.round(deg / 90) * 90) <= 4) deg = near;
        deg = Math.round(deg * 10) / 10;
        setPages((prev) => prev.map((p, i) => i !== pi ? p : {
          ...p, elements: p.elements.map((x) => (x.id !== d.elId ? x : { ...x, rotation: deg })),
        }));
      } else {
        // 8방향 리사이즈 (이미지는 코너에서 비율 고정)
        const west = d.mode === 'w' || d.mode === 'nw' || d.mode === 'sw';
        const east = d.mode === 'e' || d.mode === 'ne' || d.mode === 'se';
        const north = d.mode === 'n' || d.mode === 'nw' || d.mode === 'ne';
        const south = d.mode === 's' || d.mode === 'sw' || d.mode === 'se';
        const corner = (west || east) && (north || south);
        let nx = d.ox, ny = d.oy, nw2 = d.ow, nh2 = d.oh;
        if (east) nw2 = Math.max(2, snap(d.ow + dx));
        if (south) nh2 = Math.max(1, snap(d.oh + dy));
        if (west) { nw2 = Math.max(2, snap(d.ow - dx)); nx = d.ox + (d.ow - nw2); }
        if (north) { nh2 = Math.max(1, snap(d.oh - dy)); ny = d.oy + (d.oh - nh2); }
        if (d.ratio && corner) {
          nh2 = Math.max(1, Math.round((nw2 / d.ratio) * 2) / 2);
          if (north) ny = d.oy + (d.oh - nh2);
        }
        setPages((prev) => prev.map((p, i) => i !== pi ? p : {
          ...p, elements: p.elements.map((x) => (x.id !== d.elId ? x : { ...x, x: nx, y: ny, w: nw2, h: nh2 })),
        }));
      }
      setSaveState('dirty');
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
      setGuides({ v: [], h: [] });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /* ── 키보드 ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (present) return; // 프레젠테이션 중엔 오버레이가 키를 처리
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClipboard(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelIds((pageElsRef.current ?? []).filter((x) => !x.locked && !(x.w >= A4_W * 0.95 && x.h >= A4_H * 0.95)).map((x) => x.id)); return; } // 전면 배경은 제외
      // 선택된 요소가 없을 때만 ← → (또는 PageUp/Down) 로 페이지 넘기기 (요소 선택 중이면 방향키=요소 이동)
      if (selIds.length === 0) {
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); setPi((p) => Math.max(0, p - 1)); setEditingId(null); return; }
        if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); setPi((p) => Math.min(pagesLenRef.current - 1, p + 1)); setEditingId(null); return; }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return; }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateIds(selIds); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeIds(selIds); return; }
      if (e.key === 'Escape') { setSelIds([]); setEditingId(null); setCtxMenu(null); return; }
      const step = e.shiftKey ? 5 : 1;
      const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (mv[e.key]) {
        e.preventDefault();
        const [dx, dy] = mv[e.key];
        commit((prev) => prev.map((p, i) => i !== pi ? p : {
          ...p,
          elements: p.elements.map((x) => (selIds.includes(x.id) && !x.locked ? { ...x, x: x.x + dx, y: x.y + dy } : x)),
        }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selIds, pi, commit, removeIds, duplicateIds, copySelection, pasteClipboard, undo, present]);

  /* ── 페이지 조작 (인덱스 기준 — 썸네일 개별 아이콘에서 호출) ── */
  const addPage = () => { commit((prev) => { const n = [...prev]; n.splice(pi + 1, 0, { id: uid(), elements: [] }); return n; }); setPi(pi + 1); };
  const dupPageAt = (idx: number) => {
    commit((prev) => {
      const n = [...prev];
      const copy: StudioPage = JSON.parse(JSON.stringify(prev[idx]));
      copy.id = uid(); copy.elements.forEach((e) => { e.id = uid(); });
      n.splice(idx + 1, 0, copy); return n;
    });
    setPi(idx + 1);
  };
  /** 페이지 삭제 — 1클릭 삭제 후 토스트로 Ctrl+Z 복구 안내 (썸네일 미니 아이콘) */
  const delPageAt = (idx: number) => {
    if (pages.length <= 1) { notify('마지막 페이지는 삭제할 수 없습니다.'); return; }
    commit((prev) => prev.filter((_, i) => i !== idx));
    setPi((p) => (idx < p ? p - 1 : Math.min(p, pages.length - 2)));
    notify('페이지를 삭제했어요 · Ctrl+Z 로 되돌리기');
  };
  /** 페이지 순서 이동 (썸네일 미니 화살표) */
  const movePageAt = (idx: number, dir: -1 | 1) => {
    const ni = idx + dir;
    if (ni < 0 || ni >= pages.length) return;
    commit((prev) => { const n = [...prev]; const [x] = n.splice(idx, 1); n.splice(ni, 0, x); return n; });
    setPi(ni);
  };
  /** 페이지 넘기기(보기 이동) — 선택 썸네일이 보이도록 스크롤 */
  const gotoPage = (idx: number) => {
    const ni = Math.max(0, Math.min(pages.length - 1, idx));
    setPi(ni); setSelIds([]); setEditingId(null);
  };

  /* ── 툴바: 요소 추가 ── */
  const addText = () => addEl({ kind: 'text', x: 20, y: 30, w: 120, h: 14, text: '텍스트를 입력하세요', fontSize: 12, color: '#111111', lineHeight: 1.35, align: 'left' });
  const addRect = () => addEl({ kind: 'rect', x: 20, y: 30, w: 80, h: 40, fill: '#f1f5f9', borderColor: '#94a3b8', borderWidth: 0.3, radius: 2 });
  const addLine = () => addEl({ kind: 'line', x: 20, y: 30, w: 170, h: 1, fill: '#334155', borderWidth: 0 });
  /** QR 폼 제출 — prompt() 대체 (임베디드 브라우저에서 prompt 차단됨) */
  const submitQr = () => {
    const url = qrForm.url.trim();
    if (!url) { notify('QR로 연결할 주소(URL)를 입력해주세요.'); return; }
    const label = qrForm.label.trim();
    addEl({ kind: 'qr', x: 165, y: 240, w: 30, h: label ? 36 : 30, qrUrl: url, qrLabel: label });
    setQrForm((f) => ({ ...f, url: '' }));
    notify('QR을 추가했어요.');
  };
  const insertCoverTemplate = (template: CoverTemplateId) => {
    const cover = buildCoverPage({ title: title || '특강 교재', subtitle: '부제를 입력하세요', level: (['기초', '심화', '고난도'].includes(difficulty) ? difficulty : '기초') as StudioDifficulty, template });
    commit((prev) => { const n = [...prev]; n.splice(0, 0, cover); return n; });
    setPi(0);
    notify('표지를 맨 앞에 추가했어요.');
  };
  const pickImage = (mode: 'element' | 'cover') => { fileModeRef.current = mode; fileRef.current?.click(); };

  /** URL 이미지 삽입 — 자연 크기 기준 자동 크기(요소) 또는 전체 표지 */
  const insertImageFromUrl = useCallback((url: string, mode: 'element' | 'cover') => {
    const img = new Image();
    img.onload = () => {
      if (mode === 'cover') { addEl({ kind: 'image', x: 0, y: 0, w: A4_W, h: A4_H, src: url }); return; }
      const natWmm = (img.naturalWidth / 96) * 25.4, natHmm = (img.naturalHeight / 96) * 25.4;
      const w = Math.min(120, Math.max(20, natWmm));
      const h = Math.max(10, (natHmm / natWmm) * w);
      addEl({ kind: 'image', x: 25, y: 40, w: Math.round(w), h: Math.round(h), src: url });
    };
    img.src = url;
  }, [addEl]);

  /** 업로드 이미지를 전체 페이지로 하는 표지 페이지를 맨 앞에 추가 (사진·PDF 표지 공용) */
  const insertCoverImagePage = (url: string) => {
    commit((prev) => {
      const cover: StudioPage = { id: uid(), elements: [{ id: uid(), kind: 'image', x: 0, y: 0, w: A4_W, h: A4_H, z: 1, src: url }] };
      return [cover, ...prev];
    });
    setPi(0);
    notify('표지를 맨 앞 페이지로 추가했어요.');
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    let f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const mode = fileModeRef.current;
    // PDF 표지 → 클라이언트에서 1페이지를 이미지로 변환한 뒤 기존 이미지 업로드 흐름 재사용
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')) {
      notify('PDF를 이미지로 변환하는 중…');
      try {
        const conv = await pdfFileToImage(f);
        f = conv.file;
        if (conv.pageCount > 1) notify(`PDF ${conv.pageCount}페이지 중 1페이지를 사용해요.`);
      } catch (err) {
        console.error('pdf cover convert:', err);
        notify('PDF 변환에 실패했어요. PNG/JPG로 내보내서 올려주세요.');
        return;
      }
    }
    const fd = new FormData(); fd.append('file', f);
    const d = await fetch('/api/my/vip/materials/studio/upload', { method: 'POST', credentials: 'include', body: fd }).then((r) => r.json()).catch(() => null);
    if (!d?.ok) { notify(d?.error || '업로드에 실패했어요.'); return; }
    if (mode === 'cover') insertCoverImagePage(d.url as string);
    else insertImageFromUrl(d.url, 'element');
    // 보관함이 이미 로드돼 있으면 맨 앞에 추가
    setImgLib((lib) => (lib ? [{ name: String(d.url).split('/').pop() || '', url: d.url as string }, ...lib] : lib));
  };

  /** 왼쪽 플라이아웃 패널 토글 — 같은 도구 다시 누르면 닫힘. 이미지 열 때 보관함 최초 1회 로드 */
  const toggleFlyout = (which: 'text' | 'image' | 'qr' | 'cover' | 'classkit') => {
    setFlyout((prev) => (prev === which ? null : which));
    if (which === 'image' && imgLib === null) {
      fetch('/api/my/vip/materials/studio/upload', { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => setImgLib(d?.ok && Array.isArray(d.items) ? d.items : []))
        .catch(() => setImgLib([]));
    }
    if (which === 'classkit' && ckTextbooks === null) {
      fetch('/api/class-kit/passages/textbooks', { credentials: 'include' })
        .then((r) => r.json())
        .then((d) => setCkTextbooks(Array.isArray(d?.textbooks) ? d.textbooks : []))
        .catch(() => setCkTextbooks([]));
    }
  };

  /** 클래스키트 교재 선택 → 지문 목록 로드 */
  const loadCkPassages = useCallback((textbook: string) => {
    setCkTextbook(textbook);
    setCkPassages(null);
    if (!textbook) return;
    fetch(`/api/class-kit/passages?textbook=${encodeURIComponent(textbook)}&limit=500`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setCkPassages(Array.isArray(d?.items) ? (d.items as CkPassage[]) : []))
      .catch(() => setCkPassages([]));
  }, []);

  /** dataURL/blob 이미지 하나를 업로드 → 방향(가로=fit-width 중앙, 세로=전면) 페이지로 현재 문서 뒤에 삽입.
   *  여러 장이면 각각 새 페이지. 첫 삽입 위치로 pi 이동. */
  const insertImagePagesAfter = async (sources: (string | Blob)[], landscape: boolean, namePrefix: string): Promise<number> => {
    const urls: string[] = [];
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
      const fd = new FormData();
      fd.append('file', new File([blob], `${namePrefix}_${Date.now()}_${i}.png`, { type: 'image/png' }));
      const up = await fetch('/api/my/vip/materials/studio/upload', { method: 'POST', credentials: 'include', body: fd }).then((r) => r.json()).catch(() => null);
      if (up?.ok) urls.push(up.url as string);
    }
    if (urls.length === 0) return 0;
    commit((prev) => {
      const dispH = +(A4_W * (210 / 297)).toFixed(1); // 가로 A4(297×210)를 폭 210mm 에 맞췄을 때 높이 ≈148.5
      const pages: StudioPage[] = urls.map((url) => {
        // 가로 자료는 페이지 폭에 맞춰 세로 중앙 배치, 세로는 전면
        const el = landscape
          ? { id: uid(), kind: 'image' as const, x: 0, y: +((A4_H - dispH) / 2).toFixed(1), w: A4_W, h: dispH, z: 1, src: url }
          : { id: uid(), kind: 'image' as const, x: 0, y: 0, w: A4_W, h: A4_H, z: 1, src: url };
        return { id: uid(), elements: [el] };
      });
      const n = [...prev];
      n.splice(pi + 1, 0, ...pages);
      return n;
    });
    setPi((cur) => cur + 1);
    return urls.length;
  };

  /** 클래스키트 자료(5종)를 서버에서 A4 PNG 로 렌더 → 페이지로 현재 문서에 삽입 */
  const insertClassKitMaterial = async (p: CkPassage) => {
    if (ckBusy) return;
    const en = p.content?.sentences_en?.filter((s) => s && s.trim()) ?? [];
    const ko = p.content?.sentences_ko ?? [];
    if (en.length === 0) { notify('이 지문에는 문장 데이터가 없어요.'); return; }
    setCkBusy(true);
    const label = [p.chapter, p.number].filter(Boolean).join(' ') || p.source_key || '자료';
    const typeLabel = CK_TYPES.find((t) => t.key === ckType)?.label ?? '자료';
    notify(`${typeLabel} 생성 중…`);
    try {
      const sentences = en.map((e, i) => ({ en: e, ko: ko[i] ?? '' }));
      const res = await fetch('/api/my/vip/materials/studio/classkit-image', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: ckType, title: ckTextbook, number: String(p.number ?? ''), sentences }),
      }).then((r) => r.json()).catch(() => null);
      if (!res?.ok || !Array.isArray(res.images) || res.images.length === 0) { notify('자료 생성에 실패했어요.'); setCkBusy(false); return; }
      const added = await insertImagePagesAfter(res.images as string[], !!res.landscape, `ck_${ckType}`);
      if (added === 0) { notify('자료 업로드에 실패했어요.'); setCkBusy(false); return; }
      notify(`「${label}」 ${typeLabel} ${added > 1 ? `${added}쪽 ` : ''}넣었어요.`);
    } catch (err) {
      console.error('classkit import:', err);
      notify('자료 불러오기에 실패했어요.');
    }
    setCkBusy(false);
  };

  /** 로컬 PDF 파일 → 모든 페이지를 이미지로 현재 문서 뒤에 삽입 (클라 pdfjs, 페이지별 타임아웃 가드) */
  const pdfImportRef = useRef<HTMLInputElement>(null);
  const [pdfImporting, setPdfImporting] = useState(false);
  const onLocalPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { notify('PDF 파일만 가능해요.'); return; }
    setPdfImporting(true);
    notify('PDF를 페이지 이미지로 변환 중…');
    try {
      const modUrl = '/vendor/pdfjs/pdf.min.mjs';
      const pdfjs = (await import(/* webpackIgnore: true */ modUrl)) as PdfJsLib;
      pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
      const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
      const N = Math.min(50, doc.numPages);
      const blobs: Blob[] = [];
      let firstLandscape = false;
      for (let i = 1; i <= N; i++) {
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        if (i === 1) firstLandscape = base.width > base.height;
        const scale = Math.min(3, 1654 / base.width);
        const vp = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        // 페이지별 20초 타임아웃 가드 — 일부 PDF 는 render 가 멈출 수 있음
        const rendered = await Promise.race([
          page.render({ canvas, viewport: vp }).promise.then(() => true),
          new Promise<boolean>((r) => setTimeout(() => r(false), 20000)),
        ]);
        if (!rendered) { notify(`${i}쪽 변환이 지연돼 건너뛰었어요.`); continue; }
        const b = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
        if (b) blobs.push(b);
      }
      doc.destroy().catch(() => {});
      if (blobs.length === 0) { notify('PDF 변환에 실패했어요.'); setPdfImporting(false); return; }
      const added = await insertImagePagesAfter(blobs, firstLandscape, 'pdf');
      notify(added > 0 ? `PDF ${added}쪽을 넣었어요.` : 'PDF 삽입에 실패했어요.');
    } catch (err) {
      console.error('local pdf import:', err);
      notify('PDF 불러오기에 실패했어요.');
    }
    setPdfImporting(false);
  };

  /* ── 이미지 내보내기 (PNG/JPG) — 현재 페이지를 SVG foreignObject → canvas 로 ── */
  const exportImage = async (fmt: 'png' | 'jpeg') => {
    if (!page || exporting) return;
    setExporting(true);
    try {
      const E = 8; // px/mm ≈ 203dpi (A4 = 1680×2376)
      const srcMap = new Map<string, string>();
      for (const el of page.elements) {
        if (el.kind === 'image' && el.src && !srcMap.has(el.src)) {
          try { srcMap.set(el.src, await toDataUrl(el.src)); } catch { /* 실패한 이미지는 생략 */ }
        } else if (el.kind === 'qr' && el.qrUrl && !srcMap.has(`qr:${el.qrUrl}`)) {
          try { srcMap.set(`qr:${el.qrUrl}`, await QRCode.toDataURL(el.qrUrl, { margin: 0, width: 512 })); } catch { /* 생략 */ }
        }
      }
      const W = Math.round(A4_W * E), H = Math.round(A4_H * E);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;height:${H}px;position:relative;background:#ffffff;overflow:hidden">${pageToXhtml(page, pi + 1, E, srcMap)}</div></foreignObject></svg>`;
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('svg render'));
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      });
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.92));
      if (!blob) throw new Error('encode');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${title || '교재'}-${pi + 1}p.${fmt === 'png' ? 'png' : 'jpg'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      notify('이미지 저장에 실패했어요. PDF 다운로드를 이용해주세요.');
    }
    setExporting(false);
  };

  /* ── PPT(.pptx) 가져오기 — 슬라이드를 페이지로 변환 (텍스트·이미지·단색 도형·배경) ── */
  const pptxRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const importPptx = async (f: File) => {
    if (importing) return;
    setImporting(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      const parser = new DOMParser();
      const readXml = async (p: string) => {
        const zf = zip.file(p);
        if (!zf) return null;
        return parser.parseFromString(await zf.async('string'), 'application/xml');
      };
      /** 네임스페이스 프리픽스 무시하고 localName 으로 수집 */
      const byLocal = (root: ParentNode | Element | null, name: string): Element[] =>
        root ? [...(root as Element).getElementsByTagName('*')].filter((n) => n.localName === name) : [];
      const round2 = (v: number) => Math.round(v * 100) / 100;

      // 슬라이드 크기 (EMU → mm) → A4 맞춤 스케일(비율 유지, 중앙)
      const pres = await readXml('ppt/presentation.xml');
      if (!pres) throw new Error('not pptx');
      const sldSz = byLocal(pres, 'sldSz')[0];
      const slideW = parseInt(sldSz?.getAttribute('cx') ?? '12192000', 10) / 36000;
      const slideH = parseInt(sldSz?.getAttribute('cy') ?? '6858000', 10) / 36000;
      const SC = Math.min(A4_W / slideW, A4_H / slideH);
      const offX = (A4_W - slideW * SC) / 2, offY = (A4_H - slideH * SC) / 2;

      // 슬라이드 순서 (sldIdLst → rels 경로)
      const presRels = await readXml('ppt/_rels/presentation.xml.rels');
      const relMap: Record<string, string> = {};
      for (const rel of byLocal(presRels, 'Relationship')) relMap[rel.getAttribute('Id') ?? ''] = rel.getAttribute('Target') ?? '';
      const slidePaths = byLocal(pres, 'sldId')
        .map((n) => relMap[n.getAttribute('r:id') ?? ''])
        .filter((t) => !!t)
        .map((t) => 'ppt/' + t.replace(/^(\.\.\/)+|^\//g, ''));
      if (slidePaths.length === 0) throw new Error('no slides');

      const newPages: StudioPage[] = [];
      const stats = { texts: 0, images: 0, rects: 0, skipped: 0 };
      const uploadCache = new Map<string, string>();

      for (const sp2 of slidePaths) {
        const sxml = await readXml(sp2);
        if (!sxml) continue;
        const srels = await readXml(sp2.replace(/slides\//, 'slides/_rels/') + '.rels');
        const srelMap: Record<string, string> = {};
        for (const rel of byLocal(srels, 'Relationship')) srelMap[rel.getAttribute('Id') ?? ''] = rel.getAttribute('Target') ?? '';

        const els: StudioElement[] = [];
        let z = 0;
        // 슬라이드 배경(단색)은 잠긴 전면 상자로
        const bgClr = byLocal(byLocal(sxml, 'bg')[0] ?? null, 'srgbClr')[0];
        if (bgClr) els.push({ id: uid(), kind: 'rect', x: 0, y: 0, w: A4_W, h: A4_H, z: z++, fill: `#${bgClr.getAttribute('val')}`, locked: true });

        const spTree = byLocal(sxml, 'spTree')[0];
        if (!spTree) { newPages.push({ id: uid(), elements: els }); continue; }
        for (const node of [...spTree.children]) {
          if (node.localName !== 'sp' && node.localName !== 'pic') continue;
          const xfrm = byLocal(node, 'xfrm')[0];
          const off = byLocal(xfrm ?? null, 'off')[0];
          const ext = byLocal(xfrm ?? null, 'ext')[0];
          if (!off || !ext) { stats.skipped++; continue; }
          const x = offX + (parseInt(off.getAttribute('x') ?? '0', 10) / 36000) * SC;
          const y = offY + (parseInt(off.getAttribute('y') ?? '0', 10) / 36000) * SC;
          const w = (parseInt(ext.getAttribute('cx') ?? '0', 10) / 36000) * SC;
          const h = (parseInt(ext.getAttribute('cy') ?? '0', 10) / 36000) * SC;
          if (w < 0.5 || h < 0.5) { stats.skipped++; continue; }

          if (node.localName === 'pic') {
            // 그림 — media 를 내 보관함에 업로드해 요소로 (문서가 가벼워지고 PDF 에서도 동작)
            const rid = byLocal(node, 'blip')[0]?.getAttribute('r:embed');
            const target = rid ? srelMap[rid] : null;
            if (!target) { stats.skipped++; continue; }
            const mediaPath = 'ppt/' + target.replace(/^(\.\.\/)+|^\//g, '');
            let url = uploadCache.get(mediaPath);
            if (!url) {
              const extName = (mediaPath.split('.').pop() ?? '').toLowerCase();
              const mf = zip.file(mediaPath);
              if (!mf || !['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extName)) { stats.skipped++; continue; }
              const blob = await mf.async('blob');
              const fd = new FormData();
              fd.append('file', new File([blob], `pptx-${Date.now()}-${stats.images}.${extName}`, { type: `image/${extName === 'jpg' ? 'jpeg' : extName}` }));
              const d = await fetch('/api/my/vip/materials/studio/upload', { method: 'POST', credentials: 'include', body: fd }).then((r) => r.json()).catch(() => null);
              if (!d?.ok) { stats.skipped++; continue; }
              url = d.url as string;
              uploadCache.set(mediaPath, url);
            }
            els.push({ id: uid(), kind: 'image', x: round2(x), y: round2(y), w: round2(w), h: round2(h), z: z++, src: url });
            stats.images++;
          } else {
            const text = byLocal(node, 'p')
              .map((par) => byLocal(par, 't').map((t) => t.textContent ?? '').join(''))
              .join('\n')
              .replace(/\n+$/, '');
            if (text.trim()) {
              const rPr = byLocal(node, 'rPr')[0];
              const szAttr = rPr?.getAttribute('sz');
              const fontSize = round2(Math.min(96, Math.max(5, (szAttr ? parseInt(szAttr, 10) / 100 : 18) * SC)));
              const clr = byLocal(rPr ?? null, 'srgbClr')[0];
              const algn = byLocal(node, 'pPr')[0]?.getAttribute('algn');
              const base = {
                id: uid(), kind: 'text' as const, z: z++, text, fontSize,
                color: clr ? `#${clr.getAttribute('val')}` : '#111111',
                bold: rPr?.getAttribute('b') === '1',
                lineHeight: 1.25,
              };
              const vert = byLocal(node, 'bodyPr')[0]?.getAttribute('vert');
              if (vert && vert !== 'horz') {
                // 세로쓰기 → 박스를 눕히고 90° 회전 (중심 유지)
                const cx = x + w / 2, cy = y + h / 2;
                els.push({ ...base, x: round2(cx - h / 2), y: round2(cy - w / 2), w: round2(h), h: round2(w), align: 'left', rotation: 90 });
              } else {
                els.push({ ...base, x: round2(x), y: round2(y), w: round2(w), h: round2(h), align: algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : 'left' });
              }
              stats.texts++;
            } else {
              // 텍스트 없는 도형 — 단색 채움만 상자로 (그 외는 생략)
              const fill = byLocal(byLocal(node, 'spPr')[0] ?? null, 'srgbClr')[0];
              if (!fill) { stats.skipped++; continue; }
              const prst = byLocal(node, 'prstGeom')[0]?.getAttribute('prst') ?? '';
              els.push({ id: uid(), kind: 'rect', x: round2(x), y: round2(y), w: round2(w), h: round2(h), z: z++, fill: `#${fill.getAttribute('val')}`, radius: /round|ellipse/i.test(prst) ? 2 : 0 });
              stats.rects++;
            }
          }
        }
        newPages.push({ id: uid(), elements: els });
      }

      if (newPages.every((p) => p.elements.length === 0)) { notify('가져올 수 있는 내용을 찾지 못했어요.'); setImporting(false); return; }
      const firstNew = pages.length;
      commit((prev) => [...prev, ...newPages]);
      setPi(firstNew);
      setSelIds([]);
      notify(`PPT ${newPages.length}장 가져오기 완료 — 텍스트 ${stats.texts}·이미지 ${stats.images}·도형 ${stats.rects}${stats.skipped ? ` (미지원 요소 ${stats.skipped}개 생략)` : ''}`);
    } catch {
      notify('PPT 가져오기에 실패했어요. (.pptx 파일인지 확인해주세요)');
    }
    setImporting(false);
  };

  /* ── 문제 삽입 — 페이지 하단을 넘으면 새 페이지를 만들어 자동 분배 ── */
  const insertQuestions = (qs: FullQ[], withAnswer: boolean) => {
    if (!page) return;
    let baseNum = 0;
    for (const p of pages) for (const e of p.elements) if (e.kind === 'question' && e.q?.num) baseNum = Math.max(baseNum, e.q.num);

    const TOP = 15;    // 새 페이지 시작 y (mm)
    const LIMIT = 282; // 하단 한계 — 넘으면 다음 페이지로 (A4 297 − 여백)
    const next: StudioPage[] = JSON.parse(JSON.stringify(pages));
    let pageIdx = pi;
    let y = Math.max(TOP, next[pageIdx].elements.reduce((m, e) => Math.max(m, e.y + e.h), 0) + 4);
    let z = next[pageIdx].elements.reduce((m, e) => Math.max(m, e.z ?? 0), 0);
    let lastId: string | null = null;

    qs.forEach((q, k) => {
      const paraLines = Math.ceil((q.paragraph?.length ?? 0) / 85);
      const h = Math.min(230, 14 + paraLines * 4.6 + q.options.filter((o) => o.trim()).length * 6 + (withAnswer ? 8 : 0));
      if (y + h > LIMIT) {
        pageIdx += 1;
        next.splice(pageIdx, 0, { id: uid(), elements: [] });
        y = TOP;
        z = 0;
      }
      lastId = uid();
      next[pageIdx].elements.push({
        id: lastId, kind: 'question', x: 15, y, w: 180, h, z: ++z, fontSize: 10,
        q: { qid: q.qid, serial: q.serial, type: q.type, num: baseNum + k + 1, question: q.question, paragraph: q.paragraph, options: q.options, answer: q.answer, explanation: q.explanation, showAnswer: withAnswer },
      });
      y += h + 4;
    });

    commit(next);
    setPi(pageIdx);       // 마지막으로 배치된 페이지로 이동
    setSelIds(lastId ? [lastId] : []);
    setQModal(false);
  };

  if (loading) return <div className="p-16 text-center"><div className="w-7 h-7 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-3 select-none">
      {/* 상단 툴바 — 제목·저장 상태 + 보기·내보내기 (삽입 도구는 왼쪽 레일로 정리) */}
      {/* ⚠️ backdrop-blur(필터)는 내부 fixed 오버레이의 기준을 툴바로 바꿔 클릭닫힘이 깨짐 — 불투명 배경으로 대체 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-900/95 border border-zinc-800/80 px-3 py-2 sticky top-0 z-30">
        <button onClick={() => router.push('/my/vip/materials/studio')} className="text-zinc-500 hover:text-zinc-200 text-sm px-1">←</button>
        <input value={title} onChange={(e) => { setTitle(e.target.value); setSaveState('dirty'); }}
          className="px-2.5 py-1.5 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100 font-semibold w-56" />
        <span className={`text-[11px] ${saveState === 'saved' ? 'text-emerald-400/80' : saveState === 'saving' ? 'text-amber-300/80' : 'text-zinc-500'}`}>
          {saveState === 'saved' ? '✓ 저장됨' : saveState === 'saving' ? '저장 중…' : '수정됨'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={undo} className="tb" title="Ctrl+Z">↩ 되돌리기</button>
          <button onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))} className="tb">－</button>
          <span className="text-[11px] text-zinc-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.15) * 100) / 100))} className="tb">＋</button>
          <button onClick={() => fitZoom()} className="tb" title="캔버스 폭에 맞춤 (트랙패드 핀치로도 확대·축소)">맞춤</button>
          <button onClick={() => setPresent(true)} className="tb" title="전체화면 프레젠테이션 — ←→ 페이지 넘김, Esc 종료">▶ 발표</button>
          <div className="relative">
            <button onClick={() => setDlMenu((v) => !v)} disabled={exporting}
              className="px-3 py-1.5 rounded-lg bg-rose-600/80 text-zinc-100 text-[12px] font-semibold hover:bg-rose-500 disabled:opacity-50">
              {exporting ? '내보내는 중…' : '⬇ 다운로드 ▾'}
            </button>
            {dlMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDlMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-50 rounded-xl bg-zinc-900 border border-zinc-700/70 shadow-xl p-1.5 w-60">
                  <a href={`/api/my/vip/materials/studio/${id}/pdf`} onClick={() => setDlMenu(false)} className="block px-3 py-2 rounded-lg hover:bg-zinc-800">
                    <span className="text-[12.5px] font-semibold text-zinc-100">📄 PDF — 전체 페이지</span>
                    <span className="block text-[10.5px] text-zinc-500 mt-0.5">인쇄·배포용, 레이아웃 그대로</span>
                  </a>
                  <button onClick={() => { setDlMenu(false); exportImage('png'); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-800">
                    <span className="text-[12.5px] font-semibold text-zinc-100">🖼 PNG — 현재 페이지</span>
                    <span className="block text-[10.5px] text-zinc-500 mt-0.5">고화질 이미지 — 카톡·공지 공유</span>
                  </button>
                  <button onClick={() => { setDlMenu(false); exportImage('jpeg'); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-zinc-800">
                    <span className="text-[12.5px] font-semibold text-zinc-100">🖼 JPG — 현재 페이지</span>
                    <span className="block text-[10.5px] text-zinc-500 mt-0.5">용량 작은 이미지</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,.pdf" onChange={onFile} className="hidden" />
      <input ref={pptxRef} type="file" accept=".pptx" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importPptx(f); }} />
      <input ref={pdfImportRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={onLocalPdf} />

      <div className={`grid gap-3 items-start ${flyout ? 'grid-cols-[64px_262px_minmax(0,1fr)_280px]' : 'grid-cols-[64px_minmax(0,1fr)_280px]'}`}>
        {/* 왼쪽 도구 레일 — 클릭하면 옆에 패널이 펼쳐짐 (미리캔버스식) */}
        <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/80 p-1 flex flex-col gap-0.5">
          <button onClick={() => toggleFlyout('text')} className={`rlb ${flyout === 'text' ? 'rlb-on' : ''}`}><b>Ｔ</b><span>텍스트</span></button>
          <button onClick={() => toggleFlyout('image')} className={`rlb ${flyout === 'image' ? 'rlb-on' : ''}`}><b>🖼</b><span>이미지</span></button>
          <button onClick={() => toggleFlyout('qr')} className={`rlb ${flyout === 'qr' ? 'rlb-on' : ''}`}><b>▣</b><span>QR</span></button>
          <button onClick={addRect} className="rlb"><b>▢</b><span>상자</span></button>
          <button onClick={addLine} className="rlb"><b>―</b><span>구분선</span></button>
          <button onClick={() => addEl({ kind: 'text', x: 175, y: 288, w: 20, h: 6, text: '{{page}}', fontSize: 10, align: 'right', color: '#6b7280', lineHeight: 1.2 })} className="rlb" title="인쇄 시 실제 페이지 번호로 바뀌는 텍스트를 추가합니다"><b>＃</b><span>쪽번호</span></button>
          <div className="my-0.5 h-px bg-zinc-800" />
          <button onClick={() => setQModal(true)} className="rlb !text-violet-300" title="내 문제은행에서 문제 불러오기"><b>📚</b><span>문제</span></button>
          <button onClick={() => toggleFlyout('classkit')} className={`rlb !text-emerald-300 ${flyout === 'classkit' ? 'rlb-on' : ''}`} title="클래스키트 강의용·수업용자료를 페이지로 불러오기"><b>📥</b><span>자료</span></button>
          <button onClick={() => toggleFlyout('cover')} className={`rlb ${flyout === 'cover' ? 'rlb-on' : ''}`} title="표지 템플릿 삽입"><b>📕</b><span>표지</span></button>
          <button onClick={() => pickImage('cover')} className="rlb" title="이미지·PDF 표지를 맨 앞 페이지로"><b>🏞</b><span>사진표지</span></button>
          <div className="my-0.5 h-px bg-zinc-800" />
          <button onClick={() => pptxRef.current?.click()} disabled={importing} className="rlb !text-sky-300"
            title="PPT(.pptx) 슬라이드를 페이지로 가져오기 — 텍스트·이미지·단색 도형·배경 지원">
            {importing
              ? <span className="w-3.5 h-3.5 border-2 border-sky-400/40 border-t-sky-300 rounded-full animate-spin" />
              : <b>📽</b>}
            <span>{importing ? '가져오는중' : 'PPT'}</span>
          </button>
          <button onClick={() => pdfImportRef.current?.click()} disabled={pdfImporting} className="rlb !text-rose-300"
            title="로컬 PDF 파일의 모든 페이지를 이미지 페이지로 가져오기">
            {pdfImporting
              ? <span className="w-3.5 h-3.5 border-2 border-rose-400/40 border-t-rose-300 rounded-full animate-spin" />
              : <b>📄</b>}
            <span>{pdfImporting ? '가져오는중' : 'PDF'}</span>
          </button>
        </div>

        {/* 왼쪽 도킹 플라이아웃 패널 — 레일 도구를 누르면 여기서 펼쳐짐 */}
        {flyout && (
          <div className="rounded-xl bg-zinc-900/70 border border-zinc-800/80 flex flex-col max-h-[64vh]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/80 shrink-0">
              <h3 className="text-[12.5px] font-bold text-zinc-100">
                {flyout === 'text' ? 'Ｔ 텍스트' : flyout === 'image' ? '🖼 이미지' : flyout === 'qr' ? '▣ QR 코드' : flyout === 'classkit' ? '📥 자료 불러오기' : '📕 표지 템플릿'}
              </h3>
              <button onClick={() => setFlyout(null)} className="text-zinc-500 hover:text-zinc-200 text-base leading-none px-1" title="패널 닫기">×</button>
            </div>
            <div className="p-2.5 overflow-y-auto">
              {flyout === 'text' && (
                <div className="space-y-1.5">
                  <button onClick={() => addEl({ kind: 'text', x: 20, y: 25, w: 170, h: 13, text: '제목을 입력하세요', fontSize: 20, bold: true, color: '#111111', lineHeight: 1.25, align: 'left' })}
                    className="w-full text-left px-3 py-3 rounded-lg bg-zinc-800/70 hover:bg-zinc-800 text-zinc-100 font-bold text-[18px]">제목 추가</button>
                  <button onClick={() => addEl({ kind: 'text', x: 20, y: 40, w: 170, h: 9, text: '소제목을 입력하세요', fontSize: 14, bold: true, color: '#374151', lineHeight: 1.3, align: 'left' })}
                    className="w-full text-left px-3 py-2.5 rounded-lg bg-zinc-800/70 hover:bg-zinc-800 text-zinc-200 font-semibold text-[14px]">소제목 추가</button>
                  <button onClick={addText}
                    className="w-full text-left px-3 py-2.5 rounded-lg bg-zinc-800/70 hover:bg-zinc-800 text-zinc-400 text-[12px]">본문 텍스트 추가</button>
                  <p className="text-[10.5px] text-zinc-600 px-1 pt-1 leading-relaxed">추가한 뒤 <b className="text-zinc-500">더블클릭</b>하면 바로 편집돼요. 크기·색·정렬은 오른쪽 속성에서.</p>
                </div>
              )}
              {flyout === 'image' && (
                <div className="space-y-2">
                  <button onClick={() => pickImage('element')}
                    className="w-full px-3 py-2.5 rounded-lg bg-emerald-600/25 hover:bg-emerald-600/40 text-emerald-200 text-[12.5px] font-semibold">＋ 새 이미지 업로드</button>
                  <p className="text-[10.5px] text-zinc-500 pt-0.5">보관함 — 전에 올린 이미지 다시 쓰기</p>
                  {imgLib === null ? (
                    <div className="p-4 text-center"><div className="w-4 h-4 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
                  ) : imgLib.length === 0 ? (
                    <p className="text-[11px] text-zinc-600 px-1 py-2">아직 업로드한 이미지가 없어요.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-1.5">
                      {imgLib.map((it) => (
                        <button key={it.url} onClick={() => insertImageFromUrl(it.url, 'element')}
                          className="rounded-md overflow-hidden border border-zinc-700 hover:border-amber-400/70 bg-zinc-800 aspect-square" title={it.name}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={it.url} alt="" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {flyout === 'qr' && (
                <div className="space-y-2">
                  <label className="block text-[10.5px] text-zinc-500">연결할 주소(URL) — 강의 영상, 추가 문제 링크
                    <input autoFocus value={qrForm.url} onChange={(e) => setQrForm((f) => ({ ...f, url: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitQr(); }}
                      placeholder="https://…" className="prop-in mt-1" />
                  </label>
                  <label className="block text-[10.5px] text-zinc-500">아래 표시할 설명 (선택)
                    <input value={qrForm.label} onChange={(e) => setQrForm((f) => ({ ...f, label: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitQr(); }}
                      className="prop-in mt-1" />
                  </label>
                  <button onClick={submitQr} className="w-full px-3 py-2 rounded-lg bg-violet-600/80 text-zinc-100 text-[12px] font-semibold hover:bg-violet-500">▣ QR 추가</button>
                </div>
              )}
              {flyout === 'cover' && (
                <div className="space-y-2">
                  <p className="text-[10.5px] text-zinc-500 px-0.5">고르면 새 1페이지로 맨 앞에 삽입돼요 (모든 요소 수정 가능)</p>
                  {COVER_TEMPLATES.map((t) => (
                    <button key={t.id} onClick={() => insertCoverTemplate(t.id)}
                      className="w-full rounded-xl border border-zinc-700/70 hover:border-amber-400/70 overflow-hidden text-left transition-colors flex items-stretch gap-2.5">
                      <div className="bg-white relative shrink-0" style={{ width: 62, aspectRatio: '210/297' }}>
                        {t.id === 'classic' && (<>
                          <div className="absolute inset-x-0 top-0 bg-blue-600" style={{ height: '25%' }} />
                          <div className="absolute bg-white/80 rounded" style={{ left: '10%', top: '8%', width: '45%', height: '4%' }} />
                          <div className="absolute bg-blue-600 rounded-full" style={{ left: '10%', top: '33%', width: '22%', height: '4.5%' }} />
                          <div className="absolute bg-zinc-200 rounded" style={{ left: '10%', top: '44%', width: '60%', height: '2.5%' }} />
                          <div className="absolute bg-zinc-200 rounded" style={{ left: '10%', top: '49%', width: '52%', height: '2.5%' }} />
                          <div className="absolute inset-x-0 bottom-0 bg-zinc-900" style={{ height: '3.5%' }} />
                        </>)}
                        {t.id === 'minimal' && (<>
                          <div className="absolute bg-zinc-900" style={{ left: '10%', top: '9%', width: '80%', height: '0.8%' }} />
                          <div className="absolute bg-zinc-800 rounded" style={{ left: '22%', top: '36%', width: '56%', height: '6%' }} />
                          <div className="absolute bg-blue-500" style={{ left: '43%', top: '50%', width: '14%', height: '0.8%' }} />
                          <div className="absolute bg-zinc-200 rounded" style={{ left: '30%', top: '57%', width: '40%', height: '2.2%' }} />
                          <div className="absolute bg-zinc-200 rounded" style={{ left: '30%', top: '62%', width: '40%', height: '2.2%' }} />
                          <div className="absolute bg-zinc-900" style={{ left: '10%', top: '93%', width: '80%', height: '0.8%' }} />
                        </>)}
                        {t.id === 'dark' && (<>
                          <div className="absolute inset-0 bg-blue-800" />
                          <div className="absolute bg-white/90 rounded" style={{ left: '10%', top: '20%', width: '70%', height: '9%' }} />
                          <div className="absolute bg-white/60 rounded" style={{ left: '10%', top: '33%', width: '50%', height: '3%' }} />
                          <div className="absolute bg-white rounded-full" style={{ left: '10%', top: '42%', width: '18%', height: '4%' }} />
                          <div className="absolute bg-white/50 rounded" style={{ left: '10%', top: '55%', width: '55%', height: '2%' }} />
                          <div className="absolute bg-white/50 rounded" style={{ left: '10%', top: '60%', width: '48%', height: '2%' }} />
                        </>)}
                      </div>
                      <div className="py-2 pr-2 self-center">
                        <p className="text-[12px] font-bold text-zinc-100">{t.label}</p>
                        <p className="text-[10px] text-zinc-500 leading-snug">{t.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {flyout === 'classkit' && (
                <div className="space-y-2">
                  <p className="text-[10.5px] text-zinc-500 px-0.5">모의고사 지문을 골라 자료를 현재 문서 뒤에 페이지로 넣어요.</p>
                  {/* 자료 유형 5종 */}
                  <div className="flex flex-wrap gap-1">
                    {CK_TYPES.map((t) => (
                      <button key={t.key} onClick={() => setCkType(t.key)}
                        className={`px-2 py-1 rounded-md text-[11px] border transition-colors ${ckType === t.key ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40 font-semibold' : 'bg-zinc-900/50 text-zinc-400 border-zinc-700/60 hover:text-zinc-200'}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {/* 교재 선택 */}
                  <select value={ckTextbook} onChange={(e) => loadCkPassages(e.target.value)}
                    className="w-full px-2 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-[12px] text-zinc-100">
                    <option value="">{ckTextbooks === null ? '교재 불러오는 중…' : '모의고사 교재 선택'}</option>
                    {(ckTextbooks ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {/* 지문 목록 */}
                  {ckTextbook && (
                    ckPassages === null ? (
                      <div className="py-4 text-center"><div className="w-4 h-4 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
                    ) : ckPassages.length === 0 ? (
                      <p className="text-[11px] text-zinc-600 text-center py-3">지문이 없어요.</p>
                    ) : (
                      <div className="max-h-[34vh] overflow-y-auto space-y-1 pr-0.5">
                        {ckPassages.map((p) => {
                          const label = [p.chapter, p.number].filter(Boolean).join(' ') || p.source_key || '지문';
                          const n = p.content?.sentences_en?.filter((s) => s && s.trim()).length ?? 0;
                          return (
                            <button key={p._id} disabled={ckBusy || n === 0} onClick={() => insertClassKitMaterial(p)}
                              className="w-full text-left rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5 hover:border-emerald-500/50 disabled:opacity-40 disabled:hover:border-zinc-800">
                              <span className="text-[12px] text-zinc-200">{label}</span>
                              <span className="ml-1.5 text-[10px] text-zinc-500">{n}문장</span>
                            </button>
                          );
                        })}
                      </div>
                    )
                  )}
                  {ckBusy && <p className="text-[11px] text-emerald-300 text-center">자료 생성·삽입 중…</p>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 캔버스 */}
        {/* ⚠️ flex justify-center + overflow 는 넘칠 때 왼쪽이 잘려 스크롤 불가 — margin:auto 로 중앙 정렬 */}
        <div ref={canvasWrapRef} className="overflow-auto max-h-[64vh] rounded-xl bg-zinc-950/60 border border-zinc-800/60 p-6" onPointerDown={() => { setSelIds([]); setEditingId(null); }}>
          {page && (
            <div ref={pageDivRef} onPointerDown={startMarquee} className="relative bg-white shadow-2xl" style={{ width: A4_W * S, height: A4_H * S, margin: '0 auto' }}>
              {[...page.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)).map((e) => (
                <ElementView key={e.id} el={e} S={S} pageNo={pi + 1} selected={selIds.includes(e.id)} soleSelected={selIds.length === 1 && selIds[0] === e.id} editing={e.id === editingId}
                  qr={e.qrUrl ? qrCache[e.qrUrl] : undefined}
                  onDown={(ev) => startDrag(ev, e.id, 'move')} onHandle={(ev, m) => startDrag(ev, e.id, m)}
                  onDbl={() => { if (e.kind === 'text') beginEdit(e.id); }}
                  onCtx={(ev) => {
                    ev.preventDefault(); ev.stopPropagation();
                    setEditingId(null);
                    setSelIds((prev) => (prev.includes(e.id) ? prev : [e.id]));
                    setCtxMenu({ x: ev.clientX, y: ev.clientY });
                  }}
                  onLiveText={(v) => patchElLive(e.id, { text: v })}
                  onLiveHeight={(mm) => patchElLive(e.id, { h: mm })}
                  onMeasure={onMeasure}
                  onEndEdit={() => setEditingId(null)} />
              ))}
              {/* 플로팅 미니 툴바 — 선택 묶음 위 (미리캔버스식) */}
              {selBox && !editingId && !marquee && !dragging && (
                <div className="absolute flex items-center gap-0.5 rounded-lg bg-zinc-900/95 border border-zinc-700 shadow-xl px-1 py-0.5"
                  style={{
                    zIndex: 60,
                    left: Math.max(0, Math.min(selBox.cx * S - 62, A4_W * S - 132)),
                    top: selBox.y * S - 36 < 0 ? Math.min(selBox.b * S + 8, A4_H * S - 32) : selBox.y * S - 36,
                  }}
                  onPointerDown={(e) => e.stopPropagation()}>
                  <button className="fbt" title="복제 (Ctrl+D)" onClick={() => duplicateIds(selIds)}>⧉</button>
                  <button className="fbt" title={selBox.allLocked ? '잠금 해제' : '잠금'} onClick={() => lockIds(selIds, !selBox.allLocked)}>{selBox.allLocked ? '🔓' : '🔒'}</button>
                  <button className="fbt" title="삭제 (Delete)" onClick={() => removeIds(selIds)}>🗑</button>
                  <button className="fbt" title="더 보기" onClick={(e) => {
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setCtxMenu({ x: r.left, y: r.bottom + 6 });
                  }}>⋯</button>
                </div>
              )}
              {/* 스냅 가이드라인 */}
              {guides.v.map((g) => (
                <div key={`gv${g}`} className="absolute pointer-events-none" style={{ left: g * S - 0.5, top: 0, width: 1, height: A4_H * S, background: '#f43f5e', zIndex: 40 }} />
              ))}
              {guides.h.map((g) => (
                <div key={`gh${g}`} className="absolute pointer-events-none" style={{ top: g * S - 0.5, left: 0, height: 1, width: A4_W * S, background: '#f43f5e', zIndex: 40 }} />
              ))}
              {/* 범위 선택(마퀴) 사각형 */}
              {marquee && (
                <div className="absolute pointer-events-none" style={{ left: marquee.x * S, top: marquee.y * S, width: marquee.w * S, height: marquee.h * S, border: '1px dashed #6366f1', background: 'rgba(99,102,241,0.08)', zIndex: 50 }} />
              )}
            </div>
          )}
        </div>

        {/* 우측 패널 — 속성/레이어 탭 */}
        <div className="space-y-2">
        <div className="flex rounded-lg bg-zinc-900/60 border border-zinc-800/80 p-0.5">
          <button onClick={() => setRightTab('props')}
            className={`flex-1 py-1 rounded-md text-[11px] font-semibold ${rightTab === 'props' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>속성</button>
          <button onClick={() => setRightTab('layers')}
            className={`flex-1 py-1 rounded-md text-[11px] font-semibold ${rightTab === 'layers' ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>레이어 {page ? page.elements.length : 0}</button>
        </div>
        {rightTab === 'layers' ? (
          <LayersPanel els={page?.elements ?? []} selIds={selIds}
            onSelect={(lid, shift) => setSelIds((prev) => (shift ? (prev.includes(lid) ? prev.filter((x) => x !== lid) : [...prev, lid]) : [lid]))}
            onMove={moveLayer}
            onLock={(lid, locked) => lockIds([lid], locked)} />
        ) : selIds.length > 1 ? (
          <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 space-y-2.5">
            <p className="text-sm text-zinc-100 font-semibold">✦ {selIds.length}개 선택됨</p>
            <div className="flex gap-1.5 flex-wrap">
              <button onClick={() => duplicateIds(selIds)} className="tbx">복제</button>
              <button onClick={copySelection} className="tbx">복사 (Ctrl+C)</button>
              <button onClick={() => removeIds(selIds)} className="tbx text-rose-400/80">삭제</button>
            </div>
            <div>
              <p className="text-[10px] text-zinc-500 mb-1">정렬 (선택 묶음 기준)</p>
              <div className="flex gap-1 flex-wrap">
                <button onClick={() => alignSel('left')} className="tbx" title="왼쪽 정렬">⇤</button>
                <button onClick={() => alignSel('centerX')} className="tbx" title="가로 중앙">↔</button>
                <button onClick={() => alignSel('right')} className="tbx" title="오른쪽 정렬">⇥</button>
                <button onClick={() => alignSel('top')} className="tbx" title="위 정렬">⤒</button>
                <button onClick={() => alignSel('centerY')} className="tbx" title="세로 중앙">↕</button>
                <button onClick={() => alignSel('bottom')} className="tbx" title="아래 정렬">⤓</button>
              </div>
            </div>
            {selIds.length >= 3 && (
              <div>
                <p className="text-[10px] text-zinc-500 mb-1">균등 분배</p>
                <div className="flex gap-1">
                  <button onClick={() => distributeSel('h')} className="tbx">가로 균등</button>
                  <button onClick={() => distributeSel('v')} className="tbx">세로 균등</button>
                </div>
              </div>
            )}
            <p className="text-[11px] text-zinc-600 leading-relaxed">
              드래그 = 함께 이동 (스냅 적용)<br />
              Shift+클릭 = 선택 추가/해제<br />
              Ctrl+V = 붙여넣기 (다른 페이지 가능)
            </p>
          </div>
        ) : (
        <PropsPanel sel={sel} onPatch={(p) => sel && patchEl(sel.id, p)} onRemove={() => sel && removeEl(sel.id)} onDup={() => sel && duplicateEl(sel.id)}
          onZ={(dir) => { if (!sel) return; patchEl(sel.id, { z: Math.max(0, (sel.z ?? 0) + dir) }); }}
          onZExtreme={zExtreme} onAlign={alignSel}
          onAutoHeight={() => {
            if (!sel) return;
            const need = neededHRef.current[sel.id];
            if (need && need > 1) patchEl(sel.id, { h: Math.min(285, Math.max(4, Math.ceil((need + 0.6) * 2) / 2)) });
          }} />
        )}
        </div>
      </div>

      {/* 하단 페이지 스트립 — 미리캔버스식 가로 필름 (← → 로 페이지 넘기기, 썸네일 호버 시 미니 아이콘) */}
      <div className="rounded-xl bg-zinc-900/60 border border-zinc-800/80 px-3 py-2">
        <div className="flex items-center gap-2">
          {/* 이전 페이지 */}
          <button onClick={() => gotoPage(pi - 1)} disabled={pi <= 0}
            className="shrink-0 w-7 h-7 rounded-lg bg-zinc-800/70 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-zinc-800/70 flex items-center justify-center" title="이전 페이지 (←)">‹</button>

          <div ref={stripRef} className="flex items-center gap-2 overflow-x-auto flex-1 py-3">
            {pages.map((p, i) => (
              <div key={p.id} data-page-idx={i} className="group relative shrink-0">
                <button onClick={() => gotoPage(i)}
                  className={`relative block rounded-md border overflow-hidden ${i === pi ? 'border-amber-400/80 ring-1 ring-amber-400/40' : 'border-zinc-800 hover:border-zinc-600'}`}
                  style={{ width: 56 }} title={`${i + 1}페이지`}>
                  <div className="bg-white relative" style={{ width: '100%', aspectRatio: '210/297' }}>
                    {p.elements.slice(0, 40).map((e) => (
                      <div key={e.id} className="absolute" style={{
                        left: `${(e.x / A4_W) * 100}%`, top: `${(e.y / A4_H) * 100}%`, width: `${(e.w / A4_W) * 100}%`, height: `${(e.h / A4_H) * 100}%`,
                        background: e.kind === 'rect' || e.kind === 'line' ? (e.fill || '#eee') : e.kind === 'text' ? (e.bg || 'transparent') : e.kind === 'question' ? '#ede9fe' : '#e5e7eb',
                        outline: e.kind === 'text' && !e.bg ? '0.5px solid #e5e7eb' : undefined,
                      }} />
                    ))}
                  </div>
                  <span className={`absolute bottom-0.5 right-1 text-[9px] font-bold ${i === pi ? 'text-amber-300' : 'text-zinc-400'}`} style={{ textShadow: '0 0 3px rgba(0,0,0,.9)' }}>{i + 1}</span>
                </button>
                {/* 호버(또는 현재 페이지) 시 뜨는 미니 아이콘 — 순서이동·복제·삭제 */}
                <div className={`absolute -top-2.5 left-1/2 -translate-x-1/2 flex items-center gap-px rounded-md bg-zinc-950/95 border border-zinc-700/80 px-0.5 shadow-lg transition-opacity ${i === pi ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                  <button onClick={(e) => { e.stopPropagation(); movePageAt(i, -1); }} disabled={i === 0} className="pmi disabled:opacity-25" title="앞으로 이동">‹</button>
                  <button onClick={(e) => { e.stopPropagation(); dupPageAt(i); }} className="pmi" title="이 페이지 복제">⧉</button>
                  <button onClick={(e) => { e.stopPropagation(); delPageAt(i); }} className="pmi hover:!text-rose-300" title="이 페이지 삭제 (Ctrl+Z 복구)">🗑</button>
                  <button onClick={(e) => { e.stopPropagation(); movePageAt(i, 1); }} disabled={i === pages.length - 1} className="pmi disabled:opacity-25" title="뒤로 이동">›</button>
                </div>
              </div>
            ))}
            <button onClick={addPage} className="shrink-0 rounded-md border border-dashed border-zinc-700 text-zinc-500 hover:text-zinc-200 hover:border-zinc-500 text-lg leading-none"
              style={{ width: 56, aspectRatio: '210/297' }} title="페이지 추가">＋</button>
          </div>

          {/* 다음 페이지 + 카운터 */}
          <div className="shrink-0 flex items-center gap-2 pl-2 border-l border-zinc-800">
            <span className="text-[11px] text-zinc-500 tabular-nums whitespace-nowrap">{pi + 1} / {pages.length}</span>
            <button onClick={() => gotoPage(pi + 1)} disabled={pi >= pages.length - 1}
              className="w-7 h-7 rounded-lg bg-zinc-800/70 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-zinc-800/70 flex items-center justify-center" title="다음 페이지 (→)">›</button>
          </div>
        </div>
      </div>

      {qModal && <QuestionModal onClose={() => setQModal(false)} onInsert={insertQuestions} onNotify={notify} />}

      {/* 알림 토스트 (alert 대체 — 임베디드 브라우저에서 네이티브 다이얼로그 차단) */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110] px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-600/70 text-zinc-100 text-[13px] shadow-2xl">
          {toast}
        </div>
      )}

      {/* 우클릭/⋯ 컨텍스트 메뉴 */}
      {ctxMenu && selIds.length > 0 && (() => {
        const allLocked = (page?.elements ?? []).filter((el) => selIds.includes(el.id)).every((el) => el.locked === true);
        const mi = 'w-full text-left px-3 py-1.5 rounded-md hover:bg-zinc-800 text-zinc-200 text-[12px] flex justify-between items-center gap-4';
        return (
          <>
            <div className="fixed inset-0 z-[94]" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
            <div className="fixed z-[95] rounded-xl bg-zinc-900 border border-zinc-700/80 shadow-2xl p-1.5 w-52"
              style={{ left: Math.min(ctxMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 220), top: Math.min(ctxMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 300) }}>
              <button className={mi} onClick={() => { copySelection(); setCtxMenu(null); }}>복사 <span className="text-zinc-600 text-[10px]">Ctrl+C</span></button>
              <button className={mi} onClick={() => { pasteClipboard(); setCtxMenu(null); }}>붙여넣기 <span className="text-zinc-600 text-[10px]">Ctrl+V</span></button>
              <button className={mi} onClick={() => { duplicateIds(selIds); setCtxMenu(null); }}>복제 <span className="text-zinc-600 text-[10px]">Ctrl+D</span></button>
              <div className="my-1 h-px bg-zinc-800" />
              <button className={mi} onClick={() => { zExtremeIds(selIds, 1); setCtxMenu(null); }}>⏫ 맨 앞으로</button>
              <button className={mi} onClick={() => { zExtremeIds(selIds, -1); setCtxMenu(null); }}>⏬ 맨 뒤로</button>
              <div className="my-1 h-px bg-zinc-800" />
              <button className={mi} onClick={() => { lockIds(selIds, !allLocked); setCtxMenu(null); }}>{allLocked ? '🔓 잠금 해제' : '🔒 잠금'}</button>
              <button className={`${mi} text-rose-400`} onClick={() => { removeIds(selIds); setCtxMenu(null); }}>삭제 <span className="text-zinc-600 text-[10px]">Del</span></button>
            </div>
          </>
        );
      })()}

      {/* 전체화면 프레젠테이션 */}
      {present && <PresentOverlay pages={pages} start={pi} qrCache={qrCache} onClose={() => setPresent(false)} />}


      <style jsx global>{`
        .tb { padding: 6px 10px; border-radius: 8px; background: rgba(63,63,70,.5); color: #d4d4d8; font-size: 12px; }
        .tb:hover { background: rgba(82,82,91,.6); color: #fafafa; }
        .tbx { padding: 3px 8px; border-radius: 6px; background: rgba(63,63,70,.5); color: #a1a1aa; font-size: 11px; }
        .tbx:hover { background: rgba(82,82,91,.6); }
        .fbt { padding: 4px 7px; border-radius: 6px; color: #d4d4d8; font-size: 13px; line-height: 1; }
        .fbt:hover { background: rgba(82,82,91,.7); }
        .rlb { display: flex; flex-direction: column; align-items: center; gap: 3px; width: 100%; padding: 9px 2px; border-radius: 10px; color: #b0b0ba; }
        .rlb:hover { background: rgba(63,63,70,.55); color: #fafafa; }
        .rlb-on { background: rgba(129,140,248,.18); color: #c7d2fe; }
        .rlb-on:hover { background: rgba(129,140,248,.28); color: #e0e7ff; }
        .rlb:disabled { opacity: .55; }
        .rlb b { font-size: 15px; line-height: 1; font-weight: 500; }
        .rlb span { font-size: 9.5px; line-height: 1.1; }
        .pmi { padding: 2px 4px; border-radius: 4px; color: #c4c4cc; font-size: 11px; line-height: 1; }
        .pmi:hover { background: rgba(82,82,91,.7); color: #fafafa; }
        .pnb { width: 26px; height: 26px; border-radius: 999px; color: #d4d4d8; font-size: 15px; line-height: 1; display: flex; align-items: center; justify-content: center; }
        .pnb:hover { background: rgba(82,82,91,.7); color: #fff; }
        .pnb:disabled { opacity: .3; }
        .prop-in { width: 100%; padding: 6px 8px; border-radius: 8px; background: rgba(24,24,27,.7); border: 1px solid rgba(63,63,70,.7); color: #f4f4f5; font-size: 12px; }
      `}</style>
    </div>
  );
}

/* ───────────── 요소 렌더 ───────────── */
function ElementView({ el, S, pageNo, selected, soleSelected, editing, qr, readonly, onDown, onHandle, onDbl, onCtx, onLiveText, onLiveHeight, onMeasure, onEndEdit }: {
  el: StudioElement; S: number; pageNo: number; selected: boolean; soleSelected: boolean; editing: boolean; qr?: string;
  /** 프레젠테이션 등 읽기 전용 렌더 — 커서·넘침 배지 없음 */
  readonly?: boolean;
  onDown: (e: React.PointerEvent) => void; onHandle: (e: React.PointerEvent, m: DragMode) => void;
  onDbl: () => void; onCtx?: (e: React.MouseEvent) => void; onLiveText: (v: string) => void; onLiveHeight: (mm: number) => void;
  onMeasure: (id: string, mm: number) => void; onEndEdit: () => void;
}) {
  const box: React.CSSProperties = { position: 'absolute', left: el.x * S, top: el.y * S, width: el.w * S, height: el.h * S, cursor: readonly ? 'default' : editing ? 'text' : el.locked ? 'default' : 'move', transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined };
  const ptPx = (pt: number) => pt * PT2MM * S;
  /* 텍스트 내용이 박스를 넘는지 측정 → 넘침 배지 + 「내용에 높이 맞춤」용 보고 */
  const contentRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    if (el.kind !== 'text' || editing) return;
    const n = contentRef.current;
    if (!n) return;
    setOverflowing(n.scrollHeight > n.clientHeight + 1);
    onMeasure(el.id, n.scrollHeight / S);
  }, [el.kind, el.id, el.text, el.w, el.h, el.fontSize, el.lineHeight, el.bold, S, editing, onMeasure]);
  let inner: React.ReactNode = null;
  if (el.kind === 'text') {
    const textStyle: React.CSSProperties = {
      fontSize: ptPx(el.fontSize ?? 11), fontWeight: el.bold ? 700 : 400, color: el.color || '#111',
      background: gradientCss(el.gradient) || el.bg || 'transparent', textAlign: el.align ?? 'left', lineHeight: el.lineHeight ?? 1.35,
      letterSpacing: el.letterSpacing ? ptPx(el.letterSpacing) : undefined,
      border: el.borderColor && (el.borderWidth ?? 0) > 0 ? `${Math.max(1, (el.borderWidth ?? 0.3) * S)}px solid ${el.borderColor}` : undefined,
      padding: 1.2 * S, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: "'NanumGothic','Apple SD Gothic Neo',sans-serif",
    };
    inner = editing ? (
      <textarea
        autoFocus
        value={el.text ?? ''}
        onChange={(e) => {
          onLiveText(e.target.value);
          // 타이핑으로 내용이 길어지면 박스 높이 자동 확장
          const need = e.target.scrollHeight / S + 0.5;
          if (need > el.h) onLiveHeight(Math.min(285, Math.round(need * 2) / 2));
        }}
        onBlur={onEndEdit}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onEndEdit(); } e.stopPropagation(); }}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-full h-full resize-none outline-none overflow-auto"
        style={{ ...textStyle, background: el.bg || 'rgba(255,255,255,0.94)' }}
      />
    ) : (
      <div ref={contentRef} className="w-full h-full overflow-hidden" style={textStyle}
        dangerouslySetInnerHTML={{ __html: safeUnderlineHtml((el.text ?? '').replace(/\{\{page\}\}/g, String(pageNo))) }} />
    );
  } else if (el.kind === 'rect' || el.kind === 'line') {
    inner = <div className="w-full h-full" style={{ background: gradientCss(el.gradient) || el.fill || 'transparent', borderRadius: (el.radius ?? 0) * S, border: el.borderColor && (el.borderWidth ?? 0) > 0 ? `${Math.max(1, (el.borderWidth ?? 0) * S)}px solid ${el.borderColor}` : undefined }} />;
  } else if (el.kind === 'image') {
    // eslint-disable-next-line @next/next/no-img-element
    inner = el.src ? <img src={el.src} alt="" draggable={false} className="w-full h-full object-contain pointer-events-none" /> : <div className="w-full h-full bg-zinc-100 text-zinc-400 text-xs flex items-center justify-center">이미지 없음</div>;
  } else if (el.kind === 'qr') {
    inner = (
      <div className="w-full h-full flex flex-col items-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {qr ? <img src={qr} alt="QR" draggable={false} style={{ width: Math.min(el.w, el.h - (el.qrLabel ? 5 : 0)) * S, height: Math.min(el.w, el.h - (el.qrLabel ? 5 : 0)) * S }} className="pointer-events-none" /> : <div className="bg-zinc-200 text-[10px] text-zinc-500 flex items-center justify-center" style={{ width: el.w * S, height: el.w * S }}>QR</div>}
        {el.qrLabel && <div className="text-center" style={{ fontSize: ptPx(8), color: '#374151' }}>{el.qrLabel}</div>}
      </div>
    );
  } else if (el.kind === 'question' && el.q) {
    const q = el.q;
    const size = ptPx(el.fontSize ?? 10);
    inner = (
      <div className="w-full h-full overflow-hidden" style={{ fontSize: size, color: '#111', lineHeight: 1.5, padding: 1.5 * S, fontFamily: "'NanumGothic','Apple SD Gothic Neo',sans-serif" }}>
        <div style={{ fontWeight: 700 }}>{q.num ? `${q.num}. ` : ''}{(q.question ?? '').replace(/<\/?u>/g, '')}
          {q.serial && <span style={{ fontWeight: 400, fontSize: size * 0.75, color: '#9ca3af' }}>  {q.serial}·{q.type}</span>}
        </div>
        {q.paragraph && (
          <div style={{ border: '1px solid #9ca3af', padding: `${0.8 * S}px ${1.2 * S}px`, margin: `${0.8 * S}px 0`, fontSize: size * 0.95 }}
            dangerouslySetInnerHTML={{ __html: safeUnderlineHtml(q.paragraph) }} />
        )}
        {(q.options ?? []).filter((o) => o.trim()).map((o, i) => (
          <div key={i} style={{ fontSize: size * 0.95 }}>{CIRCLED[i]} {o}</div>
        ))}
        {q.showAnswer && q.answer && <div style={{ fontSize: size * 0.85, color: '#6b7280', marginTop: 0.5 * S }}>정답 {q.answer}{q.explanation ? ` | ${q.explanation.replace(/<\/?u>/g, '')}` : ''}</div>}
      </div>
    );
  }
  return (
    <div style={box} onPointerDown={onDown} onDoubleClick={onDbl} onContextMenu={onCtx} className={selected ? 'z-20' : ''}>
      {inner}
      {/* 텍스트 넘침 경고 — 빨간 점선 하단 + 배지 (인쇄에는 안 나감, 편집기 전용) */}
      {overflowing && !editing && !readonly && (
        <>
          <div className="absolute left-0 right-0 bottom-0 pointer-events-none" style={{ height: 2, background: 'repeating-linear-gradient(90deg,#ef4444 0 6px,transparent 6px 12px)' }} />
          <span className="absolute pointer-events-none text-[9px] font-bold bg-red-500 text-white px-1 py-0.5 rounded" style={{ right: 0, bottom: -16 }}>내용 넘침</span>
        </>
      )}
      {selected && (
        <>
          <div className="absolute inset-0 pointer-events-none" style={{ outline: editing ? '1.5px dashed #6366f1' : el.locked ? '1.5px solid #f59e0b' : '1.5px solid #6366f1', outlineOffset: 0 }} />
          {el.locked && (
            <span className="absolute pointer-events-none text-[10px]" style={{ right: 2, top: 2 }}>🔒</span>
          )}
          {soleSelected && !editing && !el.locked && (
            <>
              {/* 8방향 리사이즈 핸들 */}
              <div onPointerDown={(e) => onHandle(e, 'nw')} className="absolute w-2.5 h-2.5 bg-indigo-500 rounded-sm" style={{ left: -5, top: -5, cursor: 'nwse-resize' }} />
              <div onPointerDown={(e) => onHandle(e, 'n')} className="absolute w-2.5 h-2.5 bg-indigo-500 rounded-full" style={{ left: '50%', marginLeft: -5, top: -5, cursor: 'ns-resize' }} />
              <div onPointerDown={(e) => onHandle(e, 'ne')} className="absolute w-2.5 h-2.5 bg-indigo-500 rounded-sm" style={{ right: -5, top: -5, cursor: 'nesw-resize' }} />
              <div onPointerDown={(e) => onHandle(e, 'w')} className="absolute w-2.5 h-2.5 bg-indigo-500 rounded-full" style={{ left: -5, top: '50%', marginTop: -5, cursor: 'ew-resize' }} />
              <div onPointerDown={(e) => onHandle(e, 'e')} className="absolute w-2.5 h-2.5 bg-indigo-500 rounded-full" style={{ right: -5, top: '50%', marginTop: -5, cursor: 'ew-resize' }} />
              <div onPointerDown={(e) => onHandle(e, 'sw')} className="absolute w-2.5 h-2.5 bg-indigo-500 rounded-sm" style={{ left: -5, bottom: -5, cursor: 'nesw-resize' }} />
              <div onPointerDown={(e) => onHandle(e, 's')} className="absolute w-2.5 h-2.5 bg-indigo-500 rounded-full" style={{ bottom: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' }} />
              <div onPointerDown={(e) => onHandle(e, 'se')} className="absolute w-3 h-3 bg-indigo-500 rounded-sm" style={{ right: -6, bottom: -6, cursor: 'nwse-resize' }} />
              {/* 회전 핸들 (초록 점) — 90° 근처 자동 스냅 */}
              <div className="absolute pointer-events-none" style={{ left: '50%', top: -14, width: 1, height: 10, background: '#10b981', marginLeft: -0.5 }} />
              <div onPointerDown={(e) => onHandle(e, 'rot')} className="absolute w-3 h-3 bg-emerald-500 rounded-full border border-white" style={{ left: '50%', marginLeft: -6, top: -22, cursor: 'grab' }} title="드래그로 회전 (90° 근처 자동 스냅)" />
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────── 레이어 패널 ───────────── */
function LayersPanel({ els, selIds, onSelect, onMove, onLock }: {
  els: StudioElement[]; selIds: string[];
  onSelect: (id: string, shift: boolean) => void; onMove: (id: string, dir: 1 | -1) => void; onLock: (id: string, locked: boolean) => void;
}) {
  const sorted = [...els].sort((a, b) => (b.z ?? 0) - (a.z ?? 0)); // 위 레이어(앞)가 목록 위
  const ICON: Record<string, string> = { text: '📝', image: '🖼', qr: '▣', question: '📚', rect: '▢', line: '―' };
  const name = (e: StudioElement) =>
    e.kind === 'text' ? ((e.text || '텍스트').replace(/<\/?u>/g, '').replace(/\n/g, ' ').slice(0, 18) || '텍스트')
    : e.kind === 'question' ? `문제 ${e.q?.num ?? ''}`.trim()
    : e.kind === 'image' ? '이미지' : e.kind === 'qr' ? 'QR' : e.kind === 'rect' ? '상자' : '구분선';
  return (
    <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-2 max-h-[70vh] overflow-y-auto space-y-0.5">
      {sorted.length === 0 && <p className="text-[11px] text-zinc-600 p-3 text-center">이 페이지에 요소가 없어요.</p>}
      {sorted.map((e) => {
        const on = selIds.includes(e.id);
        return (
          <div key={e.id} onClick={(ev) => onSelect(e.id, ev.shiftKey)}
            className={`group flex items-center gap-1.5 rounded-lg px-2 py-1.5 cursor-pointer border ${on ? 'bg-indigo-500/20 border-indigo-500/50' : 'border-transparent hover:bg-zinc-800/70'}`}>
            <span className="text-[12px] shrink-0">{ICON[e.kind]}</span>
            <span className={`flex-1 truncate text-[11px] ${on ? 'text-zinc-100' : 'text-zinc-400'}`}>{name(e)}</span>
            <button className="hidden group-hover:block text-[10px] text-zinc-500 hover:text-zinc-200" title="한 층 위로"
              onClick={(ev) => { ev.stopPropagation(); onMove(e.id, 1); }}>▲</button>
            <button className="hidden group-hover:block text-[10px] text-zinc-500 hover:text-zinc-200" title="한 층 아래로"
              onClick={(ev) => { ev.stopPropagation(); onMove(e.id, -1); }}>▼</button>
            <button className={`text-[11px] ${e.locked ? '' : 'opacity-0 group-hover:opacity-60'}`} title={e.locked ? '잠금 해제' : '잠금'}
              onClick={(ev) => { ev.stopPropagation(); onLock(e.id, !e.locked); }}>{e.locked ? '🔒' : '🔓'}</button>
          </div>
        );
      })}
      <p className="text-[10px] text-zinc-600 px-1 pt-1.5 leading-relaxed">위에 있을수록 앞(위 레이어) · 클릭 = 선택 · Shift+클릭 = 다중 선택</p>
    </div>
  );
}

/* ───────────── 전체화면 프레젠테이션 ───────────── */
function PresentOverlay({ pages, start, qrCache, onClose }: {
  pages: StudioPage[]; start: number; qrCache: Record<string, string>; onClose: () => void;
}) {
  const [idx, setIdx] = useState(start);
  const [size, setSize] = useState({ w: 1280, h: 800 });
  /** 발표 확대 배율 (1 = 화면 맞춤) */
  const [zoom, setZoom] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const clampZoom = (z: number) => Math.max(0.5, Math.min(4, Math.round(z * 100) / 100));
  useEffect(() => {
    const upd = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    upd();
    window.addEventListener('resize', upd);
    return () => window.removeEventListener('resize', upd);
  }, []);
  // 브라우저 전체화면 진입/종료 (미지원·거부 시 오버레이만으로 동작)
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom((z) => clampZoom(z + 0.15)); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom((z) => clampZoom(z - 0.15)); return; }
      if (e.key === '0') { e.preventDefault(); setZoom(1); return; }
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown' || e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(pages.length - 1, i + 1)); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pages.length, onClose]);
  // 트랙패드 핀치(ctrl/⌘+휠) → 확대·축소. 일반 두 손가락 스크롤은 팬(자연 스크롤)
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault(); // 브라우저 페이지 줌 방지 — passive:false 필수
      setZoom((z) => clampZoom(z * (1 - e.deltaY * 0.01)));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);
  // 페이지 넘기면 스크롤을 가운데로 (확대 상태에서 구석이 보이지 않게)
  useEffect(() => {
    const node = scrollRef.current;
    if (node) { node.scrollLeft = (node.scrollWidth - node.clientWidth) / 2; node.scrollTop = (node.scrollHeight - node.clientHeight) / 2; }
  }, [idx, zoom]);
  const baseS = Math.min((size.w - 32) / A4_W, (size.h - 32) / A4_H);
  const S = baseS * zoom;
  const p = pages[idx];
  const noop = () => {};
  return (
    <div className="fixed inset-0 z-[100] bg-black select-none">
      {/* 스크롤·팬 레이어 — 확대 시 두 손가락 스크롤로 이동 */}
      <div ref={scrollRef} className="absolute inset-0 overflow-auto">
        <div className="min-w-full min-h-full flex items-center justify-center p-4"
          onClick={(e) => {
            if (zoom !== 1) return; // 확대 중엔 클릭 네비 비활성(팬 우선)
            if (e.clientX / size.w > 0.5) setIdx((i) => Math.min(pages.length - 1, i + 1));
            else setIdx((i) => Math.max(0, i - 1));
          }}>
          <div className="relative bg-white overflow-hidden shrink-0 shadow-2xl" style={{ width: A4_W * S, height: A4_H * S }}>
            {p && [...p.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)).map((e) => (
              <ElementView key={e.id} el={e} S={S} pageNo={idx + 1} selected={false} soleSelected={false} editing={false} readonly
                qr={e.qrUrl ? qrCache[e.qrUrl] : undefined}
                onDown={noop} onHandle={noop} onDbl={noop} onLiveText={noop} onLiveHeight={noop} onMeasure={noop} onEndEdit={noop} />
            ))}
          </div>
        </div>
      </div>

      <button onClick={onClose} className="absolute top-4 right-5 z-[101] text-zinc-500 hover:text-white text-xl leading-none" title="종료 (Esc)">✕</button>

      {/* 하단 컨트롤 바 — 페이지 네비 + 확대/축소 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[101] flex items-center gap-1 bg-zinc-900/85 rounded-full pl-3 pr-1.5 py-1.5 backdrop-blur">
        <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx <= 0} className="pnb" title="이전 (←)">‹</button>
        <span className="text-zinc-300 text-[12px] tabular-nums w-12 text-center">{idx + 1} / {pages.length}</span>
        <button onClick={() => setIdx((i) => Math.min(pages.length - 1, i + 1))} disabled={idx >= pages.length - 1} className="pnb" title="다음 (→)">›</button>
        <span className="w-px h-4 bg-zinc-700 mx-1" />
        <button onClick={() => setZoom((z) => clampZoom(z - 0.15))} className="pnb" title="축소 (−)">－</button>
        <button onClick={() => setZoom(1)} className="text-zinc-300 hover:text-white text-[11px] tabular-nums w-11 text-center" title="화면 맞춤 (0)">{Math.round(zoom * 100)}%</button>
        <button onClick={() => setZoom((z) => clampZoom(z + 0.15))} className="pnb" title="확대 (＋)">＋</button>
      </div>
      <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-[101] text-zinc-600 text-[10.5px]">←→ 넘김 · 트랙패드 핀치·＋－ 확대 · Esc 종료</div>
    </div>
  );
}

/* ───────────── 속성 패널 ───────────── */
const SWATCHES = ['#111111', '#6b7280', '#ffffff', '#2563eb', '#7c3aed', '#b91c1c', '#f59e0b', '#16a34a'];

function PropsPanel({ sel, onPatch, onRemove, onDup, onZ, onZExtreme, onAlign, onAutoHeight }: {
  sel: StudioElement | null; onPatch: (p: Partial<StudioElement>) => void; onRemove: () => void; onDup: () => void; onZ: (dir: 1 | -1) => void;
  onZExtreme: (dir: 1 | -1) => void; onAlign: (t: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => void;
  onAutoHeight: () => void;
}) {
  if (!sel) {
    return (
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 text-[12px] text-zinc-600 leading-relaxed">
        요소를 클릭해 선택하세요.<br /><br />
        · <b className="text-zinc-400">텍스트 더블클릭 = 바로 편집</b><br />
        · <b className="text-zinc-400">빈 곳 드래그 = 범위 선택</b> · Shift+클릭 = 개별 추가<br />
        · 8방향 점 = 크기 · <b className="text-zinc-400">초록 점 = 회전</b> (90° 자동 스냅)<br />
        · 이미지 모서리 = 비율 유지 리사이즈<br />
        · 방향키 = 1mm 이동 (Shift = 5mm) · Ctrl+A = 전체 선택<br />
        · Ctrl+C/V = 복사·붙여넣기 (페이지 간 가능)<br />
        · Delete = 삭제 · Ctrl+D = 복제 · Ctrl+Z = 되돌리기<br />
        · <b className="text-zinc-400">우클릭 = 메뉴</b> (복사·순서·잠금·삭제)<br />
        · <b className="text-zinc-400">트랙패드 핀치</b> = 확대·축소 · 레이어 탭 = 쌓임 순서<br />
        · 텍스트에 <b className="text-zinc-400">{'{{page}}'}</b> 입력 = 인쇄 시 페이지 번호
      </div>
    );
  }
  const KIND_LABEL: Record<string, string> = { text: '텍스트', image: '이미지', qr: 'QR', question: '문제', rect: '상자', line: '구분선' };
  const num = (v: number | undefined, def = 0) => (typeof v === 'number' ? v : def);
  return (
    <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-3.5 space-y-2.5 max-h-[78vh] overflow-y-auto">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px] font-semibold">{KIND_LABEL[sel.kind]}</span>
        <button onClick={() => onZExtreme(1)} className="tbx" title="맨 앞으로">⏫</button>
        <button onClick={() => onZ(1)} className="tbx" title="한 칸 앞으로">⬆</button>
        <button onClick={() => onZ(-1)} className="tbx" title="한 칸 뒤로">⬇</button>
        <button onClick={() => onZExtreme(-1)} className="tbx" title="맨 뒤로">⏬</button>
        <button onClick={onDup} className="tbx">복제</button>
        <button onClick={() => onPatch({ locked: !sel.locked })} className={`tbx ${sel.locked ? 'bg-amber-500/25 text-amber-200' : ''}`}
          title="잠그면 캔버스에서 이동·크기조절·Delete 가 차단됩니다 (배경 오조작 방지)">
          {sel.locked ? '🔒 잠김' : '🔓 잠금'}
        </button>
        <button onClick={onRemove} className="tbx text-rose-400/80 ml-auto">삭제</button>
      </div>
      {sel.locked && <p className="text-[10px] text-amber-300/80">잠긴 요소 — 캔버스 이동·삭제 차단. 패널에서는 수정 가능.</p>}
      <div className="grid grid-cols-4 gap-1.5">
        {(['x', 'y', 'w', 'h'] as const).map((k) => (
          <label key={k} className="text-[10px] text-zinc-500">
            {k.toUpperCase()}
            <input type="number" step={0.5} value={num(sel[k])} onChange={(e) => onPatch({ [k]: parseFloat(e.target.value) || 0 })} className="prop-in mt-0.5" />
          </label>
        ))}
      </div>
      <div className="flex items-end gap-1.5">
        <label className="text-[10px] text-zinc-500 w-16 shrink-0">회전(°)
          <input type="number" step={1} value={num(sel.rotation)} onChange={(e) => onPatch({ rotation: ((parseFloat(e.target.value) || 0) % 360 + 360) % 360 })} className="prop-in mt-0.5" />
        </label>
        <div className="flex gap-1 flex-wrap pb-0.5" title="페이지 여백 기준 정렬">
          <button onClick={() => onAlign('left')} className="tbx">⇤</button>
          <button onClick={() => onAlign('centerX')} className="tbx">↔</button>
          <button onClick={() => onAlign('right')} className="tbx">⇥</button>
          <button onClick={() => onAlign('top')} className="tbx">⤒</button>
          <button onClick={() => onAlign('centerY')} className="tbx">↕</button>
          <button onClick={() => onAlign('bottom')} className="tbx">⤓</button>
        </div>
      </div>
      {sel.kind === 'text' && (
        <>
          <textarea value={sel.text ?? ''} onChange={(e) => onPatch({ text: e.target.value })} rows={6} className="prop-in resize-y" placeholder={'내용 (<u>밑줄</u> 사용 가능)'} />
          <button onClick={onAutoHeight} className="w-full px-2 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-[11px] hover:bg-zinc-700" title="내용이 박스를 넘으면(빨간 점선) 높이를 내용에 맞게 늘립니다">
            📐 내용에 높이 맞춤
          </button>
          <div className="grid grid-cols-3 gap-1.5">
            <label className="text-[10px] text-zinc-500">크기(pt)<input type="number" step={0.5} value={num(sel.fontSize, 11)} onChange={(e) => onPatch({ fontSize: parseFloat(e.target.value) || 11 })} className="prop-in mt-0.5" /></label>
            <label className="text-[10px] text-zinc-500">줄간격<input type="number" step={0.05} value={num(sel.lineHeight, 1.35)} onChange={(e) => onPatch({ lineHeight: parseFloat(e.target.value) || 1.35 })} className="prop-in mt-0.5" /></label>
            <label className="text-[10px] text-zinc-500" title="자간 — 라벨·제목을 세련되게(pt)">자간<input type="number" step={0.2} value={num(sel.letterSpacing)} onChange={(e) => onPatch({ letterSpacing: parseFloat(e.target.value) || 0 })} className="prop-in mt-0.5" /></label>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => onPatch({ bold: !sel.bold })} className={`tbx ${sel.bold ? 'bg-zinc-200 text-zinc-900' : ''}`}>B</button>
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} onClick={() => onPatch({ align: a })} className={`tbx ${sel.align === a ? 'bg-zinc-200 text-zinc-900' : ''}`}>{a === 'left' ? '⯇' : a === 'center' ? '↔' : '⯈'}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="text-[10px] text-zinc-500">글자색<input type="color" value={sel.color || '#111111'} onChange={(e) => onPatch({ color: e.target.value })} className="prop-in mt-0.5 h-8 p-0.5" />
              <span className="flex gap-1 mt-1">
                {SWATCHES.map((c) => (
                  <button key={c} onClick={() => onPatch({ color: c })} className="w-4 h-4 rounded border border-zinc-600" style={{ background: c }} title={c} />
                ))}
              </span>
            </label>
            <label className="text-[10px] text-zinc-500">배경
              <div className="flex gap-1 mt-0.5">
                <input type="color" value={sel.bg && sel.bg !== 'transparent' ? sel.bg : '#ffffff'} onChange={(e) => onPatch({ bg: e.target.value })} className="prop-in h-8 p-0.5 flex-1" />
                <button onClick={() => onPatch({ bg: '' })} className="tbx">없음</button>
              </div>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="text-[10px] text-zinc-500">테두리색
              <div className="flex gap-1 mt-0.5">
                <input type="color" value={sel.borderColor || '#94a3b8'} onChange={(e) => onPatch({ borderColor: e.target.value, borderWidth: (sel.borderWidth ?? 0) > 0 ? sel.borderWidth : 0.3 })} className="prop-in h-8 p-0.5 flex-1" />
                <button onClick={() => onPatch({ borderColor: '', borderWidth: 0 })} className="tbx">없음</button>
              </div>
            </label>
            <label className="text-[10px] text-zinc-500">테두리(mm)<input type="number" step={0.1} value={num(sel.borderWidth)} onChange={(e) => onPatch({ borderWidth: parseFloat(e.target.value) || 0 })} className="prop-in mt-0.5" /></label>
          </div>
        </>
      )}
      {(sel.kind === 'rect' || sel.kind === 'line') && (
        <>
          <label className="text-[10px] text-zinc-500">채움색
            <div className="flex gap-1 mt-0.5">
              <input type="color" value={sel.fill && sel.fill !== 'transparent' ? sel.fill : '#f1f5f9'} onChange={(e) => onPatch({ fill: e.target.value })} className="prop-in h-8 p-0.5 flex-1" />
              <button onClick={() => onPatch({ fill: 'transparent' })} className="tbx">투명</button>
            </div>
            <span className="flex gap-1 mt-1">
              {SWATCHES.map((c) => (
                <button key={c} onClick={() => onPatch({ fill: c })} className="w-4 h-4 rounded border border-zinc-600" style={{ background: c }} title={c} />
              ))}
            </span>
          </label>
          {sel.kind === 'rect' && (
            <div className="grid grid-cols-3 gap-1.5">
              <label className="text-[10px] text-zinc-500">테두리색<input type="color" value={sel.borderColor || '#94a3b8'} onChange={(e) => onPatch({ borderColor: e.target.value })} className="prop-in mt-0.5 h-8 p-0.5" /></label>
              <label className="text-[10px] text-zinc-500">굵기<input type="number" step={0.1} value={num(sel.borderWidth)} onChange={(e) => onPatch({ borderWidth: parseFloat(e.target.value) || 0 })} className="prop-in mt-0.5" /></label>
              <label className="text-[10px] text-zinc-500">모서리<input type="number" step={0.5} value={num(sel.radius)} onChange={(e) => onPatch({ radius: parseFloat(e.target.value) || 0 })} className="prop-in mt-0.5" /></label>
            </div>
          )}
        </>
      )}
      {(sel.kind === 'text' || sel.kind === 'rect' || sel.kind === 'line') && (
        <div className="rounded-lg bg-zinc-950/40 border border-zinc-800/70 p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-400 font-semibold">🎨 그라데이션</span>
            <button
              onClick={() => onPatch({ gradient: sel.gradient ? undefined : { from: (sel.kind === 'text' ? (sel.bg && sel.bg !== 'transparent' ? sel.bg : '#A7F3D0') : (sel.fill && sel.fill !== 'transparent' ? sel.fill : '#A7F3D0')), to: '#10B981', angle: 135 } })}
              className={`tbx ${sel.gradient ? 'bg-emerald-500/25 text-emerald-200' : ''}`}>{sel.gradient ? '켜짐' : '꺼짐'}</button>
          </div>
          {sel.gradient && (
            <>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5 items-end">
                <label className="text-[10px] text-zinc-500">시작색<input type="color" value={sel.gradient.from || '#A7F3D0'} onChange={(e) => onPatch({ gradient: { ...sel.gradient!, from: e.target.value } })} className="prop-in mt-0.5 h-8 p-0.5" /></label>
                <label className="text-[10px] text-zinc-500">끝색<input type="color" value={sel.gradient.to || '#10B981'} onChange={(e) => onPatch({ gradient: { ...sel.gradient!, to: e.target.value } })} className="prop-in mt-0.5 h-8 p-0.5" /></label>
                <label className="text-[10px] text-zinc-500 w-12">각도<input type="number" step={15} value={num(sel.gradient.angle, 135)} onChange={(e) => onPatch({ gradient: { ...sel.gradient!, angle: ((parseFloat(e.target.value) || 0) % 360 + 360) % 360 } })} className="prop-in mt-0.5" /></label>
              </div>
              <div className="flex gap-1 flex-wrap">
                {([['민트', '#D1FAE5', '#34D399'], ['에메랄드', '#6EE7B7', '#059669'], ['틸', '#99F6E4', '#0D9488'], ['하늘', '#BAE6FD', '#38BDF8'], ['라벤더', '#E9D5FF', '#A855F7'], ['피치', '#FED7AA', '#FB923C']] as const).map(([name, f, t]) => (
                  <button key={name} onClick={() => onPatch({ gradient: { from: f, to: t, angle: sel.gradient?.angle ?? 135 } })}
                    className="w-6 h-6 rounded-md border border-zinc-600" style={{ background: `linear-gradient(135deg, ${f}, ${t})` }} title={name} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {sel.kind === 'qr' && (
        <>
          <label className="text-[10px] text-zinc-500">연결 주소(URL)<input value={sel.qrUrl ?? ''} onChange={(e) => onPatch({ qrUrl: e.target.value })} className="prop-in mt-0.5" placeholder="https://…" /></label>
          <label className="text-[10px] text-zinc-500">설명 라벨<input value={sel.qrLabel ?? ''} onChange={(e) => onPatch({ qrLabel: e.target.value })} className="prop-in mt-0.5" placeholder="📱 스캔해서 영상 보기" /></label>
        </>
      )}
      {sel.kind === 'question' && sel.q && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="text-[10px] text-zinc-500">문항 번호<input type="number" value={sel.q.num ?? 0} onChange={(e) => onPatch({ q: { ...sel.q, num: parseInt(e.target.value) || 0 } })} className="prop-in mt-0.5" /></label>
            <label className="text-[10px] text-zinc-500">크기(pt)<input type="number" step={0.5} value={num(sel.fontSize, 10)} onChange={(e) => onPatch({ fontSize: parseFloat(e.target.value) || 10 })} className="prop-in mt-0.5" /></label>
          </div>
          <label className="flex items-center gap-2 text-[12px] text-zinc-300">
            <input type="checkbox" checked={sel.q.showAnswer === true} onChange={(e) => onPatch({ q: { ...sel.q, showAnswer: e.target.checked } })} className="accent-violet-400" />
            정답·해설 표시
          </label>
          <p className="text-[10px] text-zinc-600">{sel.q.serial} · {sel.q.type}</p>
        </>
      )}
      {sel.kind === 'image' && <p className="text-[11px] text-zinc-500">모서리 점으로 크기를 조절하세요. 비율은 유지되어 표시됩니다.</p>}
    </div>
  );
}

/* ───────────── 문제 불러오기 모달 ───────────── */
function QuestionModal({ onClose, onInsert, onNotify }: { onClose: () => void; onInsert: (qs: FullQ[], withAnswer: boolean) => void; onNotify: (m: string) => void }) {
  const [items, setItems] = useState<BankItem[]>([]);
  const [folders, setFolders] = useState<{ name: string; count: number }[]>([]);
  const [folder, setFolder] = useState('__all__');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<FullQ | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [withAnswer, setWithAnswer] = useState(false);
  const [inserting, setInserting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (folder !== '__all__') params.set('folder', folder);
      if (q.trim()) params.set('q', q.trim());
      const d = await fetch(`/api/my/vip/question-bank?${params}`, { credentials: 'include' }).then((r) => r.json()).catch(() => null);
      if (!alive) return;
      if (d?.ok) { setItems(d.items as BankItem[]); setFolders(d.folders as { name: string; count: number }[]); }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [folder, q]);

  const openPreview = async (qid: string) => {
    setPreviewLoading(true);
    const d = await fetch(`/api/my/vip/materials/studio/question?ids=${qid}`, { credentials: 'include' }).then((r) => r.json()).catch(() => null);
    setPreview(d?.ok && d.items[0] ? (d.items[0] as FullQ) : null);
    setPreviewLoading(false);
  };

  const doInsert = async () => {
    const ids = [...sel];
    if (ids.length === 0) { onNotify('삽입할 문제를 선택하세요.'); return; }
    setInserting(true);
    const d = await fetch(`/api/my/vip/materials/studio/question?ids=${ids.join(',')}`, { credentials: 'include' }).then((r) => r.json()).catch(() => null);
    setInserting(false);
    if (!d?.ok || !Array.isArray(d.items) || d.items.length === 0) { onNotify('문제를 불러오지 못했습니다.'); return; }
    onInsert(d.items as FullQ[], withAnswer);
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-5xl max-h-[85vh] rounded-2xl bg-zinc-900 border border-zinc-700/70 overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center gap-3">
          <h2 className="text-sm font-bold text-zinc-100">📚 문제 불러오기 — 내 문제은행</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="고유번호·출처 검색" className="prop-in !w-52 ml-2" />
          <label className="ml-auto flex items-center gap-1.5 text-[12px] text-zinc-400">
            <input type="checkbox" checked={withAnswer} onChange={(e) => setWithAnswer(e.target.checked)} className="accent-violet-400" /> 정답·해설 포함
          </label>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none px-1">×</button>
        </div>
        <div className="px-5 py-2 border-b border-zinc-800/70 flex gap-1.5 flex-wrap">
          <button onClick={() => setFolder('__all__')} className={`tbx ${folder === '__all__' ? 'bg-zinc-200 text-zinc-900' : ''}`}>전체</button>
          {folders.filter((f) => f.name).map((f) => (
            <button key={f.name} onClick={() => setFolder(f.name)} className={`tbx ${folder === f.name ? 'bg-zinc-200 text-zinc-900' : ''}`}>📁 {f.name} {f.count}</button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_1fr] gap-0 flex-1 min-h-0">
          {/* 목록 */}
          <div className="overflow-y-auto border-r border-zinc-800/70 p-3 space-y-1.5">
            {loading ? (
              <div className="p-10 text-center"><div className="w-5 h-5 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
            ) : items.length === 0 ? (
              <p className="text-[12px] text-zinc-600 p-6 text-center">문제가 없습니다. 「문제 관리 → 불러오기」에서 먼저 담아주세요.</p>
            ) : items.map((it) => (
              <div key={it.id} className={`rounded-lg border p-2.5 cursor-pointer ${sel.has(it.questionId) ? 'border-violet-500/60 bg-violet-500/10' : 'border-zinc-800 hover:border-zinc-600'}`}
                onClick={() => openPreview(it.questionId)}>
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={sel.has(it.questionId)} onChange={(e) => { e.stopPropagation(); setSel((s) => { const n = new Set(s); if (n.has(it.questionId)) n.delete(it.questionId); else n.add(it.questionId); return n; }); }}
                    onClick={(e) => e.stopPropagation()} className="accent-violet-400" />
                  <span className="px-1 py-0.5 rounded bg-violet-500/20 text-violet-300 text-[10px]">{it.type}</span>
                  <span className="text-[10px] text-zinc-600 truncate">{it.source}</span>
                </div>
                <div className="text-[12px] text-zinc-300 truncate mt-1">{it.question}</div>
              </div>
            ))}
          </div>
          {/* 미리보기 */}
          <div className="overflow-y-auto p-4 bg-zinc-950/40">
            {previewLoading ? (
              <div className="p-10 text-center"><div className="w-5 h-5 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
            ) : !preview ? (
              <p className="text-[12px] text-zinc-600 p-6 text-center">왼쪽에서 문제를 클릭하면 미리보기가 표시됩니다.</p>
            ) : (
              <div className="bg-white rounded-lg p-4 text-[13px] text-zinc-900 leading-relaxed">
                <div className="font-bold mb-2">{preview.question} <span className="font-normal text-[11px] text-zinc-400">{preview.serial}·{preview.type}</span></div>
                {preview.paragraph && <div className="border border-zinc-400 rounded p-2.5 mb-2 text-[12.5px]" dangerouslySetInnerHTML={{ __html: safeUnderlineHtml(preview.paragraph) }} />}
                {preview.options.filter((o) => o.trim()).map((o, i) => <div key={i} className="text-[12.5px]">{CIRCLED[i]} {o}</div>)}
                <div className="mt-2 pt-2 border-t border-zinc-200 text-[12px] text-zinc-500">정답 {preview.answer}{preview.explanation ? ` — ${preview.explanation.replace(/<\/?u>/g, '')}` : ''}</div>
              </div>
            )}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center gap-3">
          <span className="text-[12px] text-zinc-500">{sel.size}개 선택</span>
          <button onClick={doInsert} disabled={inserting || sel.size === 0}
            className="ml-auto px-4 py-2 rounded-lg bg-violet-600/80 text-zinc-100 text-sm font-semibold hover:bg-violet-500 disabled:opacity-40">
            {inserting ? '불러오는 중…' : `현재 페이지에 ${sel.size}개 삽입`}
          </button>
        </div>
      </div>
    </div>
  );
}
