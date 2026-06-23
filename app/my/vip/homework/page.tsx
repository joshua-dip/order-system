'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadBlob } from '@/lib/download-blob';

type Status = 'assigned' | 'submitted' | 'done';
const STATUS_LABEL: Record<Status, string> = { assigned: '배정', submitted: '제출', done: '완료' };
const NEXT: Record<Status, Status> = { assigned: 'submitted', submitted: 'done', done: 'assigned' };
const STATUS_CLS: Record<Status, string> = {
  assigned: 'bg-zinc-800 text-zinc-400',
  submitted: 'bg-blue-500/20 text-blue-300',
  done: 'bg-emerald-500/20 text-emerald-300',
};

interface Student { id: string; name: string; schoolName: string; grade: number }
interface BankItem { id: string; questionId: string; type: string; source: string; textbook: string }
interface Target { studentId: string; studentName: string; status: Status }
interface Assignment { id: string; title: string; questionCount: number; questionIds: string[]; dueDate: string | null; createdAt: string; progress: { total: number; done: number; submitted: number; assigned: number }; targets: Target[] }

export default function HomeworkPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  // 생성 폼
  const [students, setStudents] = useState<Student[]>([]);
  const [bank, setBank] = useState<BankItem[]>([]);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [pickedStudents, setPickedStudents] = useState<Set<string>>(new Set());
  const [pickedQ, setPickedQ] = useState<Set<string>>(new Set());
  const [bankQuery, setBankQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const d = await fetch('/api/my/vip/assignments', { credentials: 'include' }).then((r) => r.json());
    if (d.ok) setAssignments(d.assignments);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = async () => {
    setCreating(true);
    const [st, bk] = await Promise.all([
      fetch('/api/my/vip/students?status=active', { credentials: 'include' }).then((r) => r.json()),
      fetch('/api/my/vip/question-bank', { credentials: 'include' }).then((r) => r.json()),
    ]);
    if (st.ok && Array.isArray(st.items)) setStudents(st.items);
    if (bk.ok && Array.isArray(bk.items)) setBank(bk.items);
  };

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); setter(n);
  };

  const create = async () => {
    if (!title.trim() || pickedStudents.size === 0 || pickedQ.size === 0) { alert('제목·학생·문항을 모두 선택하세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/assignments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ title, dueDate: due || undefined, studentIds: [...pickedStudents], questionIds: [...pickedQ] }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '생성 실패'); setSaving(false); return; }
      setCreating(false); setTitle(''); setDue(''); setPickedStudents(new Set()); setPickedQ(new Set());
      await load();
    } catch { alert('생성 중 오류'); }
    setSaving(false);
  };

  const cycleStatus = async (a: Assignment, t: Target) => {
    const next = NEXT[t.status];
    await fetch(`/api/my/vip/assignments?id=${a.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ studentId: t.studentId, status: next }) });
    await load();
  };

  const remove = async (a: Assignment) => {
    if (!confirm(`「${a.title}」 숙제를 삭제할까요?`)) return;
    await fetch(`/api/my/vip/assignments?id=${a.id}`, { method: 'DELETE', credentials: 'include' });
    await load();
  };

  const downloadPdf = async (a: Assignment) => {
    setPdfBusy(a.id);
    try {
      const res = await fetch('/api/my/vip/generate/download', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ ids: a.questionIds.join(','), title: a.title, answerSheet: true, subject: '영어' }),
      });
      if (!res.ok) { alert('PDF 생성 실패'); setPdfBusy(null); return; }
      downloadBlob(await res.blob(), `${a.title}.pdf`);
    } catch { alert('PDF 다운로드 오류'); }
    setPdfBusy(null);
  };

  const filteredBank = useMemo(() => bank.filter((b) => !bankQuery || b.source.includes(bankQuery) || b.type.includes(bankQuery) || (b.textbook || '').includes(bankQuery)), [bank, bankQuery]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">숙제 관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">내 문제은행에서 문항을 골라 학생에게 숙제로 배정하고, 진행상태를 관리합니다. 숙제지는 PDF로 내보낼 수 있어요.</p>
        </div>
        {!creating && <button onClick={openCreate} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">＋ 새 숙제</button>}
      </div>

      {/* 생성 폼 */}
      {creating && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="숙제 제목 (예: 6월 4주차 빈칸 10제)" maxLength={80}
              className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)}
              className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 학생 선택 */}
            <div>
              <div className="text-xs text-zinc-500 mb-1.5">배정 학생 ({pickedStudents.size})</div>
              <div className="rounded-lg border border-zinc-800/70 max-h-52 overflow-y-auto divide-y divide-zinc-800/50">
                {students.length === 0 ? <div className="p-4 text-[12px] text-zinc-600 text-center">학생이 없습니다.</div> : students.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/30 cursor-pointer">
                    <input type="checkbox" checked={pickedStudents.has(s.id)} onChange={() => toggle(pickedStudents, s.id, setPickedStudents)} className="accent-indigo-500" />
                    <span className="text-[13px] text-zinc-200">{s.name}</span>
                    <span className="text-[11px] text-zinc-600">{s.grade ? `${s.grade}학년` : ''}</span>
                  </label>
                ))}
              </div>
            </div>
            {/* 문항 선택 (문제은행) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-xs text-zinc-500">문항 선택 ({pickedQ.size})</div>
                <input value={bankQuery} onChange={(e) => setBankQuery(e.target.value)} placeholder="검색" className="px-2 py-1 rounded bg-zinc-900/70 border border-zinc-700/60 text-[11px] text-zinc-200 w-28 focus:outline-none" />
              </div>
              <div className="rounded-lg border border-zinc-800/70 max-h-52 overflow-y-auto divide-y divide-zinc-800/50">
                {bank.length === 0 ? <div className="p-4 text-[12px] text-zinc-600 text-center">문제은행이 비어 있습니다. 「문제 관리」에서 문항을 담으세요.</div> : filteredBank.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/30 cursor-pointer">
                    <input type="checkbox" checked={pickedQ.has(b.questionId)} onChange={() => toggle(pickedQ, b.questionId, setPickedQ)} className="accent-indigo-500" />
                    <span className="px-1.5 py-0.5 rounded text-[10px] bg-violet-500/15 text-violet-300">{b.type}</span>
                    <span className="text-[11px] text-zinc-500 truncate">{b.source}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => setCreating(false)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200 transition-colors">취소</button>
            <button onClick={create} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors disabled:opacity-40">{saving ? '생성 중…' : '숙제 배정'}</button>
          </div>
        </div>
      )}

      {/* 목록 */}
      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : assignments.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">아직 배정한 숙제가 없습니다. 「＋ 새 숙제」로 시작하세요.</div>
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => {
            const p = a.progress;
            const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
            return (
              <div key={a.id} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden">
                <div className="p-4 flex items-center gap-3 flex-wrap">
                  <button onClick={() => setExpanded(expanded === a.id ? null : a.id)} className="flex-1 min-w-0 text-left">
                    <div className="text-sm font-medium text-zinc-100">{a.title}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5">문항 {a.questionCount} · 학생 {p.total}명{a.dueDate ? ` · 마감 ${a.dueDate}` : ''} · 완료 {p.done}/{p.total}</div>
                  </button>
                  <div className="w-28 h-1.5 rounded-full bg-zinc-800 overflow-hidden"><div className="h-full bg-emerald-500/70" style={{ width: `${pct}%` }} /></div>
                  <button onClick={() => downloadPdf(a)} disabled={pdfBusy === a.id} className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 text-amber-200 text-[12px] hover:bg-amber-500/30 transition-colors disabled:opacity-40">{pdfBusy === a.id ? '…' : '숙제지 PDF'}</button>
                  <button onClick={() => remove(a)} className="px-2 py-1.5 text-[12px] text-zinc-600 hover:text-rose-400 transition-colors">삭제</button>
                </div>
                {expanded === a.id && (
                  <div className="border-t border-zinc-800/70 p-4 flex flex-wrap gap-2">
                    {a.targets.map((t) => (
                      <button key={t.studentId} onClick={() => cycleStatus(a, t)} title="클릭하면 상태 변경 (배정→제출→완료)"
                        className={`px-2.5 py-1.5 rounded-lg text-[12px] transition-colors ${STATUS_CLS[t.status]} hover:opacity-80`}>
                        {t.studentName} · {STATUS_LABEL[t.status]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
