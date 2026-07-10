'use client';

/**
 * PDF 편집 — 여러 PDF 를 브라우저에서 열어 페이지 합치기·순서 변경·회전·삭제 후 새 PDF 로 내려받는 도구.
 * 파일은 서버로 업로드하지 않는다(전부 브라우저 안에서 pdf-lib 로 처리).
 * 본문 텍스트 수정은 PDF 특성상 지원하지 않음(페이지 단위 편집 전용).
 */
import { useRef, useState } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';

interface SrcFile { name: string; doc: PDFDocument; pageCount: number }
/** 출력 페이지 한 장 — 원본 파일/페이지 + 추가 회전 */
interface OutPage { fileIdx: number; pageIdx: number; rot: 0 | 90 | 180 | 270 }

const FILE_COLORS = ['text-sky-300 border-sky-500/40', 'text-emerald-300 border-emerald-500/40', 'text-amber-300 border-amber-500/40', 'text-violet-300 border-violet-500/40', 'text-rose-300 border-rose-500/40'];

export default function PdfEditPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<SrcFile[]>([]);
  const [pages, setPages] = useState<OutPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [selIdx, setSelIdx] = useState<number | null>(null);

  const addFiles = async (list: FileList) => {
    setLoading(true); setError('');
    try {
      const next = [...files];
      const nextPages = [...pages];
      for (const f of Array.from(list)) {
        if (!/\.pdf$/i.test(f.name)) continue;
        let doc: PDFDocument;
        try {
          doc = await PDFDocument.load(await f.arrayBuffer());
        } catch {
          setError((prev) => (prev ? prev + ' · ' : '') + `「${f.name}」 은 열 수 없어요 (암호화되었거나 손상된 PDF).`);
          continue;
        }
        const fileIdx = next.length;
        next.push({ name: f.name, doc, pageCount: doc.getPageCount() });
        for (let p = 0; p < doc.getPageCount(); p++) nextPages.push({ fileIdx, pageIdx: p, rot: 0 });
      }
      setFiles(next);
      setPages(nextPages);
    } catch {
      setError('파일을 여는 데 실패했어요.');
    }
    setLoading(false);
  };

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= pages.length) return;
    setPages((prev) => { const n = [...prev]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setSelIdx(j);
  };
  const rotate = (i: number) => setPages((prev) => prev.map((p, k) => (k === i ? { ...p, rot: (((p.rot + 90) % 360) as OutPage['rot']) } : p)));
  const remove = (i: number) => { setPages((prev) => prev.filter((_, k) => k !== i)); setSelIdx(null); };
  const reset = () => { setFiles([]); setPages([]); setSelIdx(null); setError(''); };

  const download = async () => {
    if (pages.length === 0 || saving) return;
    setSaving(true); setError('');
    try {
      const out = await PDFDocument.create();
      // 파일별로 묶어 copyPages 호출을 줄임
      for (const p of pages) {
        const [copied] = await out.copyPages(files[p.fileIdx].doc, [p.pageIdx]);
        if (p.rot) copied.setRotation(degrees((copied.getRotation().angle + p.rot) % 360));
        out.addPage(copied);
      }
      const bytes = await out.save();
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = files.length === 1 ? files[0].name.replace(/\.pdf$/i, '') + ' (편집).pdf' : 'PDF 편집본.pdf';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch {
      setError('PDF 생성에 실패했어요. 파일을 다시 열어 시도해주세요.');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">PDF 편집</h1>
          <p className="text-sm text-zinc-500 mt-0.5">여러 PDF 를 합치고 페이지 순서 변경·회전·삭제 후 새 PDF 로 내려받습니다. <b className="text-zinc-400">파일은 서버로 올라가지 않아요</b> (브라우저 안에서만 처리).</p>
        </div>
        {pages.length > 0 && (
          <button onClick={download} disabled={saving}
            className="px-4 py-2 rounded-lg bg-rose-600/80 text-zinc-100 text-sm font-semibold hover:bg-rose-500 disabled:opacity-50">
            {saving ? '만드는 중…' : `⬇ PDF 다운로드 (${pages.length}쪽)`}
          </button>
        )}
      </div>

      {/* 파일 추가 */}
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 flex items-center gap-3 flex-wrap">
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="hidden"
          onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ''; }} />
        <button onClick={() => fileRef.current?.click()} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-100 text-sm font-medium hover:bg-zinc-700">
          📂 PDF 열기 (여러 개 가능)
        </button>
        {files.map((f, i) => (
          <span key={i} className={`px-2 py-1 rounded-md border bg-zinc-900/60 text-[12px] ${FILE_COLORS[i % FILE_COLORS.length]}`}>
            {String.fromCharCode(65 + i)} · {f.name} <span className="opacity-60">{f.pageCount}쪽</span>
          </span>
        ))}
        {files.length > 0 && <button onClick={reset} className="text-[12px] text-zinc-500 hover:text-zinc-300">전체 비우기</button>}
        {loading && <div className="w-4 h-4 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />}
      </div>

      {error && <p className="text-[13px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3.5 py-2.5">{error}</p>}

      {/* 출력 페이지 배열 */}
      {pages.length > 0 && (
        <>
          <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
            <p className="text-[11px] text-zinc-500 mb-2.5">아래 순서 그대로 새 PDF 가 만들어져요. 카드를 클릭해 이동(←→)·회전(↻)·삭제(×) 하세요.</p>
            <div className="flex flex-wrap gap-2">
              {pages.map((p, i) => {
                const on = selIdx === i;
                return (
                  <button key={`${p.fileIdx}-${p.pageIdx}-${i}`} onClick={() => setSelIdx(on ? null : i)}
                    className={`relative rounded-lg border px-3 py-2 text-left transition-colors ${on ? 'border-amber-400/80 bg-amber-500/10' : `bg-zinc-900/70 hover:bg-zinc-800/70 ${FILE_COLORS[p.fileIdx % FILE_COLORS.length]}`}`}>
                    <span className="block text-[13px] font-bold">{String.fromCharCode(65 + p.fileIdx)}-{p.pageIdx + 1}</span>
                    <span className="block text-[10px] text-zinc-500">{i + 1}번째{p.rot ? ` · ↻${p.rot}°` : ''}</span>
                  </button>
                );
              })}
            </div>
            {selIdx != null && pages[selIdx] && (
              <div className="mt-3 pt-3 border-t border-zinc-800/70 flex items-center gap-1.5 flex-wrap">
                <span className="text-[12px] text-zinc-400 mr-1.5">
                  {String.fromCharCode(65 + pages[selIdx].fileIdx)}-{pages[selIdx].pageIdx + 1} ({files[pages[selIdx].fileIdx]?.name})
                </span>
                <button onClick={() => move(selIdx, -1)} className="px-2.5 py-1.5 rounded-md bg-zinc-800 text-zinc-300 text-[12px] hover:bg-zinc-700">← 앞으로</button>
                <button onClick={() => move(selIdx, 1)} className="px-2.5 py-1.5 rounded-md bg-zinc-800 text-zinc-300 text-[12px] hover:bg-zinc-700">뒤로 →</button>
                <button onClick={() => rotate(selIdx)} className="px-2.5 py-1.5 rounded-md bg-zinc-800 text-zinc-300 text-[12px] hover:bg-zinc-700">↻ 90° 회전</button>
                <button onClick={() => remove(selIdx)} className="px-2.5 py-1.5 rounded-md bg-rose-600/30 text-rose-200 text-[12px] hover:bg-rose-600/50">× 페이지 삭제</button>
              </div>
            )}
          </div>
          <p className="text-[11px] text-zinc-600">PDF 는 파일 특성상 본문 글자 수정은 지원하지 않아요 — 페이지 단위 편집(합치기·순서·회전·삭제) 전용입니다. 문서 내용 수정은 교재 스튜디오나 한글파일 편집을 이용해주세요.</p>
        </>
      )}
    </div>
  );
}
