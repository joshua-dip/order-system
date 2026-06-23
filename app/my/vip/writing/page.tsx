'use client';

import { useCallback, useEffect, useState } from 'react';

const LEVELS = ['기초', '중급', '심화'] as const;
type Level = (typeof LEVELS)[number];
const LEVEL_CLS: Record<Level, string> = {
  기초: 'bg-emerald-500/15 text-emerald-300',
  중급: 'bg-blue-500/15 text-blue-300',
  심화: 'bg-violet-500/15 text-violet-300',
};

interface Student { id: string; name: string; grade: number; schoolName: string }
interface Topic { id: string; title: string; prompt: string; targetWords: number | null; level: Level; reference: string; submissionCount: number; createdAt: string }
interface Submission { id: string; topicId: string | null; topicTitle: string; studentId: string; studentName: string; date: string; original: string; corrected: string; feedback: string; score: number | null; status: '제출' | '첨삭완료'; wordCount: number }

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const wc = (t: string) => (t.trim() ? t.trim().split(/\s+/).filter(Boolean).length : 0);

export default function VipWritingPage() {
  const [tab, setTab] = useState<'topics' | 'submissions'>('topics');
  const [students, setStudents] = useState<Student[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);

  useEffect(() => {
    fetch('/api/my/vip/students?status=active', { credentials: 'include' }).then((r) => r.json()).then((d) => { if (d.ok && Array.isArray(d.items)) setStudents(d.items); });
  }, []);
  const loadTopics = useCallback(async () => {
    const d = await fetch('/api/my/vip/writing/topics', { credentials: 'include' }).then((r) => r.json());
    if (d.ok) setTopics(d.topics);
  }, []);
  useEffect(() => { loadTopics(); }, [loadTopics]);

  // 첨삭 탭으로 이동 시 미리 선택할 주제
  const [presetTopic, setPresetTopic] = useState<string>('');
  const goCorrect = (topicId: string) => { setPresetTopic(topicId); setTab('submissions'); };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">영작 수업</h1>
        <p className="text-sm text-zinc-500 mt-0.5">영작 주제를 출제하고, 학생 영작을 받아 직접 첨삭·피드백합니다.</p>
      </div>

      <div className="flex gap-1 p-1 rounded-xl bg-zinc-900/60 border border-zinc-800/80 w-fit">
        {([['topics', '주제'], ['submissions', '제출·첨삭']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${tab === id ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-400 hover:text-zinc-200'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'topics'
        ? <TopicsTab topics={topics} reload={loadTopics} onCorrect={goCorrect} />
        : <SubmissionsTab students={students} topics={topics} presetTopic={presetTopic} reloadTopics={loadTopics} />}
    </div>
  );
}

/* ───────────────── 주제 ───────────────── */
function TopicsTab({ topics, reload, onCorrect }: { topics: Topic[]; reload: () => void; onCorrect: (topicId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [target, setTarget] = useState('');
  const [level, setLevel] = useState<Level>('중급');
  const [reference, setReference] = useState('');

  const reset = () => { setEditId(null); setTitle(''); setPrompt(''); setTarget(''); setLevel('중급'); setReference(''); setOpen(false); };
  const startEdit = (t: Topic) => { setEditId(t.id); setTitle(t.title); setPrompt(t.prompt); setTarget(t.targetWords ? String(t.targetWords) : ''); setLevel(t.level); setReference(t.reference); setOpen(true); };

  const save = async () => {
    if (!title.trim()) { alert('주제 제목을 입력하세요.'); return; }
    setSaving(true);
    try {
      const payload = { title, prompt, targetWords: target ? Number(target) : undefined, level, reference };
      const url = editId ? `/api/my/vip/writing/topics?id=${editId}` : '/api/my/vip/writing/topics';
      const res = await fetch(url, { method: editId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      reset(); reload();
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };
  const remove = async (t: Topic) => {
    if (!confirm(`주제 "${t.title}"을(를) 삭제할까요?${t.submissionCount ? `\n(제출물 ${t.submissionCount}개는 '자유 주제'로 남습니다)` : ''}`)) return;
    await fetch(`/api/my/vip/writing/topics?id=${t.id}`, { method: 'DELETE', credentials: 'include' });
    reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { if (open) reset(); else setOpen(true); }} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 transition-colors">{open ? '닫기' : '＋ 새 주제'}</button>
      </div>

      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="주제 제목 (예: My Most Memorable Trip)"
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="주제 설명·지시문 (학생에게 안내할 내용, 조건 등)" rows={3}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
          <div className="flex flex-wrap gap-2 items-center">
            <input value={target} onChange={(e) => setTarget(e.target.value.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="권장 단어수"
              className="w-28 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <div className="flex rounded-lg overflow-hidden border border-zinc-700/60">
              {LEVELS.map((l) => (
                <button key={l} onClick={() => setLevel(l)} className={`px-3 py-2 text-sm transition-colors ${level === l ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'}`}>{l}</button>
              ))}
            </div>
          </div>
          <textarea value={reference} onChange={(e) => setReference(e.target.value)} placeholder="모범답안·첨삭 체크리스트 (선생님 참고용, 선택)" rows={2}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
          <div className="flex gap-2 justify-end">
            <button onClick={reset} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200">취소</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40">{saving ? '저장 중…' : editId ? '주제 수정' : '주제 저장'}</button>
          </div>
        </div>
      )}

      {topics.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">출제한 영작 주제가 없습니다. 「＋ 새 주제」로 시작하세요.</div>
      ) : (
        <div className="space-y-2.5">
          {topics.map((t) => (
            <div key={t.id} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`px-1.5 py-0.5 rounded text-[11px] ${LEVEL_CLS[t.level]}`}>{t.level}</span>
                <span className="text-sm font-semibold text-zinc-100">{t.title}</span>
                {t.targetWords && <span className="text-[11px] text-zinc-500">권장 {t.targetWords}단어</span>}
                {t.submissionCount > 0 && <span className="text-[11px] text-amber-300/80">제출 {t.submissionCount}</span>}
                <div className="ml-auto flex gap-1.5">
                  <button onClick={() => onCorrect(t.id)} className="text-[11px] px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">이 주제로 첨삭</button>
                  <button onClick={() => startEdit(t)} className="text-[11px] text-zinc-500 hover:text-zinc-200">수정</button>
                  <button onClick={() => remove(t)} className="text-[11px] text-zinc-600 hover:text-rose-400">삭제</button>
                </div>
              </div>
              {t.prompt && <div className="text-[13px] text-zinc-400 whitespace-pre-wrap leading-relaxed">{t.prompt}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────── 제출·첨삭 ───────────────── */
function SubmissionsTab({ students, topics, presetTopic, reloadTopics }: { students: Student[]; topics: Topic[]; presetTopic: string; reloadTopics: () => void }) {
  const [subs, setSubs] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [fStudent, setFStudent] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // 제출 폼
  const [nStudent, setNStudent] = useState('');
  const [nTopic, setNTopic] = useState('');
  const [nDate, setNDate] = useState(todayStr());
  const [nOriginal, setNOriginal] = useState('');

  useEffect(() => { if (presetTopic) { setNTopic(presetTopic); setOpen(true); } }, [presetTopic]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (fStudent) params.set('studentId', fStudent);
    if (fStatus) params.set('status', fStatus);
    const d = await fetch(`/api/my/vip/writing/submissions?${params}`, { credentials: 'include' }).then((r) => r.json());
    if (d.ok) setSubs(d.submissions);
    setLoading(false);
  }, [fStudent, fStatus]);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!nStudent || !nOriginal.trim()) { alert('학생과 영작 원문을 입력하세요.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/my/vip/writing/submissions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ studentId: nStudent, topicId: nTopic || undefined, date: nDate, original: nOriginal }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setOpen(false); setNOriginal(''); setNDate(todayStr());
      await load(); reloadTopics();
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={fStudent} onChange={(e) => setFStudent(e.target.value)} className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
          <option value="">전체 학생</option>
          {students.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
          <option value="">전체 상태</option>
          <option value="제출">제출(첨삭 전)</option>
          <option value="첨삭완료">첨삭완료</option>
        </select>
        <button onClick={() => { setOpen((v) => !v); if (!nStudent && fStudent) setNStudent(fStudent); }} className="ml-auto px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500">{open ? '닫기' : '＋ 영작 제출'}</button>
      </div>

      {open && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-3">
          <div className="flex flex-wrap gap-2">
            <select value={nStudent} onChange={(e) => setNStudent(e.target.value)} className="flex-1 min-w-[150px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
              <option value="">학생 선택</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.name}{s.grade ? ` (${s.grade}학년)` : ''}</option>)}
            </select>
            <select value={nTopic} onChange={(e) => setNTopic(e.target.value)} className="flex-1 min-w-[150px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [&>option]:bg-zinc-900 focus:outline-none focus:border-[#c9a44e]/50">
              <option value="">자유 주제</option>
              {topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <input type="date" value={nDate} onChange={(e) => setNDate(e.target.value)} className="px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 [color-scheme:dark] focus:outline-none focus:border-[#c9a44e]/50" />
          </div>
          <textarea value={nOriginal} onChange={(e) => setNOriginal(e.target.value)} placeholder="학생이 작성한 영작 원문을 붙여넣으세요." rows={5}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y font-mono" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-zinc-500">{wc(nOriginal)} 단어</span>
            <div className="flex gap-2">
              <button onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-400 text-sm hover:text-zinc-200">취소</button>
              <button onClick={create} disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600/80 text-zinc-100 text-sm font-medium hover:bg-indigo-500 disabled:opacity-40">{saving ? '저장 중…' : '제출 등록'}</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : subs.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">제출된 영작이 없습니다. 「＋ 영작 제출」로 학생 영작을 등록하세요.</div>
      ) : (
        <div className="space-y-2.5">
          {subs.map((s) => <SubmissionCard key={s.id} sub={s} reload={load} />)}
        </div>
      )}
    </div>
  );
}

function SubmissionCard({ sub, reload }: { sub: Submission; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [corrected, setCorrected] = useState(sub.corrected || sub.original);
  const [feedback, setFeedback] = useState(sub.feedback);
  const [score, setScore] = useState(sub.score != null ? String(sub.score) : '');
  const [saving, setSaving] = useState(false);

  const save = async (markDone: boolean) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/my/vip/writing/submissions?id=${sub.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ corrected, feedback, score: score === '' ? null : Number(score), status: markDone ? '첨삭완료' : '제출' }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { alert(d.error || '저장 실패'); setSaving(false); return; }
      setEditing(false); reload();
    } catch { alert('저장 중 오류'); }
    setSaving(false);
  };
  const remove = async () => {
    if (!confirm('이 제출물을 삭제할까요?')) return;
    await fetch(`/api/my/vip/writing/submissions?id=${sub.id}`, { method: 'DELETE', credentials: 'include' });
    reload();
  };

  return (
    <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
      <div className="flex items-center gap-2 flex-wrap mb-1.5">
        <span className="text-sm font-medium text-zinc-100">{sub.studentName}</span>
        <span className="text-[11px] text-zinc-500">{sub.topicTitle}</span>
        <span className="text-[11px] text-zinc-600">{sub.date} · {sub.wordCount}단어</span>
        <span className={`px-1.5 py-0.5 rounded text-[11px] ${sub.status === '첨삭완료' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>{sub.status}</span>
        {sub.score != null && <span className="text-[11px] text-zinc-300 font-semibold">{sub.score}점</span>}
        <div className="ml-auto flex gap-2">
          <button onClick={() => setEditing((v) => !v)} className="text-[11px] px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">{editing ? '접기' : sub.status === '첨삭완료' ? '첨삭 보기/수정' : '첨삭하기'}</button>
          <button onClick={remove} className="text-[11px] text-zinc-600 hover:text-rose-400">삭제</button>
        </div>
      </div>

      {/* 원문 */}
      <div className="text-[13px] text-zinc-300 whitespace-pre-wrap leading-relaxed bg-zinc-950/40 rounded-lg p-3 border border-zinc-800/60">{sub.original}</div>

      {/* 첨삭완료 + 미편집 상태: 첨삭본·피드백 표시 */}
      {!editing && sub.status === '첨삭완료' && (
        <div className="mt-2 space-y-2">
          {sub.corrected && sub.corrected !== sub.original && (
            <div className="text-[13px] text-emerald-100 whitespace-pre-wrap leading-relaxed bg-emerald-950/20 rounded-lg p-3 border border-emerald-900/40">
              <div className="text-[10px] text-emerald-400/70 mb-1">첨삭본</div>{sub.corrected}
            </div>
          )}
          {sub.feedback && <div className="text-[12px] text-amber-200/90 whitespace-pre-wrap"><span className="text-zinc-500">피드백 </span>{sub.feedback}</div>}
        </div>
      )}

      {/* 첨삭 편집기 */}
      {editing && (
        <div className="mt-3 space-y-2.5 pt-3 border-t border-zinc-800/60">
          <div>
            <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-zinc-500">첨삭본 (교정한 글)</span><span className="text-[10px] text-zinc-600">{wc(corrected)}단어</span></div>
            <textarea value={corrected} onChange={(e) => setCorrected(e.target.value)} rows={5}
              className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-emerald-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-600/50 resize-y font-mono" />
          </div>
          <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="총평·피드백 (문법·표현·구성 등)" rows={2}
            className="w-full px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50 resize-y" />
          <div className="flex items-center gap-2 flex-wrap">
            <input value={score} onChange={(e) => setScore(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} inputMode="numeric" placeholder="점수"
              className="w-20 px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/60 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#c9a44e]/50" />
            <span className="text-[11px] text-zinc-600">/ 100</span>
            <div className="ml-auto flex gap-2">
              <button onClick={() => save(false)} disabled={saving} className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-300 text-sm hover:bg-zinc-700 disabled:opacity-40">임시 저장</button>
              <button onClick={() => save(true)} disabled={saving} className="px-4 py-2 rounded-lg bg-emerald-600/80 text-zinc-100 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40">{saving ? '저장 중…' : '첨삭완료 저장'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
