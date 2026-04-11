'use client';

import { useCallback, useEffect, useState } from 'react';

interface School { id: string; name: string }
interface QuestionAccuracy { question: number; accuracy: number; total: number }
interface StudentRanking { studentId: string; studentName: string; totalScore: number; objectiveScore: number; subjectiveScore: number }
interface ExamAnalysis {
  examId: string; examType: string; grade: number; academicYear: number;
  totalQuestions: number; totalMaxScore: number; studentCount: number;
  avgScore: number; maxScore: number; minScore: number;
  typeDistribution: Record<string, number>;
  textbookCoverage: Record<string, number>;
  perQuestionAccuracy: QuestionAccuracy[];
  rankings: StudentRanking[];
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);

export default function VipAnalysisPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [selectedSchool, setSelectedSchool] = useState('');
  const [filterYear, setFilterYear] = useState(CURRENT_YEAR);
  const [filterGrade, setFilterGrade] = useState<number | null>(null);
  const [analyses, setAnalyses] = useState<ExamAnalysis[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedExam, setSelectedExam] = useState<ExamAnalysis | null>(null);

  useEffect(() => {
    fetch('/api/my/vip/schools', { credentials: 'include' }).then((r) => r.json()).then((d) => { if (d.ok) setSchools(d.schools); });
  }, []);

  const loadAnalysis = useCallback(async () => {
    if (!selectedSchool) return;
    setLoading(true);
    const p = new URLSearchParams({ schoolId: selectedSchool, academicYear: String(filterYear) });
    if (filterGrade) p.set('grade', String(filterGrade));
    const res = await fetch(`/api/my/vip/analysis?${p}`, { credentials: 'include' });
    const d = await res.json();
    if (d.ok && d.analysis) setAnalyses(d.analysis);
    else setAnalyses([]);
    setLoading(false);
  }, [selectedSchool, filterYear, filterGrade]);

  useEffect(() => { loadAnalysis(); }, [loadAnalysis]);

  const barWidth = (val: number, max: number) => max > 0 ? `${Math.round((val / max) * 100)}%` : '0%';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">시험 분석</h1>
        <p className="text-sm text-zinc-500 mt-0.5">시험별 출제 유형, 배점, 학생 성적을 분석합니다</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select value={selectedSchool} onChange={(e) => { setSelectedSchool(e.target.value); setSelectedExam(null); }} className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 [&>option]:bg-zinc-900 [&>option]:text-zinc-100">
          <option value="">학교 선택</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))} className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 [&>option]:bg-zinc-900 [&>option]:text-zinc-100">
          {YEARS.map((y) => <option key={y} value={y}>{y}년</option>)}
        </select>
        <div className="flex rounded-xl overflow-hidden border border-zinc-800/80">
          <button onClick={() => setFilterGrade(null)} className={`px-3 py-2 text-sm ${!filterGrade ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'} transition-colors`}>전체</button>
          {[1, 2, 3].map((g) => (
            <button key={g} onClick={() => setFilterGrade(g)} className={`px-3 py-2 text-sm ${filterGrade === g ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'} transition-colors`}>{g}학년</button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center"><div className="w-6 h-6 mx-auto border-2 border-zinc-600 border-t-zinc-400 rounded-full animate-spin" /></div>
      ) : analyses.length === 0 ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">분석할 시험 데이터가 없습니다</div>
      ) : !selectedExam ? (
        /* Exam list */
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {analyses.map((a) => (
            <div key={a.examId} onClick={() => setSelectedExam(a)} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 hover:bg-zinc-800/40 hover:border-white/20 transition-all cursor-pointer group">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-zinc-100">{a.academicYear}년 {a.grade}학년 {a.examType}</span>
                <svg className="w-4 h-4 text-zinc-700 group-hover:text-zinc-500 transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-lg font-bold text-zinc-100">{a.studentCount}</div>
                  <div className="text-[10px] text-zinc-500">응시자</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-blue-400">{a.avgScore}</div>
                  <div className="text-[10px] text-zinc-500">평균점수</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-zinc-100">{a.totalQuestions}</div>
                  <div className="text-[10px] text-zinc-500">문항수</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Detailed analysis */
        <div className="space-y-6">
          <button onClick={() => setSelectedExam(null)} className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors">← 시험 목록으로</button>

          <div className="text-lg font-semibold text-zinc-100">{selectedExam.academicYear}년 {selectedExam.grade}학년 {selectedExam.examType}</div>

          {/* Score overview */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: '평균', value: selectedExam.avgScore, suffix: `/ ${selectedExam.totalMaxScore}`, color: 'text-blue-400' },
              { label: '최고점', value: selectedExam.maxScore, suffix: '', color: 'text-emerald-400' },
              { label: '최저점', value: selectedExam.minScore, suffix: '', color: 'text-rose-400' },
              { label: '응시자', value: selectedExam.studentCount, suffix: '명', color: 'text-zinc-100' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-zinc-900/60 border border-zinc-800/80 p-4 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}<span className="text-xs text-zinc-600 ml-1">{s.suffix}</span></div>
                <div className="text-[11px] text-zinc-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Type distribution */}
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5">
              <h3 className="text-sm font-medium text-zinc-300 mb-3">유형별 출제 비율</h3>
              {Object.keys(selectedExam.typeDistribution).length === 0 ? (
                <p className="text-xs text-zinc-600">유형 정보가 입력되지 않았습니다</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(selectedExam.typeDistribution).sort(([, a], [, b]) => b - a).map(([type, count]) => (
                    <div key={type}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-zinc-400">{type}</span>
                        <span className="text-zinc-500">{count}문항 ({Math.round((count / selectedExam.totalQuestions) * 100)}%)</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all" style={{ width: barWidth(count, selectedExam.totalQuestions) }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Textbook coverage */}
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5">
              <h3 className="text-sm font-medium text-zinc-300 mb-3">교재별 출제</h3>
              {Object.keys(selectedExam.textbookCoverage).length === 0 ? (
                <p className="text-xs text-zinc-600">교재 정보가 입력되지 않았습니다</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(selectedExam.textbookCoverage).sort(([, a], [, b]) => b - a).map(([tb, count]) => (
                    <div key={tb}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-zinc-400 truncate max-w-[200px]">{tb}</span>
                        <span className="text-zinc-500 flex-shrink-0 ml-2">{count}문항</span>
                      </div>
                      <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all" style={{ width: barWidth(count, selectedExam.totalQuestions) }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Per-question accuracy */}
          {selectedExam.perQuestionAccuracy.length > 0 && (
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5">
              <h3 className="text-sm font-medium text-zinc-300 mb-3">문항별 정답률</h3>
              <div className="flex flex-wrap gap-2">
                {selectedExam.perQuestionAccuracy.map((q) => (
                  <div key={q.question} className="flex flex-col items-center w-12">
                    <div className="h-16 w-6 rounded-t bg-zinc-800 overflow-hidden flex flex-col justify-end relative">
                      <div
                        className={`w-full rounded-t transition-all ${
                          q.accuracy >= 80 ? 'bg-emerald-500' : q.accuracy >= 50 ? 'bg-amber-500' : 'bg-rose-500'
                        }`}
                        style={{ height: `${q.accuracy}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-zinc-500 mt-1">{q.question}</span>
                    <span className="text-[9px] text-zinc-600">{q.accuracy}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Student ranking */}
          {selectedExam.rankings.length > 0 && (
            <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 overflow-hidden">
              <div className="px-5 py-3 border-b border-zinc-800/80">
                <h3 className="text-sm font-medium text-zinc-300">학생 성적 순위</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800/80 text-zinc-500 text-xs">
                    <th className="text-left px-5 py-2 w-10">순위</th>
                    <th className="text-left px-5 py-2">이름</th>
                    <th className="text-right px-5 py-2">객관식</th>
                    <th className="text-right px-5 py-2">주관식</th>
                    <th className="text-right px-5 py-2">총점</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedExam.rankings.map((r, i) => (
                    <tr key={r.studentId} className="border-b border-zinc-800/50 hover:bg-zinc-800/20">
                      <td className="px-5 py-2 text-zinc-500">
                        {i === 0 ? <span className="text-amber-400 font-bold">1</span> :
                         i === 1 ? <span className="text-gray-300 font-bold">2</span> :
                         i === 2 ? <span className="text-amber-700 font-bold">3</span> :
                         <span>{i + 1}</span>}
                      </td>
                      <td className="px-5 py-2 text-zinc-300 font-medium">{r.studentName}</td>
                      <td className="px-5 py-2 text-right text-blue-400/80">{r.objectiveScore}</td>
                      <td className="px-5 py-2 text-right text-amber-400/80">{r.subjectiveScore}</td>
                      <td className="px-5 py-2 text-right text-zinc-100 font-semibold">{r.totalScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
