'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Photo { id: string; questionNum: string; name: string; url: string }

/** `교재::sourceKey` 키를 {textbook, sourceKey} 로 분해. */
function parseKey(key: string): { textbook: string; sourceKey: string } {
  const idx = key.indexOf('::');
  if (idx < 0) return { textbook: '', sourceKey: key };
  return { textbook: key.slice(0, idx), sourceKey: key.slice(idx + 2) };
}

/**
 * 시험범위로 설정된 지문(소스)별 학생 필기 사진 업로드/조회/삭제.
 * passages = examScopePassages (`교재::sourceKey` 배열). 지문 번호(sourceKey)별로 사진을 하나씩 모은다.
 */
export default function PassagePhotoGrid({ examId, passages, maxHeight }: { examId: string; passages: string[]; maxHeight?: string }) {
  const [photos, setPhotos] = useState<Record<string, Photo[]>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dragKey, setDragKey] = useState<string | null>(null); // 드래그앤드롭 대상 지문 키
  const [texts, setTexts] = useState<Record<string, string>>({}); // 지문별 영어 본문(툴팁)
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null); // 툴팁 위치
  const [bulkBusy, setBulkBusy] = useState(false); // 폴더 한번에 불러오기 진행중
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null); // 한번에 불러오기 결과

  const loadPhotos = useCallback(async () => {
    setLoading(true);
    const d = await fetch(`/api/my/vip/school-exams/${examId}/question-photos`, { credentials: 'include' }).then((r) => r.json());
    setPhotos(d.ok ? (d.byPassage ?? {}) : {});
    setLoading(false);
  }, [examId]);
  useEffect(() => { loadPhotos(); }, [loadPhotos]);

  // 지문 영어 본문(툴팁용) 로드
  useEffect(() => {
    let alive = true;
    fetch(`/api/my/vip/school-exams/${examId}/passage-texts`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (alive && d.ok) setTexts(d.texts ?? {}); })
      .catch(() => {});
    return () => { alive = false; };
  }, [examId]);

  const upload = async (key: string, file: File) => {
    setUploading(key);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('questionNum', key);
      fd.append('slotType', 'passage');
      const res = await fetch(`/api/my/vip/school-exams/${examId}/question-photos`, { method: 'POST', body: fd, credentials: 'include' });
      const d = await res.json();
      if (res.ok && d.ok) setPhotos((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), d.photo] }));
      else alert(d.error || '업로드 실패');
    } catch { alert('업로드 중 오류가 발생했습니다.'); }
    setUploading(null);
  };

  /** 여러 파일(드래그앤드롭·다중선택) — 이미지만 순차 업로드. */
  const uploadFiles = async (key: string, files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (imgs.length === 0) { alert('이미지 파일만 업로드할 수 있습니다.'); return; }
    for (const f of imgs) await upload(key, f);
  };

  /**
   * 폴더 한번에 불러오기 — 파일명(확장자 제거)을 지문 이름(sourceKey)과 매칭해 자동 업로드.
   * 정확 일치(공백 차이 허용) 1건만 배정, 매칭 실패·중복은 보고만 한다(오배정 방지).
   */
  const bulkImport = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (imgs.length === 0) { setBulkMsg('이미지 파일이 없습니다. (폴더 안 사진 파일명을 지문 이름으로 맞춰주세요)'); return; }
    const nf = (s: string) => s.replace(/\.[^.]+$/, '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
    setBulkBusy(true); setBulkMsg(null); setBulkProgress({ done: 0, total: imgs.length });
    let ok = 0; const unmatched: string[] = []; const ambiguous: string[] = [];
    for (let i = 0; i < imgs.length; i++) {
      const f = imgs[i];
      const fn = nf(f.name); const fns = fn.replace(/\s+/g, '');
      const hits = fileMatchIndex.filter((x) => x.n === fn || x.ns === fns);
      if (hits.length === 1) { await upload(hits[0].key, f); ok++; }
      else if (hits.length > 1) ambiguous.push(f.name);
      else unmatched.push(f.name);
      setBulkProgress({ done: i + 1, total: imgs.length });
    }
    setBulkBusy(false); setBulkProgress(null);
    const parts = [`✓ ${ok}장 매칭·업로드`];
    if (unmatched.length) parts.push(`매칭 실패 ${unmatched.length}개`);
    if (ambiguous.length) parts.push(`이름 중복 ${ambiguous.length}개`);
    let msg = parts.join(' · ');
    if (unmatched.length) msg += ` — 실패: ${unmatched.slice(0, 6).join(', ')}${unmatched.length > 6 ? ` 외 ${unmatched.length - 6}개` : ''}`;
    setBulkMsg(msg);
  };

  const removePhoto = async (key: string, photoId: string) => {
    if (!confirm('사진을 삭제할까요?')) return;
    await fetch(`/api/my/vip/school-exams/${examId}/question-photos?photoId=${photoId}`, { method: 'DELETE', credentials: 'include' });
    setPhotos((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((p) => p.id !== photoId) }));
  };

  // 교재별 그룹 (그룹은 시험범위 선택 순서 유지, 지문은 번호 이름순 정렬)
  const groups = useMemo(() => {
    const byTb: { textbook: string; keys: string[] }[] = [];
    for (const key of passages) {
      const { textbook } = parseKey(key);
      let g = byTb.find((x) => x.textbook === textbook);
      if (!g) { g = { textbook, keys: [] }; byTb.push(g); }
      g.keys.push(key);
    }
    // 지문 번호(sourceKey) 이름순 — 숫자 인식(04<05<06…, UNIT 13<UNIT 15)
    for (const g of byTb) g.keys.sort((a, b) => parseKey(a).sourceKey.localeCompare(parseKey(b).sourceKey, 'ko', { numeric: true }));
    return byTb;
  }, [passages]);

  /** 파일명(확장자 제거) → 지문 매칭 인덱스 (한번에 불러오기용) */
  const fileMatchIndex = useMemo(() => {
    const nf = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
    return passages.map((key) => { const sk = parseKey(key).sourceKey; const n = nf(sk); return { key, n, ns: n.replace(/\s+/g, '') }; });
  }, [passages]);

  const total = Object.values(photos).reduce((s, arr) => s + arr.length, 0);

  if (passages.length === 0) {
    return (
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-8 text-center text-xs text-zinc-600">
        시험범위에 지문(소스)이 없습니다.<br />
        「시험 준비」에서 <span className="text-zinc-400">교재 → 지문 범위(소스)</span>를 먼저 선택하면, 선택한 지문 번호별로 사진을 올릴 수 있어요.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-zinc-500">
        <span>지문(소스)별 학생 필기 사진 <span className="text-zinc-600">· 끌어다 놓거나, 폴더에서 한번에 불러오기</span></span>
        <div className="flex items-center gap-2">
          <span>{loading ? '불러오는 중…' : `지문 ${passages.length}개 · 사진 ${total}장`}</span>
          <label
            className={`inline-flex items-center gap-1 rounded-lg border border-[#c9a44e]/50 bg-[#c9a44e]/10 px-2.5 py-1 text-[11px] font-medium text-[#d8b75f] transition-colors ${bulkBusy ? 'opacity-60 pointer-events-none' : 'cursor-pointer hover:bg-[#c9a44e]/20'}`}
            title="폴더를 선택하면 파일명(=지문 이름)으로 자동 매칭해 한번에 업로드합니다. 파일명을 지문 이름(예: UNIT 13 06번)으로 저장해 두세요."
          >
            <span>📁</span>
            <span>{bulkBusy && bulkProgress ? `불러오는 중 ${bulkProgress.done}/${bulkProgress.total}` : '폴더에서 한번에 불러오기'}</span>
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              ref={(el) => { if (el) { el.setAttribute('webkitdirectory', ''); el.setAttribute('directory', ''); } }}
              onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) void bulkImport(fs); e.target.value = ''; }}
            />
          </label>
        </div>
      </div>
      {bulkMsg && (
        <div className="flex items-start justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-[11px] text-zinc-300">
          <span className="leading-relaxed">{bulkMsg}</span>
          <button onClick={() => setBulkMsg(null)} className="shrink-0 text-zinc-500 hover:text-zinc-300" title="닫기">×</button>
        </div>
      )}
      <div
        className={`rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-y-auto ${maxHeight ?? ''}`}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); }}
      >
        {groups.map((g) => (
          <div key={g.textbook || '_'} className="border-b border-zinc-800/70 last:border-b-0">
            {g.textbook && (
              <div className="px-4 pt-3 pb-1 text-[10px] text-zinc-500 truncate" title={g.textbook}>{g.textbook}</div>
            )}
            <div className="divide-y divide-zinc-800/50">
              {g.keys.map((key) => {
                const { sourceKey } = parseKey(key);
                const ps = photos[key] ?? [];
                return (
                  <div key={key} className="p-4 flex items-start gap-3">
                    <div
                      className={`w-20 flex-shrink-0 pt-0.5 ${texts[key] ? 'cursor-help' : ''}`}
                      onMouseEnter={(e) => {
                        if (!texts[key]) return;
                        const r = e.currentTarget.getBoundingClientRect();
                        setHover({ key, x: r.right + 10, y: r.top });
                      }}
                      onMouseLeave={() => setHover((h) => (h?.key === key ? null : h))}
                    >
                      <div className="text-[10px] text-zinc-500 mb-0.5">지문{texts[key] ? ' ⓘ' : ''}</div>
                      <div className="font-bold text-zinc-200 text-sm break-keep leading-tight">{sourceKey}</div>
                      <a
                        href={`/my/vip/studio?examId=${examId}&key=${encodeURIComponent(key)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 inline-block text-[10px] font-medium text-[#d8b75f] hover:text-[#e8c97f] hover:underline"
                        title="이 지문을 「출제 스튜디오」에서 분석·출제합니다"
                      >📝 지문 분석</a>
                    </div>
                    <div
                      className={`flex-1 min-w-0 rounded-lg transition-colors ${dragKey === key ? 'ring-2 ring-[#c9a44e]/70 bg-[#c9a44e]/10 -m-1 p-1' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (dragKey !== key) setDragKey(key); }}
                      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragKey((k) => (k === key ? null : k)); }}
                      onDrop={(e) => { e.preventDefault(); setDragKey(null); const files = Array.from(e.dataTransfer.files ?? []); if (files.length) void uploadFiles(key, files); }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {ps.map((p) => (
                          <div key={p.id} className="relative group">
                            {p.url
                              ? <a href={p.url} target="_blank" rel="noopener noreferrer"><img src={p.url} alt={p.name} className="w-20 h-20 object-cover rounded-lg border border-zinc-700" /></a>
                              : <div className="w-20 h-20 rounded-lg border border-zinc-700 bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-500">미리보기<br />불가</div>}
                            <button onClick={() => removePhoto(key, p.id)} title="삭제" className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-zinc-900 border border-zinc-600 text-zinc-300 text-xs leading-none opacity-0 group-hover:opacity-100 hover:bg-rose-600 hover:text-white transition-opacity">×</button>
                          </div>
                        ))}
                        <label
                          className={`w-20 h-20 rounded-lg border border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors ${dragKey === key ? 'border-[#c9a44e] text-[#c9a44e]' : 'border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300'} ${uploading === key ? 'opacity-50 pointer-events-none' : ''}`}
                          title="사진을 클릭해서 고르거나 끌어다 놓으세요"
                        >
                          <span className="text-lg leading-none">{uploading === key ? '…' : dragKey === key ? '⤓' : '＋'}</span>
                          <span className="text-[10px] mt-0.5">{uploading === key ? '업로드' : dragKey === key ? '놓기' : '사진'}</span>
                          <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) void uploadFiles(key, fs); e.target.value = ''; }} />
                        </label>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* 지문 영어 본문 툴팁 (지문 번호에 마우스 올렸을 때) */}
      {hover && texts[hover.key] && (
        <div
          className="fixed z-[60] w-[420px] max-w-[90vw] max-h-[60vh] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950/95 px-3.5 py-3 text-[12px] leading-relaxed text-zinc-200 shadow-2xl pointer-events-none whitespace-pre-wrap"
          style={{
            left: Math.min(hover.x, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 440),
            top: Math.min(hover.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 240),
          }}
        >
          {texts[hover.key]}
        </div>
      )}
    </div>
  );
}
