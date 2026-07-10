'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface DapjiItem {
  id: string;
  title: string;
  level: string;
  note: string;
  filename: string;
  contentType: string;
  size: number;
  copyrighted: boolean;
  createdAt: string | null;
}

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  if (n >= 1024) return `${Math.round(n / 1024)}KB`;
  return `${n}B`;
}

export default function DapjiPage() {
  const [items, setItems] = useState<DapjiItem[] | null>(null);
  const [levels, setLevels] = useState<string[]>([]);
  const [levelFilter, setLevelFilter] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [level, setLevel] = useState('');
  const [note, setNote] = useState('');
  const [copyrighted, setCopyrighted] = useState(true);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((m: string) => {
    setToast(m);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const d = await fetch('/api/my/vip/dapji', { credentials: 'include' }).then((r) => r.json());
      if (d.ok) { setItems(d.items as DapjiItem[]); setLevels(d.levels ?? []); }
      else setLoadError(typeof d?.error === 'string' ? d.error : '목록을 불러오지 못했습니다.');
    } catch { setLoadError('네트워크 오류가 발생했습니다.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('title', title.trim() || f.name.replace(/\.[^.]+$/, ''));
      fd.append('level', level.trim());
      fd.append('note', note.trim());
      fd.append('copyrighted', String(copyrighted));
      const d = await fetch('/api/my/vip/dapji', { method: 'POST', credentials: 'include', body: fd }).then((r) => r.json());
      if (d.ok) { setItems((prev) => [d.item as DapjiItem, ...(prev ?? [])]); setTitle(''); setNote(''); notify('답지를 올렸어요.'); load(); }
      else notify(d?.error || '업로드에 실패했어요.');
    } catch { notify('업로드에 실패했어요.'); }
    setBusy(false);
  };

  const remove = async (it: DapjiItem) => {
    if (confirmDel !== it.id) {
      setConfirmDel(it.id);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmDel(null), 3500);
      return;
    }
    setConfirmDel(null);
    await fetch(`/api/my/vip/dapji?id=${it.id}`, { method: 'DELETE', credentials: 'include' });
    setItems((prev) => (prev ?? []).filter((x) => x.id !== it.id));
    notify(`「${it.title}」 삭제됨`);
  };

  const shown = levelFilter ? (items ?? []).filter((i) => i.level === levelFilter) : (items ?? []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-sm border border-[#c9a44e]/25">답지닷컴</span>
          답지 라이브러리
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">교재 답지(정답·해설) PDF·이미지를 한곳에 보관하고 열람·다운로드합니다. 내 계정에만 저장됩니다.</p>
      </div>

      {/* 자체 답지 바로가기 — 문법 문제은행에서 자동 생성 */}
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
        <p className="text-sm font-semibold text-emerald-300">우리 문제 답지는 자동으로 만들어집니다</p>
        <p className="mt-0.5 text-[12px] text-zinc-400">자체 제작 문법 문제(L1·L2·L3)의 정답·해설은 <a href="/my/vip/grammar-problems" className="underline text-emerald-300 hover:text-emerald-200">문법 문제관리</a>에서 진도를 고른 뒤 「정답 보기」·「문제지 인쇄(정답지 포함)」로 바로 뽑을 수 있어요.</p>
      </div>

      {/* 업로드 */}
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 space-y-3">
        <p className="text-sm font-semibold text-zinc-200">답지 올리기</p>
        <div className="flex flex-wrap items-end gap-2.5">
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">제목</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 그래머와이즈 LEVEL 1 답지"
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100 placeholder-zinc-600 w-64" />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">분류</label>
            <input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="예: LEVEL 1" list="dapji-levels"
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100 placeholder-zinc-600 w-36" />
            <datalist id="dapji-levels">{levels.map((l) => <option key={l} value={l} />)}</datalist>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[11px] text-zinc-500 mb-1">메모 (선택)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 3~5단원 정답 포함"
              className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100 placeholder-zinc-600" />
          </div>
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-200 text-sm font-semibold hover:bg-amber-500/30 disabled:opacity-40">
            {busy ? '올리는 중…' : '📎 파일 선택 (PDF·이미지)'}
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp" onChange={onFile} className="hidden" />
        </div>
        <label className="flex items-center gap-2 text-[12px] text-zinc-400">
          <input type="checkbox" checked={copyrighted} onChange={(e) => setCopyrighted(e.target.checked)} />
          출판 교재 답지 (내부 참고 전용 — 공개·판매에 쓰지 않음)
        </label>
      </div>

      {/* 분류 필터 */}
      {levels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setLevelFilter('')} className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold border ${levelFilter === '' ? 'bg-amber-500/20 text-amber-200 border-amber-500/40' : 'bg-zinc-900/60 text-zinc-400 border-zinc-700/60 hover:text-zinc-200'}`}>전체 {items?.length ?? 0}</button>
          {levels.map((l) => (
            <button key={l} onClick={() => setLevelFilter(l)} className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold border ${levelFilter === l ? 'bg-amber-500/20 text-amber-200 border-amber-500/40' : 'bg-zinc-900/60 text-zinc-400 border-zinc-700/60 hover:text-zinc-200'}`}>{l} {(items ?? []).filter((i) => i.level === l).length}</button>
          ))}
        </div>
      )}

      {/* 목록 */}
      {items === null ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : loadError ? (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-8 text-center">
          <p className="text-sm text-rose-300 font-semibold">{loadError}</p>
          <button onClick={load} className="mt-3 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm hover:bg-zinc-700">다시 시도</button>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">
          아직 올린 답지가 없습니다. 위에서 답지 PDF·이미지를 올려 보세요.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {shown.map((it) => (
            <div key={it.id} className="group rounded-xl bg-zinc-900/50 border border-zinc-800/80 hover:border-zinc-600 transition-colors p-4">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <span className="text-lg">{it.contentType === 'application/pdf' ? '📕' : '🖼'}</span>
                {it.level && <span className="px-1.5 py-0.5 rounded text-[11px] font-bold border bg-blue-500/15 text-blue-300 border-blue-500/30">{it.level}</span>}
                {it.copyrighted && <span className="px-1.5 py-0.5 rounded text-[10px] border bg-rose-500/10 text-rose-300/90 border-rose-500/25" title="출판 교재 답지 — 내부 전용">내부용</span>}
                <span className="ml-auto text-[11px] text-zinc-600">{fmtSize(it.size)}</span>
              </div>
              <div className="text-sm font-semibold text-zinc-100 truncate" title={it.title}>{it.title}</div>
              {it.note && <div className="text-[12px] text-zinc-500 truncate mt-0.5" title={it.note}>{it.note}</div>}
              <div className="text-[11px] text-zinc-600 mt-2">{it.createdAt ? new Date(it.createdAt).toLocaleString('ko-KR') : ''}</div>
              <div className="mt-3 flex items-center gap-2">
                <a href={`/api/my/vip/dapji/${it.id}`} target="_blank" className="text-[12px] text-sky-300/90 hover:text-sky-200">열기</a>
                <a href={`/api/my/vip/dapji/${it.id}?download=1`} className="text-[12px] text-emerald-300/90 hover:text-emerald-200">다운로드</a>
                <button onClick={() => remove(it)} className={`ml-auto text-[11px] ${confirmDel === it.id ? 'text-rose-300 font-bold' : 'text-zinc-600 hover:text-rose-400'}`}>
                  {confirmDel === it.id ? '정말 삭제?' : '삭제'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-600/60 text-sm text-zinc-100 shadow-xl">{toast}</div>
      )}
    </div>
  );
}
