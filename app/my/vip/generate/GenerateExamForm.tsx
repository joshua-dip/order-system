'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { downloadBlob } from '@/lib/download-blob';
import { studentOptionLabel } from '@/lib/student-label';

interface Student { id: string; name: string; grade: number; examScope: string[]; schoolName: string; phone?: string }
interface School { id: string; name: string; region: string }
interface SchoolExam {
  id: string; schoolId: string; academicYear: number; grade: number; examType: string;
  questions: Record<string, { questionType?: string; isSubjective?: boolean; textbook?: string; score?: number; questionText?: string; questionBody?: string; source?: string }>;
  examScope: string[]; examScopePassages?: string[]; objectiveCount: number;
}
type SourceCategory = '교과서' | '부교재' | '모의고사';
const CATEGORY_ORDER: SourceCategory[] = ['교과서', '부교재', '모의고사'];

/** 서술형 문항 (범위 지문의 주제완성형 등 — paragraph 에 지문·주제틀·조건 임베드). */
interface SubjectiveItem { question: string; paragraph: string; score: number; source: string; textbook: string; modelAnswer?: string; explanation?: string; subtype?: string }

/** 기준 배점 배열 → 합계 total(기본 100)에 맞춰 정수 배분(largest remainder). */
function distributeScores(bases: number[], total = 100): number[] {
  const n = bases.length;
  if (n === 0) return [];
  const sum = bases.reduce((a, b) => a + b, 0) || n;
  const raw = bases.map((b) => (b / sum) * total);
  const out = raw.map((r) => Math.floor(r));
  let rem = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f);
  for (let k = 0; rem > 0 && k < order.length; k++, rem--) out[order[k].i]++;
  // 0점 방지(문항 수 ≤ total 가정): 0이면 가장 큰 항목에서 1 가져옴
  for (let i = 0; i < n; i++) {
    if (out[i] <= 0) { const mx = out.indexOf(Math.max(...out)); if (mx >= 0 && out[mx] > 1) { out[mx]--; out[i] = 1; } else out[i] = 1; }
  }
  return out;
}
interface Question {
  id: string; textbook: string; passageId: string | null; type: string;
  difficulty: string; paragraph: string; options: string;
  answer: string; explanation: string; source?: string; pric: string | null;
  /** 어느 범위(scope) 카테고리에서 뽑혔는지 — 표지 출처 분포용 */
  scopeCategory?: string;
}
interface ExamSet { questions: Question[]; selected: Set<string> }

/** admin/passages 「교재 분류」와 동일한 모의고사 이름 패턴 (분류 미지정 교재 fallback). */
const MOCK_EXAM_PATTERN = /^\d{2}년\s+\d{1,2}월\s+고[123]\s+영어모의고사|^\d{2}년\s+고[123]\s+영어모의고사/;
const isMockExamName = (n: string) => MOCK_EXAM_PATTERN.test(n) || /영어모의고사$/.test(n);

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

