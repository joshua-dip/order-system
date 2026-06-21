'use client';

import { useCallback, useEffect, useState } from 'react';

interface ClassRow {
  id: string;
  name: string;
  scheduleNote: string;
  studentIds: string[];
  studentCount: number;
  status: 'active' | 'inactive';
}
interface StudentOpt {
  id: string;
  name: string;
  schoolName: string;
  grade: number;
}

export default function VipAttendanceClassesPage() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [allStudents, setAllStudents] = useState<StudentOpt[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [fName, setFName] = useState('');
  const [fNote, setFNote] = useState('');
  const [fStudents, setFStudents] = useState<Set<string>>(new Set());
  const [stuSearch, setStuSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2500); };

  const loadClasses = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/my/vip/attendance/classes', { credentials: 'include' });
      const d = await r.json();
      if (d.ok) setClasses(d.classes);
    } finally { setLoading(false); }
  }, []);

  const loadStudents = useCallback(async () => {
    const r = await fetch('/api/my/vip/students?status=all&limit=100', { credentials: 'include' });
    const d = await r.json();
    if (d.ok && Array.isArray(d.items)) {
      setAllStudents(d.items.map((s: { id: string; name: string; schoolName?: string; grade?: number }) => ({
        id: s.id, name: s.name, schoolName: s.schoolName ?? '', grade: s.grade ?? 0,
      })));
    }
  }, []);

  useEffect(() => { loadClasses(); loadStudents(); }, [loadClasses, loadStudents]);

  const openCreate = () => {
    setEditId(null); setFName(''); setFNote(''); setFStudents(new Set()); setStuSearch(''); setShowForm(true);
  };
  const openEdit = (c: ClassRow) => {
    setEditId(c.id); setFName(c.name); setFNote(c.scheduleNote);
    setFStudents(new Set(c.studentIds)); setStuSearch(''); setShowForm(true);
  };

  const save = async () => {
    if (!fName.trim()) { showToast('반 이름을 입력하세요.'); return; }
    setSaving(true);
    try {
      const payload = { name: fName.trim(), scheduleNote: fNote.trim(), studentIds: [...fStudents] };
      const r = editId
        ? await fetch(`/api/my/vip/attendance/classes/${editId}`, {
            method: 'PATCH', credentials: 'include',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
          })
        : await fetch('/api/my/vip/attendance/classes', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
          });
      const d = await r.json();
      if (!r.ok) { showToast(d.error || '저장 실패'); return; }
      setShowForm(false); await loadClasses(); showToast(editId ? '수정되었습니다.' : '반이 추가되었습니다.');
    } finally { setSaving(false); }
  };

  const remove = async (c: ClassRow) => {
    if (!confirm(`"${c.name}" 반을 삭제할까요? 출결 기록도 함께 삭제됩니다.`)) return;
    const r = await fetch(`/api/my/vip/attendance/classes/${c.id}`, { method: 'DELETE', credentials: 'include' });
    if (r.ok) { await loadClasses(); showToast('삭제되었습니다.'); } else { showToast('삭제 실패'); }
  };

  const toggleStu = (id: string) => setFStudents((p) => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const filteredStudents = stuSearch.trim()
    ? allStudents.filter((s) => (s.name + s.schoolName).toLowerCase().includes(stuSearch.trim().toLowerCase()))
    : allStudents;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">반 관리</h1>
          <p className="text-sm text-zinc-500 mt-1">출결을 매길 반을 만들고 학생을 배정합니다.</p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-zinc-100 text-zinc-900 rounded-xl text-sm font-medium hover:bg-white">
          + 반 추가
        </button>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-zinc-500">로딩 중…</div>
        ) : classes.length === 0 ? (
          <div className="p-10 text-center text-zinc-600 text-sm">아직 만든 반이 없습니다. “+ 반 추가”로 시작하세요.</div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {classes.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/20">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-zinc-100 truncate">{c.name}</span>
                    {c.status === 'inactive' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">비활성</span>}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    학생 {c.studentCount}명{c.scheduleNote ? ` · ${c.scheduleNote}` : ''}
                  </div>
                </div>
                <button onClick={() => openEdit(c)} className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1">수정</button>
                <button onClick={() => remove(c)} className="text-xs text-zinc-500 hover:text-rose-400 px-2 py-1">삭제</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowForm(false)}>
          <div className="bg-zinc-900 rounded-2xl border border-white/10 w-full max-w-lg p-6 max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">{editId ? '반 수정' : '반 추가'}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">반 이름 *</label>
                <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="예: 고2 수요반"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800 text-zinc-100 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">메모(시간 등)</label>
                <input value={fNote} onChange={(e) => setFNote(e.target.value)} placeholder="예: 매주 수 19:00"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800 text-zinc-100 text-sm" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs text-zinc-500">학생 배정 ({fStudents.size}명)</label>
                  <input value={stuSearch} onChange={(e) => setStuSearch(e.target.value)} placeholder="학생 검색"
                    className="px-2 py-1 rounded bg-zinc-900/60 border border-zinc-800 text-zinc-200 text-xs w-36" />
                </div>
                <div className="max-h-52 overflow-y-auto rounded-lg border border-zinc-800 divide-y divide-zinc-800/60">
                  {filteredStudents.length === 0 ? (
                    <p className="text-xs text-zinc-600 px-3 py-4 text-center">학생이 없습니다. 먼저 “학생 관리”에서 추가하세요.</p>
                  ) : filteredStudents.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800/30 cursor-pointer text-sm">
                      <input type="checkbox" checked={fStudents.has(s.id)} onChange={() => toggleStu(s.id)} className="accent-emerald-500" />
                      <span className="flex-1 truncate text-zinc-200">{s.name}</span>
                      <span className="text-[11px] text-zinc-500 truncate">{s.schoolName}{s.grade ? ` ${s.grade}학년` : ''}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button disabled={saving} onClick={save} className="flex-1 py-2.5 bg-zinc-100 text-zinc-900 rounded-xl font-medium disabled:opacity-50">
                {saving ? '저장 중…' : editId ? '수정' : '추가'}
              </button>
              <button onClick={() => setShowForm(false)} className="flex-1 py-2.5 bg-zinc-800 text-zinc-400 rounded-xl">취소</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-emerald-600 text-zinc-100 text-sm rounded-xl shadow-lg">{toast}</div>
      )}
    </div>
  );
}
