'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Student { id: string; name: string; grade: number; examScope: string[]; schoolName: string }
interface School { id: string; name: string; region: string }
interface SchoolExam {
  id: string; schoolId: string; academicYear: number; grade: number; examType: string;
  questions: Record<string, { questionType?: string; isSubjective?: boolean }>;
  examScope: string[]; examScopePassages?: string[]; objectiveCount: number;
}
interface Question {
  id: string; textbook: string; passageId: string | null; type: string;
  difficulty: string; paragraph: string; options: string;
  answer: string; explanation: string; source?: string; pric: string | null;
}
interface ExamSet { questions: Question[]; selected: Set<string> }

const TYPES = ['빈칸', '순서', '삽입'];
const DIFFICULTIES = ['중', '상'];
const GRADES = [1, 2, 3];
const SET_LABELS = ['A', 'B', 'C', 'D', 'E'];
type Mode = 'student' | 'school';

function computeTypeCounts(questions: SchoolExam['questions'], total: number): Record<string, number> {
  const rawObj: Record<string, number> = {};
  let subjectiveCount = 0;

  for (const q of Object.values(questions)) {
    if (q.isSubjective || q.questionType === '서술형') {
      subjectiveCount++;
    } else if (q.questionType) {
      rawObj[q.questionType] = (rawObj[q.questionType] ?? 0) + 1;
    }
  }

  const rawTotal = Object.values(rawObj).reduce((s, v) => s + v, 0);
  if (rawTotal === 0 && subjectiveCount === 0) return {};

  const counts: Record<string, number> = {};
  if (rawTotal > 0) {
    for (const [type, cnt] of Object.entries(rawObj)) counts[type] = Math.max(1, Math.round((cnt / rawTotal) * total));
    const scaled = Object.values(counts).reduce((s, v) => s + v, 0);
    const diff = total - scaled;
    if (diff !== 0) { const lg = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]; if (lg) counts[lg[0]] = Math.max(0, counts[lg[0]] + diff); }
  }

  // 서술형은 기출 실제 수 그대로 (스케일 안 함)
  if (subjectiveCount > 0) counts['서술형'] = subjectiveCount;

  return counts;
}

