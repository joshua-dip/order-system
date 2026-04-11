'use client';

import { useCallback, useEffect, useState } from 'react';

interface School { id: string; name: string }
interface SchoolExam { id: string; examType: string; grade: number; academicYear: number; objectiveCount: number; subjectiveCount: number; isLocked: boolean; questions: Record<string, { score: number; isSubjective: boolean }> }
interface Student { id: string; name: string; grade: number }
interface Score { studentId: string; answers: Record<string, number>; objectiveScore: number; subjectiveScore: number; totalScore: number }

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

export default function VipScoresPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState('');
  const [filterYear, setFilterYear] = useState(CURRENT_YEAR);
  const [filterGrade, setFilterGrade] = useState(1);

  const [exams, setExams] = useState<SchoolExam[]>([]);
  const [selectedExam, setSelectedExam] = useState<SchoolExam | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [scores, setScores] = useState<Record<string, Score>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  useEffect(() => {
    fetch('/api/my/vip/schools', { credentials: 'include' }).then((r) => r.json()).then((d) => { if (d.ok) setSchools(d.schools); });
  }, []);

  useEffect(() => {
    if (!selectedSchool) { setExams([]); return; }
    const p = new URLSearchParams({ schoolId: selectedSchool, academicYear: String(filterYear), grade: String(filterGrade) });
    fetch(`/api/my/vip/school-exams?${p}`, { credentials: 'include' }).then((r) => r.json()).then((d) => { if (d.ok) setExams(d.exams); });
  }, [selectedSchool, filterYear, filterGrade]);

  const loadStudentsAndScores = useCallback(async () => {
    if (!selectedExam || !selectedSchool) return;
    const [sRes, scRes] = await Promise.all([
      fetch(`/api/my/vip/students?schoolId=${selectedSchool}&academicYear=${filterYear}&grade=${filterGrade}&limit=100`, { credentials: 'include' }).then((r) => r.json()),
      fetch(`/api/my/vip/scores?schoolExamId=${selectedExam.id}`, { credentials: 'include' }).then((r) => r.json()),
    ]);
    if (sRes.ok) setStudents(sRes.items);
    if (scRes.ok) {
      const map: Record<string, Score> = {};
      for (const s of scRes.scores) map[s.studentId] = s;
      setScores(map);
    }
  }, [selectedExam, selectedSchool, filterYear, filterGrade]);

  useEffect(() => { loadStudentsAndScores(); }, [loadStudentsAndScores]);

  const getScore = (studentId: string): Score => scores[studentId] || { studentId, answers: {}, objectiveScore: 0, subjectiveScore: 0, totalScore: 0 };

  const updateAnswer = (studentId: string, key: string, val: number) => {
    setScores((prev) => {
      const s = prev[studentId] || { studentId, answers: {}, objectiveScore: 0, subjectiveScore: 0, totalScore: 0 };
      const newAnswers = { ...s.answers, [key]: val };
      const exam = selectedExam!;
      let objScore = 0, subScore = 0;
      for (const [qn, v] of Object.entries(newAnswers)) {
        const qDef = exam.questions[qn];
        if (qDef?.isSubjective) subScore += v;
        else objScore += v;
      }
      return { ...prev, [studentId]: { ...s, answers: newAnswers, objectiveScore: objScore, subjectiveScore: subScore, totalScore: objScore + subScore } };
    });
  };

  const updateTotal = (studentId: string, field: 'objectiveScore' | 'subjectiveScore', val: number) => {
    setScores((prev) => {
      const s = prev[studentId] || { studentId, answers: {}, objectiveScore: 0, subjectiveScore: 0, totalScore: 0 };
      const updated = { ...s, [field]: val, totalScore: field === 'objectiveScore' ? val + s.subjectiveScore : s.objectiveScore + val };
      return { ...prev, [studentId]: updated };
    });
  };

  const setFullScore = (studentId: string) => {
    if (!selectedExam) return;
    const answers: Record<string, number> = {};
    const totalQ = selectedExam.objectiveCount + selectedExam.subjectiveCount;
    let objScore = 0, subScore = 0;
    for (let i = 1; i <= totalQ; i++) {
      const qDef = selectedExam.questions[String(i)];
      const sc = qDef?.score || (i <= selectedExam.objectiveCount ? 2 : 4);
      answers[String(i)] = sc;
      if (qDef?.isSubjective) subScore += sc; else objScore += sc;
    }
    setScores((prev) => ({ ...prev, [studentId]: { studentId, answers, objectiveScore: objScore, subjectiveScore: subScore, totalScore: objScore + subScore } }));
  };

  const handleSaveAll = async () => {
    if (!selectedExam) return;
    setSaving(true);
    const payload = students.map((st) => {
      const s = getScore(st.id);
      return { studentId: st.id, schoolExamId: selectedExam.id, answers: s.answers, objectiveScore: s.objectiveScore, subjectiveScore: s.subjectiveScore, totalScore: s.totalScore };
    });
    await fetch('/api/my/vip/scores', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    showToast('성적이 저장되었습니다.');
  };

  const totalQ = selectedExam ? selectedExam.objectiveCount + selectedExam.subjectiveCount : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">성적 관리</h1>
        <p className="text-sm text-zinc-500 mt-0.5">시험별 학생 성적을 입력하고 관리합니다</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={selectedSchool} onChange={(e) => { setSelectedSchool(e.target.value); setSelectedExam(null); }} className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 [&>option]:bg-zinc-900 [&>option]:text-zinc-100">
          <option value="">학교 선택</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))} className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 [&>option]:bg-zinc-900 [&>option]:text-zinc-100">
          {YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <div className="flex rounded-xl overflow-hidden border border-zinc-800/80">
          {[1, 2, 3].map((g) => (
            <button key={g} onClick={() => { setFilterGrade(g); setSelectedExam(null); }} className={`px-4 py-2 text-sm ${filterGrade === g ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'} transition-colors`}>{g}학년</button>
          ))}
        </div>
      </div>

      {/* Exam selection */}
      {exams.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {exams.map((e) => (
            <button key={e.id} onClick={() => setSelectedExam(e)} className={`px-4 py-2 rounded-xl text-sm border transition-colors ${selectedExam?.id === e.id ? 'bg-zinc-700/50 border-zinc-600 text-zinc-200' : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800'}`}>
              {e.examType}
              <span className="ml-2 text-[10px] opacity-60">({e.objectiveCount + e.subjectiveCount}문항)</span>
            </button>
          ))}
        </div>
      )}

      {!selectedExam ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">
          {exams.length === 0 ? '학교와 학년을 선택하세요' : '시험을 선택하세요'}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Info bar */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-500">학생 {students.length}명 / 총 {totalQ}문항</span>
            <button onClick={handleSaveAll} disabled={saving} className="px-5 py-2.5 bg-zinc-100 text-zinc-900 text-sm rounded-xl hover:bg-zinc-200 transition-colors font-medium disabled:opacity-50">
              {saving ? '저장 중...' : '전체 저장'}
            </button>
          </div>

          {students.length === 0 ? (
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-8 text-center text-sm text-zinc-600">해당 학년에 학생이 없습니다</div>
          ) : (
            students.map((st) => {
              const sc = getScore(st.id);
              const isOpen = expandedId === st.id;
              return (
                <div key={st.id} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-zinc-800/20 transition-colors" onClick={() => setExpandedId(isOpen ? null : st.id)}>
                    <div className="flex items-center gap-3">
                      <svg className={`w-4 h-4 text-zinc-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                      <span className="text-sm font-medium text-zinc-100">{st.name}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-blue-400">객관 {sc.objectiveScore}</span>
                      <span className="text-amber-400">주관 {sc.subjectiveScore}</span>
                      <span className="text-zinc-100 font-semibold">총점 {sc.totalScore}</span>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="px-5 pb-4 border-t border-zinc-800/80 pt-3 space-y-3">
                      <div className="flex gap-2">
                        <button onClick={() => setFullScore(st.id)} className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors">전체 정답(만점)</button>
                      </div>

                      {/* Summary totals */}
                      <div className="flex gap-4">
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-zinc-500">객관식 점수</label>
                          <input type="number" value={sc.objectiveScore} onChange={(e) => updateTotal(st.id, 'objectiveScore', Number(e.target.value))} className="w-20 px-2 py-1 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 text-center focus:outline-none focus:border-zinc-600" />
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-zinc-500">주관식 점수</label>
                          <input type="number" value={sc.subjectiveScore} onChange={(e) => updateTotal(st.id, 'subjectiveScore', Number(e.target.value))} className="w-20 px-2 py-1 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 text-center focus:outline-none focus:border-zinc-600" />
                        </div>
                        <div className="text-sm text-zinc-300 flex items-center">= {sc.totalScore}점</div>
                      </div>

                      {/* Per-question grid */}
                      {totalQ > 0 && (
                        <div className="grid grid-cols-5 sm:grid-cols-10 gap-2">
                          {Array.from({ length: totalQ }, (_, i) => {
                            const qn = String(i + 1);
                            const qDef = selectedExam.questions[qn];
                            const val = sc.answers[qn] ?? '';
                            return (
                              <div key={qn} className="text-center">
                                <div className={`text-[10px] mb-0.5 ${qDef?.isSubjective ? 'text-amber-400/60' : 'text-zinc-600'}`}>{qn}</div>
                                <input
                                  type="number" min={0} step={1}
                                  value={val}
                                  onChange={(e) => updateAnswer(st.id, qn, Number(e.target.value) || 0)}
                                  className="w-full px-1 py-1 rounded bg-zinc-900/60 border border-zinc-800/80 text-xs text-zinc-100 text-center focus:outline-none focus:border-zinc-600"
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-emerald-600 text-zinc-100 text-sm rounded-xl shadow-lg">{toast}</div>
      )}
    </div>
  );
}
