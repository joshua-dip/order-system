'use client';

import { useCallback, useEffect, useState } from 'react';

interface PayrollRecord {
  id: string;
  name: string;
  role: string;
  month: string;
  baseSalary: number;
  bonus: number;
  deduction: number;
  paid: boolean;
  payDate: string;
  memo: string;
  createdAt: string;
  net: number;
}
interface Summary { month: string; totalNet: number; paidCount: number; unpaidCount: number; headcount: number }

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PayrollPage() {
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(currentMonth());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 폼
  const [fName, setFName] = useState('');
  const [fRole, setFRole] = useState('');
  const [fMonth, setFMonth] = useState(currentMonth());
  const [fBase, setFBase] = useState('');
  const [fBonus, setFBonus] = useState('');
  const [fDeduction, setFDeduction] = useState('');
  const [fPayDate, setFPayDate] = useState('');
  const [fMemo, setFMemo] = useState('');

  const fNet = (Number(fBase) || 0) + (Number(fBonus) || 0) - (Number(fDeduction) || 0);

  const load = useCallback(async (m: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (m) params.set('month', m);
    const d = await fetch(`/api/my/vip/payroll?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setRecords(d.records); setSummary(d.summary ?? null); }
    setLoading(false);
  }, []);

  useEffect(() => { load(month); }, [load, month]);

  const create = async () => {
    if (!fName.trim()) { alert('이름을 입력하세요.'); return; }
    if (!/^\d{4}-\d{2}$/.test(fMonth)) { alert('급여 월을 입력하세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/payroll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          name: fName, role: fRole, month: fMonth,
          baseSalary: Number(fBase) || 0, bonus: Number(fBonus) || 0, deduction: Number(fDeduction) || 0,
          payDate: fPayDate || undefined, memo: fMemo,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setOpen(false);
      setFName(''); setFRole(''); setFBase(''); setFBonus(''); setFDeduction(''); setFPayDate(''); setFMemo(''); setFMonth(currentMonth());
      await load(month);
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };

  const togglePaid = async (r: PayrollRecord) => {
    await fetch(`/api/my/vip/payroll?id=${r.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ paid: !r.paid }),
    });
    await load(month);
  };

  const remove = async (r: PayrollRecord) => {
    if (!confirm('이 급여 내역을 삭제할까요?')) return;
    await fetch(`/api/my/vip/payroll?id=${r.id}`, { method: 'DELETE', credentials: 'include' });
    await load(month);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">급여 관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">직원·강사 급여(기본급·수당·공제)를 월별로 관리합니다.</p>
        </div>
        <div className="flex gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
          <button onClick={() => setOpen((v) => !v)}
            className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">＋ 급여 추가</button>
        </div>
      </div>

      {/* 요약 */}
      {summary && (
        <div className="grid grid-cols-3 gap-2 max-w-2xl">
          <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/70 px-3 py-2.5 text-center">
            <div className="text-lg font-bold text-zinc-100 tabular-nums">{summary.headcount}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">인원수</div>
          </div>
          <div className="rounded-lg bg-emerald-900/15 border border-emerald-700/30 px-3 py-2.5 text-center">
            <div className="text-lg font-bold text-emerald-200 tabular-nums">{summary.totalNet.toLocaleString()}원</div>
            <div className="text-[10px] text-emerald-300/70 mt-0.5">지급 합계</div>
          </div>
          <div className="rounded-lg bg-amber-900/15 border border-amber-700/30 px-3 py-2.5 text-center">
            <div className="text-lg font-bold text-amber-200 tabular-nums">{summary.unpaidCount}</div>
            <div className="text-[10px] text-amber-300/70 mt-0.5">미지급</div>
          </div>
        </div>
      )}

      {/* 작성 폼 */}
      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="이름"
              className="flex-1 min-w-[140px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <input value={fRole} onChange={(e) => setFRole(e.target.value)} placeholder="직책 (선택)"
              className="flex-1 min-w-[140px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <input type="month" value={fMonth} onChange={(e) => setFMonth(e.target.value)}
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
          </div>
          <div className="flex flex-wrap gap-2">
            <input type="number" min={0} value={fBase} onChange={(e) => setFBase(e.target.value)} placeholder="기본급"
              className="flex-1 min-w-[120px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <input type="number" min={0} value={fBonus} onChange={(e) => setFBonus(e.target.value)} placeholder="수당"
              className="flex-1 min-w-[120px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <input type="number" min={0} value={fDeduction} onChange={(e) => setFDeduction(e.target.value)} placeholder="공제"
              className="flex-1 min-w-[120px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <input type="date" value={fPayDate} onChange={(e) => setFPayDate(e.target.value)}
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
          </div>
          <div className="text-[13px] text-zinc-400">실지급액 <span className="font-bold text-emerald-300 tabular-nums">{fNet.toLocaleString()}원</span> <span className="text-zinc-600">(기본급 + 수당 − 공제)</span></div>
          <input value={fMemo} onChange={(e) => setFMemo(e.target.value)} placeholder="메모 (선택)"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200 transition-colors">취소</button>
            <button onClick={create} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">{saving ? '저장 중…' : '급여 저장'}</button>
          </div>
        </div>
      )}

      {/* 목록 */}
      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : records.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">급여 내역이 없습니다. 「＋ 급여 추가」로 시작하세요.</div>
      ) : (
        <div className="space-y-2.5">
          {records.map((r) => (
            <div key={r.id} className="rounded-xl border bg-zinc-900/50 border-zinc-800/80 p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-zinc-100">{r.name}</span>
                {r.role && <span className="text-[12px] text-zinc-500">· {r.role}</span>}
                <span className="text-[11px] text-zinc-500">{r.month}</span>
                <button onClick={() => togglePaid(r)} className={`px-1.5 py-0.5 rounded text-[11px] transition-colors ${r.paid ? 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30' : 'bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'}`}>{r.paid ? '지급' : '미지급'}</button>
                <div className="ml-auto flex items-center gap-3">
                  <span className="text-sm font-bold text-zinc-100 tabular-nums">{r.net.toLocaleString()}원</span>
                  <button onClick={() => remove(r)} className="text-[11px] text-zinc-600 hover:text-rose-400 transition-colors">삭제</button>
                </div>
              </div>
              <div className="text-[12px] text-zinc-500 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                <span>기본급 <span className="text-zinc-400 tabular-nums">{r.baseSalary.toLocaleString()}</span></span>
                <span>수당 <span className="text-zinc-400 tabular-nums">{r.bonus.toLocaleString()}</span></span>
                <span>공제 <span className="text-zinc-400 tabular-nums">{r.deduction.toLocaleString()}</span></span>
                {r.payDate && <span>지급일 <span className="text-zinc-400">{r.payDate}</span></span>}
              </div>
              {r.memo && <div className="text-[12px] text-zinc-400 mt-2 pt-2 border-t border-zinc-800/60 whitespace-pre-wrap">{r.memo}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