export default function VipGeneratePage() {
  const [mode, setMode] = useState<Mode>('student');

  /* 학생별 */
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [count, setCount] = useState(20);
  const [randomOrder, setRandomOrder] = useState(true);

  /* 학교별 */
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolExams, setSchoolExams] = useState<SchoolExam[]>([]);
  const [selectedSchool, setSelectedSchool] = useState('');
  const [selectedGrade, setSelectedGrade] = useState(1);
  const [scopeExamId, setScopeExamId] = useState('');
  const [patternExamId, setPatternExamId] = useState('');
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [schoolCount, setSchoolCount] = useState(20);
  const [schoolRandom, setSchoolRandom] = useState(true);

  /* 교재별 문제 수 */
  const [textbookCounts, setTextbookCounts] = useState<Record<string, number>>({});

  /* 세트 수 */
  const [setsCount, setSetsCount] = useState(1);

  /* 결과 */
  const [examSets, setExamSets] = useState<ExamSet[]>([]);
  const [activeSet, setActiveSet] = useState(0);
  const [resultTypeCounts, setResultTypeCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null); // set index or -1 for all

  useEffect(() => {
    fetch('/api/my/vip/students?limit=200&status=active', { credentials: 'include' })
      .then((r) => r.json()).then((d) => { if (d.ok) setStudents(d.items); });
  }, []);

  useEffect(() => {
    fetch('/api/my/vip/schools', { credentials: 'include' })
      .then((r) => r.json()).then((d) => { if (d.ok) setSchools(d.schools); });
  }, []);

  useEffect(() => {
    if (!selectedSchool) { setSchoolExams([]); return; }
    fetch(`/api/my/vip/school-exams?schoolId=${selectedSchool}`, { credentials: 'include' })
      .then((r) => r.json()).then((d) => { if (d.ok) setSchoolExams(d.exams); });
  }, [selectedSchool]);

  useEffect(() => {
    const filtered = schoolExams.filter((e) => e.grade === selectedGrade)
      .sort((a, b) => b.academicYear - a.academicYear || a.examType.localeCompare(b.examType));
    setScopeExamId(filtered[0]?.id ?? '');
    setPatternExamId(filtered[1]?.id ?? '');
  }, [schoolExams, selectedGrade]);

  useEffect(() => {
    const pe = schoolExams.find((e) => e.id === patternExamId);
    setTypeCounts(pe ? computeTypeCounts(pe.questions, schoolCount) : {});
  }, [patternExamId, schoolExams, schoolCount]);

  const selectedStudentObj = students.find((s) => s.id === selectedStudent);
  const scopeExam = schoolExams.find((e) => e.id === scopeExamId);

  /* 교재별 소스(지문) 수 */
  const scopePassagesByTb = useMemo<Record<string, number>>(() => {
    if (!scopeExam) return {};
    const result: Record<string, number> = {};
    if (scopeExam.examScopePassages?.length) {
      for (const e of scopeExam.examScopePassages) {
        const sep = e.indexOf('::');
        const tb = sep >= 0 ? e.slice(0, sep) : e;
        result[tb] = (result[tb] ?? 0) + 1;
      }
    } else {
      for (const tb of scopeExam.examScope) result[tb] = 0;
    }
    return result;
  }, [scopeExam]);

  /* scopeExam 바뀔 때 교재별 문제 수 초기화 (소스 비율로 균등 배분) */
  useEffect(() => {
    const tbs = Object.keys(scopePassagesByTb);
    if (tbs.length <= 1) { setTextbookCounts({}); return; }
    const totalP = Object.values(scopePassagesByTb).reduce((s, v) => s + v, 0);
    const counts: Record<string, number> = {};
    if (totalP > 0) {
      let remaining = schoolCount;
      const sorted = Object.entries(scopePassagesByTb).sort((a, b) => b[1] - a[1]);
      sorted.forEach(([tb, cnt], i) => {
        if (i === sorted.length - 1) { counts[tb] = Math.max(1, remaining); }
        else { const share = Math.max(1, Math.round(cnt / totalP * schoolCount)); counts[tb] = share; remaining -= share; }
      });
    } else {
      const base = Math.floor(schoolCount / tbs.length);
      tbs.forEach((tb, i) => { counts[tb] = i < schoolCount % tbs.length ? base + 1 : base; });
    }
    setTextbookCounts(counts);
  // scopeExamId가 바뀔 때만 초기화 (schoolCount 변경 시엔 유지)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeExamId, scopePassagesByTb]);
  const patternExam = schoolExams.find((e) => e.id === patternExamId);
  const gradeExams = schoolExams.filter((e) => e.grade === selectedGrade)
    .sort((a, b) => b.academicYear - a.academicYear || a.examType.localeCompare(b.examType));

  const applyResult = (rawSets: Question[][], tc?: Record<string, number>) => {
    const newSets: ExamSet[] = rawSets.map((qs) => ({
      questions: qs,
      selected: new Set(qs.map((q) => q.id)),
    }));
    setExamSets(newSets);
    setActiveSet(0);
    setResultTypeCounts(tc ?? {});
    setGenerated(true);
  };

  const handleGenerate = useCallback(async () => {
    setLoading(true); setGenerated(false);
    try {
      if (mode === 'student') {
        const params = new URLSearchParams({ limit: String(count), random: String(randomOrder), sets: String(setsCount) });
        if (selectedStudent) params.set('studentId', selectedStudent);
        if (filterType) params.set('type', filterType);
        if (filterDifficulty) params.set('difficulty', filterDifficulty);
        const d = await fetch(`/api/my/vip/generate?${params}`, { credentials: 'include' }).then((r) => r.json());
        if (d.ok) applyResult(d.sets ?? [d.questions]);
      } else {
        if (!scopeExamId) { alert('시험 범위 기준 시험을 선택해주세요.'); return; }
        const perTb = Object.keys(textbookCounts).length > 1;
        const effectiveTotal = perTb
          ? Object.values(textbookCounts).reduce((s, v) => s + v, 0)
          : schoolCount;
        const params = new URLSearchParams({ scopeExamId, total: String(effectiveTotal), random: String(schoolRandom), sets: String(setsCount) });
        if (patternExamId) params.set('patternExamId', patternExamId);
        if (Object.keys(typeCounts).length > 0) params.set('typeCounts', JSON.stringify(typeCounts));
        if (perTb) params.set('textbookCounts', JSON.stringify(textbookCounts));
        const d = await fetch(`/api/my/vip/generate/by-exam?${params}`, { credentials: 'include' }).then((r) => r.json());
        if (d.ok) applyResult(d.sets ?? [], d.typeCounts);
        else alert(d.error ?? '생성에 실패했습니다.');
      }
    } finally { setLoading(false); }
  }, [mode, count, randomOrder, setsCount, selectedStudent, filterType, filterDifficulty,
      scopeExamId, patternExamId, typeCounts, schoolCount, schoolRandom]);

  const toggleSelect = (setIdx: number, id: string) => {
    setExamSets((prev) => prev.map((s, i) => {
      if (i !== setIdx) return s;
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...s, selected: next };
    }));
  };
  const toggleAll = (setIdx: number) => {
    setExamSets((prev) => prev.map((s, i) => {
      if (i !== setIdx) return s;
      const allSel = s.selected.size === s.questions.length;
      return { ...s, selected: allSel ? new Set() : new Set(s.questions.map((q) => q.id)) };
    }));
  };

  const handleDownload = async (format: 'pdf' | 'docx', setIdx: number) => {
    const s = examSets[setIdx];
    const selectedIds = s.questions.filter((q) => s.selected.has(q.id)).map((q) => q.id);
    if (selectedIds.length === 0) { alert('다운로드할 문제를 선택해주세요.'); return; }

    setDownloading(setIdx);
    try {
      const school = schools.find((sc) => sc.id === selectedSchool);
      const sExam = schoolExams.find((e) => e.id === scopeExamId);
      const baseTitle = mode === 'school' && school && sExam
        ? `${school.name} ${selectedGrade}학년 ${sExam.academicYear}년 ${sExam.examType}`
        : '변형문제';
      const setLabel = examSets.length > 1 ? ` (세트 ${SET_LABELS[setIdx]})` : '';
      const examTitle = baseTitle + setLabel;
      const params = new URLSearchParams({ format, ids: selectedIds.join(','), title: examTitle });
      const res = await fetch(`/api/my/vip/generate/download?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('실패');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url;
      a.download = `${examTitle}.${format}`; a.click();
      URL.revokeObjectURL(url);
    } catch { alert('다운로드에 실패했습니다.'); }
    setDownloading(null);
  };

  const parseOptions = (opts: string) =>
    opts ? opts.split(/\n|<br\s*\/?>/).map((l) => l.trim()).filter(Boolean) : [];

  const totalTypeCount = Object.values(typeCounts).reduce((s, v) => s + v, 0);
  const currentSet = examSets[activeSet];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">시험지 만들기</h1>
        <p className="text-sm text-zinc-500 mt-0.5">시험 범위에 맞는 문제를 세트별로 구성합니다</p>
      </div>

      {/* 모드 탭 */}
      <div className="flex gap-1 p-1 bg-zinc-900/60 rounded-xl border border-zinc-800/60 w-fit">
        {(['student', 'school'] as Mode[]).map((m) => (
          <button key={m} onClick={() => { setMode(m); setGenerated(false); setExamSets([]); }}
            className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-colors ${mode === m ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
            {m === 'student' ? '학생별' : '학교별'}
          </button>
        ))}
      </div>

      {/* ── 학생별 필터 ── */}
      {mode === 'student' && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">학생 선택</label>
              <select value={selectedStudent} onChange={(e) => setSelectedStudent(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none [&>option]:bg-zinc-900">
                <option value="">전체 (범위 미지정)</option>
                {students.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.schoolName} {s.grade}학년)</option>)}
              </select>
              {selectedStudentObj?.examScope?.length ? (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {selectedStudentObj.examScope.map((s) => <span key={s} className="px-1.5 py-0.5 bg-zinc-700/40 text-zinc-300 text-[10px] rounded">{s.length > 15 ? s.slice(0, 15) + '…' : s}</span>)}
                </div>
              ) : null}
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">유형</label>
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none [&>option]:bg-zinc-900">
                <option value="">전체</option>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">난이도</label>
              <select value={filterDifficulty} onChange={(e) => setFilterDifficulty(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none [&>option]:bg-zinc-900">
                <option value="">전체</option>
                {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">문제 수 / 세트</label>
              <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none" />
            </div>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer">
              <input type="checkbox" checked={randomOrder} onChange={(e) => setRandomOrder(e.target.checked)} className="rounded" />
              문제 순서 랜덤
            </label>
            <SetCountSelector value={setsCount} onChange={setSetsCount} />
          </div>
        </div>
      )}

      {/* ── 학교별 필터 ── */}
      {mode === 'school' && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">학교</label>
              <select value={selectedSchool} onChange={(e) => setSelectedSchool(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none [&>option]:bg-zinc-900">
                <option value="">학교 선택</option>
                {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">학년</label>
              <div className="flex gap-1">
                {GRADES.map((g) => (
                  <button key={g} onClick={() => setSelectedGrade(g)} className={`flex-1 py-2 text-sm rounded-xl border transition-colors font-medium ${selectedGrade === g ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-500 hover:text-zinc-300'}`}>{g}학년</button>
                ))}
              </div>
            </div>
          </div>

          {selectedSchool && gradeExams.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">시험 범위 기준 <span className="text-zinc-600">(이번 시험)</span></label>
                <select value={scopeExamId} onChange={(e) => setScopeExamId(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none [&>option]:bg-zinc-900">
                  <option value="">선택 안 함</option>
                  {gradeExams.map((e) => <option key={e.id} value={e.id}>{e.academicYear}년 {e.examType} — 교재 {e.examScope.length}권{e.examScopePassages?.length ? ` · 소스 ${e.examScopePassages.length}개` : ''}</option>)}
                </select>
                {scopeExam && (
                  <div className="mt-2 p-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                    <p className="text-[10px] text-zinc-500 mb-1">시험 범위</p>
                    <div className="flex flex-wrap gap-1">
                      {scopeExam.examScope.length === 0 ? <span className="text-[11px] text-zinc-600">범위 미설정</span>
                        : scopeExam.examScope.map((tb) => <span key={tb} className="px-1.5 py-0.5 bg-zinc-700/60 text-zinc-300 text-[10px] rounded truncate max-w-[180px]" title={tb}>{tb.length > 20 ? tb.slice(0, 20) + '…' : tb}</span>)}
                    </div>
                    {(scopeExam.examScopePassages?.length ?? 0) > 0 && <p className="text-[10px] text-zinc-600 mt-1">소스 {scopeExam.examScopePassages!.length}개 지정됨</p>}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">기출 분석 기준 <span className="text-zinc-600">(이전 시험)</span></label>
                <select value={patternExamId} onChange={(e) => setPatternExamId(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none [&>option]:bg-zinc-900">
                  <option value="">기출 분석 없이 생성</option>
                  {gradeExams.map((e) => <option key={e.id} value={e.id}>{e.academicYear}년 {e.examType} — 객관식 {e.objectiveCount}문제</option>)}
                </select>
                {patternExam && Object.keys(patternExam.questions).length > 0 && (
                  <div className="mt-2 p-2.5 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
                    <p className="text-[10px] text-zinc-500 mb-1.5">기출 유형 분포</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(Object.values(patternExam.questions).reduce((acc, q) => {
                        if (q.isSubjective || q.questionType === '서술형') { acc['서술형'] = (acc['서술형'] ?? 0) + 1; }
                        else if (q.questionType) { acc[q.questionType] = (acc[q.questionType] ?? 0) + 1; }
                        return acc;
                      }, {} as Record<string, number>))
                        .sort((a, b) => (a[0] === '서술형' ? 1 : b[0] === '서술형' ? -1 : b[1] - a[1])).map(([type, cnt]) => (
                          <span key={type} className={`px-1.5 py-0.5 text-[10px] rounded ${type === '서술형' ? 'bg-amber-500/20 text-amber-300' : 'bg-violet-500/20 text-violet-300'}`}>{type} {cnt}</span>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedSchool && gradeExams.length === 0 && (
            <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/50 px-4 py-3 text-xs text-zinc-500">
              선택한 학교의 {selectedGrade}학년 시험 데이터가 없습니다.
              <a href="/my/vip/exams" className="ml-1 text-violet-400 hover:text-violet-300 underline">시험 관리</a>에서 먼저 등록해주세요.
            </div>
          )}

          {/* 교재별 문제 수 */}
          {Object.keys(scopePassagesByTb).length > 1 && Object.keys(textbookCounts).length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-zinc-400 font-medium">교재별 문제 수</p>
                <span className="text-xs text-zinc-500">
                  합계 {Object.values(textbookCounts).reduce((s, v) => s + v, 0)}문항 / 세트
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {Object.entries(scopePassagesByTb).sort((a, b) => b[1] - a[1]).map(([tb, passageCnt]) => (
                  <div key={tb} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800/60 border border-zinc-700/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-300 truncate" title={tb}>{tb.length > 22 ? tb.slice(0, 22) + '…' : tb}</p>
                      {passageCnt > 0 && <p className="text-[10px] text-zinc-600">{passageCnt}소스</p>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setTextbookCounts((p) => ({ ...p, [tb]: Math.max(0, (p[tb] ?? 0) - 1) }))} className="w-5 h-5 flex items-center justify-center rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 text-xs font-bold">−</button>
                      <span className="w-6 text-center text-xs text-zinc-100 font-medium">{textbookCounts[tb] ?? 0}</span>
                      <button onClick={() => setTextbookCounts((p) => ({ ...p, [tb]: (p[tb] ?? 0) + 1 }))} className="w-5 h-5 flex items-center justify-center rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 text-xs font-bold">+</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 유형별 문제 수 */}
          {Object.keys(typeCounts).length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-zinc-400 font-medium">유형별 문제 수 (기출 비율 자동 계산)</p>
                <span className="text-xs text-zinc-500">합계 {totalTypeCount}문항 / 세트</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([type, cnt]) => (
                  <div key={type} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-zinc-800/60 border border-zinc-700/50">
                    <span className="text-xs text-zinc-300 flex-1 truncate">{type}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setTypeCounts((p) => ({ ...p, [type]: Math.max(0, (p[type] ?? 0) - 1) }))} className="w-5 h-5 flex items-center justify-center rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 text-xs font-bold">−</button>
                      <span className="w-5 text-center text-xs text-zinc-100 font-medium">{cnt}</span>
                      <button onClick={() => setTypeCounts((p) => ({ ...p, [type]: (p[type] ?? 0) + 1 }))} className="w-5 h-5 flex items-center justify-center rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 text-xs font-bold">+</button>
                    </div>
                  </div>
                ))}
                <button onClick={() => { const t = prompt('추가할 유형'); if (t?.trim()) setTypeCounts((p) => ({ ...p, [t.trim()]: 1 })); }}
                  className="px-3 py-2 rounded-xl border border-dashed border-zinc-700 text-zinc-600 hover:text-zinc-400 hover:border-zinc-600 text-xs transition-colors">
                  + 유형 추가
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">문제 수 / 세트</label>
              <input type="number" min={1} max={100} value={schoolCount} onChange={(e) => setSchoolCount(Number(e.target.value))} className="w-20 px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none" />
            </div>
            <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer mt-4">
              <input type="checkbox" checked={schoolRandom} onChange={(e) => setSchoolRandom(e.target.checked)} className="rounded" />
              문제 순서 랜덤
            </label>
            <div className="mt-4">
              <SetCountSelector value={setsCount} onChange={setSetsCount} />
            </div>
          </div>
        </div>
      )}

      {/* 시험지 만들기 버튼 */}
      <div className="flex justify-end">
        <button onClick={handleGenerate} disabled={loading || (mode === 'school' && !scopeExamId)}
          className="px-7 py-2.5 bg-zinc-100 text-zinc-900 text-sm rounded-xl hover:bg-zinc-200 transition-all font-semibold disabled:opacity-40 flex items-center gap-2">
          {loading ? (
            <><span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-zinc-600 border-t-zinc-900 rounded-full" />시험지 생성 중...</>
          ) : '시험지 만들기'}
        </button>
      </div>

      {/* ── 결과 ── */}
      {generated && examSets.length > 0 && (
        <div className="space-y-4">
          {/* 세트 탭 */}
          {examSets.length > 1 && (
            <div className="flex gap-1 p-1 bg-zinc-900/60 rounded-xl border border-zinc-800/60 w-fit">
              {examSets.map((s, i) => (
                <button key={i} onClick={() => setActiveSet(i)}
                  className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-colors ${activeSet === i ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
                  세트 {SET_LABELS[i]}
                  <span className={`ml-1.5 text-[10px] ${activeSet === i ? 'text-zinc-400' : 'text-zinc-600'}`}>{s.questions.length}문제</span>
                </button>
              ))}
            </div>
          )}

          {currentSet && (
            <>
              {/* 툴바 */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <button onClick={() => toggleAll(activeSet)} className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors">
                    {currentSet.selected.size === currentSet.questions.length ? '전체 해제' : '전체 선택'}
                  </button>
                  <span className="text-xs text-zinc-500">{currentSet.selected.size}개 선택 / 총 {currentSet.questions.length}개</span>
                  {Object.keys(resultTypeCounts).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(resultTypeCounts).sort((a, b) => b[1] - a[1]).map(([type, cnt]) => (
                        <span key={type} className="px-1.5 py-0.5 bg-violet-500/20 text-violet-300 text-[10px] rounded">{type} {cnt}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleDownload('pdf', activeSet)} disabled={downloading !== null || currentSet.selected.size === 0}
                    className="px-4 py-2 bg-rose-600/80 text-zinc-100 text-sm rounded-xl hover:bg-rose-500 transition-colors disabled:opacity-40">
                    {downloading === activeSet ? '생성 중…' : 'PDF'}
                  </button>
                  <button onClick={() => handleDownload('docx', activeSet)} disabled={downloading !== null || currentSet.selected.size === 0}
                    className="px-4 py-2 bg-blue-600/80 text-zinc-100 text-sm rounded-xl hover:bg-blue-500 transition-colors disabled:opacity-40">
                    DOCX
                  </button>
                  {examSets.length > 1 && (
                    <button onClick={async () => {
                      for (let i = 0; i < examSets.length; i++) {
                        setActiveSet(i);
                        await handleDownload('pdf', i);
                      }
                    }} disabled={downloading !== null}
                      className="px-4 py-2 bg-zinc-700/80 text-zinc-200 text-sm rounded-xl hover:bg-zinc-600 transition-colors disabled:opacity-40">
                      전체 PDF
                    </button>
                  )}
                </div>
              </div>

              {/* 문제 목록 */}
              {currentSet.questions.length === 0 ? (
                <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">
                  조건에 맞는 문제가 없습니다.
                </div>
              ) : (
                <div className="space-y-3">
                  {currentSet.questions.map((q, idx) => (
                    <div key={q.id} className={`rounded-2xl border overflow-hidden transition-colors ${currentSet.selected.has(q.id) ? 'bg-zinc-800/40 border-zinc-600' : 'bg-zinc-900/40 border-zinc-800/80'}`}>
                      <div className="flex items-start gap-3 p-4">
                        <input type="checkbox" checked={currentSet.selected.has(q.id)} onChange={() => toggleSelect(activeSet, q.id)} className="mt-1 rounded flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-xs font-mono text-zinc-600">#{idx + 1}</span>
                            <span className="px-1.5 py-0.5 bg-violet-500/20 text-violet-300 text-[10px] rounded">{q.type}</span>
                            <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 text-[10px] rounded">{q.difficulty}</span>
                            <span className="text-[10px] text-zinc-600 truncate max-w-[200px]">{q.textbook}</span>
                            {q.source && <span className="text-[10px] text-zinc-700 truncate">{q.source}</span>}
                          </div>
                          <p className="text-sm text-zinc-400 leading-relaxed line-clamp-3" dangerouslySetInnerHTML={{ __html: q.paragraph }} />
                          {q.options && (
                            <div className="mt-2 space-y-0.5">
                              {parseOptions(q.options).map((opt, oi) => <div key={oi} className="text-xs text-zinc-500">{opt}</div>)}
                            </div>
                          )}
                          <div className="mt-2 text-xs text-emerald-400/80">정답: {q.answer}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SetCountSelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-1">세트 수</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => onChange(n)}
            className={`w-8 h-8 text-sm rounded-lg border transition-colors font-medium ${value === n ? 'bg-zinc-700 border-zinc-600 text-zinc-100' : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-500 hover:text-zinc-300'}`}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
