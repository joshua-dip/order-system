'use client';

import { useCallback, useEffect, useState } from 'react';

const TYPES = ['전화', '대면', '문자', '기타'] as const;
type CType = (typeof TYPES)[number];
const TYPE_CLS: Record<CType, string> = {
  전화: 'bg-blue-500/15 text-blue-300',
  대면: 'bg-emerald-500/15 text-emerald-300',
  문자: 'bg-violet-500/15 text-violet-300',
  기타: 'bg-zinc-700/50 text-zinc-400',
};

interface Student { id: string; name: string; grade: number; schoolName: string }
interface CounselRecord { id: string; studentId: string; studentName: string; date: string; type: CType; content: string; nextPlan: string; createdAt: string }

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CounselingPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<CounselRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStudent, setFilterStudent] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 폼
  const [fStudent, setFStudent] = useState('');
  const [fDate, setFDate] = useState(todayStr());
  const [fType, setFType] = useState<CType>('전화');
  const [fContent, setFContent] = useState('');
  const [fNext, setFNext] = useState('');

  const loadRecords = useCallback(async (sid: string) => {
    setLoading(true);
    const url = sid ? `/api/my/vip/counseling?studentId=${sid}` : '/api/my/vip/counseling';
    const d = await fetch(url, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) setRecords(d.records);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch('/api/my/vip/students?status=active', { credentials: 'include' }).then((r) => r.json()).then((d) => { if (d.ok && Array.isArray(d.items)) setStudents(d.items); });
  }, []);
  useEffect(() => { loadRecords(filterStudent); }, [loadRecords, filterStudent]);

  const create = async () => {
    if (!fStudent || !fContent.trim()) { alert('학생과 상담 내용을 입력하세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/counseling', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ studentId: fStudent, date: fDate, type: fType, content: fContent, nextPlan: fNext || undefined }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setOpen(false); setFContent(''); setFNext(''); setFType('전화'); setFDate(todayStr());
      await loadRecords(filterStudent);
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };

  const remove = async (r: CounselRecord) => {
    if (!confirm('이 상담 기록을 삭제할까요?')) return;
    await fetch(`/api/my/vip/counseling?id=${r.id}`, { method: 'DELETE', credentials: 'include' });
    await loadRecords(filterStudent);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">상담일지</h1>
          <p className="text-sm text-zinc-500 mt-0.5">학생·학부모 상담 내용을 날짜·유형별로 기록하고 다시 찾아봅니다.</p>
        </div>
        <div className="flex gap-2">
          <select value={filterStudent} onChange={(e) => setFilterStudent(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
            <option value="">전체 학생</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => { setOpen((v) => !v); if (!fStudent && filterStudent) setFStudent(filterStudent); }}
            className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">＋ 새 상담 기록</button>
        </div>
      </div>

      {/* 작성 폼 */}
      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            <select value={fStudent} onChange={(e) => setFStudent(e.target.value)}
              className="flex-1 min-w-[160px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
              <option value="">학생 선택</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}{s.grade ? ` (${s.grade}학년)` : ''}</option>)}
            </select>
            <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)}
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
            <div className="flex rounded-lg overflow-hidden border border-zinc-700/60">
              {TYPES.map((t) => (
                <button key={t} onClick={() => setFType(t)} className={`px-3 py-2 text-sm transition-colors ${fType === t ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'}`}>{t}</button>
              ))}
            </div>
          </div>
          <textarea value={fContent} onChange={(e) => setFContent(e.target.value)} placeholder="상담 내용" rows={3}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
          <input value={fNext} onChange={(e) => setFNext(e.target.value)} placeholder="다음 계획 (선택)"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200 transition-colors">취소</button>
            <button onClick={create} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">{saving ? '저장 중…' : '기록 저장'}</button>
          </div>
        </div>
      )}

      {/* 목록 */}
      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : records.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">상담 기록이 없습니다. 「＋ 새 상담 기록」으로 시작하세요.</div>
      ) : (
        <div className="space-y-2.5">
          {records.map((r) => (
            <div key={r.id} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="text-sm font-medium text-zinc-100">{r.studentName}</span>
                <span className={`px-1.5 py-0.5 rounded text-[11px] ${TYPE_CLS[r.type] ?? TYPE_CLS['기타']}`}>{r.type}</span>
                <span className="text-[11px] text-zinc-500">{r.date}</span>
                <button onClick={() => remove(r)} className="ml-auto text-[11px] text-zinc-600 hover:text-rose-400 transition-colors">삭제</button>
              </div>
              <div className="text-[13px] text-zinc-300 whitespace-pre-wrap leading-relaxed">{r.content}</div>
              {r.nextPlan && <div className="text-[12px] text-amber-300/80 mt-2 pt-2 border-t border-zinc-800/60"><span className="text-zinc-500">다음 계획 </span>{r.nextPlan}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
