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
interface CounselRecord { id: string; studentId: string; studentName: string; date: string; time: string; status: '예정' | '완료'; type: CType; content: string; nextPlan: string; createdAt: string }
interface Summary { upcoming: number; thisMonthDone: number; today: string }

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CounselingPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<CounselRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStudent, setFilterStudent] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | '예정' | '완료'>('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 폼
  const [fStatus, setFStatus] = useState<'예정' | '완료'>('완료');
  const [fStudent, setFStudent] = useState('');
  const [fDate, setFDate] = useState(todayStr());
  const [fTime, setFTime] = useState('');
  const [fType, setFType] = useState<CType>('전화');
  const [fContent, setFContent] = useState('');
  const [fNext, setFNext] = useState('');

  const loadRecords = useCallback(async (sid: string, status: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (sid) params.set('studentId', sid);
    if (status) params.set('status', status);
    const d = await fetch(`/api/my/vip/counseling?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setRecords(d.records); setSummary(d.summary ?? null); }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch('/api/my/vip/students?status=active', { credentials: 'include' }).then((r) => r.json()).then((d) => { if (d.ok && Array.isArray(d.items)) setStudents(d.items); });
  }, []);
  useEffect(() => { loadRecords(filterStudent, filterStatus); }, [loadRecords, filterStudent, filterStatus]);

  const create = async () => {
    if (!fStudent) { alert('학생을 선택하세요.'); return; }
    if (fStatus === '완료' && !fContent.trim()) { alert('상담 내용을 입력하세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/counseling', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ studentId: fStudent, date: fDate, time: fTime || undefined, status: fStatus, type: fType, content: fContent, nextPlan: fNext || undefined }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setOpen(false); setFContent(''); setFNext(''); setFTime(''); setFType('전화'); setFDate(todayStr());
      await loadRecords(filterStudent, filterStatus);
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };

  const complete = async (r: CounselRecord) => {
    let content = r.content;
    if (!content.trim()) {
      const v = prompt('상담 내용을 입력하세요 (완료 처리).', '');
      if (v === null) return;
      content = v;
    }
    await fetch(`/api/my/vip/counseling?id=${r.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ status: '완료', content }),
    });
    await loadRecords(filterStudent, filterStatus);
  };

  const remove = async (r: CounselRecord) => {
    if (!confirm(r.status === '예정' ? '이 상담 예약을 삭제할까요?' : '이 상담 기록을 삭제할까요?')) return;
    await fetch(`/api/my/vip/counseling?id=${r.id}`, { method: 'DELETE', credentials: 'include' });
    await loadRecords(filterStudent, filterStatus);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">상담 관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">상담 일정을 예약하고, 진행한 상담은 내용·다음 계획까지 기록·관리합니다.</p>
        </div>
        <div className="flex gap-2">
          <select value={filterStudent} onChange={(e) => setFilterStudent(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
            <option value="">전체 학생</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => { setOpen((v) => !v); if (!fStudent && filterStudent) setFStudent(filterStudent); }}
            className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">＋ 상담 추가</button>
        </div>
      </div>

      {/* 요약 */}
      {summary && (
        <div className="grid grid-cols-2 gap-2 max-w-md">
          <div className="rounded-lg bg-amber-900/15 border border-amber-700/30 px-3 py-2.5 text-center">
            <div className="text-lg font-bold text-amber-200 tabular-nums">{summary.upcoming}</div>
            <div className="text-[10px] text-amber-300/70 mt-0.5">예정 상담</div>
          </div>
          <div className="rounded-lg bg-zinc-900/60 border border-zinc-800/70 px-3 py-2.5 text-center">
            <div className="text-lg font-bold text-zinc-100 tabular-nums">{summary.thisMonthDone}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">이번 달 완료</div>
          </div>
        </div>
      )}

      {/* 작성 폼 */}
      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <div className="flex rounded-lg overflow-hidden border border-zinc-700/60 w-fit">
            {(['완료', '예정'] as const).map((s) => (
              <button key={s} onClick={() => setFStatus(s)} className={`px-4 py-2 text-sm transition-colors ${fStatus === s ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'}`}>{s === '완료' ? '상담 기록' : '상담 예약'}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={fStudent} onChange={(e) => setFStudent(e.target.value)}
              className="flex-1 min-w-[150px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
              <option value="">학생 선택</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}{s.grade ? ` (${s.grade}학년)` : ''}</option>)}
            </select>
            <input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)}
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
            {fStatus === '예정' && (
              <input type="time" value={fTime} onChange={(e) => setFTime(e.target.value)}
                className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
            )}
            <div className="flex rounded-lg overflow-hidden border border-zinc-700/60">
              {TYPES.map((t) => (
                <button key={t} onClick={() => setFType(t)} className={`px-3 py-2 text-sm transition-colors ${fType === t ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'}`}>{t}</button>
              ))}
            </div>
          </div>
          <textarea value={fContent} onChange={(e) => setFContent(e.target.value)} placeholder={fStatus === '예정' ? '상담 안건 (선택)' : '상담 내용'} rows={3}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
          <input value={fNext} onChange={(e) => setFNext(e.target.value)} placeholder="다음 계획 (선택)"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200 transition-colors">취소</button>
            <button onClick={create} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">{saving ? '저장 중…' : fStatus === '예정' ? '예약 저장' : '기록 저장'}</button>
          </div>
        </div>
      )}

      {/* 상태 탭 */}
      <div className="flex gap-1.5">
        {[{ v: '' as const, l: '전체' }, { v: '예정' as const, l: '예정' }, { v: '완료' as const, l: '완료' }].map((f) => (
          <button key={f.v} onClick={() => setFilterStatus(f.v)} className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${filterStatus === f.v ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>{f.l}</button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : records.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">{filterStatus === '예정' ? '예정된 상담이 없습니다.' : '상담 기록이 없습니다.'} 「＋ 상담 추가」로 시작하세요.</div>
      ) : (
        <div className="space-y-2.5">
          {records.map((r) => (
            <div key={r.id} className={`rounded-xl border p-4 ${r.status === '예정' ? 'bg-amber-900/10 border-amber-700/30' : 'bg-zinc-900/50 border-zinc-800/80'}`}>
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                {r.status === '예정' && <span className="px-1.5 py-0.5 rounded text-[11px] bg-amber-500/20 text-amber-200">예정</span>}
                <span className="text-sm font-medium text-zinc-100">{r.studentName}</span>
                <span className={`px-1.5 py-0.5 rounded text-[11px] ${TYPE_CLS[r.type] ?? TYPE_CLS['기타']}`}>{r.type}</span>
                <span className="text-[11px] text-zinc-500">{r.date}{r.time ? ` ${r.time}` : ''}</span>
                <div className="ml-auto flex items-center gap-2">
                  {r.status === '예정' && <button onClick={() => complete(r)} className="text-[11px] px-2 py-1 rounded bg-emerald-600/70 text-zinc-100 hover:bg-emerald-500">완료 처리</button>}
                  <button onClick={() => remove(r)} className="text-[11px] text-zinc-600 hover:text-rose-400 transition-colors">삭제</button>
                </div>
              </div>
              {r.content && <div className="text-[13px] text-zinc-300 whitespace-pre-wrap leading-relaxed">{r.content}</div>}
              {r.status === '예정' && !r.content && <div className="text-[12px] text-zinc-600 italic">안건 미입력</div>}
              {r.nextPlan && <div className="text-[12px] text-amber-300/80 mt-2 pt-2 border-t border-zinc-800/60"><span className="text-zinc-500">다음 계획 </span>{r.nextPlan}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
