'use client';

import { useCallback, useEffect, useState } from 'react';
import VipSchoolSearchInput from '@/app/components/VipSchoolSearchInput';

type SchoolLevel = 'elem' | 'middle' | 'high';
interface School { id: string; name: string; region: string; neisCode?: string; schoolLevel?: SchoolLevel }
interface StudentSubject { name: string; tuition?: number }
interface Student {
  id: string; schoolId: string; schoolName: string; name: string;
  grade: number; academicYear: number; status: string;
  examScope: string[]; subjects: StudentSubject[]; gender: string;
  memo: string; phone: string; parentPhone: string;
}
interface Subject { id: string; name: string; order: number }
/** 모달 입력용 — tuition 은 입력 문자열(저장 시 number 로 정규화). */
interface FormSubject { name: string; tuition: string }

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
/** 클라이언트 상수 — lib/vip-db(서버, mongodb 의존)를 import 하지 않도록 여기서 정의. */
const SCHOOL_LEVELS: { v: SchoolLevel; l: string }[] = [
  { v: 'elem', l: '초등' }, { v: 'middle', l: '중등' }, { v: 'high', l: '고등' },
];
const LEVEL_LABEL: Record<SchoolLevel, string> = { elem: '초', middle: '중', high: '고' };
const GRADE_RANGE: Record<SchoolLevel, number[]> = {
  elem: [1, 2, 3, 4, 5, 6], middle: [1, 2, 3], high: [1, 2, 3],
};
const gradesFor = (level?: SchoolLevel): number[] => GRADE_RANGE[level ?? 'high'];

