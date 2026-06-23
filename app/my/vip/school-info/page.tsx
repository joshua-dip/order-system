'use client';

import { useCallback, useEffect, useState } from 'react';

const LEVELS = ['초등', '중등', '고등', '기타'] as const;
type Level = (typeof LEVELS)[number];
const LEVEL_CLS: Record<Level, string> = {
  초등: 'bg-emerald-500/15 text-emerald-300',
  중등: 'bg-blue-500/15 text-blue-300',
  고등: 'bg-violet-500/15 text-violet-300',
  기타: 'bg-zinc-700/50 text-zinc-400',
};

interface School { id: string; name: string; level: Level; address: string; phone: string; examInfo: string; note: string }

export default function SchoolInfoPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [filterLevel, setFilterLevel] = useState<'' | Level>('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // 폼
  const [fName, setFName] = useState('');
  const [fLevel, setFLevel] = useState<Level>('중등');
  const [fAddress, setFAddress] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [fExam, setFExam] = useState('');
  const [fNote, setFNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterLevel) params.set('level', filterLevel);
    if (q.trim()) params.set('q', q.trim());
    const d = await fetch(`/api/my/vip/school-info?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) setSchools(d.schools);
    setLoading(false);
  }, [filterLevel, q]);
  useEffect(() => { load(); }, [load]);

  const reset = () => { setEditId(null); setFName(''); setFLevel('중등'); setFAddress(''); setFPhone(''); setFExam(''); setFNote(''); setOpen(false); };
  const startEdit = (s: School) => { setEditId(s.id); setFName(s.name); setFLevel(s.level); setFAddress(s.address); setFPhone(s.phone); setFExam(s.examInfo); setFNote(s.note); setOpen(true); };

  const save = async () => {
    if (!fName.trim()) { alert('학교명을 입력하세요.'); return; }
    setSaving(true);
    try {
      const payload = { name: fName, level: fLevel, address: fAddress, phone: fPhone, examInfo: fExam, note: fNote };
      const res = await fetch(editId ? `/api/my/vip/school-info?id=${editId}` : '/api/my/vip/school-info', {
        method: editId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      reset(); load();
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };
  const remove = async (s: School) => {
    if (!confirm(`"${s.name}" 정보를 삭제할까요?`)) return;
    await fetch(`/api/my/vip/school-info?id=${s.id}`, { method: 'DELETE', credentials: 'include' });
    load();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">학교 정보 관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">학생들이 다니는 학교의 정보(연락처·시험 일정 등)를 정리합니다.</p>
        </div>
        <button onClick={() => { if (open) reset(); else setOpen(true); }} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">{open ? '닫기' : '＋ 학교 추가'}</button>
      </div>

      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="학교명" className="flex-1 min-w-[160px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <div className="flex rounded-lg overflow-hidden border border-zinc-700/60">
              {LEVELS.map((l) => (
                <button key={l} onClick={() => setFLevel(l)} className={`px-3 py-2 text-sm transition-colors ${fLevel === l ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <input value={fAddress} onChange={(e) => setFAddress(e.target.value)} placeholder="주소 (선택)" className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <input value={fPhone} onChange={(e) => setFPhone(e.target.value)} placeholder="전화 (선택)" className="w-40 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          </div>
          <textarea value={fExam} onChange={(e) => setFExam(e.target.value)} placeholder="시험 일정·특이사항 (선택)" rows={3} className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
          <input value={fNote} onChange={(e) => setFNote(e.target.value)} placeholder="비고 (선택)" className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          <div className="flex gap-2 justify-end">
            <button onClick={reset} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200">취소</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40">{saving ? '저장 중…' : editId ? '수정 저장' : '학교 저장'}</button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        {[{ v: '' as const, l: '전체' }, ...LEVELS.map((l) => ({ v: l, l }))].map((f) => (
          <button key={f.v} onClick={() => setFilterLevel(f.v)} className={`px-3 py-1 rounded-full text-xs transition-colors ${filterLevel === f.v ? 'bg-zinc-100 text-zinc-900 font-medium' : 'bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700'}`}>{f.l}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="학교명 검색" className="ml-auto px-3 py-1.5 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 w-44" />
      </div>

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : schools.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">등록한 학교가 없습니다. 「＋ 학교 추가」로 시작하세요.</div>
      ) : (
        <div className="space-y-2.5">
          {schools.map((s) => (
            <div key={s.id} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`px-1.5 py-0.5 rounded text-[11px] ${LEVEL_CLS[s.level]}`}>{s.level}</span>
                <span className="text-sm font-medium text-zinc-100">{s.name}</span>
                {s.phone && <span className="text-[11px] text-zinc-500">{s.phone}</span>}
                <div className="ml-auto flex gap-2">
                  <button onClick={() => startEdit(s)} className="text-[11px] text-zinc-500 hover:text-zinc-200">수정</button>
                  <button onClick={() => remove(s)} className="text-[11px] text-zinc-600 hover:text-rose-400">삭제</button>
                </div>
              </div>
              {s.address && <div className="text-[12px] text-zinc-500">{s.address}</div>}
              {s.examInfo && <div className="text-[13px] text-zinc-300 whitespace-pre-wrap mt-1.5 pt-1.5 border-t border-zinc-800/60"><span className="text-zinc-500 text-[11px]">시험 정보 </span>{s.examInfo}</div>}
              {s.note && <div className="text-[12px] text-amber-300/80 mt-1">{s.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
