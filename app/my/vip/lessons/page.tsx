'use client';

import { useCallback, useEffect, useState } from 'react';

interface ClassRow { id: string; name: string; studentCount: number }
interface LessonLog { id: string; classId: string; className: string; date: string; progress: string; homework: string; memo: string; createdAt: string }

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function LessonsPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [logs, setLogs] = useState<LessonLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterClass, setFilterClass] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 폼
  const [fClass, setFClass] = useState('');
  const [fDate, setFDate] = useState(todayStr());
  const [fProgress, setFProgress] = useState('');
  const [fHomework, setFHomework] = useState('');
  const [fMemo, setFMemo] = useState('');

  const loadLogs = useCallback(async (cid: string) => {
    setLoading(true);
    const url = cid ? `/api/my/vip/lessons?classId=${cid}` : '/api/my/vip/lessons';
    const d = await fetch(url, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) setLogs(d.logs);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch('/api/my/vip/attendance/classes', { credentials: 'include' }).then((r) => r.json()).then((d) => { if (d.ok && Array.isArray(d.classes)) setClasses(d.classes); });
  }, []);
  useEffect(() => { loadLogs(filterClass); }, [loadLogs, filterClass]);

  const create = async () => {
    if (!fClass || !fProgress.trim()) { alert('반과 진도(수업 내용)를 입력하세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/lessons', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ classId: fClass, date: fDate, progress: fProgress, homework: fHomework || undefined, memo: fMemo || undefined }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setOpen(false); setFProgress(''); setFHomework(''); setFMemo(''); setFDate(todayStr());
      await loadLogs(filterClass);
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };

  const remove = async (l: LessonLog) => {
    if (!confirm('이 수업일지를 삭제할까요?')) return;
    await fetch(`/api/my/vip/lessons?id=${l.id}`, { method: 'DELETE', credentials: 'include' });
    await loadLogs(filterClass);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">수업일지</h1>
          <p className="text-sm text-zinc-500 mt-0.5">반별 수업 진도와 과제를 날짜순으로 기록해 진도를 관리합니다.</p>
        </div>
        <div className="flex gap-2">
          <select value={filterClass} onChange={(e) => setFilterClass(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
            <option value="">전체 반</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={() => { setOpen((v) => !v); if (!fClass && filterClass) setFClass(filterClass); }}
            className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">＋ 새 수업일지</button>
        </div>
      </div>

      {classes.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">
          등록된 반이 없습니다. 「출결관리 → 반 관리」에서 <span className="text-zinc-400">반</span>을 먼저 만들면 수업일지를 기록할 수 있어요.
        </div>
      ) : (
        <>
          {/* 작성 폼 */}
          {open && (
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
              <div className="flex flex-wrap gap-2">
                <select value={fClass} onChange={(e) => setFClass(e.target.value)}
                  className="flex-1 min-w-[160px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
                  <option value="">반 선택</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.studentCount}명)</option>)}
                </select>
                <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)}
                  className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
              </div>
              <textarea value={fProgress} onChange={(e) => setFProgress(e.target.value)} placeholder="진도 (오늘 수업에서 배운 내용)" rows={2}
                className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
              <input value={fHomework} onChange={(e) => setFHomework(e.target.value)} placeholder="과제 (선택)"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
              <input value={fMemo} onChange={(e) => setFMemo(e.target.value)} placeholder="비고 (선택)"
                className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200 transition-colors">취소</button>
                <button onClick={create} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">{saving ? '저장 중…' : '일지 저장'}</button>
              </div>
            </div>
          )}

          {/* 목록 */}
          {loading ? (
            <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
          ) : logs.length === 0 ? (
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">수업일지가 없습니다. 「＋ 새 수업일지」로 시작하세요.</div>
          ) : (
            <div className="space-y-2.5">
              {logs.map((l) => (
                <div key={l.id} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="px-1.5 py-0.5 rounded text-[11px] bg-blue-500/15 text-blue-300">{l.className}</span>
                    <span className="text-[11px] text-zinc-500">{l.date}</span>
                    <button onClick={() => remove(l)} className="ml-auto text-[11px] text-zinc-600 hover:text-rose-400 transition-colors">삭제</button>
                  </div>
                  <div className="text-[13px] text-zinc-300 whitespace-pre-wrap leading-relaxed">{l.progress}</div>
                  {l.homework && <div className="text-[12px] text-amber-300/80 mt-2"><span className="text-zinc-500">과제 </span>{l.homework}</div>}
                  {l.memo && <div className="text-[12px] text-zinc-500 mt-1"><span className="text-zinc-600">비고 </span>{l.memo}</div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