export default function GenerateExamForm({ forcedMode }: { forcedMode: Mode }) {
  const [mode] = useState<Mode>(forcedMode);
  const router = useRouter();
  const [scopeExpanded, setScopeExpanded] = useState(false);

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
  /** 기출 시험지의 지문·유형 순서대로 생성 (기출 선택 시 기본 ON) */
  const [followOrder, setFollowOrder] = useState(true);
  /** PDF/Word 첫 페이지에 출처·유형 분포 표지 포함 */
  const [includeCover, setIncludeCover] = useState(true);
  /** PDF 표지에 QR 채점 코드 포함 (학생 전화번호 자가채점) */
  const [includeQr, setIncludeQr] = useState(true);
  /** 답안지 페이지 포함 */
  const [includeAnswerSheet, setIncludeAnswerSheet] = useState(true);
  /** 서술형 문제 포함 (기출 서술형 그대로) */
  const [includeSubjective, setIncludeSubjective] = useState(true);

  /* 교재별 문제 수 */
  const [textbookCounts, setTextbookCounts] = useState<Record<string, number>>({});
  /* 교재 분류(교과서/부교재/모의고사) — settings.textbookTypeMeta 기반, API가 내려줌 */
  const [textbookTypes, setTextbookTypes] = useState<Record<string, SourceCategory>>({});

  /* 세트 수 */
  const [setsCount, setSetsCount] = useState(1);

  /* 결과 */
  const [examSets, setExamSets] = useState<ExamSet[]>([]);
  const [activeSet, setActiveSet] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? null : t)), 4500); };
  const [resultTypeCounts, setResultTypeCounts] = useState<Record<string, number>>({});
  /** 서술형 — '이번 시험범위' 지문의 주제완성형(narrative)에서 가져옴 (기출 패턴 서술형 대체). */
  const [subjectiveItems, setSubjectiveItems] = useState<SubjectiveItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [downloading, setDownloading] = useState<number | null>(null); // set index or -1 for all
  const [qrLoading, setQrLoading] = useState<number | null>(null); // QR 채점본 생성 중인 세트

  useEffect(() => {
    fetch('/api/my/vip/students?limit=200&status=active', { credentials: 'include' })
      .then((r) => r.json()).then((d) => { if (d.ok) setStudents(d.items); });
  }, []);

  useEffect(() => {
    fetch('/api/my/vip/schools', { credentials: 'include' })
      .then((r) => r.json()).then((d) => { if (d.ok) setSchools(d.schools); });
  }, []);

  useEffect(() => {
    fetch('/api/my/vip/textbooks', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (d.ok && d.types && typeof d.types === 'object') setTextbookTypes(d.types); })
      .catch(() => {});
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

  const selectedStudentObj = students.find((s) => s.id === selectedStudent);
  const scopeExam = schoolExams.find((e) => e.id === scopeExamId);
  const patternExam = schoolExams.find((e) => e.id === patternExamId);

  /* 교재 → 카테고리(교과서/부교재/모의고사). 분류 미지정이면 모의고사 패턴 → 부교재 fallback. */
  const classifyCategory = useCallback((tb: string): SourceCategory => {
    const t = textbookTypes[tb];
    if (t === '교과서' || t === '부교재' || t === '모의고사') return t;
    return isMockExamName(tb) ? '모의고사' : '부교재';
  }, [textbookTypes]);

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

  /* 시험 범위 소스(번호)를 교재별로 그룹 — 펼치기 표시용 */
  const scopeSourcesByTb = useMemo<{ tb: string; sources: string[] }[]>(() => {
    if (!scopeExam?.examScopePassages?.length) return [];
    const map = new Map<string, string[]>();
    for (const e of scopeExam.examScopePassages) {
      const sep = e.indexOf('::');
      const tb = sep >= 0 ? e.slice(0, sep) : e;
      const src = sep >= 0 ? e.slice(sep + 2) : '';
      if (!map.has(tb)) map.set(tb, []);
      if (src) map.get(tb)!.push(src);
    }
    return [...map.entries()].map(([tb, sources]) => ({
      tb,
      sources: sources.sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })),
    }));
  }, [scopeExam]);

  /* 이번 시험 범위(scope)의 교재를 카테고리로 그룹 */
  const scopeTbByCategory = useMemo<Record<SourceCategory, string[]>>(() => {
    const m: Record<SourceCategory, string[]> = { 교과서: [], 부교재: [], 모의고사: [] };
    for (const tb of Object.keys(scopePassagesByTb)) m[classifyCategory(tb)].push(tb);
    return m;
  }, [scopePassagesByTb, classifyCategory]);

  /* 기출(pattern) 시험의 출처 카테고리 분포 — 문항별 textbook을 분류해 집계 */
  const patternCategoryCounts = useMemo<Record<SourceCategory, number>>(() => {
    const m: Record<SourceCategory, number> = { 교과서: 0, 부교재: 0, 모의고사: 0 };
    if (!patternExam?.questions) return m;
    for (const q of Object.values(patternExam.questions)) {
      const tb = q.textbook?.trim();
      if (tb) m[classifyCategory(tb)]++;
    }
    return m;
  }, [patternExam, classifyCategory]);

  /* 기출 유형별 평균 배점 (서술형 제외) — 객관식 점수 분포 기준 */
  const typeAvgScore = useMemo<Record<string, number>>(() => {
    const acc: Record<string, { sum: number; n: number }> = {};
    if (patternExam?.questions) {
      for (const q of Object.values(patternExam.questions)) {
        if (q.isSubjective || q.questionType === '서술형') continue;
        const t = q.questionType; const s = Number(q.score);
        if (!t || !Number.isFinite(s) || s <= 0) continue;
        (acc[t] ||= { sum: 0, n: 0 }); acc[t].sum += s; acc[t].n++;
      }
    }
    const m: Record<string, number> = {};
    for (const [t, v] of Object.entries(acc)) m[t] = v.sum / v.n;
    return m;
  }, [patternExam]);

  /* 기출 패턴(이전 시험)의 서술형 문항 수 — 이번 시험지에 넣을 서술형 개수의 기준 */
  const patternSubjectiveCount = useMemo<number>(() => {
    if (!patternExam?.questions) return 0;
    return Object.values(patternExam.questions).filter((q) => q.isSubjective || q.questionType === '서술형').length;
  }, [patternExam]);

  /* 서술형 = '이번 시험범위' 지문의 주제완성형(narrative)에서 patternSubjectiveCount 개를 가져온다.
     (기출 패턴 서술형은 범위 밖이라 그대로 쓰지 않고, 범위 지문의 서술형으로 교체) */
  useEffect(() => {
    if (mode !== 'school' || !scopeExamId || patternSubjectiveCount <= 0) { setSubjectiveItems([]); return; }
    let alive = true;
    fetch(`/api/my/vip/generate/scope-subjectives?scopeExamId=${scopeExamId}&limit=${patternSubjectiveCount}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => { if (alive) setSubjectiveItems(d.ok && Array.isArray(d.subjectives) ? d.subjectives : []); })
      .catch(() => { if (alive) setSubjectiveItems([]); });
    return () => { alive = false; };
  }, [mode, scopeExamId, patternSubjectiveCount]);

  /* 유형별 문제 수 계산 — 서술형은 '범위 내'로 필터된 실제 수(subjectiveItems)로 맞춘다(raw 아님). */
  useEffect(() => {
    const pe = schoolExams.find((e) => e.id === patternExamId);
    if (!pe) { setTypeCounts({}); return; }
    const counts = computeTypeCounts(pe.questions, schoolCount);
    if ('서술형' in counts) {
      if (subjectiveItems.length > 0) counts['서술형'] = subjectiveItems.length;
      else delete counts['서술형'];
    }
    setTypeCounts(counts);
  }, [patternExamId, schoolExams, schoolCount, subjectiveItems]);

  /* 기출 객관식 수 → 「문제 수/세트」 자동 세팅 (기출 선택 시) */
  useEffect(() => {
    if (patternExam && patternExam.objectiveCount > 0) setSchoolCount(patternExam.objectiveCount);
  // patternExamId가 바뀔 때만
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patternExamId]);

  /* 교재별 문제 수 배분 — 기출 출처 카테고리 비율 우선, 없으면 scope 지문 비율. */
  useEffect(() => {
    const tbs = Object.keys(scopePassagesByTb);
    if (tbs.length <= 1) { setTextbookCounts({}); return; }
    const total = Math.max(1, schoolCount);

    // 카테고리별 가중치: 기출 분포 우선, scope에 있는 카테고리만
    const present = CATEGORY_ORDER.filter((c) => scopeTbByCategory[c].length > 0);
    const usePattern = present.some((c) => patternCategoryCounts[c] > 0);
    const catWeight: Record<string, number> = {};
    for (const c of present) {
      catWeight[c] = usePattern
        ? patternCategoryCounts[c]
        : (scopeTbByCategory[c].reduce((s, tb) => s + (scopePassagesByTb[tb] || 0), 0) || scopeTbByCategory[c].length);
    }
    const wTotal = present.reduce((s, c) => s + catWeight[c], 0);

    // 카테고리별 문항 수 (largest remainder)
    const catAlloc: Record<string, number> = {};
    if (wTotal > 0) {
      let rem = total;
      present.forEach((c, i) => {
        if (i === present.length - 1) catAlloc[c] = Math.max(0, rem);
        else { const share = Math.round(catWeight[c] / wTotal * total); catAlloc[c] = share; rem -= share; }
      });
    } else {
      const base = Math.floor(total / present.length);
      present.forEach((c, i) => { catAlloc[c] = i < total % present.length ? base + 1 : base; });
    }

    // 카테고리 안에서 교재별 배분 (scope 지문 수, 없으면 균등)
    const counts: Record<string, number> = {};
    for (const c of present) {
      const list = scopeTbByCategory[c];
      const catTotal = catAlloc[c] || 0;
      const pTotal = list.reduce((s, tb) => s + (scopePassagesByTb[tb] || 0), 0);
      let rem = catTotal;
      const sorted = list.slice().sort((a, b) => (scopePassagesByTb[b] || 0) - (scopePassagesByTb[a] || 0));
      sorted.forEach((tb, i) => {
        if (catTotal <= 0) { counts[tb] = 0; return; }
        if (i === sorted.length - 1) { counts[tb] = Math.max(0, rem); }
        else {
          const share = pTotal > 0 ? Math.round((scopePassagesByTb[tb] || 0) / pTotal * catTotal) : Math.round(catTotal / list.length);
          counts[tb] = Math.max(0, share); rem -= counts[tb];
        }
      });
    }
    setTextbookCounts(counts);
  // 기출/범위/총수 변경 시 재배분
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeExamId, patternExamId, scopePassagesByTb, scopeTbByCategory, patternCategoryCounts, schoolCount]);
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
        const useFollow = followOrder && !!patternExamId;
        const params = new URLSearchParams({ scopeExamId, total: String(effectiveTotal), random: String(schoolRandom), sets: String(setsCount) });
        if (patternExamId) params.set('patternExamId', patternExamId);
        if (useFollow) params.set('followOrder', 'true');
        // 서술형은 객관식 생성기(by-exam) 대상이 아님 — 다운로드 시 기출 그대로 별도 부착
        const objTypeCounts = Object.fromEntries(Object.entries(typeCounts).filter(([t]) => t !== '서술형'));
        if (Object.keys(objTypeCounts).length > 0) params.set('typeCounts', JSON.stringify(objTypeCounts));
        if (perTb) params.set('textbookCounts', JSON.stringify(textbookCounts));
        const d = await fetch(`/api/my/vip/generate/by-exam?${params}`, { credentials: 'include' }).then((r) => r.json());
        if (d.ok) applyResult(d.sets ?? [], d.typeCounts);
        else alert(d.error ?? '생성에 실패했습니다.');
      }
    } finally { setLoading(false); }
  }, [mode, count, randomOrder, setsCount, selectedStudent, filterType, filterDifficulty,
      scopeExamId, patternExamId, typeCounts, schoolCount, schoolRandom, followOrder, textbookCounts]);

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

  /** 선택 문항 → 다운로드/저장 공통 페이로드(제목·배점·카테고리·서술형). 선택 0 + 서술형 없으면 null. */
  const buildExamPayload = (setIdx: number) => {
    const s = examSets[setIdx];
    const selected = s.questions.filter((q) => s.selected.has(q.id));
    const selectedIds = selected.map((q) => q.id);
    const useSubjective = mode === 'school' && includeSubjective && subjectiveItems.length > 0;
    if (selectedIds.length === 0 && !useSubjective) return null;

    const school = schools.find((sc) => sc.id === selectedSchool);
    const sExam = schoolExams.find((e) => e.id === scopeExamId);
    const baseTitle = mode === 'school' && school && sExam
      ? `${school.name} ${selectedGrade}학년 ${sExam.academicYear}년 ${sExam.examType}`
      : '변형문제';
    const setLabel = examSets.length > 1 ? ` (세트 ${SET_LABELS[setIdx]})` : '';
    const examTitle = baseTitle + setLabel;

    // 배점 분배: 객관식(유형 평균) + 서술형(기출 배점) → 합계 100점
    const subjList = useSubjective ? subjectiveItems : [];
    const objBases = selected.map((q) => typeAvgScore[q.type] ?? 3);
    const subjBases = subjList.map((s2) => s2.score || 5);
    const allScores = distributeScores([...objBases, ...subjBases], 100);
    const objScores = allScores.slice(0, selected.length);
    const subjScores = allScores.slice(selected.length);
    const subjectivesPayload = subjList.map((s2, i) => ({ question: s2.question, paragraph: s2.paragraph, source: [s2.textbook, s2.source].filter(Boolean).join(' · '), score: subjScores[i] ?? s2.score, category: classifyCategory(s2.textbook), type: '서술형', textbook: s2.textbook, sourceKey: s2.source, modelAnswer: s2.modelAnswer ?? '', explanation: s2.explanation ?? '' }));
    const categories = selected.map((q) => q.scopeCategory || classifyCategory(q.textbook));

    return { selectedIds, examTitle, objScores, categories, subjectivesPayload, school, examYear: sExam?.academicYear, examTerm: sExam?.examType };
  };

  const handleDownload = async (format: 'pdf' | 'docx', setIdx: number) => {
    const p = buildExamPayload(setIdx);
    if (!p) { alert('다운로드할 문제를 선택해주세요.'); return; }

    setDownloading(setIdx);
    try {
      const params = new URLSearchParams({ format, ids: p.selectedIds.join(','), title: p.examTitle });
      if (!includeCover) params.set('cover', 'false');
      if (!includeAnswerSheet) params.set('answerSheet', 'false');
      if (p.selectedIds.length > 0) {
        params.set('scores', p.objScores.join(','));
        // 표지 출처 분포가 범위(scope) 카테고리 기준으로 집계되도록 문항별 카테고리 전달
        params.set('categories', p.categories.join(','));
      }
      if (p.subjectivesPayload.length > 0) params.set('subjectives', JSON.stringify(p.subjectivesPayload));
      if (p.school?.name) params.set('schoolName', p.school.name);
      if (mode === 'school' && selectedGrade) params.set('grade', String(selectedGrade));
      if (p.examYear) params.set('examYear', String(p.examYear));
      if (p.examTerm) params.set('examTerm', p.examTerm);
      const res = await fetch('/api/my/vip/generate/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(Object.fromEntries(params)) });
      if (!res.ok) throw new Error('실패');
      downloadBlob(await res.blob(), `${p.examTitle}.${format}`);
    } catch { alert('다운로드에 실패했습니다.'); }
    setDownloading(null);
  };

  /** QR 채점본: 시험지를 저장(토큰)하고, 표지에 학생 자가채점 QR 을 넣은 PDF 다운로드. */
  const handleQrExam = async (setIdx: number) => {
    const p = buildExamPayload(setIdx);
    if (!p) { alert('문제를 선택해주세요.'); return; }
    if (p.selectedIds.length === 0) { alert('QR 자가채점은 객관식이 1문항 이상 필요합니다.'); return; }

    setQrLoading(setIdx);
    try {
      // 1) 시험지 저장 → 토큰·자가채점 URL
      const saveRes = await fetch('/api/my/vip/generate/exam-paper', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          ids: p.selectedIds, scores: p.objScores, categories: p.categories,
          subjectives: p.subjectivesPayload, title: p.examTitle,
          schoolId: selectedSchool || undefined, schoolName: p.school?.name || '', grade: selectedGrade,
        }),
      });
      const saved = await saveRes.json();
      if (!saveRes.ok || !saved.ok) { alert(saved.error || 'QR 시험지 생성에 실패했습니다.'); setQrLoading(null); return; }

      // 2) QR 포함 PDF (표지 강제 포함)
      const params = new URLSearchParams({ format: 'pdf', ids: p.selectedIds.join(','), title: p.examTitle, qr: saved.url });
      params.set('scores', p.objScores.join(','));
      params.set('categories', p.categories.join(','));
      if (!includeAnswerSheet) params.set('answerSheet', 'false');
      if (p.subjectivesPayload.length > 0) params.set('subjectives', JSON.stringify(p.subjectivesPayload));
      if (p.school?.name) params.set('schoolName', p.school.name);
      if (mode === 'school' && selectedGrade) params.set('grade', String(selectedGrade));
      if (p.examYear) params.set('examYear', String(p.examYear));
      if (p.examTerm) params.set('examTerm', p.examTerm);
      const res = await fetch('/api/my/vip/generate/download', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(Object.fromEntries(params)) });
      if (!res.ok) throw new Error('실패');
      downloadBlob(await res.blob(), `${p.examTitle} (QR채점).pdf`);
      showToast('QR 채점본 저장 완료 · 「문제 생성 → QR 자가채점 결과」에서 응시 결과를 볼 수 있어요.');
    } catch { alert('QR 채점본 생성에 실패했습니다.'); }
    setQrLoading(null);
  };

  const parseOptions = (opts: unknown): string[] => {
    if (Array.isArray(opts)) return opts.map((l) => String(l ?? '').trim()).filter(Boolean);
    if (opts && typeof opts === 'object') return Object.values(opts as Record<string, unknown>).map((l) => String(l ?? '').trim()).filter(Boolean);
    if (typeof opts === 'string' && opts) return opts.split(/\n|<br\s*\/?>/).map((l) => l.trim()).filter(Boolean);
    return [];
  };

  const totalTypeCount = Object.entries(typeCounts).reduce((s, [t, v]) => s + (t === '서술형' && !includeSubjective ? 0 : v), 0);
  // 「문제 수 / 세트」는 객관식 목표치(schoolCount)에 포함된 서술형 수를 더한 '총 문항'으로 표기.
  const subjIncludedCount = includeSubjective ? subjectiveItems.length : 0;
  const schoolTotalCount = schoolCount + subjIncludedCount;
  const currentSet = examSets[activeSet];

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-md px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 shadow-xl text-sm text-zinc-100 flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2" role="status">
          <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
          <span>{toast}</span>
        </div>
      )}
      <div>
        <h1 className="text-xl font-bold text-zinc-100">{mode === 'student' ? '학생별 시험지 만들기' : '학교별 시험지 만들기'}</h1>
        <p className="text-sm text-zinc-500 mt-0.5">{mode === 'student' ? '학생의 시험 범위에 맞는 변형문제를 세트별로 구성합니다' : '학교 시험을 기준으로 출제 비율·순서에 맞춰 시험지를 구성합니다'}</p>
      </div>

      {/* ── 학생별 필터 ── */}
      {mode === 'student' && (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">학생 선택</label>
              <select value={selectedStudent} onChange={(e) => setSelectedStudent(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none [&>option]:bg-zinc-900">
                <option value="">전체 (범위 미지정)</option>
                {students.map((s) => <option key={s.id} value={s.id}>{studentOptionLabel(s, { school: true })}</option>)}
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
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] text-zinc-500">시험 범위</p>
                      <button type="button" onClick={() => router.push('/my/vip/exams')}
                        className="text-[10px] text-blue-400/90 hover:text-blue-300 inline-flex items-center gap-0.5">
                        시험 범위 수정 →
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {scopeExam.examScope.length === 0 ? <span className="text-[11px] text-zinc-600">범위 미설정</span>
                        : scopeExam.examScope.map((tb) => <span key={tb} className="px-1.5 py-0.5 bg-zinc-700/60 text-zinc-300 text-[10px] rounded truncate max-w-[180px]" title={tb}>{tb.length > 20 ? tb.slice(0, 20) + '…' : tb}</span>)}
                    </div>
                    {(scopeExam.examScopePassages?.length ?? 0) > 0 && (
                      <>
                        <button type="button" onClick={() => setScopeExpanded((v) => !v)}
                          className="mt-1.5 text-[10px] text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1">
                          소스 {scopeExam.examScopePassages!.length}개 지정됨
                          <span className="text-zinc-500">{scopeExpanded ? '· 접기 ▲' : '· 펼치기 ▼'}</span>
                        </button>
                        {scopeExpanded && (
                          <div className="mt-2 space-y-2 max-h-60 overflow-y-auto pr-1">
                            {scopeSourcesByTb.map(({ tb, sources }) => (
                              <div key={tb}>
                                <p className="text-[10px] font-medium text-zinc-300 mb-1 truncate" title={tb}>{tb} <span className="text-zinc-600">({sources.length})</span></p>
                                <div className="flex flex-wrap gap-1">
                                  {sources.length === 0 ? <span className="text-[10px] text-zinc-600">번호 미상</span>
                                    : sources.map((s, i) => <span key={tb + i} className="px-1.5 py-0.5 bg-zinc-700/40 text-zinc-300 text-[10px] rounded" title={s}>{s}</span>)}
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
                    {CATEGORY_ORDER.some((c) => patternCategoryCounts[c] > 0) && (() => {
                      const catTotal = CATEGORY_ORDER.reduce((s, c) => s + patternCategoryCounts[c], 0);
                      return (
                        <>
                          <p className="text-[10px] text-zinc-500 mb-1.5 mt-2.5">기출 출처 분포</p>
                          <div className="flex flex-wrap gap-1">
                            {CATEGORY_ORDER.filter((c) => patternCategoryCounts[c] > 0).map((c) => {
                              const pct = catTotal ? Math.round((patternCategoryCounts[c] / catTotal) * 100) : 0;
                              const color = c === '교과서' ? 'bg-emerald-500/20 text-emerald-300'
                                : c === '모의고사' ? 'bg-sky-500/20 text-sky-300'
                                : 'bg-orange-500/20 text-orange-300';
                              return <span key={c} className={`px-1.5 py-0.5 text-[10px] rounded ${color}`}>{c} {patternCategoryCounts[c]} · {pct}%</span>;
                            })}
                          </div>
                        </>
                      );
                    })()}
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

          {/* 출처(카테고리)별 · 교재별 문제 수 */}
          {Object.keys(scopePassagesByTb).length > 1 && Object.keys(textbookCounts).length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-zinc-400 font-medium">
                  출처별 문제 수 {patternExam && CATEGORY_ORDER.some((c) => patternCategoryCounts[c] > 0) ? '(기출 출처 비율 자동 배분)' : '(범위 비율)'}
                </p>
                <span className="text-xs text-zinc-500">
                  합계 {Object.values(textbookCounts).reduce((s, v) => s + v, 0)}문항 / 세트
                </span>
              </div>
              {(() => {
                const missing = CATEGORY_ORDER.filter((c) => patternCategoryCounts[c] > 0 && scopeTbByCategory[c].length === 0);
                if (missing.length === 0) return null;
                return (
                  <p className="text-[10px] text-amber-400/90 mb-2 -mt-1 leading-relaxed">
                    ⚠ 기출엔 <span className="font-semibold">{missing.join('·')}</span> 출처가 있지만 이번 시험 범위에 해당 교재가 없어 제외됐어요.{' '}
                    <a href="/my/vip/exams" className="underline hover:text-amber-300">시험 관리</a>에서 범위에 추가하면 그 비율까지 반영됩니다.
                  </p>
                );
              })()}
              <div className="space-y-2.5">
                {CATEGORY_ORDER.filter((c) => scopeTbByCategory[c].length > 0).map((c) => {
                  const list = scopeTbByCategory[c].slice().sort((a, b) => (scopePassagesByTb[b] || 0) - (scopePassagesByTb[a] || 0));
                  const catSum = list.reduce((s, tb) => s + (textbookCounts[tb] ?? 0), 0);
                  const color = c === '교과서' ? 'text-emerald-300' : c === '모의고사' ? 'text-sky-300' : 'text-orange-300';
                  return (
                    <div key={c}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[11px] font-semibold ${color}`}>{c}</span>
                        <div className="flex-1 h-px bg-zinc-800" />
                        <span className="text-[10px] text-zinc-500">{catSum}문항</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {list.map((tb) => {
                          const passageCnt = scopePassagesByTb[tb] || 0;
                          return (
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
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 유형별 문제 수 */}
          {Object.keys(typeCounts).length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <p className="text-xs text-zinc-400 font-medium">유형별 문제 수 (기출 비율 자동 계산)</p>
                <div className="flex items-center gap-3">
                  {subjectiveItems.length > 0 && (
                    <label className="flex items-center gap-1.5 text-xs text-amber-300/90 cursor-pointer select-none" title="기출 서술형 문제를 그대로 포함 (배점 합 100점에 반영)">
                      <input type="checkbox" checked={includeSubjective} onChange={(e) => setIncludeSubjective(e.target.checked)} className="rounded accent-amber-500" />
                      서술형 포함 ({subjectiveItems.length})
                    </label>
                  )}
                  <span className="text-xs text-zinc-500">합계 {totalTypeCount}문항 / 세트</span>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {Object.entries(typeCounts).filter(([type]) => type !== '서술형' || includeSubjective).sort((a, b) => (a[0] === '서술형' ? 1 : b[0] === '서술형' ? -1 : b[1] - a[1])).map(([type, cnt]) => (
                  <div key={type} className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${type === '서술형' ? 'bg-amber-900/20 border-amber-700/50' : 'bg-zinc-800/60 border-zinc-700/50'}`}>
                    <span className={`text-xs flex-1 truncate ${type === '서술형' ? 'text-amber-200' : 'text-zinc-300'}`}>{type}</span>
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
              <input
                type="number"
                min={subjIncludedCount + 1}
                max={100 + subjIncludedCount}
                value={schoolTotalCount}
                onChange={(e) => setSchoolCount(Math.max(1, Math.min(100, Number(e.target.value) - subjIncludedCount)))}
                className="w-20 px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none"
              />
              {subjIncludedCount > 0 && (
                <p className="text-[10px] text-zinc-500 mt-1">객관식 {schoolCount} + 서술형 {subjIncludedCount}</p>
              )}
            </div>
            {patternExam && (
              <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer mt-4" title="기출 시험지의 문항(지문·유형) 순서 그대로 배치">
                <input type="checkbox" checked={followOrder} onChange={(e) => setFollowOrder(e.target.checked)} className="rounded accent-emerald-500" />
                기출 순서 따르기 <span className="text-zinc-600 text-xs">(지문·유형)</span>
              </label>
            )}
            <label className={`flex items-center gap-2 text-sm cursor-pointer mt-4 ${followOrder && patternExam ? 'text-zinc-600 line-through' : 'text-zinc-400'}`}>
              <input type="checkbox" checked={schoolRandom} disabled={followOrder && !!patternExam} onChange={(e) => setSchoolRandom(e.target.checked)} className="rounded disabled:opacity-40" />
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
                  {mode === 'school' && includeSubjective && subjectiveItems.length > 0 && (
                    <span className="text-[10px] text-amber-300/90 px-1.5 py-0.5 rounded bg-amber-900/20 border border-amber-700/40">+ 서술형 {subjectiveItems.length}문항 (배점 100점 분배)</span>
                  )}
                  {Object.keys(resultTypeCounts).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(resultTypeCounts).filter(([type]) => type !== '서술형').sort((a, b) => b[1] - a[1]).map(([type, cnt]) => (
                        <span key={type} className="px-1.5 py-0.5 bg-violet-500/20 text-violet-300 text-[10px] rounded">{type} {cnt}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none" title="표지에 QR 을 넣어 저장 — 학생이 본인 전화번호로 자가채점, 「QR 자가채점 결과」에서 확인">
                    <input type="checkbox" checked={includeQr} onChange={(e) => setIncludeQr(e.target.checked)} className="rounded accent-indigo-500" />
                    <span className="text-indigo-300/90">QR 채점 포함</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none" title={includeQr ? 'QR 은 표지에 표시되므로 표지가 포함됩니다' : '첫 페이지에 출처·유형 분포 표지 추가'}>
                    <input type="checkbox" checked={includeCover || includeQr} disabled={includeQr} onChange={(e) => setIncludeCover(e.target.checked)} className="rounded accent-emerald-500 disabled:opacity-50" />
                    표지 포함
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer mr-1 select-none" title="마지막에 정답 답안지 페이지 추가">
                    <input type="checkbox" checked={includeAnswerSheet} onChange={(e) => setIncludeAnswerSheet(e.target.checked)} className="rounded accent-emerald-500" />
                    답안지 포함
                  </label>
                  <button onClick={() => includeQr ? handleQrExam(activeSet) : handleDownload('pdf', activeSet)} disabled={qrLoading !== null || downloading !== null || currentSet.selected.size === 0}
                    title={includeQr ? '학생 자가채점 QR 이 표지에 포함됩니다' : undefined}
                    className="px-4 py-2 bg-rose-600/80 text-zinc-100 text-sm rounded-xl hover:bg-rose-500 transition-colors disabled:opacity-40">
                    {(includeQr ? qrLoading === activeSet : downloading === activeSet) ? '생성 중…' : (includeQr ? 'PDF (QR 채점)' : 'PDF')}
                  </button>
                  <button onClick={() => handleDownload('docx', activeSet)} disabled={qrLoading !== null || downloading !== null || currentSet.selected.size === 0}
                    className="px-4 py-2 bg-blue-600/80 text-zinc-100 text-sm rounded-xl hover:bg-blue-500 transition-colors disabled:opacity-40">
                    DOCX
                  </button>
                  {examSets.length > 1 && (
                    <button onClick={async () => {
                      for (let i = 0; i < examSets.length; i++) {
                        setActiveSet(i);
                        if (includeQr) await handleQrExam(i); else await handleDownload('pdf', i);
                      }
                    }} disabled={qrLoading !== null || downloading !== null}
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

              {/* 서술형 섹션 (기출 그대로 · 항상 시험지에 포함 · 선택 불필요) */}
              {mode === 'school' && includeSubjective && subjectiveItems.length > 0 && (
                <div className="mt-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-amber-300">서술형 {subjectiveItems.length}문항</span>
                    <span className="text-[10px] text-zinc-500">기출 그대로 포함 · 항상 시험지에 출제됩니다 (선택 불필요)</span>
                  </div>
                  <div className="space-y-3">
                    {subjectiveItems.map((sj, i) => (
                      <div key={i} className="rounded-2xl border border-amber-700/40 bg-amber-900/10 overflow-hidden">
                        <div className="p-4">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className="text-xs font-mono text-amber-500/70">서술 #{i + 1}</span>
                            <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 text-[10px] rounded">서술형</span>
                            {sj.textbook && <span className="text-[10px] text-zinc-600 truncate max-w-[200px]">{sj.textbook}</span>}
                            {sj.source && <span className="text-[10px] text-zinc-700 truncate">{sj.source}</span>}
                          </div>
                          {sj.question && <p className="text-sm text-amber-100/90 leading-relaxed mb-1">{sj.question}</p>}
                          {sj.paragraph && <p className="text-sm text-zinc-400 leading-relaxed line-clamp-3" dangerouslySetInnerHTML={{ __html: sj.paragraph }} />}
                        </div>
                      </div>
                    ))}
                  </div>
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
