'use client';

import { useCallback, useEffect, useState } from 'react';

interface SubjectFee { name: string; tuition: number }
interface Row { studentId: string; name: string; schoolName: string; grade: number | null; subjects: SubjectFee[]; expected: number; amount: number; status: 'unpaid' | 'paid'; paidAt: string | null; hasInvoice: boolean }
interface Summary { studentCount: number; billed: number; collected: number; outstanding: number; paidCount: number }

const won = (n: number) => `${n.toLocaleString()}원`;

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function TuitionPage() {
  const [month, setMonth] = useState(currentMonth());
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    const d = await fetch(`/api/my/vip/tuition?month=${m}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setRows(d.rows); setSummary(d.summary); }
    setLoading(false);
  }, []);
  useEffect(() => { load(month); }, [load, month]);

  const save = async (r: Row, patch: Partial<Pick<Row, 'amount' | 'status'>>) => {
    setSavingId(r.studentId);
    const next = { ...r, ...patch };
    try {
      const res = await fetch('/api/my/vip/tuition', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ month, studentId: r.studentId, amount: next.amount, status: next.status }),
      });
      if (res.ok) await load(month);
      else alert('저장 실패');
    } catch { alert('저장 중 오류'); }
    setSavingId(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">수강료 관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">월별 수강료를 청구·수납 관리합니다. 기본 청구액은 학생의 <b className="text-zinc-300">과목별 수강료 합</b>으로 채워집니다.</p>
        </div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value || currentMonth())}
          className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
      </div>

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ['총 청구', won(summary.billed), 'text-zinc-100'],
            ['수납', won(summary.collected), 'text-emerald-300'],
            ['미납', won(summary.outstanding), 'text-amber-300'],
            ['수납 인원', `${summary.paidCount} / ${summary.studentCount}`, 'text-zinc-100'],
          ].map(([k, v, c]) => (
            <div key={k} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
              <div className="text-[11px] text-zinc-500">{k}</div>
              <div className={`text-lg font-bold mt-1 ${c}`}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">활성 학생이 없습니다. 「학생 관리」에서 학생과 <span className="text-zinc-400">과목별 수강료</span>를 먼저 등록하세요.</div>
      ) : (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-zinc-500 text-[12px] border-b border-zinc-800/70">
                <th className="text-left px-4 py-2.5">학생</th>
                <th className="text-left px-3 py-2.5">과목 · 수강료</th>
                <th className="text-right px-3 py-2.5 w-36">청구액</th>
                <th className="text-center px-4 py-2.5 w-28">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.studentId} className="border-b border-zinc-800/50 last:border-b-0">
                  <td className="px-4 py-2.5">
                    <div className="text-zinc-200">{r.name}</div>
                    <div className="text-[11px] text-zinc-600">{r.schoolName || '—'}{r.grade ? ` · ${r.grade}학년` : ''}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.subjects.length === 0 ? <span className="text-[11px] text-zinc-600">과목 미등록</span> : (
                      <div className="flex flex-wrap gap-1">
                        {r.subjects.map((s, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded bg-zinc-800/70 text-[11px] text-zinc-400">{s.name}{s.tuition > 0 ? ` ${won(s.tuition)}` : ''}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <input
                      type="number" min={0} defaultValue={r.amount}
                      onBlur={(e) => { const v = Math.max(0, Math.floor(Number(e.target.value) || 0)); if (v !== r.amount) save(r, { amount: v }); }}
                      className="w-28 px-2 py-1 text-right rounded-md bg-zinc-900/80 border border-zinc-700/60 text-zinc-100 text-[13px] focus:outline-none focus:border-[#c9a44e]/50"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      onClick={() => save(r, { status: r.status === 'paid' ? 'unpaid' : 'paid' })}
                      disabled={savingId === r.studentId}
                      className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-50 ${r.status === 'paid' ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                    >
                      {r.status === 'paid' ? '✓ 수납' : '미납'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
