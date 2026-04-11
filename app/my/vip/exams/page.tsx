'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface School { id: string; name: string }
interface ExamQuestion {
  source?: string; textbook?: string; questionType?: string;
  questionText?: string;   // 출처/내용 표시용 (문제제목에서 자동)
  questionTitle?: string;  // 문제제목 (발문)
  questionBody?: string;   // 문제본문 (지문)
  choices?: string;        // 선택지 (\n 구분)
  summary?: string;        // 요약문 (요약 유형)
  score: number; isSubjective: boolean;
}
interface SchoolExam {
  id: string; schoolId: string; academicYear: number; grade: number;
  examType: string; questions: Record<string, ExamQuestion>;
  objectiveCount: number; subjectiveCount: number;
  examScope: string[]; isLocked: boolean;
  pdfPath?: string | null; pdfName?: string | null;
}
interface TextbookEntry { textbook: string }

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const EXAM_TYPES = ['1학기 중간고사', '1학기 기말고사', '2학기 중간고사', '2학기 기말고사'];

const OBJECTIVE_TYPES = ['주제', '제목', '요지', '빈칸', '순서', '삽입', '연결사', '지칭추론', '어법', '어휘', '요약', '내용일치', '내용불일치', '심경', '함의', '글의목적', '장문', '기타'];
const SUBJECTIVE_TYPES = ['서술형', '영작', '요약서술', '기타'];

// 엑셀 문제유형 → 시스템 유형 매핑
const EXCEL_TYPE_MAP: Record<string, string> = {
  요지: '요지', 주제: '주제', 제목: '제목', 일치: '내용일치', 불일치: '내용불일치',
  문장삽입: '삽입', 삽입: '삽입', 순서: '순서', 어법: '어법', 어휘: '어휘',
  빈칸: '빈칸', 연결사: '연결사', 지칭추론: '지칭추론', 심경: '심경',
  함의: '함의', 글의의미: '함의', 요약: '요약', 글의목적: '글의목적', 장문: '장문',
  서술형: '서술형', 영작: '영작', 요약서술: '요약서술',
};
const SUBJECTIVE_TYPE_SET = new Set(['서술형', '영작', '요약서술']);

type ExcelQuestion = { num: number; questionType: string; score: number; isSubjective: boolean };

async function parseExamExcel(file: File): Promise<ExcelQuestion[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);
  return rows.map((row) => {
    const num = Number(row['문제번호'] ?? row['번호'] ?? 0);
    const rawType = String(row['문제유형'] ?? row['유형'] ?? '').trim();
    const mappedType = EXCEL_TYPE_MAP[rawType] ?? (rawType || '기타');
    const score = Number(row['문제점수'] ?? row['점수'] ?? 0);
    return { num, questionType: mappedType, score, isSubjective: SUBJECTIVE_TYPE_SET.has(mappedType) };
  }).filter((q) => q.num > 0);
}

