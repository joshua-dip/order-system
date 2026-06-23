'use client';

import { useCallback, useEffect, useState } from 'react';

const TYPES = ['발표', '보고서', '실기', '지필', '기타'] as const;
type AType = (typeof TYPES)[number];
const TYPE_CLS: Record<AType, string> = {
  발표: 'bg-blue-500/15 text-blue-300',
  보고서: 'bg-violet-500/15 text-violet-300',
  실기: 'bg-emerald-500/15 text-emerald-300',
  지필: 'bg-amber-500/15 text-amber-300',
  기타: 'bg-zinc-700/50 text-zinc-400',
};

type AStatus = '예정' | '진행' | '완료';
const STATUS_CLS: Record<AStatus, string> = {
  예정: 'bg-amber-500/20 text-amber-200',
  진행: 'bg-blue-500/20 text-blue-200',
  완료: 'bg-emerald-500/20 text-emerald-200',
};
const STATUS_CARD: Record<AStatus, string> = {
  예정: 'bg-amber-900/10 border-amber-700/30',
  진행: 'bg-blue-900/10 border-blue-700/30',
  완료: 'bg-zinc-900/50 border-zinc-800/80',
};
const NEXT_STATUS: Record<AStatus, AStatus | null> = { 예정: '진행', 진행: '완료', 완료: null };

interface AssessRecord { id: string; title: string; subject: string; school: string; grade: string; type: AType; dueDate: string; description: string; status: AStatus; createdAt: string }
interface Summary { upcoming: number }

export default function AssessmentsPage() {
  const [records, setRecords] = useState<AssessRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<'' | AStatus>('');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 폼
  const [fTitle, setFTitle] = useState('');
  const [fSubject, setFSubject] = useState('');
  const [fSchool, setFSchool] = useState('');
  const [fGrade, setFGrade] = useState('');
  const [fType, setFType] = useState<AType>('기타');
  const [fDue, setFDue] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fStatus, setFStatus] = useState<AStatus>('예정');

  const loadRecords = useCallback(async (status: string, q: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    const d = await fetch(`/api/my/vip/assessments?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setRecords(d.records); setSummary(d.summary ?? null); }
    setLoading(false);
  }, []);

  useEffect(() => { loadRecords(filterStatus, query); }, [loadRecords, filterStatus, query]);

  const create = async () => {
    if (!fTitle.trim()) { alert('제목을 입력하세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/assessments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ title: fTitle, subject: fSubject, school: fSchool, grade: fGrade, type: fType, dueDate: fDue, description: fDesc, status: fStatus }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setOpen(false);
      setFTitle(''); setFSubject(''); setFSchool(''); setFGrade(''); setFType('기타'); setFDue(''); setFDesc(''); setFStatus('예정');
      await loadRecords(filterStatus, query);
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };

  const changeStatus = async (r: AssessRecord, status: AStatus) => {
    await fetch(`/api/my/vip/assessments?id=${r.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ status }),
    });
    await loadRecords(filterStatus, query);
  };

  const remove = async (r: AssessRecord) => {
    if (!confirm('이 수행평가를 삭제할까요?')) return;
    await fetch(`/api/my/vip/assessments?id=${r.id}`, { method: 'DELETE', credentials: 'include' });
    await loadRecords(filterStatus, query);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">수행평가 관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">학교 수행평가 일정·유형·마감일과 진행 상태를 관리합니다.</p>
        </div>
        <div className="flex gap-2">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목·과목·학교 검색"
            className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          <button onClick={() => setOpen((v) => !v)}
            className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">＋ 수행평가</button>
        </div>
      </div>

      {/* 요약 */}
      {summary && (
        <div className="grid grid-cols-1 gap-2 max-w-[12rem]">
          <div className="rounded-lg bg-amber-900/15 border border-amber-700/30 px-3 py-2.5 text-center">
            <div className="text-lg font-bold text-amber-200 tabular-nums">{summary.upcoming}</div>
            <div className="text-[10px] text-amber-300/70 mt-0.5">미완료 (예정+진행)</div>
          </div>
        </div>
      )}

      {/* 작성 폼 */}
      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="수행평가 제목"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          <div className="flex flex-wrap gap-2">
            <input value={fSubject} onChange={(e) => setFSubject(e.target.value)} placeholder="과목"
              className="flex-1 min-w-[120px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <input value={fSchool} onChange={(e) => setFSchool(e.target.value)} placeholder="학교"
              className="flex-1 min-w-[120px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <input value={fGrade} onChange={(e) => setFGrade(e.target.value)} placeholder="학년"
              className="w-[100px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex rounded-lg overflow-hidden border border-zinc-700/60">
              {TYPES.map((t) => (
                <button key={t} onClick={() => setFType(t)} className={`px-3 py-2 text-sm transition-colors ${fType === t ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'}`}>{t}</button>
              ))}
            </div>
            <input type="date" value={fDue} onChange={(e) => setFDue(e.target.value)}
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value as AStatus)}
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
              <option value="예정">예정</option>
              <option value="진행">진행</option>
              <option value="완료">완료</option>
            </select>
          </div>
          <textarea value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="설명 / 평가 기준 (선택)" rows={3}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200 transition-colors">취소</button>
            <button onClick={create} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">{saving ? '저장 중…' : '저장'}</button>
          </div>
        </div>
      )}

      {/* 상태 탭 */}
      <div className="flex gap-1.5">
        {[{ v: '' as const, l: '전체' }, { v: '예정' as const, l: '예정' }, { v: '진행' as const, l: '진행' }, { v: '완료' as const, l: '완료' }].map((f) => (
          <button key={f.v} onClick={() => setFilterStatus(f.v)} className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${filterStatus === f.v ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>{f.l}</button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : records.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">수행평가가 없습니다. 「＋ 수행평가」로 시작하세요.</div>
      ) : (
        <div className="space-y-2.5">
          {records.map((r) => {
            const next = NEXT_STATUS[r.status];
            const meta = [r.subject, r.school, r.grade].filter(Boolean).join(' · ');
            return (
              <div key={r.id} className={`rounded-xl border p-4 ${STATUS_CARD[r.status]}`}>
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className={`px-1.5 py-0.5 rounded text-[11px] ${STATUS_CLS[r.status]}`}>{r.status}</span>
                  <span className="text-sm font-medium text-zinc-100">{r.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[11px] ${TYPE_CLS[r.type] ?? TYPE_CLS['기타']}`}>{r.type}</span>
                  {r.dueDate && <span className="text-[11px] text-zinc-500">마감 {r.dueDate}</span>}
                  <div className="ml-auto flex items-center gap-2">
                    {next && <button onClick={() => changeStatus(r, next)} className="text-[11px] px-2 py-1 rounded bg-emerald-600/70 text-zinc-100 hover:bg-emerald-500">{next}로</button>}
                    <button onClick={() => remove(r)} className="text-[11px] text-zinc-600 hover:text-rose-400 transition-colors">삭제</button>
                  </div>
                </div>
                {meta && <div className="text-[12px] text-zinc-400">{meta}</div>}
                {r.description && <div className="text-[13px] text-zinc-300 whitespace-pre-wrap leading-relaxed mt-1.5">{r.description}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
