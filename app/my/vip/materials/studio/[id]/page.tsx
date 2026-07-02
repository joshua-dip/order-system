'use client';

/**
 * 교재 스튜디오 편집기 — A4 캔버스 자유 배치 (드래그·리사이즈·속성·페이지·문제 불러오기·PDF/HWPX).
 * 좌표는 mm (A4 210×297). 화면 표시는 S(px/mm) 배율.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import {
  A4_W, A4_H, buildCoverPage,
  type StudioElement, type StudioPage, type StudioDifficulty,
} from '@/lib/vip-material-studio';

const uid = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const PT2MM = 25.4 / 72;
const CIRCLED = ['①', '②', '③', '④', '⑤'];

/** <u> 만 허용하는 안전 렌더 (그 외 태그는 이스케이프) */
function safeUnderlineHtml(s: string): string {
  const esc = (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/&lt;u&gt;/g, '<u>').replace(/&lt;\/u&gt;/g, '</u>').replace(/\n/g, '<br/>');
}

interface BankItem { id: string; questionId: string; serialNo: number | null; type: string; textbook: string; source: string; question: string; preview: string; folder: string }
interface FullQ { qid: string; serial: string; type: string; textbook: string; source: string; question: string; paragraph: string; options: string[]; answer: string; explanation: string }

