'use client';

import { useCallback, useEffect, useState } from 'react';

const CATEGORIES = ['임대료', '공과금', '비품', '급여', '마케팅', '기타'] as const;
type ECategory = (typeof CATEGORIES)[number];
const CAT_CLS: Record<ECategory, string> = {
  임대료: 'bg-blue-500/15 text-blue-300',
  공과금: 'bg-cyan-500/15 text-cyan-300',
  비품: 'bg-emerald-500/15 text-emerald-300',
  급여: 'bg-violet-500/15 text-violet-300',
  마케팅: 'bg-amber-500/15 text-amber-300',
  기타: 'bg-zinc-700/50 text-zinc-400',
};

interface ExpenseRecord { id: string; date: string; category: ECategory; amount: number; payee: string; memo: string; createdAt: string }
interface CatTotal { category: ECategory; total: number }
interface Summary { month: string; monthTotal: number; byCategory: CatTotal[] }

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ExpensesPage() {
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(currentMonth());
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 폼
  const [fDate, setFDate] = useState(todayStr());
  const [fCategory, setFCategory] = useState<ECategory>('임대료');
  const [fAmount, setFAmount] = useState('');
  const [fPayee, setFPayee] = useState('');
  const [fMemo, setFMemo] = useState('');

  const loadRecords = useCallback(async (m: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (m) params.set('month', m);
    const d = await fetch(`/api/my/vip/expenses?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setRecords(d.records); setSummary(d.summary ?? null); }
    setLoading(false);
  }, []);

  useEffect(() => { loadRecords(month); }, [loadRecords, month]);

  const create = async () => {
    const amount = Number(fAmount);
    if (!Number.isFinite(amount) || amount < 0) { alert('금액을 올바르게 입력하세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/expenses', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ date: fDate, category: fCategory, amount, payee: fPayee || undefined, memo: fMemo || undefined }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setOpen(false); setFAmount(''); setFPayee(''); setFMemo(''); setFCategory('임대료'); setFDate(todayStr());
      await loadRecords(month);
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };

  const remove = async (r: ExpenseRecord) => {
    if (!confirm('이 지출 내역을 삭제할까요?')) return;
    await fetch(`/api/my/vip/expenses?id=${r.id}`, { method: 'DELETE', credentials: 'include' });
    await loadRecords(month);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">운영비 관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">학원 운영비 지출을 기록·분류하고 월별 합계를 봅니다.</p>
        </div>
        <div className="flex gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
          <button onClick={() => setOpen((v) => !v)}
            className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">＋ 지출 추가</button>
        </div>
      </div>

      {/* 요약 */}
      {summary && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-zinc-100 tabular-nums">{summary.monthTotal.toLocaleString()}원</span>
            <span className="text-[11px] text-zinc-500">{summary.month} 합계</span>
          </div>
          {summary.byCategory.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {summary.byCategory.map((c) => (
                <span key={c.category} className={`px-2 py-1 rounded text-[11px] ${CAT_CLS[c.category] ?? CAT_CLS['기타']}`}>
                  {c.category} {c.total.toLocaleString()}원
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 작성 폼 */}
      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)}
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
            <div className="flex rounded-lg overflow-hidden border border-zinc-700/60 flex-wrap">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => setFCategory(c)} className={`px-3 py-2 text-sm transition-colors ${fCategory === c ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'}`}>{c}</button>
              ))}
            </div>
            <input type="number" inputMode="numeric" min={0} value={fAmount} onChange={(e) => setFAmount(e.target.value)} placeholder="금액(원)"
              className="w-32 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
            <input value={fPayee} onChange={(e) => setFPayee(e.target.value)} placeholder="지급처 (선택)"
              className="flex-1 min-w-[140px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          </div>
          <textarea value={fMemo} onChange={(e) => setFMemo(e.target.value)} placeholder="메모 (선택)" rows={2}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200 transition-colors">취소</button>
            <button onClick={create} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">{saving ? '저장 중…' : '지출 저장'}</button>
          </div>
        </div>
      )}

      {/* 목록 */}
      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : records.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">이 달의 지출 내역이 없습니다. 「＋ 지출 추가」로 시작하세요.</div>
      ) : (
        <div className="space-y-2.5">
          {records.map((r) => (
            <div key={r.id} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-zinc-500">{r.date}</span>
                <span className={`px-1.5 py-0.5 rounded text-[11px] ${CAT_CLS[r.category] ?? CAT_CLS['기타']}`}>{r.category}</span>
                {r.payee && <span className="text-sm font-medium text-zinc-100">{r.payee}</span>}
                <div className="ml-auto flex items-center gap-3">
                  <span className="text-sm font-bold text-zinc-100 tabular-nums">{r.amount.toLocaleString()}원</span>
                  <button onClick={() => remove(r)} className="text-[11px] text-zinc-600 hover:text-rose-400 transition-colors">삭제</button>
                </div>
              </div>
              {r.memo && <div className="text-[13px] text-zinc-300 whitespace-pre-wrap leading-relaxed mt-1.5">{r.memo}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
