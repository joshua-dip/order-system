'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Slot {
  id: string;
  studentName: string;
  dayOfWeek: number; // 0=월 … 6=일
  startTime: string;
  endTime: string;
  subject: string;
  memo: string;
}

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];

const EMPTY = { studentName: '', dayOfWeek: 0, startTime: '', endTime: '', subject: '', memo: '' };

export default function TutoringTimetablePage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [studentNames, setStudentNames] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch('/api/my/vip/tutoring/timetable', { credentials: 'include' }).then((r) => r.json());
      if (d.ok) setSlots(d.slots as Slot[]);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let alive = true;
    fetch('/api/my/vip/students', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const arr = Array.isArray(d?.students) ? d.students : [];
        setStudentNames(arr.map((s: { name?: string }) => s?.name).filter((n: unknown): n is string => typeof n === 'string' && !!n));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.studentName.trim()) { setError('학생 이름을 입력해 주세요.'); return; }
    if (!form.startTime) { setError('시작 시간을 입력해 주세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/tutoring/timetable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setForm((f) => ({ ...EMPTY, studentName: f.studentName, dayOfWeek: f.dayOfWeek, subject: f.subject })); // 연속 입력 편의
        load();
      } else {
        setError(d.error || '저장에 실패했습니다.');
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    }
    setSaving(false);
  };

  const remove = async (id: string) => {
    if (!confirm('이 수업 시간을 삭제할까요?')) return;
    setDeletingId(id);
    try {
      const res = await fetch('/api/my/vip/tutoring/timetable', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });
      if (res.ok) setSlots((prev) => prev.filter((s) => s.id !== id));
    } catch {
      /* ignore */
    }
    setDeletingId(null);
  };

  const byDay = useMemo(() => {
    const m: Slot[][] = [[], [], [], [], [], [], []];
    for (const s of slots) if (s.dayOfWeek >= 0 && s.dayOfWeek <= 6) m[s.dayOfWeek].push(s);
    return m;
  }, [slots]);

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-sm border border-[#c9a44e]/25">과외솔루션</span>
          시간표관리
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">학생별 요일·시간 수업을 <b className="text-zinc-300">주간 시간표</b>로 관리합니다.</p>
      </div>

      {/* 수업 추가 */}
      <form onSubmit={submit} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
        <div className="text-xs font-semibold text-zinc-400 mb-3">수업 추가</div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2.5 items-end">
          <div className="col-span-2 md:col-span-1">
            <label className="block text-[11px] text-zinc-500 mb-1">학생 *</label>
            <input list="vip-timetable-students" value={form.studentName} onChange={(e) => set('studentName', e.target.value)} placeholder="학생 이름" className={inputCls} />
            <datalist id="vip-timetable-students">{studentNames.map((n) => <option key={n} value={n} />)}</datalist>
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">요일</label>
            <select value={form.dayOfWeek} onChange={(e) => set('dayOfWeek', Number(e.target.value))} className={inputCls}>
              {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">시작 *</label>
            <input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">종료</label>
            <input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">과목</label>
            <input value={form.subject} onChange={(e) => set('subject', e.target.value)} placeholder="예: 영어" className={inputCls} />
          </div>
          <div className="col-span-2 md:col-span-1 lg:col-span-1">
            <label className="block text-[11px] text-zinc-500 mb-1">메모</label>
            <input value={form.memo} onChange={(e) => set('memo', e.target.value)} placeholder="장소·비고" className={inputCls} />
          </div>
        </div>
        {error && <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 mt-3">{error}</p>}
        <div className="mt-3">
          <button type="submit" disabled={saving} className="px-5 py-2 rounded-lg bg-amber-500/20 text-amber-200 text-sm font-semibold hover:bg-amber-500/30 transition-colors disabled:opacity-40">
            {saving ? '추가 중…' : '시간표에 추가'}
          </button>
        </div>
      </form>

      {/* 주간 시간표 */}
      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {DAYS.map((day, i) => (
            <div key={day} className="rounded-xl bg-zinc-900/40 border border-zinc-800/70 min-h-[120px]">
              <div className={`px-3 py-2 text-center text-[13px] font-bold border-b border-zinc-800/70 ${i >= 5 ? 'text-rose-300/80' : 'text-zinc-300'}`}>
                {day}
                <span className="text-[11px] font-normal text-zinc-600 ml-1">{byDay[i].length || ''}</span>
              </div>
              <div className="p-2 space-y-2">
                {byDay[i].length === 0 ? (
                  <div className="text-[11px] text-zinc-700 text-center py-4">—</div>
                ) : (
                  byDay[i].map((s) => (
                    <div key={s.id} className="group rounded-lg bg-zinc-800/50 border border-zinc-700/50 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[12px] font-bold text-amber-200/90">{s.startTime}{s.endTime ? `~${s.endTime}` : ''}</span>
                        <button onClick={() => remove(s.id)} disabled={deletingId === s.id} className="text-[11px] text-zinc-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-40">✕</button>
                      </div>
                      <div className="text-[13px] text-zinc-100 font-medium truncate">{s.studentName}</div>
                      {s.subject && <div className="text-[11px] text-violet-300/80 truncate">{s.subject}</div>}
                      {s.memo && <div className="text-[11px] text-zinc-500 truncate">{s.memo}</div>}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
