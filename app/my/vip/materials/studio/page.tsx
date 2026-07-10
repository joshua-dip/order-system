'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { STUDIO_DIFFICULTIES } from '@/lib/vip-material-studio';

interface Item { id: string; title: string; subtitle: string; difficulty: string; pageCount: number; folder: string; updatedAt: string | null; coverImageUrl: string | null }

const LEVEL_CLS: Record<string, string> = {
  기초: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  심화: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  고난도: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
};

export default function StudioListPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>}>
      <StudioListInner />
    </Suspense>
  );
}

function StudioListInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFolder = searchParams.get('folder') || ''; // ?folder=고등 교재 → 해당 폴더로 진입
  const [items, setItems] = useState<Item[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [curFolder, setCurFolder] = useState<string>(initialFolder || 'ALL'); // 'ALL' | ''(미분류) | 폴더명
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newLevel, setNewLevel] = useState<string>('기초');
  const [folderInputOpen, setFolderInputOpen] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null); // 2단계 삭제 대상 id
  const [armSeed, setArmSeed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** alert/confirm 대체 토스트 — 임베디드 브라우저에서 네이티브 다이얼로그는 크래시 */
  const notify = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [d, f] = await Promise.all([
        fetch('/api/my/vip/materials/studio', { credentials: 'include' }).then((r) => r.json()),
        fetch('/api/my/vip/materials/studio/folders', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      ]);
      if (d.ok) setItems(d.items as Item[]);
      else setLoadError(typeof d?.error === 'string' ? d.error : '목록을 불러오지 못했습니다.');
      if (f?.ok && Array.isArray(f.folders)) {
        // ?folder= 로 들어오면 그 폴더가 없어도 목록에 포함(진입점 메뉴용)
        const list = f.folders as string[];
        setFolders(initialFolder && !list.includes(initialFolder) ? [...list, initialFolder].sort((a, b) => a.localeCompare(b, 'ko')) : list);
      }
    } catch {
      setLoadError('네트워크 오류가 발생했습니다.');
    }
    setLoading(false);
  }, [initialFolder]);
  useEffect(() => { load(); }, [load]);

  // ?folder= 진입점 폴더는 레지스트리에 한 번 등록(다음부터 항상 노출)
  useEffect(() => {
    if (!initialFolder) return;
    fetch('/api/my/vip/materials/studio/folders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ name: initialFolder }),
    }).catch(() => { /* 이미 있으면 무시 */ });
  }, [initialFolder]);

  const createBlank = async () => {
    setBusy(true);
    try {
      const folder = curFolder === 'ALL' ? '' : curFolder;
      const d = await fetch('/api/my/vip/materials/studio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ title: newTitle.trim() || '새 교재', difficulty: newLevel, folder }),
      }).then((r) => r.json());
      if (d.ok && d.id) router.push(`/my/vip/materials/studio/${d.id}`);
      else notify('생성에 실패했습니다.');
    } catch { notify('생성에 실패했습니다.'); }
    setBusy(false);
  };

  /** 시드 생성 — confirm() 대신 2단계 버튼 */
  const createSeed = async () => {
    if (!armSeed) {
      setArmSeed(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setArmSeed(false), 3500);
      return;
    }
    setArmSeed(false);
    setBusy(true);
    try {
      const d = await fetch('/api/my/vip/materials/studio', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ seed: 'grammar8' }),
      }).then((r) => r.json());
      if (d.ok) { await load(); notify('3권이 생성되었습니다. 카드를 눌러 편집하세요.'); }
      else notify('생성에 실패했습니다.');
    } catch { notify('생성에 실패했습니다.'); }
    setBusy(false);
  };

  /** 삭제 — confirm() 대신 같은 버튼 2번 클릭 */
  const remove = async (it: Item) => {
    if (confirmDel !== it.id) {
      setConfirmDel(it.id);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmDel(null), 3500);
      return;
    }
    setConfirmDel(null);
    await fetch(`/api/my/vip/materials/studio/${it.id}`, { method: 'DELETE', credentials: 'include' });
    setItems((prev) => prev.filter((x) => x.id !== it.id));
    notify(`「${it.title}」 삭제됨`);
  };

  const createFolder = async () => {
    const name = newFolder.trim();
    if (!name) { notify('폴더 이름을 입력해주세요.'); return; }
    const d = await fetch('/api/my/vip/materials/studio/folders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ name }),
    }).then((r) => r.json()).catch(() => null);
    if (!d?.ok) { notify(d?.error || '폴더 생성에 실패했습니다.'); return; }
    setFolders((prev) => (prev.includes(d.name) ? prev : [...prev, d.name].sort((a, b) => a.localeCompare(b, 'ko'))));
    setNewFolder('');
    setFolderInputOpen(false);
    setCurFolder(d.name);
    notify(`「${d.name}」 폴더를 만들었어요.`);
  };

  const deleteFolder = async (name: string) => {
    const d = await fetch('/api/my/vip/materials/studio/folders', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ name }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
    if (d.body?.ok) {
      setFolders((prev) => prev.filter((f) => f !== name));
      if (curFolder === name) setCurFolder('ALL');
      notify(`「${name}」 폴더를 삭제했어요.`);
    } else notify(d.body?.error || '폴더 삭제에 실패했습니다.');
  };

  const moveFolder = async (it: Item, folder: string) => {
    const d = await fetch(`/api/my/vip/materials/studio/${it.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ folder }),
    }).then((r) => r.json()).catch(() => null);
    if (!d?.ok) { notify('폴더 이동에 실패했습니다.'); return; }
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, folder } : x)));
    notify(`「${it.title}」 → ${folder || '미분류'}`);
  };

  const docsOf = (f: string) => items.filter((it) => (it.folder || '') === f);
  const visible = curFolder === 'ALL' ? items : docsOf(curFolder);

  /** 폴더 카드의 미니 표지 — 업로드 표지가 없으면 제목 첫 글자 */
  const miniCover = (it: Item) => (
    it.coverImageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={it.coverImageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
    ) : (
      <div className="w-full h-full flex items-center justify-center text-[11px] font-bold text-zinc-400 bg-zinc-800">{(it.title || '?').slice(0, 1)}</div>
    )
  );

  /** 표지 스택 — 3권 이상: 부채꼴 3장 / 2권: 2장 / 1권: 1장 / 0권: 점선 빈 칸. 업로드 표지가 있는 책을 앞장으로 */
  const coverStack = (docs: Item[]) => {
    const tops = [...docs].sort((a, b) => (b.coverImageUrl ? 1 : 0) - (a.coverImageUrl ? 1 : 0)).slice(0, 3);
    if (tops.length === 0) {
      return <div className="w-[42px] h-[58px] rounded border border-dashed border-zinc-700 flex items-center justify-center text-zinc-700 text-sm">＋</div>;
    }
    // 컨테이너 64×60, 카드 40×56 — 센터(12,2) 기준 부채꼴 오프셋·회전 (translate 유틸 충돌 방지 위해 inline)
    const fan = [
      { dx: 0, dy: 0, rot: 0, z: 30 },
      tops.length === 2 ? { dx: -8, dy: -2, rot: -7, z: 20 } : { dx: 8, dy: -2, rot: 7, z: 20 },
      { dx: -8, dy: -3, rot: -7, z: 10 },
    ];
    return (
      <div className="relative w-[64px] h-[60px]">
        {tops.map((it, i) => (
          <div key={it.id} className="absolute w-[40px] h-[56px] rounded overflow-hidden border border-zinc-600/70 shadow-md bg-zinc-800"
            style={{ left: 12 + fan[i].dx, top: 2 + fan[i].dy, transform: `rotate(${fan[i].rot}deg)`, zIndex: fan[i].z }}>
            {miniCover(it)}
          </div>
        ))}
      </div>
    );
  };

  const folderCard = (label: string, value: string, docs: Item[], opts?: { deletable?: boolean }) => {
    const on = curFolder === value;
    return (
      <div key={`f:${value}`} role="button" tabIndex={0} onClick={() => setCurFolder(value)}
        onKeyDown={(e) => { if (e.key === 'Enter') setCurFolder(value); }}
        className={`relative cursor-pointer select-none rounded-xl border px-3 pt-3 pb-2 w-[108px] text-center transition-colors ${on ? 'bg-amber-500/10 border-amber-500/50' : 'bg-zinc-900/50 border-zinc-800/80 hover:border-zinc-600'}`}>
        <div className="flex justify-center">{coverStack(docs)}</div>
        <div className={`mt-1.5 text-[12px] font-semibold truncate ${on ? 'text-amber-200' : 'text-zinc-300'}`}>{label}</div>
        <div className="text-[11px] text-zinc-600">{docs.length}권</div>
        {opts?.deletable && on && docs.length === 0 && (
          <button onClick={(e) => { e.stopPropagation(); deleteFolder(value); }} title="빈 폴더 삭제"
            className="absolute top-1 right-1 px-1 rounded text-[11px] text-zinc-600 hover:text-rose-400">✕</button>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-sm border border-[#c9a44e]/25">교재 스튜디오</span>
          자유 편집 <span className="text-[11px] font-normal px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">A4 캔버스</span>
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">인디자인처럼 페이지 위에 텍스트·이미지·QR·문제를 자유롭게 배치하고 PDF·HWPX 로 내려받습니다.</p>
      </div>

      {/* 생성 */}
      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 flex flex-wrap items-end gap-2.5">
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">제목</label>
          <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="새 교재 제목"
            className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100 placeholder-zinc-600 w-56" />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">난이도</label>
          <select value={newLevel} onChange={(e) => setNewLevel(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100">
            {STUDIO_DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <button onClick={createBlank} disabled={busy}
          className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-200 text-sm font-semibold hover:bg-amber-500/30 disabled:opacity-40">
          + 새 교재{curFolder !== 'ALL' && curFolder !== '' ? ` (${curFolder})` : ''}
        </button>
        <button onClick={createSeed} disabled={busy}
          className={`px-4 py-2 rounded-lg text-sm font-semibold border disabled:opacity-40 ${armSeed ? 'bg-amber-500/25 text-amber-200 border-amber-500/50' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'}`}>
          {armSeed ? '한 번 더 누르면 3권 생성' : '🌞 여름방학 문법특강 8회차 세트 (기초·심화·고난도 3권)'}
        </button>
      </div>

      {/* 폴더 카드 — 표지 스택으로 내용물이 보이는 시각형 */}
      <div className="flex flex-wrap items-start gap-2">
        {folderCard('전체', 'ALL', items)}
        {folderCard('미분류', '', docsOf(''))}
        {folders.map((f) => folderCard(`📁 ${f}`, f, docsOf(f), { deletable: true }))}
        {folderInputOpen ? (
          <div className="rounded-xl border border-amber-500/40 bg-zinc-900/60 px-3 pt-3 pb-2 w-[150px]">
            <input autoFocus value={newFolder} onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') { setFolderInputOpen(false); setNewFolder(''); } }}
              placeholder="폴더 이름" className="w-full px-2 py-1.5 rounded-lg bg-zinc-900/80 border border-zinc-700/70 text-[12px] text-zinc-100 placeholder-zinc-600" />
            <div className="flex gap-1 mt-1.5 justify-center">
              <button onClick={createFolder} className="px-2 py-1 rounded-lg text-[12px] bg-amber-500/20 text-amber-200 font-semibold">만들기</button>
              <button onClick={() => { setFolderInputOpen(false); setNewFolder(''); }} className="px-1.5 py-1 rounded-lg text-[12px] text-zinc-500 hover:text-zinc-300">취소</button>
            </div>
          </div>
        ) : (
          <div role="button" tabIndex={0} onClick={() => setFolderInputOpen(true)}
            onKeyDown={(e) => { if (e.key === 'Enter') setFolderInputOpen(true); }}
            className="cursor-pointer rounded-xl border border-dashed border-zinc-700 hover:border-zinc-500 px-3 pt-3 pb-2 w-[108px] text-center transition-colors">
            <div className="flex justify-center items-center h-[60px] text-zinc-600 text-xl">＋</div>
            <div className="mt-1.5 text-[12px] font-semibold text-zinc-500">새 폴더</div>
            <div className="text-[11px] text-transparent">·</div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : loadError ? (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-8 text-center">
          <p className="text-sm text-rose-300 font-semibold">{loadError}</p>
          <button onClick={load} className="mt-3 px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm hover:bg-zinc-700">다시 시도</button>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">
          {items.length === 0 ? '아직 교재가 없습니다. 위에서 새 교재를 만들거나 문법특강 세트를 생성해 보세요.' : '이 폴더에 교재가 없습니다. 카드의 폴더 선택으로 옮겨 보세요.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map((it) => (
            <div key={it.id} className="group rounded-xl bg-zinc-900/50 border border-zinc-800/80 hover:border-zinc-600 transition-colors overflow-hidden">
              <button onClick={() => router.push(`/my/vip/materials/studio/${it.id}`)} className="w-full text-left p-4 flex gap-3">
                <div className="w-14 shrink-0 aspect-[210/297] rounded-md overflow-hidden border border-zinc-700/60 bg-zinc-800/50 flex items-center justify-center">
                  {it.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.coverImageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <span className="text-base opacity-60">📕</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    {it.difficulty && <span className={`px-1.5 py-0.5 rounded text-[11px] font-bold border ${LEVEL_CLS[it.difficulty] ?? 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>{it.difficulty}</span>}
                    <span className="text-[11px] text-zinc-600">{it.pageCount}페이지</span>
                    {curFolder === 'ALL' && it.folder && <span className="text-[11px] text-zinc-500">📁 {it.folder}</span>}
                  </div>
                  <div className="text-sm font-semibold text-zinc-100 truncate">{it.title}</div>
                  {it.subtitle && <div className="text-[12px] text-zinc-500 truncate mt-0.5">{it.subtitle}</div>}
                  <div className="text-[11px] text-zinc-600 mt-2">{it.updatedAt ? new Date(it.updatedAt).toLocaleString('ko-KR') : ''}</div>
                </div>
              </button>
              <div className="px-4 pb-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <a href={`/api/my/vip/materials/studio/${it.id}/pdf`} className="text-[11px] text-rose-300/90 hover:text-rose-200">PDF</a>
                <a href={`/api/my/vip/materials/studio/${it.id}/hwpx`} className="text-[11px] text-sky-300/90 hover:text-sky-200">HWPX</a>
                <select value={it.folder || ''} onChange={(e) => moveFolder(it, e.target.value)} title="폴더 이동"
                  className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-900/80 border border-zinc-700/60 text-zinc-400 max-w-[130px]">
                  <option value="">미분류</option>
                  {folders.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                <button onClick={() => remove(it)}
                  className={`ml-auto text-[11px] ${confirmDel === it.id ? 'text-rose-300 font-bold' : 'text-zinc-600 hover:text-rose-400'}`}>
                  {confirmDel === it.id ? '정말 삭제?' : '삭제'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-zinc-800 border border-zinc-600/60 text-sm text-zinc-100 shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}
