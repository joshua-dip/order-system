'use client';

import { useCallback, useEffect, useState } from 'react';

interface ClassRow { id: string; name: string }
interface StatRow {
  id: string; name: string;
  counts: { present: number; late: number; earlyLeave: number; absent: number };
  total: number; rate: number | null;
}

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function VipAttendanceHistoryPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [classId, setClassId] = useState('');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [rows, setRows] = useState<StatRow[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/my/vip/attendance/classes', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (d.ok) { setClasses(d.classes); if (d.classes[0]) setClassId(d.classes[0].id); } })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!classId) { setRows([]); return; }
    setLoading(true);
    try {
      const p = new URLSearchParams({ classId, from, to });
      const r = await fetch(`/api/my/vip/attendance/stats?${p}`, { credentials: 'include' });
      const d = await r.json();
      if (d.ok) { setRows(d.students); setSessionCount(d.sessionCount); } else { setRows([]); }
    } finally { setLoading(false); }
  }, [classId, from, to]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">출결 통계</h1>
        <p className="text-sm text-zinc-500 mt-1">기간별 학생 출석률·지각·결석을 집계합니다.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">반</label>
          <select value={classId} onChange={(e) => setClassId(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800 text-zinc-100 text-sm min-w-[160px]">
            {classes.length === 0 && <option value="">반 없음</option>}
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">시작</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800 text-zinc-100 text-sm" />
        </div>
        <div>
          <label className="block text-[11px] text-zinc-500 mb-1">종료</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800 text-zinc-100 text-sm" />
        </div>
        <span className="ml-auto text-xs text-zinc-500">세션 {sessionCount}회</span>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-zinc-500">로딩 중…</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-zinc-600 text-sm">데이터가 없습니다.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                <th className="text-left px-4 py-2.5 font-medium">학생</th>
                <th className="px-2 py-2.5 font-medium">출석</th>
                <th className="px-2 py-2.5 font-medium">지각</th>
                <th className="px-2 py-2.5 font-medium">조퇴</th>
                <th className="px-2 py-2.5 font-medium">결석</th>
                <th className="px-3 py-2.5 font-medium text-right">출석률</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-zinc-800/60 hover:bg-zinc-800/20">
                  <td className="px-4 py-2.5 text-zinc-100">{s.name}</td>
                  <td className="px-2 py-2.5 text-center text-emerald-300">{s.counts.present}</td>
                  <td className="px-2 py-2.5 text-center text-amber-300">{s.counts.late}</td>
                  <td className="px-2 py-2.5 text-center text-sky-300">{s.counts.earlyLeave}</td>
                  <td className="px-2 py-2.5 text-center text-rose-300">{s.counts.absent}</td>
                  <td className="px-3 py-2.5 text-right font-semibold text-zinc-200">
                    {s.rate === null ? '–' : `${s.rate}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
