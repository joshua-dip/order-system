'use client';

import { useEffect, useState } from 'react';

interface Target { studentId: string; studentName: string; status: string }
interface Worksheet {
  id: string; title: string; topicCount: number; itemCount: number; gradableCount: number;
  gradeToken: string; createdAt: string; targets: Target[];
  progress: { total: number; done: number; submitted: number; assigned: number };
}
interface Student { id: string; name: string; schoolName: string; grade: number }

/** 저장된 문법 학습지 관리 — 다운로드(QR)·학생 배정·QR 링크·삭제. */
export function WorksheetManager({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Worksheet[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<Worksheet | null>(null);

  const reload = () => fetch('/api/my/vip/grammar-problems/worksheets', { credentials: 'include' })
    .then((r) => r.json()).then((d) => setList(d?.ok ? d.worksheets : [])).catch(() => setList([]));
  useEffect(() => { reload(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const download = async (w: Worksheet) => {
    setBusy(w.id);
    try {
      const r = await fetch(`/api/my/vip/grammar-problems/worksheets/${w.id}/download`, { credentials: 'include' });
      if (!r.ok) throw new Error();
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${w.title}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { alert('PDF 생성 실패'); } finally { setBusy(null); }
  };

  const copyQr = (w: Worksheet) => {
    const url = `${location.origin}/grade-g/${w.gradeToken}`;
    navigator.clipboard?.writeText(url).then(() => alert('QR 채점 링크를 복사했어요:\n' + url)).catch(() => prompt('QR 채점 링크', url));
  };

  const remove = async (w: Worksheet) => {
    if (!confirm(`"${w.title}" 학습지를 삭제할까요?`)) return;
    setBusy(w.id);
    try { await fetch(`/api/my/vip/grammar-problems/worksheets/${w.id}`, { method: 'DELETE', credentials: 'include' }); reload(); }
    finally { setBusy(null); }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
          <span className="text-lg">📂</span>
          <p className="text-sm font-bold text-zinc-100">저장된 문법 학습지</p>
          <button onClick={onClose} className="ml-auto rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {!list ? (
            <div className="py-16 text-center"><div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-400" /></div>
          ) : list.length === 0 ? (
            <p className="py-16 text-center text-sm text-zinc-500">저장된 학습지가 없습니다.<br />범위를 선택하고 「💾 저장」을 누르면 여기에 쌓여요.</p>
          ) : (
            <div className="space-y-2.5">
              {list.map((w) => (
                <div key={w.id} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-bold text-zinc-100">{w.title}</p>
                    <span className="text-[11px] text-zinc-500">{w.topicCount}범위 · {w.itemCount}문항</span>
                    {w.gradableCount > 0 && <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">QR 채점 {w.gradableCount}</span>}
                  </div>
                  {w.targets.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      <span className="text-[11px] text-zinc-500">배정 {w.targets.length}명:</span>
                      {w.targets.map((t) => (
                        <span key={t.studentId} className={`rounded px-1.5 py-0.5 text-[10px] ${t.status === 'done' ? 'bg-emerald-500/15 text-emerald-300' : t.status === 'submitted' ? 'bg-amber-500/15 text-amber-300' : 'bg-zinc-800 text-zinc-400'}`}>{t.studentName}</span>
                      ))}
                    </div>
                  )}
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <button onClick={() => download(w)} disabled={busy === w.id}
                      className="rounded-md bg-gradient-to-r from-[#c9a44e] to-amber-600 px-2.5 py-1 text-[11px] font-bold text-zinc-950 hover:opacity-90 disabled:opacity-60">
                      {busy === w.id ? '⏳' : '⬇ PDF(QR)'}
                    </button>
                    <button onClick={() => setAssignFor(w)} className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-[#c9a44e]/50 hover:text-[#e8d48b]">👥 학생 배정</button>
                    {w.gradableCount > 0 && <button onClick={() => copyQr(w)} className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-sky-500/50 hover:text-sky-300">🔗 QR 링크</button>}
                    <button onClick={() => remove(w)} className="rounded-md border border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-500 hover:border-rose-500/40 hover:text-rose-300">삭제</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {assignFor && <AssignModal worksheet={assignFor} onClose={() => setAssignFor(null)} onSaved={() => { setAssignFor(null); reload(); }} />}
    </div>
  );
}

/** 학생 배정 모달 — 내 학생 목록 체크 → PATCH studentIds. */
function AssignModal({ worksheet, onClose, onSaved }: { worksheet: Worksheet; onClose: () => void; onSaved: () => void }) {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set(worksheet.targets.map((t) => t.studentId)));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/my/vip/students?status=active&limit=100', { credentials: 'include' })
      .then((r) => r.json()).then((d) => setStudents(d?.ok ? d.items : [])).catch(() => setStudents([]));
  }, []);

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/my/vip/grammar-problems/worksheets/${worksheet.id}`, {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentIds: [...picked] }),
      });
      if (!r.ok) throw new Error();
      onSaved();
    } catch { alert('배정 저장 실패'); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-zinc-800 px-4 py-3">
          <p className="text-[11px] text-zinc-500">학생 배정</p>
          <p className="truncate text-sm font-bold text-zinc-100">{worksheet.title}</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {!students ? (
            <div className="py-12 text-center"><div className="mx-auto h-5 w-5 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-400" /></div>
          ) : students.length === 0 ? (
            <p className="py-12 text-center text-sm text-zinc-500">등록된 학생이 없습니다.<br />「학생 관리」에서 먼저 학생을 추가하세요.</p>
          ) : (
            <div className="space-y-1">
              {students.map((s) => (
                <label key={s.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${picked.has(s.id) ? 'border-[#c9a44e]/50 bg-[#c9a44e]/10' : 'border-zinc-800 hover:bg-zinc-800/40'}`}>
                  <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} />
                  <span className="text-zinc-200">{s.name}</span>
                  <span className="ml-auto text-[11px] text-zinc-500">{s.schoolName} {s.grade}학년</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-zinc-800 px-4 py-3">
          <span className="text-[11px] text-zinc-500">{picked.size}명 선택</span>
          <button onClick={onClose} className="ml-auto rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">취소</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-gradient-to-r from-[#c9a44e] to-amber-600 px-4 py-1.5 text-sm font-bold text-zinc-950 hover:opacity-90 disabled:opacity-60">{saving ? '저장 중…' : '배정 저장'}</button>
        </div>
      </div>
    </div>
  );
}
