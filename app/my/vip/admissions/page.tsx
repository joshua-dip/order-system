'use client';

import { useCallback, useEffect, useState } from 'react';
import { studentOptionLabel } from '@/lib/student-label';

const TRACKS = ['수시-학종', '수시-교과', '논술', '정시', '기타'] as const;
type Track = (typeof TRACKS)[number];
const STATUSES = ['준비', '지원', '1차합격', '최종합격', '불합격', '등록'] as const;
type Status = (typeof STATUSES)[number];

const STATUS_CLS: Record<Status, string> = {
  준비: 'bg-amber-500/20 text-amber-200',
  지원: 'bg-blue-500/20 text-blue-200',
  '1차합격': 'bg-emerald-500/15 text-emerald-300',
  최종합격: 'bg-emerald-500/20 text-emerald-200',
  불합격: 'bg-rose-500/20 text-rose-200',
  등록: 'bg-emerald-600/25 text-emerald-100',
};

interface Student { id: string; name: string; grade: number; schoolName: string; phone?: string }
interface AdmissionRecord { id: string; studentId: string; studentName: string; university: string; department: string; track: Track; status: Status; targetDate: string; memo: string; createdAt: string }
interface Summary { inProgress: number }

export default function AdmissionsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<AdmissionRecord[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStudent, setFilterStudent] = useState('');
  const [filterStatus, setFilterStatus] = useState<'' | Status>('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 폼
  const [fStudent, setFStudent] = useState('');
  const [fUniversity, setFUniversity] = useState('');
  const [fDepartment, setFDepartment] = useState('');
  const [fTrack, setFTrack] = useState<Track>('수시-학종');
  const [fStatus, setFStatus] = useState<Status>('준비');
  const [fTargetDate, setFTargetDate] = useState('');
  const [fMemo, setFMemo] = useState('');

  const loadRecords = useCallback(async (sid: string, status: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (sid) params.set('studentId', sid);
    if (status) params.set('status', status);
    const d = await fetch(`/api/my/vip/admissions?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) { setRecords(d.records); setSummary(d.summary ?? null); }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetch('/api/my/vip/students?status=active', { credentials: 'include' }).then((r) => r.json()).then((d) => { if (d.ok && Array.isArray(d.items)) setStudents(d.items); });
  }, []);
  useEffect(() => { loadRecords(filterStudent, filterStatus); }, [loadRecords, filterStudent, filterStatus]);

  const create = async () => {
    if (!fStudent) { alert('학생을 선택하세요.'); return; }
    if (!fUniversity.trim()) { alert('대학을 입력하세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/admissions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ studentId: fStudent, university: fUniversity, department: fDepartment, track: fTrack, status: fStatus, targetDate: fTargetDate || '', memo: fMemo }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setOpen(false); setFUniversity(''); setFDepartment(''); setFTrack('수시-학종'); setFStatus('준비'); setFTargetDate(''); setFMemo('');
      await loadRecords(filterStudent, filterStatus);
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };

  const changeStatus = async (r: AdmissionRecord, status: Status) => {
    await fetch(`/api/my/vip/admissions?id=${r.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ status }),
    });
    await loadRecords(filterStudent, filterStatus);
  };

  const remove = async (r: AdmissionRecord) => {
    if (!confirm('이 입시 항목을 삭제할까요?')) return;
    await fetch(`/api/my/vip/admissions?id=${r.id}`, { method: 'DELETE', credentials: 'include' });
    await loadRecords(filterStudent, filterStatus);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">입시관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">학생별 목표 대학·전형·지원/합불 현황을 관리합니다.</p>
        </div>
        <div className="flex gap-2">
          <select value={filterStudent} onChange={(e) => setFilterStudent(e.target.value)}
            className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
            <option value="">전체 학생</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => { setOpen((v) => !v); if (!fStudent && filterStudent) setFStudent(filterStudent); }}
            className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">＋ 입시 추가</button>
        </div>
      </div>

      {/* 요약 */}
      {summary && (
        <div className="grid grid-cols-1 gap-2 max-w-[12rem]">
          <div className="rounded-lg bg-amber-900/15 border border-amber-700/30 px-3 py-2.5 text-center">
            <div className="text-lg font-bold text-amber-200 tabular-nums">{summary.inProgress}</div>
            <div className="text-[10px] text-amber-300/70 mt-0.5">진행 중</div>
          </div>
        </div>
      )}

      {/* 작성 폼 */}
      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            <select value={fStudent} onChange={(e) => setFStudent(e.target.value)}
              className="flex-1 min-w-[150px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
              <option value="">학생 선택</option>
              {students.map((s) => <option key={s.id} value={s.id}>{studentOptionLabel(s)}</option>)}
            </select>
            <input value={fUniversity} onChange={(e) => setFUniversity(e.target.value)} placeholder="대학"
              className="flex-1 min-w-[140px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <input value={fDepartment} onChange={(e) => setFDepartment(e.target.value)} placeholder="학과"
              className="flex-1 min-w-[140px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex rounded-lg overflow-hidden border border-zinc-700/60">
              {TRACKS.map((t) => (
                <button key={t} onClick={() => setFTrack(t)} className={`px-3 py-2 text-sm transition-colors ${fTrack === t ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'}`}>{t}</button>
              ))}
            </div>
            <select value={fStatus} onChange={(e) => setFStatus(e.target.value as Status)}
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="date" value={fTargetDate} onChange={(e) => setFTargetDate(e.target.value)}
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
          </div>
          <textarea value={fMemo} onChange={(e) => setFMemo(e.target.value)} placeholder="메모 (선택)" rows={2}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200 transition-colors">취소</button>
            <button onClick={create} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">{saving ? '저장 중…' : '저장'}</button>
          </div>
        </div>
      )}

      {/* 상태 탭 */}
      <div className="flex gap-1.5 flex-wrap">
        {[{ v: '' as const, l: '전체' }, ...STATUSES.map((s) => ({ v: s, l: s }))].map((f) => (
          <button key={f.v} onClick={() => setFilterStatus(f.v)} className={`px-3.5 py-1.5 rounded-lg text-sm transition-colors ${filterStatus === f.v ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>{f.l}</button>
        ))}
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : records.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">입시 항목이 없습니다. 「＋ 입시 추가」로 시작하세요.</div>
      ) : (
        <div className="space-y-2.5">
          {records.map((r) => (
            <div key={r.id} className="rounded-xl border p-4 bg-zinc-900/50 border-zinc-800/80">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className={`px-1.5 py-0.5 rounded text-[11px] ${STATUS_CLS[r.status] ?? STATUS_CLS['준비']}`}>{r.status}</span>
                <span className="text-sm font-medium text-zinc-100">{r.studentName}</span>
                <span className="px-1.5 py-0.5 rounded text-[11px] bg-zinc-700/50 text-zinc-400">{r.track}</span>
                {r.targetDate && <span className="text-[11px] text-zinc-500">{r.targetDate}</span>}
                <div className="ml-auto flex items-center gap-2">
                  <select value={r.status} onChange={(e) => changeStatus(r, e.target.value as Status)}
                    className="text-[11px] px-2 py-1 rounded bg-zinc-900/70 border border-zinc-700/60 text-zinc-300 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={() => remove(r)} className="text-[11px] text-zinc-600 hover:text-rose-400 transition-colors">삭제</button>
                </div>
              </div>
              <div className="text-[13px] text-zinc-300 leading-relaxed">{r.university}{r.department ? ` · ${r.department}` : ''}</div>
              {r.memo && <div className="text-[12px] text-zinc-400 mt-2 pt-2 border-t border-zinc-800/60 whitespace-pre-wrap">{r.memo}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