export default function VipStudentsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [totalStudents, setTotalStudents] = useState(0);
  const [loading, setLoading] = useState(false);

  const [subjectList, setSubjectList] = useState<Subject[]>([]);

  const [filterGrade, setFilterGrade] = useState<number | null>(null);
  const [filterYear, setFilterYear] = useState<number>(CURRENT_YEAR);
  const [search, setSearch] = useState('');

  const [showAddSchool, setShowAddSchool] = useState(false);
  const [newSchoolName, setNewSchoolName] = useState('');
  const [newSchoolMeta, setNewSchoolMeta] = useState<{ region?: string; neisCode?: string }>({});
  const [newSchoolLevel, setNewSchoolLevel] = useState<SchoolLevel>('high');
  const [schoolSearch, setSchoolSearch] = useState('');

  const [showAddStudent, setShowAddStudent] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [form, setForm] = useState<{
    name: string; grade: string; gender: string; memo: string; phone: string; parentPhone: string; subjects: FormSubject[];
  }>({ name: '', grade: '1', gender: '', memo: '', phone: '', parentPhone: '', subjects: [] });
  const [newSubjectInput, setNewSubjectInput] = useState('');

  const [showSubjectManager, setShowSubjectManager] = useState(false);
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [editingSubjectName, setEditingSubjectName] = useState('');
  const [managerNewSubject, setManagerNewSubject] = useState('');

  const [toast, setToast] = useState('');

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  const loadSchools = useCallback(async () => {
    const res = await fetch('/api/my/vip/schools', { credentials: 'include' });
    const d = await res.json();
    if (d.ok) setSchools(d.schools);
  }, []);

  const loadSubjects = useCallback(async () => {
    const res = await fetch('/api/my/vip/subjects', { credentials: 'include' });
    const d = await res.json();
    if (d.ok) setSubjectList(d.subjects);
  }, []);

  const loadStudents = useCallback(async () => {
    if (!selectedSchool) { setStudents([]); setTotalStudents(0); return; }
    setLoading(true);
    const params = new URLSearchParams({ schoolId: selectedSchool.id, academicYear: String(filterYear) });
    if (filterGrade) params.set('grade', String(filterGrade));
    if (search) params.set('search', search);
    const res = await fetch(`/api/my/vip/students?${params}`, { credentials: 'include' });
    const d = await res.json();
    if (d.ok) { setStudents(d.items); setTotalStudents(d.total); }
    setLoading(false);
  }, [selectedSchool, filterGrade, filterYear, search]);

  useEffect(() => { loadSchools(); }, [loadSchools]);
  useEffect(() => { loadSubjects(); }, [loadSubjects]);
  useEffect(() => { loadStudents(); }, [loadStudents]);

  const handleAddSchool = async () => {
    if (!newSchoolName.trim()) return;
    const res = await fetch('/api/my/vip/schools', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newSchoolName.trim(), region: newSchoolMeta.region, neisCode: newSchoolMeta.neisCode, schoolLevel: newSchoolLevel }),
    });
    const d = await res.json();
    if (d.ok) {
      await loadSchools();
      setNewSchoolName('');
      setNewSchoolMeta({});
      setNewSchoolLevel('high');
      setShowAddSchool(false);
      showToast(d.existed ? '이미 등록된 학교입니다.' : '학교가 등록되었습니다.');
    }
  };

  const handleDeleteSchool = async (school: School) => {
    if (!confirm(`"${school.name}"를 삭제하시겠습니까?`)) return;
    const res = await fetch(`/api/my/vip/schools/${school.id}`, { method: 'DELETE', credentials: 'include' });
    const d = await res.json();
    if (d.ok) {
      if (selectedSchool?.id === school.id) setSelectedSchool(null);
      await loadSchools();
      showToast('학교가 삭제되었습니다.');
    } else {
      alert(d.error || '삭제 실패');
    }
  };

  const defaultGrade = (level?: SchoolLevel) => String(gradesFor(level)[0] ?? 1);

  const openAddStudent = () => {
    setEditStudent(null);
    setForm({ name: '', grade: defaultGrade(selectedSchool?.schoolLevel), gender: '', memo: '', phone: '', parentPhone: '', subjects: [] });
    setNewSubjectInput('');
    setShowAddStudent(true);
  };

  const openEditStudent = (s: Student) => {
    setEditStudent(s);
    setForm({
      name: s.name, grade: String(s.grade), gender: s.gender || '', memo: s.memo, phone: s.phone, parentPhone: s.parentPhone,
      subjects: (s.subjects ?? []).map((sub) => ({ name: sub.name, tuition: sub.tuition != null ? String(sub.tuition) : '' })),
    });
    setNewSubjectInput('');
    setShowAddStudent(true);
  };

  const toggleFormSubject = (name: string) => {
    setForm((f) => {
      const exists = f.subjects.some((s) => s.name === name);
      return {
        ...f,
        subjects: exists ? f.subjects.filter((s) => s.name !== name) : [...f.subjects, { name, tuition: '' }],
      };
    });
  };

  const setSubjectTuition = (name: string, tuition: string) => {
    setForm((f) => ({ ...f, subjects: f.subjects.map((s) => (s.name === name ? { ...s, tuition } : s)) }));
  };

  /** 새 과목 마스터 추가(POST) 후 목록 갱신. selectInForm 이면 학생 form 에 즉시 배정. */
  const addSubjectMaster = async (rawName: string, selectInForm: boolean): Promise<boolean> => {
    const name = rawName.trim();
    if (!name) return false;
    const res = await fetch('/api/my/vip/subjects', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const d = await res.json();
    if (!d.ok) { alert(d.error || '과목 추가 실패'); return false; }
    await loadSubjects();
    if (selectInForm) {
      setForm((f) => (f.subjects.some((s) => s.name === name) ? f : { ...f, subjects: [...f.subjects, { name, tuition: '' }] }));
    }
    return true;
  };

  const renameSubject = async (id: string, name: string) => {
    const nm = name.trim();
    if (!nm) return;
    const res = await fetch(`/api/my/vip/subjects/${id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nm }),
    });
    const d = await res.json();
    if (!d.ok) { alert(d.error || '수정 실패'); return; }
    setEditingSubjectId(null);
    setEditingSubjectName('');
    await loadSubjects();
  };

  const deleteSubject = async (id: string) => {
    const sub = subjectList.find((s) => s.id === id);
    if (sub && !confirm(`과목 "${sub.name}"을(를) 삭제하시겠습니까?\n(이미 배정된 학생 데이터는 그대로 유지됩니다)`)) return;
    await fetch(`/api/my/vip/subjects/${id}`, { method: 'DELETE', credentials: 'include' });
    await loadSubjects();
  };

  const handleSaveStudent = async () => {
    if (!form.name.trim()) { alert('이름을 입력해주세요.'); return; }
    const subjects = form.subjects.map((s) => ({
      name: s.name,
      tuition: s.tuition.trim() === '' ? undefined : Number(s.tuition),
    }));
    const payload = {
      name: form.name.trim(), grade: Number(form.grade), gender: form.gender || undefined,
      memo: form.memo, phone: form.phone, parentPhone: form.parentPhone, subjects,
    };
    if (editStudent) {
      await fetch(`/api/my/vip/students/${editStudent.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      showToast('학생 정보가 수정되었습니다.');
    } else {
      await fetch('/api/my/vip/students', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, schoolId: selectedSchool!.id, academicYear: filterYear }),
      });
      showToast('학생이 등록되었습니다.');
    }
    setShowAddStudent(false);
    await loadStudents();
  };

  const handleDeleteStudent = async (s: Student) => {
    if (!confirm(`"${s.name}" 학생을 삭제하시겠습니까?`)) return;
    await fetch(`/api/my/vip/students/${s.id}`, { method: 'DELETE', credentials: 'include' });
    showToast('학생이 삭제되었습니다.');
    await loadStudents();
  };

  const filteredSchools = schoolSearch ? schools.filter((s) => s.name.includes(schoolSearch)) : schools;
  const modalGrades = gradesFor(selectedSchool?.schoolLevel);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">학생 관리</h1>
          <p className="text-sm text-zinc-500 mt-0.5">학교별로 학생을 등록하고 관리합니다</p>
        </div>
        <button onClick={() => setShowSubjectManager(true)} className="px-3 py-2 text-sm text-zinc-400 bg-zinc-900/50 border border-zinc-800/80 rounded-xl hover:bg-zinc-800 hover:text-zinc-200 transition-colors">
          과목 관리
        </button>
      </div>

      <div className="flex gap-6">
        {/* School sidebar */}
        <div className="w-64 flex-shrink-0 space-y-2">
          {/* 학교 목록 카드 (overflow-hidden으로 스크롤 처리) */}
          <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden">
            <div className="p-3 border-b border-zinc-800/80">
              <input
                type="text"
                placeholder="학교 검색..."
                value={schoolSearch}
                onChange={(e) => setSchoolSearch(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
              />
            </div>

            <div className="max-h-80 overflow-y-auto">
              {filteredSchools.length === 0 ? (
                <div className="p-4 text-center text-xs text-zinc-600">등록된 학교가 없습니다</div>
              ) : (
                filteredSchools.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => setSelectedSchool(s)}
                    className={`group flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
                      selectedSchool?.id === s.id
                        ? 'bg-zinc-800 text-zinc-100 border-l-2 border-zinc-400'
                        : 'text-zinc-400 hover:bg-zinc-800/40 border-l-2 border-transparent'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      {s.schoolLevel && (
                        <span className="shrink-0 px-1 py-0.5 rounded bg-zinc-700/50 text-zinc-300 text-[10px]">{LEVEL_LABEL[s.schoolLevel]}</span>
                      )}
                      <span className="text-sm truncate">{s.name}</span>
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteSchool(s); }}
                      className="opacity-0 group-hover:opacity-100 text-red-400/60 hover:text-red-400 transition-all p-0.5 shrink-0"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>

            {!showAddSchool && (
              <div className="p-3 border-t border-zinc-800/80">
                <button onClick={() => setShowAddSchool(true)} className="w-full px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800 rounded-lg transition-colors text-center">
                  + 학교 추가
                </button>
              </div>
            )}
          </div>

          {/* 학교 추가 영역 — overflow-hidden 밖에 배치해 드롭다운이 잘리지 않도록 */}
          {showAddSchool && (
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-3 space-y-2">
              <VipSchoolSearchInput
                value={newSchoolName}
                onChange={(name, meta) => {
                  setNewSchoolName(name);
                  setNewSchoolMeta(meta ?? {});
                }}
                placeholder="학교명 검색 (2글자 이상)"
              />
              <div>
                <label className="block text-[11px] text-zinc-500 mb-1">학교급</label>
                <div className="flex rounded-lg overflow-hidden border border-white/10">
                  {SCHOOL_LEVELS.map((lv) => (
                    <button
                      key={lv.v}
                      onClick={() => setNewSchoolLevel(lv.v)}
                      className={`flex-1 px-2 py-1.5 text-xs transition-colors ${newSchoolLevel === lv.v ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-400 hover:bg-zinc-800'}`}
                    >
                      {lv.l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={handleAddSchool}
                  disabled={!newSchoolName.trim()}
                  className="flex-1 px-3 py-1.5 bg-zinc-100 text-zinc-900 text-xs rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  추가
                </button>
                <button
                  onClick={() => { setShowAddSchool(false); setNewSchoolName(''); setNewSchoolMeta({}); setNewSchoolLevel('high'); }}
                  className="flex-1 px-3 py-1.5 bg-zinc-800 text-zinc-400 text-xs rounded-lg hover:bg-zinc-700 transition-colors"
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          {!selectedSchool ? (
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center">
              <svg className="w-12 h-12 mx-auto text-zinc-700 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342" />
              </svg>
              <p className="text-zinc-500 text-sm">좌측에서 학교를 선택하세요</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* School header + Filters */}
              <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                    {selectedSchool.schoolLevel && (
                      <span className="px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-300 text-xs">{LEVEL_LABEL[selectedSchool.schoolLevel]}</span>
                    )}
                    {selectedSchool.name}
                  </h2>
                  <button onClick={openAddStudent} className="px-4 py-2 bg-zinc-100 text-zinc-900 text-sm rounded-xl hover:bg-zinc-200 transition-colors">
                    + 학생 추가
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <select value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))} className="px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 [&>option]:bg-zinc-900 [&>option]:text-zinc-100">
                    {YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
                  </select>

                  <div className="flex rounded-lg overflow-hidden border border-white/10">
                    <button onClick={() => setFilterGrade(null)} className={`px-3 py-1.5 text-xs ${!filterGrade ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-400 hover:bg-zinc-800'} transition-colors`}>전체</button>
                    {gradesFor(selectedSchool.schoolLevel).map((g) => (
                      <button key={g} onClick={() => setFilterGrade(g)} className={`px-3 py-1.5 text-xs ${filterGrade === g ? 'bg-zinc-100 text-zinc-900' : 'bg-white/5 text-zinc-400 hover:bg-zinc-800'} transition-colors`}>{g}학년</button>
                    ))}
                  </div>

                  <input type="text" placeholder="이름 검색" value={search} onChange={(e) => setSearch(e.target.value)} className="px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 w-40" />
                </div>
              </div>

              {/* Student table */}
              <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden">
                {loading ? (
                  <div className="p-8 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
                ) : students.length === 0 ? (
                  <div className="p-8 text-center text-sm text-zinc-600">학생이 없습니다</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800/80 text-zinc-500 text-xs">
                        <th className="text-left px-4 py-3 font-medium">이름</th>
                        <th className="text-left px-4 py-3 font-medium">학년</th>
                        <th className="text-left px-4 py-3 font-medium">수강과목</th>
                        <th className="text-left px-4 py-3 font-medium">연락처</th>
                        <th className="text-right px-4 py-3 font-medium w-24"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s) => (
                        <tr key={s.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors">
                          <td className="px-4 py-3 text-zinc-100 font-medium">
                            {s.name}
                            {s.gender && <span className="ml-1.5 text-[11px] text-zinc-500">{s.gender === 'male' ? '남' : '여'}</span>}
                          </td>
                          <td className="px-4 py-3 text-zinc-400">{s.grade}학년</td>
                          <td className="px-4 py-3">
                            {s.subjects && s.subjects.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {s.subjects.slice(0, 4).map((sub) => (
                                  <span key={sub.name} className="px-1.5 py-0.5 bg-zinc-700/40 text-zinc-300 text-[10px] rounded">{sub.name}</span>
                                ))}
                                {s.subjects.length > 4 && <span className="text-[10px] text-zinc-600">+{s.subjects.length - 4}</span>}
                              </div>
                            ) : <span className="text-zinc-600 text-xs">미설정</span>}
                          </td>
                          <td className="px-4 py-3 text-zinc-500 text-xs">{s.phone || '—'}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => openEditStudent(s)} className="p-1.5 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800 transition-all">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>
                              </button>
                              <button onClick={() => handleDeleteStudent(s)} className="p-1.5 text-zinc-500 hover:text-red-400 rounded-lg hover:bg-red-500/10 transition-all">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {totalStudents > 0 && (
                  <div className="px-4 py-2 border-t border-zinc-800/80 text-xs text-zinc-500">
                    총 {totalStudents}명
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Student Modal */}
      {showAddStudent && selectedSchool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setShowAddStudent(false)}>
          <div className="bg-zinc-900 rounded-2xl border border-white/10 w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-zinc-100 mb-4">{editStudent ? '학생 수정' : '학생 추가'}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">이름 *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">학년</label>
                  <select value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 [&>option]:bg-zinc-900 [&>option]:text-zinc-100">
                    {modalGrades.map((g) => <option key={g} value={g}>{g}학년</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">성별 <span className="text-zinc-600">(선택)</span></label>
                  <div className="flex rounded-xl overflow-hidden border border-zinc-800/80">
                    {([['', '—'], ['male', '남'], ['female', '여']] as const).map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setForm({ ...form, gender: v })} className={`flex-1 px-2 py-2 text-sm transition-colors ${form.gender === v ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'}`}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 수강과목 + 과목별 수강료 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs text-zinc-500">수강과목</label>
                  <button type="button" onClick={() => setShowSubjectManager(true)} className="text-[11px] text-zinc-500 hover:text-zinc-300">과목 관리</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {subjectList.map((sub) => {
                    const sel = form.subjects.some((s) => s.name === sub.name);
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => toggleFormSubject(sub.name)}
                        className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${sel ? 'bg-emerald-600 text-white' : 'bg-zinc-800/80 text-zinc-400 hover:bg-zinc-700'}`}
                      >
                        {sub.name}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 flex gap-1.5">
                  <input
                    type="text"
                    value={newSubjectInput}
                    onChange={(e) => setNewSubjectInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); void addSubjectMaster(newSubjectInput, true).then((ok) => { if (ok) setNewSubjectInput(''); }); }
                    }}
                    placeholder="+ 직접 추가 (새 과목명)"
                    className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
                  />
                  <button
                    type="button"
                    onClick={() => void addSubjectMaster(newSubjectInput, true).then((ok) => { if (ok) setNewSubjectInput(''); })}
                    disabled={!newSubjectInput.trim()}
                    className="px-3 py-1.5 bg-zinc-800 text-zinc-300 text-xs rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-40"
                  >
                    추가
                  </button>
                </div>
                {form.subjects.length > 0 && (
                  <div className="mt-2.5 space-y-1.5 rounded-lg bg-zinc-900/40 border border-zinc-800/60 p-2.5">
                    <p className="text-[11px] text-zinc-500">과목별 수강료 <span className="text-zinc-600">(선택)</span></p>
                    {form.subjects.map((s) => (
                      <div key={s.name} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-xs text-zinc-300">{s.name}</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={s.tuition}
                          onChange={(e) => setSubjectTuition(s.name, e.target.value)}
                          placeholder="수강료"
                          className="flex-1 px-2.5 py-1.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-xs text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <span className="text-xs text-zinc-500 shrink-0">원</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">학생 연락처</label>
                  <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600" />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">학부모 연락처 <span className="text-zinc-600">(선택)</span></label>
                  <input type="text" value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">메모</label>
                <input type="text" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleSaveStudent} className="flex-1 py-2.5 bg-zinc-100 text-zinc-900 text-sm rounded-xl hover:bg-zinc-200 transition-colors font-medium">
                {editStudent ? '수정' : '추가'}
              </button>
              <button onClick={() => setShowAddStudent(false)} className="flex-1 py-2.5 bg-zinc-800 text-zinc-400 text-sm rounded-xl hover:bg-zinc-700 transition-colors">
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subject Manager Modal */}
      {showSubjectManager && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => { setShowSubjectManager(false); setEditingSubjectId(null); }}>
          <div className="bg-zinc-900 rounded-2xl border border-white/10 w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-zinc-100 mb-1">과목 관리</h3>
            <p className="text-xs text-zinc-500 mb-4">학생 등록 시 선택할 수강과목 목록입니다.</p>
            <div className="space-y-1.5">
              {subjectList.length === 0 ? (
                <p className="text-sm text-zinc-600 text-center py-4">과목을 불러오는 중…</p>
              ) : (
                subjectList.map((sub) => (
                  <div key={sub.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
                    {editingSubjectId === sub.id ? (
                      <>
                        <input
                          type="text"
                          value={editingSubjectName}
                          onChange={(e) => setEditingSubjectName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void renameSubject(sub.id, editingSubjectName); } }}
                          className="flex-1 px-2 py-1 rounded-md bg-zinc-900/80 border border-zinc-700 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                          autoFocus
                        />
                        <button onClick={() => void renameSubject(sub.id, editingSubjectName)} className="text-xs text-emerald-400 hover:text-emerald-300">저장</button>
                        <button onClick={() => { setEditingSubjectId(null); setEditingSubjectName(''); }} className="text-xs text-zinc-500 hover:text-zinc-300">취소</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-zinc-200">{sub.name}</span>
                        <button onClick={() => { setEditingSubjectId(sub.id); setEditingSubjectName(sub.name); }} className="p-1 text-zinc-500 hover:text-zinc-300 rounded hover:bg-zinc-800 transition-all" aria-label="이름 변경">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" /></svg>
                        </button>
                        <button onClick={() => void deleteSubject(sub.id)} className="p-1 text-zinc-500 hover:text-red-400 rounded hover:bg-red-500/10 transition-all" aria-label="삭제">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 flex gap-1.5">
              <input
                type="text"
                value={managerNewSubject}
                onChange={(e) => setManagerNewSubject(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addSubjectMaster(managerNewSubject, false).then((ok) => { if (ok) setManagerNewSubject(''); }); } }}
                placeholder="새 과목명"
                className="flex-1 px-3 py-2 rounded-lg bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
              />
              <button
                onClick={() => void addSubjectMaster(managerNewSubject, false).then((ok) => { if (ok) setManagerNewSubject(''); })}
                disabled={!managerNewSubject.trim()}
                className="px-4 py-2 bg-zinc-100 text-zinc-900 text-sm rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-40"
              >
                추가
              </button>
            </div>
            <button onClick={() => { setShowSubjectManager(false); setEditingSubjectId(null); }} className="w-full mt-3 py-2.5 bg-zinc-800 text-zinc-400 text-sm rounded-xl hover:bg-zinc-700 transition-colors">
              닫기
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-emerald-600 text-zinc-100 text-sm rounded-xl shadow-lg animate-[fadeInUp_0.3s_ease-out]">
          {toast}
        </div>
      )}
    </div>
  );
}