export default function StudioEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [title, setTitle] = useState('');
  const [difficulty, setDifficulty] = useState('기초');
  const [pages, setPages] = useState<StudioPage[]>([]);
  const [pi, setPi] = useState(0); // 현재 페이지 index
  const [selId, setSelId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [qrCache, setQrCache] = useState<Record<string, string>>({});
  const [qModal, setQModal] = useState(false);

  const S = 3.2 * zoom; // px per mm
  const histRef = useRef<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileModeRef = useRef<'element' | 'cover'>('element');
  const dragRef = useRef<{ mode: 'move' | 'e' | 's' | 'se'; elId: string; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);

  const page = pages[pi];
  const sel = useMemo(() => page?.elements.find((e) => e.id === selId) ?? null, [page, selId]);

  /* ── 로드 ── */
  useEffect(() => {
    let alive = true;
    (async () => {
      const d = await fetch(`/api/my/vip/materials/studio/${id}`, { credentials: 'include' }).then((r) => r.json()).catch(() => null);
      if (!alive) return;
      if (d?.ok) {
        setTitle(d.doc.title); setDifficulty(d.doc.difficulty || '기초'); setPages(d.doc.pages as StudioPage[]);
      } else { alert(d?.error || '불러오기 실패'); router.push('/my/vip/materials/studio'); }
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

  const addEl = useCallback((el: Omit<StudioElement, 'id' | 'z'>) => {
    const nid = uid();
    commit((prev) => prev.map((p, i) => {
      if (i !== pi) return p;
      const maxZ = p.elements.reduce((m, e) => Math.max(m, e.z ?? 0), 0);
      return { ...p, elements: [...p.elements, { ...el, id: nid, z: maxZ + 1 } as StudioElement] };
    }));
    setSelId(nid);
  }, [commit, pi]);

  const removeEl = useCallback((elId: string) => {
    commit((prev) => prev.map((p, i) => (i !== pi ? p : { ...p, elements: p.elements.filter((e) => e.id !== elId) })));
    setSelId(null);
  }, [commit, pi]);

  const duplicateEl = useCallback((elId: string) => {
    commit((prev) => prev.map((p, i) => {
      if (i !== pi) return p;
      const src = p.elements.find((e) => e.id === elId);
      if (!src) return p;
      const maxZ = p.elements.reduce((m, e) => Math.max(m, e.z ?? 0), 0);
      return { ...p, elements: [...p.elements, { ...JSON.parse(JSON.stringify(src)), id: uid(), x: src.x + 5, y: src.y + 5, z: maxZ + 1 }] };
    }));
  }, [commit, pi]);

  /* ── 드래그·리사이즈 ── */
  const startDrag = (e: React.PointerEvent, elId: string, mode: 'move' | 'e' | 's' | 'se') => {
    e.stopPropagation(); e.preventDefault();
    const el = page?.elements.find((x) => x.id === elId);
    if (!el) return;
    setSelId(elId);
    dragRef.current = { mode, elId, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h };
    histRef.current.push(JSON.stringify(pages));
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current; if (!d) return;
      const dx = (ev.clientX - d.sx) / S, dy = (ev.clientY - d.sy) / S;
      const snap = (v: number) => Math.round(v * 2) / 2;
      setPages((prev) => prev.map((p, i) => i !== pi ? p : {
        ...p,
        elements: p.elements.map((x) => {
          if (x.id !== d.elId) return x;
          if (d.mode === 'move') return { ...x, x: snap(d.ox + dx), y: snap(d.oy + dy) };
          const nw = d.mode !== 's' ? Math.max(2, snap(d.ow + dx)) : x.w;
          const nh = d.mode !== 'e' ? Math.max(1, snap(d.oh + dy)) : x.h;
          return { ...x, w: nw, h: nh };
        }),
      }));
      setSaveState('dirty');
    };
    const onUp = () => { dragRef.current = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  /* ── 키보드 ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (!selId) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateEl(selId); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeEl(selId); return; }
      const step = e.shiftKey ? 5 : 1;
      const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (mv[e.key]) {
        e.preventDefault();
        const el = page?.elements.find((x) => x.id === selId);
        if (el) patchEl(selId, { x: el.x + mv[e.key][0], y: el.y + mv[e.key][1] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selId, page, patchEl, removeEl, duplicateEl, undo]);

  /* ── 페이지 조작 ── */
  const addPage = () => { commit((prev) => { const n = [...prev]; n.splice(pi + 1, 0, { id: uid(), elements: [] }); return n; }); setPi(pi + 1); };
  const dupPage = () => {
    commit((prev) => {
      const n = [...prev];
      const copy: StudioPage = JSON.parse(JSON.stringify(prev[pi]));
      copy.id = uid(); copy.elements.forEach((e) => { e.id = uid(); });
      n.splice(pi + 1, 0, copy); return n;
    });
    setPi(pi + 1);
  };
  const delPage = () => {
    if (pages.length <= 1) { alert('마지막 페이지는 삭제할 수 없습니다.'); return; }
    if (!confirm(`${pi + 1}페이지를 삭제할까요?`)) return;
    commit((prev) => prev.filter((_, i) => i !== pi));
    setPi(Math.max(0, pi - 1));
  };
  const movePage = (dir: -1 | 1) => {
    const ni = pi + dir;
    if (ni < 0 || ni >= pages.length) return;
    commit((prev) => { const n = [...prev]; const [x] = n.splice(pi, 1); n.splice(ni, 0, x); return n; });
    setPi(ni);
  };

  /* ── 툴바: 요소 추가 ── */
  const addText = () => addEl({ kind: 'text', x: 20, y: 30, w: 120, h: 14, text: '텍스트를 입력하세요', fontSize: 12, color: '#111111', lineHeight: 1.35, align: 'left' });
  const addRect = () => addEl({ kind: 'rect', x: 20, y: 30, w: 80, h: 40, fill: '#f1f5f9', borderColor: '#94a3b8', borderWidth: 0.3, radius: 2 });
  const addLine = () => addEl({ kind: 'line', x: 20, y: 30, w: 170, h: 1, fill: '#334155', borderWidth: 0 });
  const addQr = () => {
    const url = prompt('QR로 연결할 주소(URL)를 입력하세요.\n예: 강의 영상, 추가 문제 링크');
    if (!url?.trim()) return;
    const label = prompt('QR 아래에 표시할 설명 (선택)', '📱 스캔해서 영상 보기') ?? '';
    addEl({ kind: 'qr', x: 165, y: 240, w: 30, h: label ? 36 : 30, qrUrl: url.trim(), qrLabel: label.trim() });
  };
  const insertCoverTemplate = () => {
    const cover = buildCoverPage({ title: title || '특강 교재', subtitle: '부제를 입력하세요', level: (['기초', '심화', '고난도'].includes(difficulty) ? difficulty : '기초') as StudioDifficulty });
    commit((prev) => { const n = [...prev]; n.splice(0, 0, cover); return n; });
    setPi(0);
  };
  const pickImage = (mode: 'element' | 'cover') => { fileModeRef.current = mode; fileRef.current?.click(); };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    const d = await fetch('/api/my/vip/materials/studio/upload', { method: 'POST', credentials: 'include', body: fd }).then((r) => r.json()).catch(() => null);
    if (!d?.ok) { alert(d?.error || '업로드 실패'); return; }
    // 자연 크기 → 적절한 크기(최대 폭 120mm) 자동 조절
    const img = new Image();
    img.onload = () => {
      if (fileModeRef.current === 'cover') {
        addEl({ kind: 'image', x: 0, y: 0, w: A4_W, h: A4_H, src: d.url });
        return;
      }
      const natWmm = (img.naturalWidth / 96) * 25.4, natHmm = (img.naturalHeight / 96) * 25.4;
      const w = Math.min(120, Math.max(20, natWmm));
      const h = Math.max(10, (natHmm / natWmm) * w);
      addEl({ kind: 'image', x: 25, y: 40, w: Math.round(w), h: Math.round(h), src: d.url });
    };
    img.src = d.url;
  };

  /* ── 문제 삽입 ── */
  const insertQuestions = (qs: FullQ[], withAnswer: boolean) => {
    if (!page) return;
    let baseNum = 0;
    for (const p of pages) for (const e of p.elements) if (e.kind === 'question' && e.q?.num) baseNum = Math.max(baseNum, e.q.num);
    let y = page.elements.reduce((m, e) => Math.max(m, e.y + e.h), 0) + 4;
    commit((prev) => prev.map((p, i) => {
      if (i !== pi) return p;
      let z = p.elements.reduce((m, e) => Math.max(m, e.z ?? 0), 0);
      const news: StudioElement[] = qs.map((q, k) => {
        const paraLines = Math.ceil((q.paragraph?.length ?? 0) / 85);
        const h = Math.min(230, 14 + paraLines * 4.6 + q.options.filter((o) => o.trim()).length * 6 + (withAnswer ? 8 : 0));
        const el: StudioElement = {
          id: uid(), kind: 'question', x: 15, y, w: 180, h, z: ++z, fontSize: 10,
          q: { qid: q.qid, serial: q.serial, type: q.type, num: baseNum + k + 1, question: q.question, paragraph: q.paragraph, options: q.options, answer: q.answer, explanation: q.explanation, showAnswer: withAnswer },
        };
        y += h + 4;
        return el;
      });
      return { ...p, elements: [...p.elements, ...news] };
    }));
    setQModal(false);
  };

  if (loading) return <div className="p-16 text-center"><div className="w-7 h-7 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-3 select-none">
      {/* 툴바 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 px-3 py-2 sticky top-0 z-30 backdrop-blur">
        <button onClick={() => router.push('/my/vip/materials/studio')} className="text-zinc-500 hover:text-zinc-200 text-sm px-1">←</button>
        <input value={title} onChange={(e) => { setTitle(e.target.value); setSaveState('dirty'); }}
          className="px-2.5 py-1.5 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100 font-semibold w-56" />
        <span className={`text-[11px] ${saveState === 'saved' ? 'text-emerald-400/80' : saveState === 'saving' ? 'text-amber-300/80' : 'text-zinc-500'}`}>
          {saveState === 'saved' ? '✓ 저장됨' : saveState === 'saving' ? '저장 중…' : '수정됨'}
        </span>
        <div className="mx-1 h-5 w-px bg-zinc-800" />
        <button onClick={addText} className="tb">＋ 텍스트</button>
        <button onClick={() => pickImage('element')} className="tb">🖼 이미지</button>
        <button onClick={addQr} className="tb">▣ QR</button>
        <button onClick={addRect} className="tb">▢ 상자</button>
        <button onClick={addLine} className="tb">― 구분선</button>
        <button onClick={() => setQModal(true)} className="px-2.5 py-1.5 rounded-lg bg-violet-500/20 text-violet-200 text-[12px] font-semibold hover:bg-violet-500/30">📚 문제 불러오기</button>
        <div className="mx-1 h-5 w-px bg-zinc-800" />
        <button onClick={insertCoverTemplate} className="tb">📕 표지 템플릿</button>
        <button onClick={() => pickImage('cover')} className="tb">🖼 이미지 표지</button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={undo} className="tb" title="Ctrl+Z">↩ 되돌리기</button>
          <button onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.15) * 100) / 100))} className="tb">－</button>
          <span className="text-[11px] text-zinc-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.15) * 100) / 100))} className="tb">＋</button>
          <a href={`/api/my/vip/materials/studio/${id}/pdf`} className="px-3 py-1.5 rounded-lg bg-rose-600/80 text-zinc-100 text-[12px] font-semibold hover:bg-rose-500">PDF</a>
          <a href={`/api/my/vip/materials/studio/${id}/hwpx`} className="px-3 py-1.5 rounded-lg bg-sky-600/70 text-zinc-100 text-[12px] font-semibold hover:bg-sky-500">HWPX</a>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={onFile} className="hidden" />

      <div className="grid grid-cols-[120px_1fr_270px] gap-3 items-start">
        {/* 페이지 썸네일 */}
        <div className="space-y-2 max-h-[75vh] overflow-y-auto pr-1">
          {pages.map((p, i) => (
            <button key={p.id} onClick={() => { setPi(i); setSelId(null); }}
              className={`w-full rounded-lg border text-left overflow-hidden ${i === pi ? 'border-amber-400/70 ring-1 ring-amber-400/40' : 'border-zinc-800 hover:border-zinc-600'}`}>
              <div className="bg-white relative" style={{ width: '100%', aspectRatio: '210/297' }}>
                {p.elements.slice(0, 40).map((e) => (
                  <div key={e.id} className="absolute" style={{
                    left: `${(e.x / A4_W) * 100}%`, top: `${(e.y / A4_H) * 100}%`, width: `${(e.w / A4_W) * 100}%`, height: `${(e.h / A4_H) * 100}%`,
                    background: e.kind === 'rect' || e.kind === 'line' ? (e.fill || '#eee') : e.kind === 'text' ? (e.bg || 'transparent') : e.kind === 'question' ? '#ede9fe' : '#e5e7eb',
                    outline: e.kind === 'text' && !e.bg ? '0.5px solid #e5e7eb' : undefined,
                  }} />
                ))}
              </div>
              <div className="px-1.5 py-0.5 text-[10px] text-zinc-500 bg-zinc-900/60">{i + 1}</div>
            </button>
          ))}
          <div className="flex flex-wrap gap-1 pt-1">
            <button onClick={addPage} className="tbx">＋추가</button>
            <button onClick={dupPage} className="tbx">복제</button>
            <button onClick={() => movePage(-1)} className="tbx">↑</button>
            <button onClick={() => movePage(1)} className="tbx">↓</button>
            <button onClick={delPage} className="tbx text-rose-400/80">삭제</button>
          </div>
        </div>

        {/* 캔버스 */}
        <div className="overflow-auto max-h-[78vh] rounded-xl bg-zinc-950/60 border border-zinc-800/60 p-6 flex justify-center" onPointerDown={() => setSelId(null)}>
          {page && (
            <div className="relative bg-white shadow-2xl shrink-0" style={{ width: A4_W * S, height: A4_H * S }}>
              {[...page.elements].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)).map((e) => (
                <ElementView key={e.id} el={e} S={S} selected={e.id === selId} qr={e.qrUrl ? qrCache[e.qrUrl] : undefined}
                  onDown={(ev) => startDrag(ev, e.id, 'move')} onHandle={(ev, m) => startDrag(ev, e.id, m)} />
              ))}
            </div>
          )}
        </div>

        {/* 속성 패널 */}
        <PropsPanel sel={sel} onPatch={(p) => sel && patchEl(sel.id, p)} onRemove={() => sel && removeEl(sel.id)} onDup={() => sel && duplicateEl(sel.id)}
          onZ={(dir) => { if (!sel) return; patchEl(sel.id, { z: Math.max(0, (sel.z ?? 0) + dir) }); }} />
      </div>

      {qModal && <QuestionModal onClose={() => setQModal(false)} onInsert={insertQuestions} />}

      <style jsx global>{`
        .tb { padding: 6px 10px; border-radius: 8px; background: rgba(63,63,70,.5); color: #d4d4d8; font-size: 12px; }
        .tb:hover { background: rgba(82,82,91,.6); color: #fafafa; }
        .tbx { padding: 3px 8px; border-radius: 6px; background: rgba(63,63,70,.5); color: #a1a1aa; font-size: 11px; }
        .tbx:hover { background: rgba(82,82,91,.6); }
        .prop-in { width: 100%; padding: 6px 8px; border-radius: 8px; background: rgba(24,24,27,.7); border: 1px solid rgba(63,63,70,.7); color: #f4f4f5; font-size: 12px; }
      `}</style>
    </div>
  );
}

/* ───────────── 요소 렌더 ───────────── */
function ElementView({ el, S, selected, qr, onDown, onHandle }: {
  el: StudioElement; S: number; selected: boolean; qr?: string;
  onDown: (e: React.PointerEvent) => void; onHandle: (e: React.PointerEvent, m: 'e' | 's' | 'se') => void;
}) {
  const box: React.CSSProperties = { position: 'absolute', left: el.x * S, top: el.y * S, width: el.w * S, height: el.h * S, cursor: 'move' };
  const ptPx = (pt: number) => pt * PT2MM * S;
  let inner: React.ReactNode = null;
  if (el.kind === 'text') {
    inner = (
      <div className="w-full h-full overflow-hidden" style={{
        fontSize: ptPx(el.fontSize ?? 11), fontWeight: el.bold ? 700 : 400, color: el.color || '#111',
        background: el.bg || 'transparent', textAlign: el.align ?? 'left', lineHeight: el.lineHeight ?? 1.35,
        border: el.borderColor && (el.borderWidth ?? 0) > 0 ? `${Math.max(1, (el.borderWidth ?? 0.3) * S)}px solid ${el.borderColor}` : undefined,
        padding: 1.2 * S, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: "'NanumGothic','Apple SD Gothic Neo',sans-serif",
      }} dangerouslySetInnerHTML={{ __html: safeUnderlineHtml(el.text ?? '') }} />
    );
  } else if (el.kind === 'rect' || el.kind === 'line') {
    inner = <div className="w-full h-full" style={{ background: el.fill || 'transparent', borderRadius: (el.radius ?? 0) * S, border: el.borderColor && (el.borderWidth ?? 0) > 0 ? `${Math.max(1, (el.borderWidth ?? 0) * S)}px solid ${el.borderColor}` : undefined }} />;
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
    <div style={box} onPointerDown={onDown} className={selected ? 'z-20' : ''}>
      {inner}
      {selected && (
        <>
          <div className="absolute inset-0 pointer-events-none" style={{ outline: '1.5px solid #6366f1', outlineOffset: 0 }} />
          <div onPointerDown={(e) => onHandle(e, 'e')} className="absolute w-2.5 h-2.5 bg-indigo-500 rounded-full" style={{ right: -5, top: '50%', marginTop: -5, cursor: 'ew-resize' }} />
          <div onPointerDown={(e) => onHandle(e, 's')} className="absolute w-2.5 h-2.5 bg-indigo-500 rounded-full" style={{ bottom: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' }} />
          <div onPointerDown={(e) => onHandle(e, 'se')} className="absolute w-3 h-3 bg-indigo-500 rounded-sm" style={{ right: -6, bottom: -6, cursor: 'nwse-resize' }} />
        </>
      )}
    </div>
  );
}

/* ───────────── 속성 패널 ───────────── */
function PropsPanel({ sel, onPatch, onRemove, onDup, onZ }: {
  sel: StudioElement | null; onPatch: (p: Partial<StudioElement>) => void; onRemove: () => void; onDup: () => void; onZ: (dir: 1 | -1) => void;
}) {
  if (!sel) {
    return (
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 text-[12px] text-zinc-600 leading-relaxed">
        요소를 클릭해 선택하세요.<br /><br />
        · 드래그 = 이동, 모서리 점 = 크기<br />
        · 방향키 = 1mm 이동 (Shift = 5mm)<br />
        · Delete = 삭제 · Ctrl+D = 복제 · Ctrl+Z = 되돌리기
      </div>
    );
  }
  const KIND_LABEL: Record<string, string> = { text: '텍스트', image: '이미지', qr: 'QR', question: '문제', rect: '상자', line: '구분선' };
  const num = (v: number | undefined, def = 0) => (typeof v === 'number' ? v : def);
  return (
    <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-3.5 space-y-2.5 max-h-[78vh] overflow-y-auto">
      <div className="flex items-center gap-2">
        <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px] font-semibold">{KIND_LABEL[sel.kind]}</span>
        <button onClick={() => onZ(1)} className="tbx" title="앞으로">⬆앞</button>
        <button onClick={() => onZ(-1)} className="tbx" title="뒤로">⬇뒤</button>
        <button onClick={onDup} className="tbx">복제</button>
        <button onClick={onRemove} className="tbx text-rose-400/80 ml-auto">삭제</button>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {(['x', 'y', 'w', 'h'] as const).map((k) => (
          <label key={k} className="text-[10px] text-zinc-500">
            {k.toUpperCase()}
            <input type="number" step={0.5} value={num(sel[k])} onChange={(e) => onPatch({ [k]: parseFloat(e.target.value) || 0 })} className="prop-in mt-0.5" />
          </label>
        ))}
      </div>
      {sel.kind === 'text' && (
        <>
          <textarea value={sel.text ?? ''} onChange={(e) => onPatch({ text: e.target.value })} rows={6} className="prop-in resize-y" placeholder={'내용 (<u>밑줄</u> 사용 가능)'} />
          <div className="grid grid-cols-2 gap-1.5">
            <label className="text-[10px] text-zinc-500">크기(pt)<input type="number" step={0.5} value={num(sel.fontSize, 11)} onChange={(e) => onPatch({ fontSize: parseFloat(e.target.value) || 11 })} className="prop-in mt-0.5" /></label>
            <label className="text-[10px] text-zinc-500">줄간격<input type="number" step={0.05} value={num(sel.lineHeight, 1.35)} onChange={(e) => onPatch({ lineHeight: parseFloat(e.target.value) || 1.35 })} className="prop-in mt-0.5" /></label>
          </div>
          <div className="flex gap-1.5">
            <button onClick={() => onPatch({ bold: !sel.bold })} className={`tbx ${sel.bold ? 'bg-zinc-200 text-zinc-900' : ''}`}>B</button>
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} onClick={() => onPatch({ align: a })} className={`tbx ${sel.align === a ? 'bg-zinc-200 text-zinc-900' : ''}`}>{a === 'left' ? '⯇' : a === 'center' ? '↔' : '⯈'}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <label className="text-[10px] text-zinc-500">글자색<input type="color" value={sel.color || '#111111'} onChange={(e) => onPatch({ color: e.target.value })} className="prop-in mt-0.5 h-8 p-0.5" /></label>
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
function QuestionModal({ onClose, onInsert }: { onClose: () => void; onInsert: (qs: FullQ[], withAnswer: boolean) => void }) {
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
    if (ids.length === 0) { alert('삽입할 문제를 선택하세요.'); return; }
    setInserting(true);
    const d = await fetch(`/api/my/vip/materials/studio/question?ids=${ids.join(',')}`, { credentials: 'include' }).then((r) => r.json()).catch(() => null);
    setInserting(false);
    if (!d?.ok || !Array.isArray(d.items) || d.items.length === 0) { alert('문제를 불러오지 못했습니다.'); return; }
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