export default function VipExamsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [exams, setExams] = useState<SchoolExam[]>([]);
  const [textbooks, setTextbooks] = useState<TextbookEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const [filterYear, setFilterYear] = useState(CURRENT_YEAR);
  const [filterGrade, setFilterGrade] = useState<number>(1);

  const [expandedExam, setExpandedExam] = useState<string | null>(null);
  const [localExams, setLocalExams] = useState<Record<string, SchoolExam>>({});

  // 문항 유형 입력 모드: 'dropdown' | 'text'
  const [qtMode, setQtMode] = useState<Record<string, 'dropdown' | 'text'>>({});
  // PDF 업로드 진행 중
  const [uploadingPdf, setUploadingPdf] = useState<Record<string, boolean>>({});
  // AI 분석 진행 중
  const [analyzingPdf, setAnalyzingPdf] = useState<Record<string, boolean>>({});
  // AI 분석 결과 미리보기 (examId → 결과)
  const [analysisPreview, setAnalysisPreview] = useState<Record<string, {
    objectiveCount: number;
    subjectiveCount: number;
    questions: Record<string, { questionType: string; score: number; questionText: string }>;
  } | null>>({});
  // 엑셀 가져오기 미리보기
  const [xlsxPreview, setXlsxPreview] = useState<Record<string, ExcelQuestion[] | null>>({});

  // 지문 입력 모달
  const [textModal, setTextModal] = useState<{
    examId: string; qNum: string;
    title: string;    // 문제제목
    body: string;     // 문제본문
    choices: string;  // 선택지 (\n 구분)
    summary: string;  // 요약문
    showSummary: boolean;
    bodySelection: string;  // 문제본문에서 드래그한 선택 영역
    matching: boolean;
    matchResult: { textbook: string; sourceKey: string; similarity: number } | null;
    noMatch: boolean;
  } | null>(null);
  const pdfInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const xlsxInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [toast, setToast] = useState('');
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2500); };

  useEffect(() => {
    fetch('/api/my/vip/schools', { credentials: 'include' })
      .then((r) => r.json()).then((d) => { if (d.ok) setSchools(d.schools); });
  }, []);

  useEffect(() => {
    fetch('/api/textbooks').then((r) => r.json()).then((data) => {
      const keys = typeof data === 'object' && !Array.isArray(data) ? Object.keys(data) : [];
      setTextbooks(keys.map((k) => ({ textbook: k })));
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

  useEffect(() => { loadExams(); }, [loadExams]);

  const textbookNames = useMemo(() => textbooks.map((t) => t.textbook), [textbooks]);

  const handleAddExam = async (examType: string) => {
    if (!selectedSchool) return;
    const res = await fetch('/api/my/vip/school-exams', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schoolId: selectedSchool.id, academicYear: filterYear, grade: filterGrade, examType }),
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

  const handlePdfUpload = async (examId: string, file: File) => {
    if (file.type !== 'application/pdf') { alert('PDF 파일만 업로드 가능합니다.'); return; }
    if (file.size > 20 * 1024 * 1024) { alert('파일 크기는 20MB 이하여야 합니다.'); return; }
    setUploadingPdf((prev) => ({ ...prev, [examId]: true }));
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/my/vip/school-exams/${examId}/upload-pdf`, {
        method: 'POST', credentials: 'include', body: fd,
      });
      const d = await res.json();
      if (d.ok) {
        setLocalExams((prev) => ({
          ...prev,
          [examId]: { ...(prev[examId] || exams.find((e) => e.id === examId)!), pdfPath: d.pdfPath, pdfName: d.pdfName },
        }));
        showToast('시험지 PDF가 업로드되었습니다.');
      } else {
        alert(d.error || 'PDF 업로드 실패');
      }
    } catch {
      alert('업로드 중 오류가 발생했습니다.');
    } finally {
      setUploadingPdf((prev) => ({ ...prev, [examId]: false }));
    }
  };

  const handleAnalyzePdf = async (examId: string) => {
    setAnalyzingPdf((prev) => ({ ...prev, [examId]: true }));
    setAnalysisPreview((prev) => ({ ...prev, [examId]: null }));
    try {
      const res = await fetch(`/api/my/vip/school-exams/${examId}/analyze-pdf`, {
        method: 'POST', credentials: 'include',
      });
      const d = await res.json();
      if (d.ok && d.analysis) {
        setAnalysisPreview((prev) => ({ ...prev, [examId]: d.analysis }));
      } else {
        alert(d.error || 'AI 분석 실패');
      }
    } catch {
      alert('AI 분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzingPdf((prev) => ({ ...prev, [examId]: false }));
    }
  };

  const applyAnalysis = async (examId: string) => {
    const preview = analysisPreview[examId];
    if (!preview) return;
    const exam = localExams[examId] || exams.find((e) => e.id === examId);
    if (!exam) return;
    const newQuestions: Record<string, ExamQuestion> = {};
    Object.entries(preview.questions).forEach(([num, q]) => {
      const isSubjective = parseInt(num) > preview.objectiveCount;
      newQuestions[num] = {
        questionType: q.questionType,
        score: q.score,
        isSubjective,
        textbook: exam.questions[num]?.textbook || '',
        questionText: q.questionText,
      };
    });
    const updated = {
      ...(localExams[examId] || exam),
      totalQuestions: preview.objectiveCount + preview.subjectiveCount,
      objectiveCount: preview.objectiveCount,
      subjectiveCount: preview.subjectiveCount,
      questions: newQuestions,
    };
    setLocalExams((prev) => ({ ...prev, [examId]: updated }));
    setAnalysisPreview((prev) => ({ ...prev, [examId]: null }));

    // 바로 MongoDB에 저장
    try {
      const res = await fetch(`/api/my/vip/school-exams/${examId}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: newQuestions,
          objectiveCount: preview.objectiveCount,
          subjectiveCount: preview.subjectiveCount,
          examScope: updated.examScope,
          isLocked: updated.isLocked,
        }),
      });
      const d = await res.json();
      if (d.ok) {
        showToast('AI 분석 결과가 저장되었습니다.');
        await loadExams();
      } else {
        showToast('적용됨 (저장 실패: ' + (d.error || '알 수 없는 오류') + ')');
      }
    } catch {
      showToast('적용됨 (저장 중 오류 발생)');
    }
  };

  const handleXlsxSelect = async (examId: string, file: File) => {
    try {
      const questions = await parseExamExcel(file);
      if (questions.length === 0) { alert('문항 데이터를 찾을 수 없습니다. 열 이름을 확인해주세요 (문제번호, 문제유형, 문제점수).'); return; }
      setXlsxPreview((prev) => ({ ...prev, [examId]: questions }));
    } catch {
      alert('엑셀 파일 파싱 중 오류가 발생했습니다.');
    }
  };

  const applyXlsx = async (examId: string) => {
    const questions = xlsxPreview[examId];
    if (!questions) return;
    const exam = localExams[examId] || exams.find((e) => e.id === examId);
    if (!exam) return;
    const objCount = questions.filter((q) => !q.isSubjective).length;
    const subCount = questions.filter((q) => q.isSubjective).length;
    const newQuestions: Record<string, ExamQuestion> = {};
    questions.forEach((q) => {
      newQuestions[String(q.num)] = {
        questionType: q.questionType,
        score: q.score,
        isSubjective: q.isSubjective,
        textbook: exam.questions[String(q.num)]?.textbook || '',
        questionText: '',
      };
    });
    const updated = { ...(localExams[examId] || exam), objectiveCount: objCount, subjectiveCount: subCount, questions: newQuestions };
    setLocalExams((prev) => ({ ...prev, [examId]: updated }));
    setXlsxPreview((prev) => ({ ...prev, [examId]: null }));
    try {
      const res = await fetch(`/api/my/vip/school-exams/${examId}`, {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: newQuestions, objectiveCount: objCount, subjectiveCount: subCount, examScope: updated.examScope, isLocked: updated.isLocked }),
      });
      const d = await res.json();
      if (d.ok) { showToast('엑셀 문항 정보가 저장되었습니다.'); await loadExams(); }
      else showToast('적용됨 (저장 실패: ' + (d.error || '알 수 없는 오류') + ')');
    } catch { showToast('적용됨 (저장 중 오류 발생)'); }
  };

  const openTextModal = (examId: string, qNum: string) => {
    const exam = localExams[examId] || exams.find((e) => e.id === examId);
    const q = exam?.questions[qNum];
    const isYoyak = (q?.questionType || '').includes('요약');
    setTextModal({
      examId, qNum,
      title: q?.questionTitle || '',
      body: q?.questionBody || '',
      choices: q?.choices || '',
      summary: q?.summary || '',
      showSummary: isYoyak || !!(q?.summary),
      bodySelection: '',
      matching: false, matchResult: null, noMatch: false,
    });
  };

  const handleMatchPassage = async () => {
    if (!textModal || textModal.body.trim().length < 15) return;
    setTextModal((prev) => prev && ({ ...prev, matching: true, matchResult: null, noMatch: false }));
    try {
      const res = await fetch('/api/my/vip/passages/match', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textModal.body }),
      });
      const d = await res.json();
      if (d.match) {
        setTextModal((prev) => prev && ({ ...prev, matching: false, matchResult: d.match }));
      } else {
        setTextModal((prev) => prev && ({ ...prev, matching: false, noMatch: true }));
      }
    } catch {
      setTextModal((prev) => prev && ({ ...prev, matching: false, noMatch: true }));
    }
  };

  const applyTextModal = (applyMatch: boolean) => {
    if (!textModal) return;
    const { examId, qNum, title, body, choices, summary, matchResult } = textModal;
    const patch: Partial<ExamQuestion> = {
      questionTitle: title,
      questionBody: body,
      choices,
      summary,
      questionText: title || body.slice(0, 60) || '',
    };
    if (applyMatch && matchResult) {
      patch.textbook = matchResult.textbook;
      patch.source = matchResult.sourceKey;
    }
    updateQuestion(examId, qNum, patch);
    setTextModal(null);
  };

  const updateLocal = (id: string, patch: Partial<SchoolExam>) => {
    setLocalExams((prev) => ({ ...prev, [id]: { ...(prev[id] || exams.find((e) => e.id === id)!), ...patch } }));
  };

  const updateQuestion = (examId: string, qNum: string, patch: Partial<ExamQuestion>) => {
    setLocalExams((prev) => {
      const exam = prev[examId] || exams.find((e) => e.id === examId)!;
      const q = exam.questions[qNum] || { score: 0, isSubjective: false };
      return { ...prev, [examId]: { ...exam, questions: { ...exam.questions, [qNum]: { ...q, ...patch } } } };
    });
  };

  const stepCount = (examId: string, field: 'objectiveCount' | 'subjectiveCount', delta: number) => {
    const local = localExams[examId] || exams.find((e) => e.id === examId)!;
    const next = Math.max(0, (local[field] ?? 0) + delta);
    updateLocal(examId, { [field]: next });
  };

  const getLocal = (id: string) => localExams[id] || exams.find((e) => e.id === id)!;
  const existingTypes = new Set(exams.map((e) => e.examType));

  const calcScores = (exam: SchoolExam) => {
    const qs = Object.entries(exam.questions);
    const totalScore = qs.reduce((s, [, q]) => s + (q.score || 0), 0);
    const objScore = qs
      .filter(([k]) => Number(k) <= exam.objectiveCount)
      .reduce((s, [, q]) => s + (q.score || 0), 0);
    const subScore = qs
      .filter(([k]) => Number(k) > exam.objectiveCount)
      .reduce((s, [, q]) => s + (q.score || 0), 0);
    return { totalScore, objScore, subScore };
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">시험 관리</h1>
        <p className="text-sm text-zinc-500 mt-0.5">기출 시험을 등록하고 문항 정보를 입력합니다</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={selectedSchool?.id || ''}
          onChange={(e) => setSelectedSchool(schools.find((s) => s.id === e.target.value) || null)}
          className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 [&>option]:bg-zinc-900 [&>option]:text-zinc-100"
        >
          <option value="">학교 선택</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select
          value={filterYear}
          onChange={(e) => setFilterYear(Number(e.target.value))}
          className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 [&>option]:bg-zinc-900 [&>option]:text-zinc-100"
        >
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
        <div className="space-y-4">
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
              const { totalScore, objScore, subScore } = calcScores(local);
              const isTextMode = qtMode[exam.id] === 'text';
              const isPdfUploading = !!uploadingPdf[exam.id];
              const isPdfAnalyzing = !!analyzingPdf[exam.id];
              const preview = analysisPreview[exam.id];

              return (
                <div key={exam.id} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden">
                  {/* Exam header */}
                  <div className="flex items-center justify-between px-5 py-3.5">
                    {/* Left: toggle + title */}
                    <button
                      className="flex items-center gap-3 flex-1 text-left"
                      onClick={() => setExpandedExam(isOpen ? null : exam.id)}
                    >
                      <svg className={`w-4 h-4 text-zinc-500 transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                      <span className="text-sm font-medium text-zinc-100">{exam.examType}</span>
                      {local.isLocked && <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 text-[10px] rounded">확정</span>}
                    </button>

                    {/* Right: info + PDF + delete */}
                    <div className="flex items-center gap-3 text-xs text-zinc-500 shrink-0">
                      <span>객관 {local.objectiveCount} / 주관 {local.subjectiveCount}</span>
                      {totalScore > 0 && <span className="text-zinc-400">총 <strong className="text-zinc-200">{totalScore}점</strong></span>}

                      {/* PDF 상태 */}
                      {local.pdfPath ? (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const res = await fetch(`/api/my/vip/school-exams/${exam.id}/pdf-link`, { credentials: 'include' });
                              const d = await res.json();
                              if (d.ok && d.url) window.open(d.url, '_blank');
                              else alert(d.error || '링크 생성 실패');
                            } catch { alert('링크를 가져올 수 없습니다.'); }
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-500/20 text-blue-300 rounded-lg hover:bg-blue-500/30 transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                          </svg>
                          시험지
                        </button>
                      ) : (
                        <>
                          <input
                            type="file"
                            accept="application/pdf"
                            className="hidden"
                            ref={(el) => { pdfInputRefs.current[exam.id] = el; }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handlePdfUpload(exam.id, file);
                              e.target.value = '';
                            }}
                          />
                          <button
                            disabled={isPdfUploading}
                            onClick={(e) => { e.stopPropagation(); pdfInputRefs.current[exam.id]?.click(); }}
                            className="flex items-center gap-1 px-2.5 py-1.5 bg-zinc-800 text-zinc-400 rounded-lg hover:bg-zinc-700 hover:text-zinc-200 transition-colors disabled:opacity-50"
                          >
                            {isPdfUploading ? (
                              <div className="w-3.5 h-3.5 border border-zinc-400 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                              </svg>
                            )}
                            시험지 업로드
                          </button>
                        </>
                      )}

                      <button onClick={() => handleDeleteExam(exam)} className="p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="px-5 pb-5 border-t border-zinc-800/80 pt-4 space-y-4">
                      {/* PDF re-upload + AI 분석 */}
                      {local.pdfPath && (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs text-zinc-500">
                            <svg className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                            </svg>
                            <span className="truncate max-w-[180px]">{local.pdfName}</span>
                            <button
                              onClick={() => pdfInputRefs.current[exam.id]?.click()}
                              className="text-zinc-500 hover:text-zinc-300 underline shrink-0"
                            >
                              재업로드
                            </button>
                            <button
                              disabled={isPdfAnalyzing}
                              onClick={() => handleAnalyzePdf(exam.id)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-violet-500/20 text-violet-300 rounded-lg hover:bg-violet-500/30 transition-colors disabled:opacity-50 text-[11px] shrink-0"
                            >
                              {isPdfAnalyzing ? (
                                <>
                                  <div className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin" />
                                  AI 분석 중…
                                </>
                              ) : (
                                <>
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                                  </svg>
                                  AI 자동 분석
                                </>
                              )}
                            </button>
                          </div>

                          {/* AI 분석 결과 미리보기 */}
                          {/* 엑셀 가져오기 버튼 */}
                          <input
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            className="hidden"
                            ref={(el) => { xlsxInputRefs.current[exam.id] = el; }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleXlsxSelect(exam.id, file);
                              e.target.value = '';
                            }}
                          />
                          <button
                            onClick={() => xlsxInputRefs.current[exam.id]?.click()}
                            className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/20 text-emerald-300 rounded-lg hover:bg-emerald-500/30 transition-colors text-[11px] shrink-0"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                            </svg>
                            엑셀 가져오기
                          </button>

                          {/* 엑셀 미리보기 */}
                          {xlsxPreview[exam.id] && (
                            <div className="mt-2 rounded-xl bg-emerald-950/30 border border-emerald-800/50 p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V19.5a2.25 2.25 0 002.25 2.25h.75" />
                                  </svg>
                                  <span className="text-xs font-medium text-emerald-300">엑셀 가져오기 미리보기</span>
                                  <span className="text-[10px] text-zinc-500">
                                    객관 {xlsxPreview[exam.id]!.filter(q => !q.isSubjective).length}문 / 주관 {xlsxPreview[exam.id]!.filter(q => q.isSubjective).length}문
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button onClick={() => setXlsxPreview((prev) => ({ ...prev, [exam.id]: null }))} className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">닫기</button>
                                  <button onClick={() => applyXlsx(exam.id)} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] rounded-lg transition-colors">적용하기</button>
                                </div>
                              </div>
                              <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                                {xlsxPreview[exam.id]!.map((q) => (
                                  <div key={q.num} className="flex items-center gap-2 text-[11px]">
                                    <span className="w-6 text-right text-zinc-500 shrink-0">{q.num}</span>
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${q.isSubjective ? 'bg-amber-500/20 text-amber-300' : 'bg-blue-500/20 text-blue-300'}`}>
                                      {q.isSubjective ? '주관' : '객관'}
                                    </span>
                                    <span className="text-zinc-300 truncate">{q.questionType}</span>
                                    {q.score > 0 && <span className="text-zinc-500 shrink-0">{q.score}점</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {preview && (
                            <div className="rounded-xl bg-violet-950/30 border border-violet-800/50 p-4 space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <svg className="w-4 h-4 text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                                  </svg>
                                  <span className="text-xs font-medium text-violet-300">AI 분석 결과</span>
                                  <span className="text-[10px] text-zinc-500">객관 {preview.objectiveCount}문 / 주관 {preview.subjectiveCount}문</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => setAnalysisPreview((prev) => ({ ...prev, [exam.id]: null }))}
                                    className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                                  >
                                    닫기
                                  </button>
                                  <button
                                    onClick={() => applyAnalysis(exam.id)}
                                    className="px-3 py-1 bg-violet-600 hover:bg-violet-500 text-white text-[11px] rounded-lg transition-colors"
                                  >
                                    적용하기
                                  </button>
                                </div>
                              </div>
                              <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                                {Object.entries(preview.questions).map(([num, q]) => {
                                  const isSubj = parseInt(num) > preview.objectiveCount;
                                  return (
                                    <div key={num} className="flex items-center gap-2 text-[11px]">
                                      <span className="w-6 text-right text-zinc-500 shrink-0">{num}</span>
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${isSubj ? 'bg-amber-500/20 text-amber-300' : 'bg-blue-500/20 text-blue-300'}`}>
                                        {isSubj ? '주관' : '객관'}
                                      </span>
                                      <span className="text-zinc-300 truncate">{q.questionType}</span>
                                      {q.score > 0 && <span className="text-zinc-500 shrink-0">{q.score}점</span>}
                                      {q.questionText && <span className="text-zinc-600 truncate hidden sm:block">{q.questionText}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Question count + mode + lock */}
                      <div className="flex items-center gap-4 flex-wrap">
                        {/* 객관식 stepper */}
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-zinc-500">객관식</label>
                          <div className="flex items-center">
                            <button
                              onClick={() => !local.isLocked && stepCount(exam.id, 'objectiveCount', -1)}
                              disabled={local.isLocked}
                              className="w-7 h-7 rounded-l-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 text-base leading-none flex items-center justify-center"
                            >−</button>
                            <span className="w-10 text-center text-sm text-zinc-100 font-semibold bg-zinc-900/60 border-y border-zinc-700 h-7 flex items-center justify-center">{local.objectiveCount}</span>
                            <button
                              onClick={() => !local.isLocked && stepCount(exam.id, 'objectiveCount', 1)}
                              disabled={local.isLocked}
                              className="w-7 h-7 rounded-r-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 text-base leading-none flex items-center justify-center"
                            >+</button>
                          </div>
                        </div>

                        {/* 주관식 stepper */}
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-zinc-500">주관식</label>
                          <div className="flex items-center">
                            <button
                              onClick={() => !local.isLocked && stepCount(exam.id, 'subjectiveCount', -1)}
                              disabled={local.isLocked}
                              className="w-7 h-7 rounded-l-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 text-base leading-none flex items-center justify-center"
                            >−</button>
                            <span className="w-10 text-center text-sm text-zinc-100 font-semibold bg-zinc-900/60 border-y border-zinc-700 h-7 flex items-center justify-center">{local.subjectiveCount}</span>
                            <button
                              onClick={() => !local.isLocked && stepCount(exam.id, 'subjectiveCount', 1)}
                              disabled={local.isLocked}
                              className="w-7 h-7 rounded-r-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 text-base leading-none flex items-center justify-center"
                            >+</button>
                          </div>
                        </div>

                        <span className="text-xs text-zinc-500 ml-auto">총 {totalQ}문항</span>

                        {/* 유형 입력 모드 토글 */}
                        <button
                          onClick={() => setQtMode((prev) => ({ ...prev, [exam.id]: isTextMode ? 'dropdown' : 'text' }))}
                          className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${isTextMode ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                        >
                          {isTextMode ? '드롭다운으로' : '직접입력으로'}
                        </button>

                        {/* 확정 토글 */}
                        <button
                          onClick={() => updateLocal(exam.id, { isLocked: !local.isLocked })}
                          className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${local.isLocked ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'}`}
                        >
                          {local.isLocked ? '확정됨' : '확정'}
                        </button>
                      </div>

                      {/* Exam scope */}
                      {textbookNames.length > 0 && (
                        <div>
                          <label className="text-xs text-zinc-500 mb-1.5 block">시험 범위 (교재)</label>
                          <div className="flex flex-wrap gap-1.5">
                            {textbookNames.map((tb) => (
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
                                    : 'bg-zinc-900/60 border-zinc-800/80 text-zinc-500 hover:text-zinc-400'
                                }`}
                              >
                                {tb.length > 20 ? tb.slice(0, 20) + '…' : tb}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Question table */}
                      {totalQ > 0 && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-zinc-800/80 text-zinc-500">
                                <th className="text-left px-2 py-2 w-10">#</th>
                                <th className="text-left px-2 py-2 w-14">구분</th>
                                <th className="text-left px-2 py-2 w-32">유형</th>
                                <th className="text-left px-2 py-2 w-36">교재</th>
                                <th className="text-left px-2 py-2">출처/내용</th>
                                <th className="text-center px-2 py-2 w-14">배점</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Array.from({ length: totalQ }, (_, i) => {
                                const qNum = String(i + 1);
                                const isSubjective = i + 1 > local.objectiveCount;
                                const q = local.questions[qNum] || { score: 0, isSubjective };
                                const types = isSubjective ? SUBJECTIVE_TYPES : OBJECTIVE_TYPES;
                                return (
                                  <tr
                                    key={qNum}
                                    className={`border-b border-zinc-800/50 hover:bg-zinc-800/20 ${i + 1 === local.objectiveCount + 1 && local.subjectiveCount > 0 ? 'border-t-2 border-t-amber-500/30' : ''}`}
                                  >
                                    <td className="px-2 py-1.5">
                                      <button
                                        onClick={() => openTextModal(exam.id, qNum)}
                                        title="클릭하여 지문 입력 및 출처 검색"
                                        className={`font-mono text-sm w-full text-left hover:text-cyan-300 transition-colors ${q.questionText ? 'text-cyan-400' : 'text-zinc-500'}`}
                                      >
                                        {qNum}
                                      </button>
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${isSubjective ? 'bg-amber-500/20 text-amber-300' : 'bg-cyan-500/20 text-cyan-300'}`}>
                                        {isSubjective ? '주관' : '객관'}
                                      </span>
                                    </td>
                                    <td className="px-2 py-1.5">
                                      {isTextMode ? (
                                        <input
                                          type="text"
                                          value={q.questionType || ''}
                                          onChange={(e) => updateQuestion(exam.id, qNum, { questionType: e.target.value })}
                                          placeholder="유형"
                                          className="w-full px-2 py-1 rounded bg-zinc-900/60 border border-zinc-800/80 text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-zinc-600 text-[11px]"
                                        />
                                      ) : (
                                        <select
                                          value={q.questionType || ''}
                                          onChange={(e) => updateQuestion(exam.id, qNum, { questionType: e.target.value })}
                                          className="w-full px-2 py-1 rounded bg-zinc-900/60 border border-zinc-800/80 text-zinc-100 focus:outline-none focus:border-zinc-600 text-[11px] [&>option]:bg-zinc-900 [&>option]:text-zinc-100"
                                        >
                                          <option value="">선택</option>
                                          {types.map((t) => <option key={t} value={t}>{t}</option>)}
                                        </select>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <select
                                        value={q.textbook || ''}
                                        onChange={(e) => updateQuestion(exam.id, qNum, { textbook: e.target.value })}
                                        className="w-full px-2 py-1 rounded bg-zinc-900/60 border border-zinc-800/80 text-zinc-100 focus:outline-none focus:border-zinc-600 text-[11px] [&>option]:bg-zinc-900 [&>option]:text-zinc-100"
                                      >
                                        <option value="">—</option>
                                        {textbookNames.map((tb) => <option key={tb} value={tb}>{tb.length > 22 ? tb.slice(0, 22) + '…' : tb}</option>)}
                                      </select>
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <input
                                        type="text"
                                        value={q.questionText || ''}
                                        onChange={(e) => updateQuestion(exam.id, qNum, { questionText: e.target.value })}
                                        placeholder="출처/내용"
                                        className="w-full px-2 py-1 rounded bg-zinc-900/60 border border-zinc-800/80 text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-zinc-600 text-[11px]"
                                      />
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                      <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step={0.5}
                                        value={q.score || ''}
                                        onChange={(e) => updateQuestion(exam.id, qNum, { score: parseFloat(e.target.value) || 0 })}
                                        className="w-12 px-1 py-1 rounded bg-zinc-900/60 border border-zinc-800/80 text-zinc-100 text-center focus:outline-none focus:border-zinc-600 text-[11px]"
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>

                          {/* Score summary */}
                          {totalScore > 0 && (
                            <div className="mt-3 pt-3 border-t border-zinc-800/80 flex items-center gap-6 text-xs">
                              <span className="text-zinc-500">총점 <strong className="text-zinc-100">{totalScore}점</strong></span>
                              <span className="text-zinc-500">객관식 <strong className="text-cyan-300">{objScore}점</strong></span>
                              <span className="text-zinc-500">주관식 <strong className="text-amber-300">{subScore}점</strong></span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Save */}
                      <div className="flex gap-2 pt-2">
                        <button onClick={() => handleSaveExam(exam)} className="px-4 py-2 bg-zinc-100 text-zinc-900 text-sm rounded-xl hover:bg-zinc-200 transition-colors font-medium">저장</button>
                      </div>
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

      {/* 지문 입력 모달 — 3컬럼 */}
      {textModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onKeyDown={(e) => { if (e.key === 'Escape') setTextModal(null); }}
        >
          <div className="w-full max-w-5xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl flex flex-col"
            style={{ maxHeight: 'calc(100vh - 2rem)' }}>

            {/* 헤더 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
              <div className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-lg bg-cyan-500/20 text-cyan-300 text-sm font-mono flex items-center justify-center">{textModal.qNum}</span>
                <span className="text-sm font-medium text-zinc-100">문항 세부 정보</span>
                {textModal.matchResult && (
                  <span className="flex items-center gap-1 text-[11px] text-cyan-400">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    출처 찾음 ({textModal.matchResult.similarity}%)
                    <span className="text-zinc-500 ml-1">{textModal.matchResult.textbook} · {textModal.matchResult.sourceKey}</span>
                  </span>
                )}
                {textModal.noMatch && <span className="text-[11px] text-zinc-600">일치 지문 없음</span>}
              </div>
              <button onClick={() => setTextModal(null)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* 3컬럼 본문 */}
            <div className="flex-1 overflow-hidden flex min-h-0">

              {/* Col 1: 문제제목 */}
              <div className="flex flex-col w-56 shrink-0 border-r border-zinc-800 p-3 gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">문제제목</span>
                  {textModal.bodySelection && !/[①②③④⑤]/.test(textModal.bodySelection) && (
                    <button
                      onClick={() => setTextModal((prev) => {
                        if (!prev) return prev;
                        const sel = prev.bodySelection;
                        const idx = prev.body.indexOf(sel);
                        const newBody = idx >= 0
                          ? (prev.body.slice(0, idx) + prev.body.slice(idx + sel.length))
                              .replace(/\n{3,}/g, '\n\n').trim()
                          : prev.body;
                        return { ...prev, title: sel.trim(), body: newBody, bodySelection: '' };
                      })}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-500/25 text-indigo-300 hover:bg-indigo-500/40 transition-colors text-[10px] animate-pulse"
                      title="선택한 텍스트를 문제제목으로 가져오기"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                      </svg>
                      여기로
                    </button>
                  )}
                </div>
                <textarea
                  value={textModal.title}
                  onChange={(e) => setTextModal((prev) => prev && ({ ...prev, title: e.target.value }))}
                  placeholder={"다음 글의 요지로 가장 적절한 것은?"}
                  className="flex-1 w-full px-2.5 py-2 rounded-xl bg-zinc-900/80 border border-zinc-800 text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-zinc-600 text-xs resize-none leading-relaxed"
                />
              </div>

              {/* Col 2: 문제본문 + 요약문 */}
              <div className="flex flex-col flex-1 min-w-0 border-r border-zinc-800 p-3 gap-2 overflow-hidden">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">문제본문</span>
                  <button
                    disabled={textModal.matching || textModal.body.trim().length < 15}
                    onClick={handleMatchPassage}
                    className="flex items-center gap-1 px-2.5 py-1 bg-cyan-500/20 text-cyan-300 rounded-lg hover:bg-cyan-500/30 transition-colors disabled:opacity-40 text-[11px]"
                  >
                    {textModal.matching ? (
                      <><div className="w-3 h-3 border border-cyan-400 border-t-transparent rounded-full animate-spin" />검색 중…</>
                    ) : (
                      <><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg>출처 검색</>
                    )}
                  </button>
                </div>
                <textarea
                  autoFocus
                  value={textModal.body}
                  onChange={(e) => setTextModal((prev) => prev && ({ ...prev, body: e.target.value, matchResult: null, noMatch: false }))}
                  onSelect={(e) => {
                    const el = e.currentTarget;
                    const sel = el.value.substring(el.selectionStart, el.selectionEnd).trim();
                    setTextModal((prev) => prev && ({ ...prev, bodySelection: sel }));
                  }}
                  onMouseUp={(e) => {
                    const el = e.currentTarget;
                    const sel = el.value.substring(el.selectionStart, el.selectionEnd).trim();
                    setTextModal((prev) => prev && ({ ...prev, bodySelection: sel }));
                  }}
                  placeholder={"James felt happy when his friend Yena praised his dancing skills after seeing his social media post..."}
                  className="flex-1 w-full px-2.5 py-2 rounded-xl bg-zinc-900/80 border border-zinc-800 text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-zinc-600 text-xs resize-none leading-relaxed min-h-0"
                />

                {/* 요약문 토글 */}
                {textModal.showSummary ? (
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide">요약문</span>
                      <button
                        onClick={() => setTextModal((prev) => prev && ({ ...prev, showSummary: false, summary: '' }))}
                        className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors"
                      >✕ 제거</button>
                    </div>
                    <textarea
                      value={textModal.summary}
                      onChange={(e) => setTextModal((prev) => prev && ({ ...prev, summary: e.target.value }))}
                      placeholder="Promotion ________ with consumer psychology, keeping wealth ________ within a small number of families."
                      rows={3}
                      className="w-full px-2.5 py-2 rounded-xl bg-amber-950/30 border border-amber-800/50 text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-amber-700 text-xs resize-none leading-relaxed"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => setTextModal((prev) => prev && ({ ...prev, showSummary: true }))}
                    className="flex items-center gap-1.5 self-start px-2.5 py-1 rounded-lg border border-dashed border-zinc-700 text-zinc-600 hover:text-zinc-400 hover:border-zinc-500 transition-colors text-[11px] shrink-0"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    요약문 추가
                  </button>
                )}
              </div>

              {/* Col 3: 선택지 */}
              <div className="flex flex-col w-72 shrink-0 p-3 gap-2 overflow-y-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">선택지</span>
                    {/* 드래그 선택 시 동그라미 번호 감지 → 여기로 버튼 */}
                    {textModal.bodySelection && /[①②③④⑤]/.test(textModal.bodySelection) && (
                      <button
                        onClick={() => {
                          const raw = textModal.bodySelection;
                          const parts = raw
                            .split(/(?=[①②③④⑤])/)
                            .map((s) => s.replace(/^[①②③④⑤\s]+/, '').trim())
                            .filter(Boolean)
                            .slice(0, 5);
                          while (parts.length < 5) parts.push('');
                          setTextModal((prev) => {
                            if (!prev) return prev;
                            const idx = prev.body.indexOf(prev.bodySelection);
                            const newBody = idx >= 0
                              ? (prev.body.slice(0, idx) + prev.body.slice(idx + prev.bodySelection.length))
                                  .replace(/\n{3,}/g, '\n\n').trim()
                              : prev.body;
                            return { ...prev, choices: parts.join('\n'), body: newBody, bodySelection: '' };
                          });
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-500/25 text-indigo-300 hover:bg-indigo-500/40 transition-colors text-[10px] animate-pulse"
                        title="선택한 텍스트를 선택지로 분리"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                        </svg>
                        여기로
                      </button>
                    )}
                  </div>
                </div>

                {[1, 2, 3, 4, 5].map((n) => {
                  const lines = textModal.choices.split('\n');
                  const val = lines[n - 1] ?? '';
                  return (
                    <div key={n} className="flex items-start gap-1.5">
                      <span className="text-[11px] text-zinc-600 mt-2 shrink-0 w-4">{'①②③④⑤'[n - 1]}</span>
                      <textarea
                        value={val}
                        onChange={(e) => {
                          const lines = textModal.choices.split('\n');
                          while (lines.length < 5) lines.push('');
                          lines[n - 1] = e.target.value;
                          setTextModal((prev) => prev && ({ ...prev, choices: lines.join('\n') }));
                        }}
                        rows={2}
                        className="flex-1 px-2 py-1.5 rounded-lg bg-zinc-900/80 border border-zinc-800 text-zinc-100 placeholder-zinc-700 focus:outline-none focus:border-zinc-600 text-xs resize-none leading-relaxed"
                        placeholder={`선택지 ${n}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 푸터 */}
            <div className="flex items-center justify-between px-5 py-3.5 border-t border-zinc-800 shrink-0">
              <div className="text-[11px] text-zinc-600">Esc 닫기 · 번호를 클릭하면 언제든 다시 편집 가능</div>
              <div className="flex items-center gap-3">
                <button onClick={() => setTextModal(null)} className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 transition-colors">취소</button>
                {textModal.matchResult ? (
                  <>
                    <button onClick={() => applyTextModal(false)} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm rounded-xl transition-colors">
                      텍스트만 저장
                    </button>
                    <button onClick={() => applyTextModal(true)} className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded-xl transition-colors">
                      교재·출처도 적용
                    </button>
                  </>
                ) : (
                  <button onClick={() => applyTextModal(false)} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm rounded-xl transition-colors">
                    저장
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
