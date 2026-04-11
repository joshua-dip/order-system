'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface School { id: string; name: string }
interface Student { id: string; name: string; grade: number; examScope: string[] }
interface ExamQuestion {
  source?: string; textbook?: string; questionType?: string;
  questionText?: string; score: number; isSubjective: boolean;
}
interface SchoolExam {
  id: string; schoolId: string; academicYear: number; grade: number;
  examType: string; questions: Record<string, ExamQuestion>;
  objectiveCount: number; subjectiveCount: number;
  examScope: string[]; isLocked: boolean;
}
interface TextbookEntry { textbook: string; passages: { passageId: string; title: string }[] }

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const EXAM_TYPES = ['1학기 중간고사', '1학기 기말고사', '2학기 중간고사', '2학기 기말고사'];

export default function VipExamsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [exams, setExams] = useState<SchoolExam[]>([]);
  const [textbooks, setTextbooks] = useState<TextbookEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const [filterYear, setFilterYear] = useState(CURRENT_YEAR);
  const [filterGrade, setFilterGrade] = useState<number>(1);

  const [expandedExam, setExpandedExam] = useState<string | null>(null);
  const [localExams, setLocalExams] = useState<Record<string, SchoolExam>>({});

  const [showScopeModal, setShowScopeModal] = useState<Student | null>(null);
  const [scopeSelections, setScopeSelections] = useState<string[]>([]);

  const [toast, setToast] = useState('');
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  useEffect(() => {
    fetch('/api/my/vip/schools', { credentials: 'include' })
      .then((r) => r.json()).then((d) => { if (d.ok) setSchools(d.schools); });
  }, []);

  useEffect(() => {
    fetch('/api/textbooks').then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) {
        const entries: TextbookEntry[] = data.map((t: { textbook: string; passages?: { passageId: string; title: string }[] }) => ({
          textbook: t.textbook, passages: t.passages ?? [],
        }));
        setTextbooks(entries);
      }
    }).catch(() => {});
  }, []);

  const loadExams = useCallback(async () => {
    if (!selectedSchool) { setExams([]); return; }
    setLoading(true);
    const params = new URLSearchParams({
      schoolId: selectedSchool.id,
      academicYear: String(filterYear),
      grade: String(filterGrade),
    });
    const res = await fetch(`/api/my/vip/school-exams?${params}`, { credentials: 'include' });
    const d = await res.json();
    if (d.ok) {
      setExams(d.exams);
      const m: Record<string, SchoolExam> = {};
      for (const e of d.exams) m[e.id] = e;
      setLocalExams(m);
    }
    setLoading(false);
  }, [selectedSchool, filterYear, filterGrade]);

  const loadStudents = useCallback(async () => {
    if (!selectedSchool) { setStudents([]); return; }
    const params = new URLSearchParams({
      schoolId: selectedSchool.id,
      academicYear: String(filterYear),
      grade: String(filterGrade),
      status: 'active',
      limit: '100',
    });
    const res = await fetch(`/api/my/vip/students?${params}`, { credentials: 'include' });
    const d = await res.json();
    if (d.ok) setStudents(d.items);
  }, [selectedSchool, filterYear, filterGrade]);

  useEffect(() => { loadExams(); loadStudents(); }, [loadExams, loadStudents]);

  const textbookNames = useMemo(() => textbooks.map((t) => t.textbook), [textbooks]);

  const handleAddExam = async (examType: string) => {
    if (!selectedSchool) return;
    const res = await fetch('/api/my/vip/school-exams', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schoolId: selectedSchool.id,
        academicYear: filterYear,
        grade: filterGrade,
        examType,
      }),
    });
    const d = await res.json();
    if (d.ok) { showToast('시험이 추가되었습니다.'); await loadExams(); }
    else alert(d.error || '추가 실패');
  };

  const handleSaveExam = async (exam: SchoolExam) => {
    const local = localExams[exam.id] || exam;
    const res = await fetch(`/api/my/vip/school-exams/${exam.id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questions: local.questions,
        objectiveCount: local.objectiveCount,
        subjectiveCount: local.subjectiveCount,
        examScope: local.examScope,
        isLocked: local.isLocked,
      }),
    });
    const d = await res.json();
    if (d.ok) { showToast('저장되었습니다.'); await loadExams(); }
    else alert(d.error || '저장 실패');
  };

  const handleDeleteExam = async (exam: SchoolExam) => {
    if (!confirm(`"${exam.examType}"를 삭제하시겠습니까?`)) return;
    await fetch(`/api/my/vip/school-exams/${exam.id}`, { method: 'DELETE', credentials: 'include' });
    showToast('삭제되었습니다.');
    await loadExams();
  };

  const updateLocal = (id: string, patch: Partial<SchoolExam>) => {
    setLocalExams((prev) => ({ ...prev, [id]: { ...(prev[id] || exams.find((e) => e.id === id)!), ...patch } }));
  };

  const updateQuestion = (examId: string, qNum: string, patch: Partial<ExamQuestion>) => {
    setLocalExams((prev) => {
      const exam = prev[examId] || exams.find((e) => e.id === examId)!;
      const q = exam.questions[qNum] || { source: '', textbook: '', questionType: '', questionText: '', score: 0, isSubjective: false };
      return { ...prev, [examId]: { ...exam, questions: { ...exam.questions, [qNum]: { ...q, ...patch } } } };
    });
  };

  const handleOpenScope = (student: Student) => {
    setShowScopeModal(student);
    setScopeSelections([...student.examScope]);
  };

  const handleSaveScope = async () => {
    if (!showScopeModal) return;
    await fetch(`/api/my/vip/students/${showScopeModal.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ examScope: scopeSelections }),
    });
    showToast('시험 범위가 저장되었습니다.');
    setShowScopeModal(null);
    await loadStudents();
  };

  const toggleScope = (tb: string) => {
    setScopeSelections((prev) => prev.includes(tb) ? prev.filter((s) => s !== tb) : [...prev, tb]);
  };

  const getLocal = (id: string) => localExams[id] || exams.find((e) => e.id === id)!;
  const existingTypes = new Set(exams.map((e) => e.examType));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">시험 관리</h1>
        <p className="text-sm text-zinc-500 mt-0.5">기출 시험을 등록하고 학생의 시험 범위를 설정합니다</p>
      </div>

      {/* School / Filter */}
      <div className="flex flex-wrap gap-3">
        <select value={selectedSchool?.id || ''} onChange={(e) => setSelectedSchool(schools.find((s) => s.id === e.target.value) || null)} className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 [&>option]:bg-zinc-900 [&>option]:text-zinc-100">
          <option value="">학교 선택</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))} className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 [&>option]:bg-zinc-900 [&>option]:text-zinc-100">
          {YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <div className="flex rounded-xl overflow-hidden border border-zinc-800/80">
          {[1, 2, 3].map((g) => (
            <button key={g} onClick={() => setFilterGrade(g)} className={`px-4 py-2 text-sm ${filterGrade === g ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'} transition-colors`}>{g}학년</button>
          ))}
        </div>
      </div>

      {!selectedSchool ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">학교를 선택해주세요</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Exams */}
          <div className="lg:col-span-2 space-y-4">
            {/* Add exam buttons */}
            <div className="flex flex-wrap gap-2">
              {EXAM_TYPES.filter((t) => !existingTypes.has(t)).map((t) => (
                <button key={t} onClick={() => handleAddExam(t)} className="px-3 py-1.5 text-xs bg-zinc-900/60 border border-zinc-800/80 text-zinc-400 rounded-lg hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
                  + {t}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="p-8 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
            ) : exams.length === 0 ? (
              <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-8 text-center text-sm text-zinc-600">등록된 시험이 없습니다. 위 버튼으로 시험을 추가하세요.</div>
            ) : (
              exams.map((exam) => {
                const local = getLocal(exam.id);
                const isOpen = expandedExam === exam.id;
                const totalQ = local.objectiveCount + local.subjectiveCount;
                return (
                  <div key={exam.id} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden">
                    {/* Exam header */}
                    <div
                      className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-zinc-800/20 transition-colors"
                      onClick={() => setExpandedExam(isOpen ? null : exam.id)}
                    >
                      <div className="flex items-center gap-3">
                        <svg className={`w-4 h-4 text-zinc-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                        <span className="text-sm font-medium text-zinc-100">{exam.examType}</span>
                        {local.isLocked && <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] rounded">확정</span>}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-zinc-500">
                        <span>객관 {local.objectiveCount} / 주관 {local.subjectiveCount}</span>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="px-5 pb-5 border-t border-zinc-800/80 pt-4 space-y-4">
                        {/* Question count + lock */}
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-zinc-500">객관식</label>
                            <input type="number" min={0} max={50} value={local.objectiveCount} onChange={(e) => updateLocal(exam.id, { objectiveCount: Math.max(0, Number(e.target.value)) })} className="w-16 px-2 py-1 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 text-center focus:outline-none focus:border-zinc-600" />
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-zinc-500">주관식</label>
                            <input type="number" min={0} max={50} value={local.subjectiveCount} onChange={(e) => updateLocal(exam.id, { subjectiveCount: Math.max(0, Number(e.target.value)) })} className="w-16 px-2 py-1 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 text-center focus:outline-none focus:border-zinc-600" />
                          </div>
                          <label className="flex items-center gap-1.5 text-xs text-zinc-500 cursor-pointer ml-auto">
                            <input type="checkbox" checked={local.isLocked} onChange={(e) => updateLocal(exam.id, { isLocked: e.target.checked })} className="rounded" />
                            확정
                          </label>
                        </div>

                        {/* Exam scope chips */}
                        <div>
                          <label className="text-xs text-zinc-500 mb-1.5 block">시험 범위 (교재)</label>
                          <div className="flex flex-wrap gap-1.5">
                            {textbookNames.slice(0, 20).map((tb) => (
                              <button
                                key={tb}
                                onClick={() => {
                                  const current = local.examScope || [];
                                  const next = current.includes(tb) ? current.filter((s) => s !== tb) : [...current, tb];
                                  updateLocal(exam.id, { examScope: next });
                                }}
                                className={`px-2 py-1 text-[11px] rounded-lg border transition-colors ${
                                  (local.examScope || []).includes(tb)
                                    ? 'bg-zinc-700/50 border-zinc-600 text-zinc-200'
                                    : 'bg-zinc-900/60 border border-zinc-800/80 text-zinc-500 hover:text-zinc-400'
                                }`}
                              >
                                {tb.length > 20 ? tb.slice(0, 20) + '…' : tb}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Question table */}
                        {totalQ > 0 && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-zinc-800/80 text-zinc-500">
                                  <th className="text-left px-2 py-2 w-10">번호</th>
                                  <th className="text-left px-2 py-2">유형</th>
                                  <th className="text-left px-2 py-2">교재</th>
                                  <th className="text-left px-2 py-2">출처/내용</th>
                                  <th className="text-center px-2 py-2 w-16">배점</th>
                                  <th className="text-center px-2 py-2 w-12">서술</th>
                                </tr>
                              </thead>
                              <tbody>
                                {Array.from({ length: totalQ }, (_, i) => {
                                  const qNum = String(i + 1);
                                  const q = local.questions[qNum] || { source: '', textbook: '', questionType: '', questionText: '', score: 0, isSubjective: false };
                                  return (
                                    <tr key={qNum} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                                      <td className="px-2 py-1.5 text-zinc-500">{qNum}</td>
                                      <td className="px-2 py-1.5">
                                        <input type="text" value={q.questionType || ''} onChange={(e) => updateQuestion(exam.id, qNum, { questionType: e.target.value })} placeholder="빈칸/순서/삽입..." className="w-full px-2 py-1 rounded bg-zinc-900/60 border border-zinc-800/80 text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-zinc-600" />
                                      </td>
                                      <td className="px-2 py-1.5">
                                        <select value={q.textbook || ''} onChange={(e) => updateQuestion(exam.id, qNum, { textbook: e.target.value })} className="w-full px-2 py-1 rounded bg-zinc-900/60 border border-zinc-800/80 text-zinc-100 focus:outline-none focus:border-zinc-600 [&>option]:bg-zinc-900 [&>option]:text-zinc-100">
                                          <option value="">-</option>
                                          {textbookNames.map((tb) => <option key={tb} value={tb}>{tb.length > 25 ? tb.slice(0, 25) + '…' : tb}</option>)}
                                        </select>
                                      </td>
                                      <td className="px-2 py-1.5">
                                        <input type="text" value={q.questionText || ''} onChange={(e) => updateQuestion(exam.id, qNum, { questionText: e.target.value })} placeholder="내용" className="w-full px-2 py-1 rounded bg-zinc-900/60 border border-zinc-800/80 text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-zinc-600" />
                                      </td>
                                      <td className="px-2 py-1.5 text-center">
                                        <input type="number" min={0} max={10} value={q.score || ''} onChange={(e) => updateQuestion(exam.id, qNum, { score: Number(e.target.value) })} className="w-12 px-1 py-1 rounded bg-zinc-900/60 border border-zinc-800/80 text-zinc-100 text-center focus:outline-none focus:border-zinc-600" />
                                      </td>
                                      <td className="px-2 py-1.5 text-center">
                                        <input type="checkbox" checked={q.isSubjective || false} onChange={(e) => updateQuestion(exam.id, qNum, { isSubjective: e.target.checked })} className="rounded" />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}

                        {/* Save / Delete */}
                        <div className="flex gap-2 pt-2">
                          <button onClick={() => handleSaveExam(exam)} className="px-4 py-2 bg-zinc-100 text-zinc-900 text-sm rounded-xl hover:bg-zinc-200 transition-colors">저장</button>
                          <button onClick={() => handleDeleteExam(exam)} className="px-4 py-2 bg-red-500/20 text-red-300 text-sm rounded-xl hover:bg-red-500/30 transition-colors">삭제</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Right: Students exam scope */}
          <div className="space-y-4">
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800/80">
                <h3 className="text-sm font-medium text-zinc-300">학생 시험 범위</h3>
              </div>
              {students.length === 0 ? (
                <div className="p-4 text-center text-xs text-zinc-600">이 학교/학년에 학생이 없습니다</div>
              ) : (
                <div className="divide-y divide-zinc-800/50">
                  {students.map((s) => (
                    <div key={s.id} className="px-4 py-3 hover:bg-zinc-800/20 transition-colors">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-zinc-300">{s.name}</span>
                        <button onClick={() => handleOpenScope(s)} className="text-[11px] text-zinc-400 hover:text-zinc-300 transition-colors">범위 설정</button>
                      </div>
                      {s.examScope.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {s.examScope.map((scope) => (
                            <span key={scope} className="px-1.5 py-0.5 bg-zinc-700/40 text-zinc-300 text-[10px] rounded">{scope.length > 15 ? scope.slice(0, 15) + '…' : scope}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scope modal */}
      {showScopeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowScopeModal(null)}>
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800/80 w-full max-w-lg p-6 shadow-2xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-zinc-100 mb-1">{showScopeModal.name} - 시험 범위</h3>
            <p className="text-xs text-zinc-500 mb-4">시험에 포함될 교재를 선택하세요</p>
            <div className="space-y-1.5">
              {textbookNames.map((tb) => (
                <label key={tb} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-zinc-800/40 cursor-pointer transition-colors">
                  <input type="checkbox" checked={scopeSelections.includes(tb)} onChange={() => toggleScope(tb)} className="rounded" />
                  <span className="text-sm text-zinc-300">{tb}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-5 sticky bottom-0 bg-zinc-900 pt-3">
              <button onClick={handleSaveScope} className="flex-1 py-2.5 bg-zinc-100 text-zinc-900 text-sm rounded-xl hover:bg-zinc-200 transition-colors font-medium">저장</button>
              <button onClick={() => setShowScopeModal(null)} className="flex-1 py-2.5 bg-zinc-800 text-zinc-400 text-sm rounded-xl hover:bg-zinc-700 transition-colors">취소</button>
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
