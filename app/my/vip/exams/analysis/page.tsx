'use client';

import { useEffect, useState } from 'react';
import PassagePhotoGrid from '../PassagePhotoGrid';
import { getCurrentSubject, DEFAULT_VIP_SUBJECT } from '@/lib/vip-subject';

interface ExamQuestion { questionType?: string; score?: number; questionText?: string; textbook?: string; source?: string; isSubjective?: boolean }
interface SchoolExam { id: string; academicYear: number; grade: number; examType: string; questions: Record<string, ExamQuestion>; examScope: string[]; examScopePassages?: string[]; analyzed?: boolean }
interface School { id: string; name: string }

const GRADES = [1, 2, 3];

export default function VipExamAnalysisPage() {
  const [subject, setSubject] = useState(DEFAULT_VIP_SUBJECT);
  useEffect(() => { setSubject(getCurrentSubject()); }, []);
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [grade, setGrade] = useState(1);
  const [exams, setExams] = useState<SchoolExam[]>([]);
  const [exam, setExam] = useState<SchoolExam | null>(null);

  useEffect(() => {
    fetch('/api/my/vip/schools', { credentials: 'include' }).then((r) => r.json()).then((d) => { if (d.ok) setSchools(d.schools); });
  }, []);

  useEffect(() => {
    if (!schoolId) { setExams([]); return; }
    fetch(`/api/my/vip/school-exams?schoolId=${schoolId}`, { credentials: 'include' }).then((r) => r.json()).then((d) => { if (d.ok) setExams(d.exams); });
    setExam(null);
  }, [schoolId]);

  const gradeExams = exams.filter((e) => e.grade === grade && e.analyzed);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 flex items-center gap-2">
          <span className="px-2 py-0.5 rounded-md bg-[#c9a44e]/15 text-[#e8d48b] text-sm border border-[#c9a44e]/25">{subject}</span>
          기출 분석·예측
        </h1>
        <p className="text-sm text-zinc-500 mt-0.5">{subject} 기출 시험을 분석하고, 문항별 학생 필기를 사진으로 모아 다가올 시험을 대비합니다</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)} className="px-3 py-2 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-sm text-zinc-100 [&>option]:bg-zinc-900">
          <option value="">학교 선택</option>
          {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex rounded-xl overflow-hidden border border-zinc-800/80">
          {GRADES.map((g) => (
            <button key={g} onClick={() => { setGrade(g); setExam(null); }} className={`px-3 py-2 text-sm ${grade === g ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'} transition-colors`}>{g}학년</button>
          ))}
        </div>
      </div>

      {!schoolId ? (
        <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">학교를 선택하세요.</div>
      ) : !exam ? (
        gradeExams.length === 0 ? (
          <div className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-12 text-center text-sm text-zinc-600">분석완료한 {grade}학년 시험이 없습니다.<br />「시험 준비」에서 시험을 다듬은 뒤 <span className="text-amber-300/80">분석완료</span> 버튼을 누르면 여기에 표시됩니다.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {gradeExams.map((e) => (
              <div key={e.id} onClick={() => setExam(e)} className="rounded-xl bg-zinc-900/50 border border-zinc-800/80 p-5 hover:bg-zinc-800/40 hover:border-white/20 transition-all cursor-pointer">
                <div className="text-sm font-medium text-zinc-100 mb-1">{e.academicYear}년 {e.examType}</div>
                <div className="text-[11px] text-zinc-500">{Object.keys(e.questions ?? {}).length}문항 · 교재 {e.examScope?.length ?? 0}권</div>
              </div>
            ))}
          </div>
        )
      ) : (
        <ExamDetail exam={exam} onBack={() => setExam(null)} />
      )}
    </div>
  );
}

function ExamDetail({ exam, onBack }: { exam: SchoolExam; onBack: () => void }) {
  const nums = Object.keys(exam.questions ?? {});
  const typeDist: Record<string, number> = {};
  for (const n of nums) { const t = exam.questions[n]?.isSubjective ? '서술형' : (exam.questions[n]?.questionType || '미지정'); typeDist[t] = (typeDist[t] ?? 0) + 1; }

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors">← 기출 시험 목록으로</button>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-lg font-semibold text-zinc-100">{exam.academicYear}년 {exam.grade}학년 {exam.examType}</div>
          <div className="text-xs text-zinc-500 mt-0.5">{nums.length}문항</div>
        </div>
        <div className="flex flex-wrap gap-1">
          {Object.entries(typeDist).sort((a, b) => b[1] - a[1]).map(([t, c]) => (
            <span key={t} className={`px-2 py-0.5 rounded-full text-[11px] ${t === '서술형' ? 'bg-amber-500/15 text-amber-300' : 'bg-violet-500/15 text-violet-300'}`}>{t} {c}</span>
          ))}
        </div>
      </div>

      <PassagePhotoGrid examId={exam.id} passages={exam.examScopePassages ?? []} />
    </div>
  );
}
