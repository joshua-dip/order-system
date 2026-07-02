'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Note {
  id: string;
  studentName: string;
  source: string;
  questionText: string;
  wrongAnswer: string;
  correctAnswer: string;
  memo: string;
  createdAt: string | null;
}

const EMPTY_FORM = {
  studentName: '',
  source: '',
  questionText: '',
  wrongAnswer: '',
  correctAnswer: '',
  memo: '',
};

export default function ManualReviewNote({ subject }: { subject: '국어' | '수학' }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [studentNames, setStudentNames] = useState<string[]>([]);
  const [filterStudent, setFilterStudent] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await fetch(`/api/my/vip/review/manual?subject=${encodeURIComponent(subject)}`, { credentials: 'include' }).then((r) => r.json());
      if (d.ok) setNotes(d.notes as Note[]);
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [subject]);
  useEffect(() => { load(); }, [load]);

  // 학생 이름 자동완성 (실패해도 자유 입력 가능)
  useEffect(() => {
    let alive = true;
    fetch('/api/my/vip/students', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const arr = Array.isArray(d?.students) ? d.students : [];
        setStudentNames(arr.map((s: { name?: string }) => s?.name).filter((n: unknown): n is string => typeof n === 'string' && !!n));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const set = (k: keyof typeof EMPTY_FORM, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.studentName.trim()) { setError('학생 이름을 입력해 주세요.'); return; }
    if (!form.questionText.trim() && !form.memo.trim()) { setError('문제 내용 또는 메모 중 하나는 입력해 주세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/review/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ subject, ...form }),
      });
      const d = await res.json();
      if (res.ok && d.ok) {
        setForm({ ...EMPTY_FORM, studentName: form.studentName }); // 같은 학생 연속 입력 편의
        load();
      } else {
        setError(d.error || '저장에 실패했습니다.');
      }
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    }
    setSaving(false);
  };

  const remove = async (id: string) => {
    if (!confirm('이 오답 항목을 삭제할까요?')) return;
    setDeletingId(id);
    try {
      const res = await fetch('/api/my/vip/review/manual', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });
      if (res.ok) setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch {
      /* ignore */
    }
    setDeletingId(null);
  };

  const studentsInNotes = useMemo(
    () => [...new Set(notes.map((n) => n.studentName))].sort((a, b) => a.localeCompare(b, 'ko')),
    [notes],
  );
  const shown = filterStudent ? notes.filter((n) => n.studentName === filterStudent) : notes;

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-sm border border-[#c9a44e]/25">{subject}</span>
          오답노트
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">
          학생별 틀린 문항을 직접 기록해 두는 <b className="text-zinc-300">{subject} 오답노트</b>입니다. (영어는 QR 자가채점에서 자동 생성돼요)
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">
        {/* 입력 폼 */}
        <form onSubmit={submit} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4 space-y-3 h-fit">
          <div className="text-xs font-semibold text-zinc-400">오답 추가</div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">학생 이름 *</label>
            <input
              list="vip-review-student-names"
              value={form.studentName}
              onChange={(e) => set('studentName', e.target.value)}
              placeholder="학생 이름"
              className={inputCls}
            />
            <datalist id="vip-review-student-names">
              {studentNames.map((n) => <option key={n} value={n} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">시험·단원·교재 (선택)</label>
            <input value={form.source} onChange={(e) => set('source', e.target.value)} placeholder="예: 3월 모의고사 · 문학 5단원" className={inputCls} />
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">문제 내용</label>
            <textarea value={form.questionText} onChange={(e) => set('questionText', e.target.value)} rows={3} placeholder="틀린 문제의 내용/번호" className={`${inputCls} resize-y`} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">학생 답 (선택)</label>
              <input value={form.wrongAnswer} onChange={(e) => set('wrongAnswer', e.target.value)} placeholder="오답" className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-500 mb-1">정답 (선택)</label>
              <input value={form.correctAnswer} onChange={(e) => set('correctAnswer', e.target.value)} placeholder="정답" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="block text-[11px] text-zinc-500 mb-1">해설·메모</label>
            <textarea value={form.memo} onChange={(e) => set('memo', e.target.value)} rows={2} placeholder="오답 원인·해설·복습 포인트" className={`${inputCls} resize-y`} />
          </div>
          {error && <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>}
          <button type="submit" disabled={saving} className="w-full py-2.5 rounded-lg bg-amber-500/20 text-amber-200 text-sm font-semibold hover:bg-amber-500/30 transition-colors disabled:opacity-40">
            {saving ? '저장 중…' : '오답 기록 추가'}
          </button>
        </form>

        {/* 목록 */}
        <div className="space-y-3">
          {studentsInNotes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-zinc-600 mr-1">학생별 보기:</span>
              <button onClick={() => setFilterStudent('')} className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${filterStudent === '' ? 'bg-zinc-700 text-zinc-100 border-zinc-600' : 'bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:border-zinc-700'}`}>전체 {notes.length}</button>
              {studentsInNotes.map((name) => (
                <button key={name} onClick={() => setFilterStudent(name)} className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${filterStudent === name ? 'bg-zinc-700 text-zinc-100 border-zinc-600' : 'bg-zinc-900/50 text-zinc-400 border-zinc-800 hover:border-zinc-700'}`}>{name}</button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
          ) : shown.length === 0 ? (
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">
              {notes.length === 0 ? '아직 기록한 오답이 없습니다. 왼쪽에서 추가해 보세요.' : '해당 학생의 오답이 없습니다.'}
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="text-xs text-zinc-500">오답 {shown.length}개</div>
              {shown.map((n) => (
                <div key={n.id} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="font-bold text-zinc-200 text-sm">{n.studentName}</span>
                    {n.source && <span className="px-1.5 py-0.5 rounded text-[11px] bg-violet-500/15 text-violet-300">{n.source}</span>}
                    <span className="text-[11px] text-zinc-600">{n.createdAt ? new Date(n.createdAt).toLocaleDateString('ko-KR') : ''}</span>
                    <button onClick={() => remove(n.id)} disabled={deletingId === n.id} className="ml-auto text-[11px] text-zinc-500 hover:text-rose-400 transition-colors disabled:opacity-40">
                      {deletingId === n.id ? '삭제 중…' : '삭제'}
                    </button>
                  </div>
                  {n.questionText && <div className="text-[13px] text-zinc-300 whitespace-pre-wrap mb-1">{n.questionText}</div>}
                  {(n.wrongAnswer || n.correctAnswer) && (
                    <div className="text-[12px] mb-1">
                      {n.wrongAnswer && <span className="text-rose-400">학생 답 {n.wrongAnswer}</span>}
                      {n.wrongAnswer && n.correctAnswer && <span className="text-zinc-600"> / </span>}
                      {n.correctAnswer && <span className="text-emerald-400">정답 {n.correctAnswer}</span>}
                    </div>
                  )}
                  {n.memo && <div className="text-[12px] text-zinc-400 mt-2 pt-2 border-t border-zinc-800/60"><span className="text-zinc-500">메모 </span>{n.memo}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
