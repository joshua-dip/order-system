'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import WordSetView from '@/app/components/WordSetView';
import { parseWordLines, wordsToText } from '@/lib/word-types';

export default function WordSetEditorPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === 'string' ? params.id : '';

  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState('');
  const [textbook, setTextbook] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/my/vip/word-sets/${id}`, { credentials: 'include' }).then((r) => r.json()).then((d) => {
      if (!alive) return;
      if (!d.ok) { setNotFound(true); setLoading(false); return; }
      setTitle(d.set.title); setFolder(d.set.folder); setTextbook(d.set.textbook); setText(wordsToText(d.set.words));
      setLoading(false);
    }).catch(() => { setNotFound(true); setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const words = parseWordLines(text);
  const mark = () => setDirty(true);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/my/vip/word-sets/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ title, folder, textbook, words: parseWordLines(text) }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setDirty(false);
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  }, [id, title, folder, textbook, text]);

  if (loading) return <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>;
  if (notFound) return <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-500">단어장을 찾을 수 없습니다. <button onClick={() => router.push('/my/vip/words')} className="text-indigo-300 underline ml-1">목록으로</button></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => router.push('/my/vip/words')} className="text-sm text-zinc-400 hover:text-zinc-200">← 목록</button>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-[11px] text-amber-400/80">저장 안 됨</span>}
          <span className="text-[11px] text-zinc-500">{words.length}단어</span>
          <button onClick={() => setPreview((v) => !v)} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 text-sm hover:bg-zinc-700">{preview ? '편집' : '미리보기'}</button>
          <a href={`/print/wordset/${id}`} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-200 text-sm hover:bg-zinc-700">인쇄/시험지 ↗</a>
          <button onClick={save} disabled={saving || !dirty} className="px-4 py-1.5 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40">{saving ? '저장 중…' : '저장'}</button>
        </div>
      </div>

      <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 space-y-2.5">
        <input value={title} onChange={(e) => { setTitle(e.target.value); mark(); }} placeholder="단어장 제목" className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-base text-zinc-100 font-semibold placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
        <div className="flex gap-2 flex-wrap">
          <input value={folder} onChange={(e) => { setFolder(e.target.value); mark(); }} placeholder="강좌/단원 (선택)" className="flex-1 min-w-[140px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          <input value={textbook} onChange={(e) => { setTextbook(e.target.value); mark(); }} placeholder="연계 교재 (선택)" className="flex-1 min-w-[140px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
        </div>
      </div>

      {preview ? (
        <div className="rounded-xl bg-white p-6 sm:p-8 shadow-lg overflow-x-auto">
          <WordSetView set={{ title, folder, textbook, words }} mode="전체" />
        </div>
      ) : (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 space-y-2">
          <div className="text-[11px] text-zinc-500">한 줄에 한 단어씩 — <span className="text-zinc-400">단어 | 뜻 | 예문(선택)</span></div>
          <textarea value={text} onChange={(e) => { setText(e.target.value); mark(); }} rows={16}
            placeholder={'apple | 사과 | I ate an apple.\nrun | 달리다\n…'}
            className="w-full px-3 py-2.5 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y font-mono leading-relaxed" />
        </div>
      )}
    </div>
  );
}
