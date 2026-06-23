'use client';

import { useCallback, useEffect, useState } from 'react';
import { parseVideoUrl, PROVIDER_LABEL, type VideoProvider } from '@/lib/video-url';

interface Video { id: string; title: string; url: string; provider: VideoProvider; videoId: string; embedUrl: string; thumbnailUrl: string; description: string; folder: string; order: number; textbook: string; durationMin: number | null; createdAt: string }
interface FolderInfo { name: string; count: number }

const PROVIDER_CLS: Record<VideoProvider, string> = {
  youtube: 'bg-red-500/15 text-red-300',
  vimeo: 'bg-sky-500/15 text-sky-300',
  other: 'bg-zinc-700/50 text-zinc-400',
};

export default function VipLectureVideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [folder, setFolder] = useState('__all__');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [playing, setPlaying] = useState<Video | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (folder !== '__all__') params.set('folder', folder);
    if (q.trim()) params.set('q', q.trim());
    const d = await fetch(`/api/my/vip/videos?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setVideos(d.videos); setFolders(d.folders); }
    setLoading(false);
  }, [folder, q]);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">강의영상관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">강의영상 링크(YouTube·Vimeo 등)를 강좌·회차별로 정리하고 바로 재생합니다.</p>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">{open ? '닫기' : '＋ 영상 추가'}</button>
      </div>

      {open && <VideoForm folders={folders} onDone={() => { setOpen(false); load(); }} />}

      {/* 폴더(강좌) 칩 + 검색 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {[{ name: '__all__', label: '전체' }, { name: '', label: '미분류' }].map((f) => (
          <button key={f.name} onClick={() => setFolder(f.name)} className={`px-3 py-1 rounded-full text-xs transition-colors ${folder === f.name ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>{f.label}</button>
        ))}
        {folders.filter((f) => f.name !== '').map((f) => (
          <button key={f.name} onClick={() => setFolder(f.name)} className={`px-3 py-1 rounded-full text-xs transition-colors ${folder === f.name ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>🎬 {f.name} <span className="opacity-60">{f.count}</span></button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·교재 검색" className="w-full sm:max-w-xs px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : videos.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">등록한 강의영상이 없습니다. 「＋ 영상 추가」로 영상 링크를 등록하세요.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {videos.map((v) => <VideoCard key={v.id} v={v} onPlay={() => setPlaying(v)} reload={load} />)}
        </div>
      )}

      {playing && <PlayerModal v={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}

/* ───────────────── 추가/수정 폼 ───────────────── */
function VideoForm({ folders, onDone, edit }: { folders: FolderInfo[]; onDone: () => void; edit?: Video }) {
  const [title, setTitle] = useState(edit?.title ?? '');
  const [url, setUrl] = useState(edit?.url ?? '');
  const [folder, setFolder] = useState(edit?.folder ?? '');
  const [order, setOrder] = useState(edit?.order ? String(edit.order) : '');
  const [textbook, setTextbook] = useState(edit?.textbook ?? '');
  const [duration, setDuration] = useState(edit?.durationMin ? String(edit.durationMin) : '');
  const [description, setDescription] = useState(edit?.description ?? '');
  const [saving, setSaving] = useState(false);
  const parsed = url.trim() ? parseVideoUrl(url) : null;

  const save = async () => {
    if (!title.trim() || !url.trim()) { alert('제목과 영상 URL을 입력하세요.'); return; }
    setSaving(true);
    try {
      const payload = { title, url, folder, order: order ? Number(order) : 0, textbook, durationMin: duration ? Number(duration) : undefined, description };
      const res = await fetch(edit ? `/api/my/vip/videos?id=${edit.id}` : '/api/my/vip/videos', {
        method: edit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      onDone();
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };

  return (
    <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="영상 제목 (예: 1강. 분사구문 개념)" className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
      <div className="flex gap-2 items-start">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="영상 URL (YouTube·Vimeo 또는 https 링크)" className="flex-1 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
        {parsed && (
          <span className={`shrink-0 mt-1.5 px-2 py-0.5 rounded text-[11px] ${PROVIDER_CLS[parsed.provider]}`}>{PROVIDER_LABEL[parsed.provider]}{parsed.provider === 'other' && url.trim() ? '(임베드X)' : ''}</span>
        )}
      </div>
      {parsed?.thumbnailUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={parsed.thumbnailUrl} alt="썸네일 미리보기" className="w-40 aspect-video object-cover rounded-lg border border-zinc-800" />
      )}
      <div className="flex flex-wrap gap-2">
        <input value={folder} onChange={(e) => setFolder(e.target.value)} list="vid-folders" placeholder="강좌/폴더 (선택)" className="flex-1 min-w-[140px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
        <datalist id="vid-folders">{folders.filter((f) => f.name).map((f) => <option key={f.name} value={f.name} />)}</datalist>
        <input value={order} onChange={(e) => setOrder(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="회차" className="w-20 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
        <input value={duration} onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="분" className="w-16 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
      </div>
      <input value={textbook} onChange={(e) => setTextbook(e.target.value)} placeholder="연계 교재 (선택)" className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="설명 (선택)" rows={2} className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
      <div className="flex gap-2 justify-end">
        <button onClick={onDone} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200">취소</button>
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40">{saving ? '저장 중…' : edit ? '수정 저장' : '영상 등록'}</button>
      </div>
    </div>
  );
}

/* ───────────────── 영상 카드 ───────────────── */
function VideoCard({ v, onPlay, reload }: { v: Video; onPlay: () => void; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const remove = async () => {
    if (!confirm(`"${v.title}"을(를) 삭제할까요?`)) return;
    await fetch(`/api/my/vip/videos?id=${v.id}`, { method: 'DELETE', credentials: 'include' });
    reload();
  };
  if (editing) return <div className="sm:col-span-2 lg:col-span-3"><VideoForm folders={[]} edit={v} onDone={() => { setEditing(false); reload(); }} /></div>;

  const canEmbed = !!v.embedUrl;
  return (
    <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden group">
      <button onClick={canEmbed ? onPlay : () => window.open(v.url, '_blank', 'noopener')} className="relative block w-full aspect-video bg-black/60 overflow-hidden">
        {v.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.thumbnailUrl} alt={v.title} className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">{PROVIDER_LABEL[v.provider]}</div>
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-11 h-11 rounded-full bg-black/55 backdrop-blur flex items-center justify-center text-white text-lg group-hover:bg-black/70 transition-colors">▶</span>
        </span>
        {v.durationMin && <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-zinc-200">{v.durationMin}분</span>}
      </button>
      <div className="p-3">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${PROVIDER_CLS[v.provider]}`}>{PROVIDER_LABEL[v.provider]}</span>
          {typeof v.order === 'number' && v.order > 0 && <span className="text-[10px] text-zinc-500">{v.order}회차</span>}
          {v.folder && <span className="text-[10px] text-amber-300/80">🎬 {v.folder}</span>}
        </div>
        <div className="text-sm text-zinc-100 font-medium leading-snug line-clamp-2">{v.title}</div>
        {v.textbook && <div className="text-[11px] text-zinc-500 mt-0.5 truncate">{v.textbook}</div>}
        {v.description && <div className="text-[11px] text-zinc-600 mt-1 line-clamp-2">{v.description}</div>}
        <div className="flex gap-2 mt-2 pt-2 border-t border-zinc-800/60">
          <button onClick={canEmbed ? onPlay : () => window.open(v.url, '_blank', 'noopener')} className="text-[11px] text-indigo-300 hover:text-indigo-200">{canEmbed ? '▶ 재생' : '↗ 링크 열기'}</button>
          <button onClick={() => setEditing(true)} className="ml-auto text-[11px] text-zinc-500 hover:text-zinc-200">수정</button>
          <button onClick={remove} className="text-[11px] text-zinc-600 hover:text-rose-400">삭제</button>
        </div>
      </div>
    </div>
  );
}

/* ───────────────── 재생 모달 ───────────────── */
function PlayerModal({ v, onClose }: { v: Video; onClose: () => void }) {
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-zinc-200 font-medium truncate pr-2">{v.title}</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 text-xl leading-none">✕</button>
        </div>
        <div className="aspect-video w-full rounded-xl overflow-hidden bg-black border border-zinc-800">
          <iframe src={v.embedUrl} title={v.title} className="w-full h-full" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen />
        </div>
        <div className="mt-2 text-right">
          <a href={v.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-zinc-500 hover:text-zinc-300">원본에서 보기 ↗</a>
        </div>
      </div>
    </div>
  );
}
