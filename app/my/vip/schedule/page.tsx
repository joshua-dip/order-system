'use client';

import { useCallback, useEffect, useState } from 'react';

const CATEGORIES = ['수업', '시험', '상담', '행사', '휴원', '기타'] as const;
type SCategory = (typeof CATEGORIES)[number];
const CAT_CLS: Record<SCategory, string> = {
  수업: 'bg-blue-500/15 text-blue-300',
  시험: 'bg-rose-500/15 text-rose-300',
  상담: 'bg-violet-500/15 text-violet-300',
  행사: 'bg-emerald-500/15 text-emerald-300',
  휴원: 'bg-amber-500/15 text-amber-300',
  기타: 'bg-zinc-700/50 text-zinc-400',
};

interface ScheduleRecord { id: string; title: string; date: string; time: string; category: SCategory; description: string; createdAt: string }
interface Summary { today: string; upcoming: number }

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function thisMonthStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function SchedulePage() {
  const [records, setRecords] = useState<ScheduleRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterMonth, setFilterMonth] = useState(thisMonthStr());
  const [filterCategory, setFilterCategory] = useState<'' | SCategory>('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 폼
  const [fTitle, setFTitle] = useState('');
  const [fDate, setFDate] = useState(todayStr());
  const [fTime, setFTime] = useState('');
  const [fCategory, setFCategory] = useState<SCategory>('수업');
  const [fDesc, setFDesc] = useState('');

  const loadRecords = useCallback(async (month: string, category: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (month) params.set('month', month);
    if (category) params.set('category', category);
    const d = await fetch(`/api/my/vip/schedule?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setRecords(d.records); setSummary(d.summary ?? null); }
    setLoading(false);
  }, []);

  useEffect(() => { loadRecords(filterMonth, filterCategory); }, [loadRecords, filterMonth, filterCategory]);

  const create = async () => {
    if (!fTitle.trim()) { alert('일정 제목을 입력하세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/schedule', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ title: fTitle, date: fDate, time: fTime || undefined, category: fCategory, description: fDesc || undefined }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setOpen(false); setFTitle(''); setFDesc(''); setFTime(''); setFCategory('수업'); setFDate(todayStr());
      await loadRecords(filterMonth, filterCategory);
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };

  const remove = async (r: ScheduleRecord) => {
    if (!confirm('이 일정을 삭제할까요?')) return;
    await fetch(`/api/my/vip/schedule?id=${r.id}`, { method: 'DELETE', credentials: 'include' });
    await loadRecords(filterMonth, filterCategory);
  };

  const today = summary?.today ?? todayStr();

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">일정관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">학원 일정(수업·시험·상담·행사 등)을 등록하고 관리합니다.</p>
        </div>
        <div className="flex gap-2">
          <input type="month" value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
          <button onClick={() => setOpen((v) => !v)}
            className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">＋ 일정 추가</button>
        </div>
      </div>

      {/* 요약 */}
      {summary && (
        <div className="grid grid-cols-1 gap-2 max-w-[12rem]">
          <div className="rounded-lg bg-amber-900/15 border border-amber-700/30 px-3 py-2.5 text-center">
            <div className="text-lg font-bold text-amber-200 tabular-nums">{summary.upcoming}</div>
            <div className="text-[10px] text-amber-300/70 mt-0.5">다가오는 일정</div>
          </div>
        </div>
      )}

      {/* 작성 폼 */}
      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="일정 제목"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          <div className="flex flex-wrap gap-2">
            <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)}
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
            <input type="time" value={fTime} onChange={(e) => setFTime(e.target.value)}
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
            <div className="flex rounded-lg overflow-hidden border border-zinc-700/60 flex-wrap">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setFCategory(c)} className={`px-3 py-2 text-sm transition-colors ${fCategory === c ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'}`}>{c}</button>
              ))}
            </div>
          </div>
          <textarea value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="설명 (선택)" rows={3}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200 transition-colors">취소</button>
            <button onClick={create} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">{saving ? '저장 중…' : '일정 저장'}</button>
          </div>
        </div>
      )}

      {/* 카테고리 탭 */}
      <div className="flex gap-1.5 flex-wrap">
        {[{ v: '' as const, l: '전체' }, ...CATEGORIES.map((c) => ({ v: c, l: c }))].map((f) => (
          <button key={f.v} onClick={() => setFilterCategory(f.v)} className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${filterCategory === f.v ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>{f.l}</button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : records.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">등록된 일정이 없습니다. 「＋ 일정 추가」로 시작하세요.</div>
      ) : (
        <div className="space-y-2.5">
          {records.map((r) => {
            const upcoming = r.date >= today;
            return (
              <div key={r.id} className={`rounded-xl border p-4 ${upcoming ? 'bg-zinc-900/50 border-zinc-700/60' : 'bg-zinc-900/30 border-zinc-800/60 opacity-70'}`}>
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  {upcoming && <span className="px-1.5 py-0.5 rounded text-[11px] bg-emerald-500/20 text-emerald-200">예정</span>}
                  <span className={`px-1.5 py-0.5 rounded text-[11px] ${CAT_CLS[r.category] ?? CAT_CLS['기타']}`}>{r.category}</span>
                  <span className={`text-[12px] tabular-nums ${upcoming ? 'text-zinc-300' : 'text-zinc-500'}`}>{r.date}{r.time ? ` ${r.time}` : ''}</span>
                  <div className="ml-auto">
                    <button onClick={() => remove(r)} className="text-[11px] text-zinc-600 hover:text-rose-400 transition-colors">삭제</button>
                  </div>
                </div>
                <div className="text-sm font-medium text-zinc-100">{r.title}</div>
                {r.description && <div className="text-[13px] text-zinc-300 whitespace-pre-wrap leading-relaxed mt-1">{r.description}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
