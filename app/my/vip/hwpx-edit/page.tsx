'use client';

/**
 * 한글파일 편집 — .hwpx(OWPML=ZIP+XML) 를 브라우저에서 열어 텍스트만 고쳐 다시 내려받는 도구.
 * 파일은 서버로 업로드하지 않는다(전부 브라우저 안에서 jszip 으로 처리).
 * v1 범위: 본문 섹션(Contents/section*.xml)의 텍스트(hp:t) 편집 + 찾아 바꾸기. 서식·표·이미지는 그대로 유지.
 */
import { useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';

interface Chunk {
  /** section 파일 경로 */
  sec: string;
  /** 해당 섹션 안에서 몇 번째 hp:t 인지 */
  idx: number;
  original: string;
  text: string;
}

export default function HwpxEditPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<JSZip | null>(null);
  /** 섹션별 파싱된 XML 문서 + t 노드 목록 (저장 시 재직렬화) */
  const docsRef = useRef<Record<string, { doc: Document; tNodes: Element[] }>>({});
  const [fileName, setFileName] = useState('');
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [filter, setFilter] = useState('');

  const editedCount = useMemo(() => chunks.filter((c) => c.text !== c.original).length, [chunks]);
  const matchCount = useMemo(() => {
    if (!find) return 0;
    return chunks.reduce((n, c) => n + c.text.split(find).length - 1, 0);
  }, [chunks, find]);

  const open = async (f: File) => {
    setLoading(true); setError(''); setChunks([]);
    try {
      const zip = await JSZip.loadAsync(await f.arrayBuffer());
      // OWPML 본문 섹션 파일들 (Contents/section0.xml …)
      const secNames = Object.keys(zip.files)
        .filter((n) => /contents\/section\d+\.xml$/i.test(n))
        .sort((a, b) => (parseInt(a.match(/(\d+)\.xml$/)?.[1] ?? '0') - parseInt(b.match(/(\d+)\.xml$/)?.[1] ?? '0')));
      if (secNames.length === 0) throw new Error('본문 섹션(Contents/section*.xml)을 찾지 못했어요. hwpx 파일이 맞는지 확인해주세요. (암호화된 문서는 열 수 없습니다)');
      const parser = new DOMParser();
      const docs: Record<string, { doc: Document; tNodes: Element[] }> = {};
      const list: Chunk[] = [];
      for (const sec of secNames) {
        const xml = await zip.files[sec].async('string');
        const doc = parser.parseFromString(xml, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length > 0) throw new Error(`${sec} XML 해석에 실패했어요.`);
        // hp:t = 본문 텍스트 런 (네임스페이스 프리픽스 무관하게 localName 으로 수집)
        const tNodes = [...doc.getElementsByTagName('*')].filter((n) => n.localName === 't');
        docs[sec] = { doc, tNodes };
        tNodes.forEach((n, idx) => {
          const text = n.textContent ?? '';
          if (text.trim()) list.push({ sec, idx, original: text, text });
        });
      }
      zipRef.current = zip;
      docsRef.current = docs;
      setFileName(f.name);
      setChunks(list);
      if (list.length === 0) setError('편집할 텍스트가 없는 문서예요.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일을 여는 데 실패했어요.');
      zipRef.current = null;
    }
    setLoading(false);
  };

  const replaceAll = () => {
    if (!find) return;
    setChunks((prev) => prev.map((c) => (c.text.includes(find) ? { ...c, text: c.text.split(find).join(replace) } : c)));
  };

  const download = async () => {
    const zip = zipRef.current;
    if (!zip || saving) return;
    setSaving(true); setError('');
    try {
      // 수정 텍스트를 XML 노드에 반영 후 섹션 파일만 교체
      for (const c of chunks) {
        if (c.text === c.original) continue;
        const d = docsRef.current[c.sec];
        if (d?.tNodes[c.idx]) d.tNodes[c.idx].textContent = c.text;
      }
      const ser = new XMLSerializer();
      const touched = new Set(chunks.filter((c) => c.text !== c.original).map((c) => c.sec));
      for (const sec of touched) zip.file(sec, ser.serializeToString(docsRef.current[sec].doc));
      // mimetype 은 무압축(STORE) 유지 — OCF 규약
      if (zip.files['mimetype']) {
        const mt = await zip.files['mimetype'].async('string');
        zip.file('mimetype', mt, { compression: 'STORE' });
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/hwp+zip' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName.replace(/\.hwpx$/i, '') + ' (수정).hwpx';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      // 저장본 기준으로 original 갱신
      setChunks((prev) => prev.map((c) => ({ ...c, original: c.text })));
    } catch {
      setError('저장에 실패했어요. 파일을 다시 열어 시도해주세요.');
    }
    setSaving(false);
  };

  const visible = filter ? chunks.filter((c) => c.text.includes(filter) || c.original.includes(filter)) : chunks;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">한글파일 편집</h1>
          <p className="text-sm text-zinc-500 mt-0.5">.hwpx 파일을 열어 텍스트를 고치고 다시 내려받습니다. 서식·표·이미지는 그대로, <b className="text-zinc-400">파일은 서버로 올라가지 않아요</b> (브라우저 안에서만 처리).</p>
        </div>
        {chunks.length > 0 && (
          <button onClick={download} disabled={saving}
            className="px-4 py-2 rounded-lg bg-sky-600/80 text-zinc-100 text-sm font-semibold hover:bg-sky-500 disabled:opacity-50">
            {saving ? '만드는 중…' : `⬇ 수정본 다운로드${editedCount ? ` (${editedCount}곳 수정)` : ''}`}
          </button>
        )}
      </div>

      {/* 파일 열기 */}
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 flex items-center gap-3 flex-wrap">
        <input ref={fileRef} type="file" accept=".hwpx" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) open(f); }} />
        <button onClick={() => fileRef.current?.click()} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-100 text-sm font-medium hover:bg-zinc-700">
          📂 HWPX 파일 열기
        </button>
        {fileName && <span className="text-[13px] text-zinc-400">{fileName} <span className="text-zinc-600">— 텍스트 {chunks.length}개</span></span>}
        {loading && <div className="w-4 h-4 border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />}
      </div>

      {error && <p className="text-[13px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3.5 py-2.5">{error}</p>}

      {chunks.length > 0 && (
        <>
          {/* 찾아 바꾸기 */}
          <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 flex items-end gap-2.5 flex-wrap">
            <label className="text-[11px] text-zinc-500">찾을 내용
              <input value={find} onChange={(e) => setFind(e.target.value)} className="block mt-1 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100 w-52" />
            </label>
            <label className="text-[11px] text-zinc-500">바꿀 내용
              <input value={replace} onChange={(e) => setReplace(e.target.value)} className="block mt-1 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100 w-52" />
            </label>
            <button onClick={replaceAll} disabled={!find || matchCount === 0}
              className="px-3.5 py-2 rounded-lg bg-amber-600/70 text-zinc-100 text-sm font-medium hover:bg-amber-500 disabled:opacity-40">
              모두 바꾸기{find ? ` (${matchCount})` : ''}
            </button>
            <label className="text-[11px] text-zinc-500 ml-auto">목록 검색
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="포함 텍스트로 거르기" className="block mt-1 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100 w-52" />
            </label>
          </div>

          {/* 텍스트 목록 */}
          <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 divide-y divide-zinc-800/60 max-h-[62vh] overflow-y-auto">
            {visible.map((c) => {
              const key = `${c.sec}#${c.idx}`;
              const edited = c.text !== c.original;
              return (
                <div key={key} className={`px-4 py-2.5 ${edited ? 'bg-amber-500/5' : ''}`}>
                  <textarea
                    value={c.text}
                    rows={Math.min(6, Math.max(1, Math.ceil(c.text.length / 60)))}
                    onChange={(e) => setChunks((prev) => prev.map((x) => (x.sec === c.sec && x.idx === c.idx ? { ...x, text: e.target.value } : x)))}
                    className={`w-full resize-y bg-transparent text-[13.5px] leading-relaxed outline-none rounded-md px-2 py-1 border ${edited ? 'border-amber-500/40 text-amber-100' : 'border-transparent hover:border-zinc-700/60 text-zinc-200'}`}
                  />
                  {edited && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10.5px] text-zinc-600 line-through truncate max-w-[70%]">{c.original}</span>
                      <button onClick={() => setChunks((prev) => prev.map((x) => (x.sec === c.sec && x.idx === c.idx ? { ...x, text: x.original } : x)))}
                        className="text-[10.5px] text-zinc-500 hover:text-zinc-300">되돌리기</button>
                    </div>
                  )}
                </div>
              );
            })}
            {visible.length === 0 && <p className="p-6 text-center text-[12px] text-zinc-600">검색과 일치하는 텍스트가 없어요.</p>}
          </div>
          <p className="text-[11px] text-zinc-600">수정한 곳은 노란 테두리로 표시돼요. 문단 안에 형광펜 등 특수 표식이 걸친 텍스트는 표식이 단순화될 수 있어요.</p>
        </>
      )}
    </div>
  );
}
