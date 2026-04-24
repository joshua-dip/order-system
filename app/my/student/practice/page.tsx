'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';

const QUESTION_TYPES = [
  { value: '요약문본문어휘', label: '요약문 어휘 찾기', desc: '지문에서 단어를 찾아 요약문 완성', tag: '서술형' },
  { value: '빈칸', label: '빈칸 추론', desc: '문맥에 맞는 표현을 고르는 객관식', tag: '객관식' },
  { value: '주제', label: '주제 찾기', desc: '글의 주제를 고르는 객관식', tag: '객관식' },
] as const;

type StepType = 'idle' | 'generating' | 'solving' | 'grading' | 'result';

const GENERATION_STEPS = ['지문 분석 중', '문제 작성 중', '검수 중'];

interface QuestionData {
  Question?: string;
  Paragraph?: string;
  Options?: string;
  CorrectAnswer?: string;
  Explanation?: string;
  Conditions?: string;
  SummaryFrame?: string;
  SampleAnswer?: string;
  Keywords?: string[];
}

export default function StudentPracticePage() {
  const [step, setStep] = useState<StepType>('idle');
  const [paragraph, setParagraph] = useState('');
  const [selectedType, setSelectedType] = useState('요약문본문어휘');
  const [questionData, setQuestionData] = useState<QuestionData | null>(null);
  const [questionType, setQuestionType] = useState('');
  const [studentAnswer, setStudentAnswer] = useState('');
  const [selectedOption, setSelectedOption] = useState('');
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [genStepIdx, setGenStepIdx] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);

  const genTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // sessionStorage에 지문 임시 저장
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('practice_paragraph');
      if (saved) setParagraph(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      if (paragraph) sessionStorage.setItem('practice_paragraph', paragraph);
    } catch {}
  }, [paragraph]);

  const isObjective = questionType === '빈칸' || questionType === '주제';

  const handleGenerate = async () => {
    if (paragraph.length < 100) {
      setError('지문은 100자 이상 입력해 주세요.');
      return;
    }
    setError('');
    setStep('generating');
    setGenStepIdx(0);
    setStartTime(Date.now());

    genTimer.current = setInterval(() => {
      setGenStepIdx(prev => Math.min(prev + 1, GENERATION_STEPS.length - 1));
    }, 5000);

    try {
      const res = await fetch('/api/my/student/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paragraph, type: selectedType }),
      });
      const data = await res.json();
      if (genTimer.current) clearInterval(genTimer.current);

      if (!res.ok) {
        setError(data.error ?? '문제 생성에 실패했습니다.');
        setStep('idle');
        return;
      }

      setQuestionData(data.question_data);
      setQuestionType(data.type);
      setStudentAnswer('');
      setSelectedOption('');
      setStep('solving');
    } catch {
      if (genTimer.current) clearInterval(genTimer.current);
      setError('요청 중 오류가 발생했습니다.');
      setStep('idle');
    }
  };

  const handleGrade = async () => {
    const answer = isObjective ? selectedOption : studentAnswer;
    if (!answer) {
      setError('답안을 입력하거나 선택해 주세요.');
      return;
    }
    setError('');
    setStep('grading');

    try {
      const res = await fetch('/api/my/student/ai/grade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question_data: questionData,
          type: questionType,
          studentAnswer: answer,
          timeSpentMs: startTime ? Date.now() - startTime : undefined,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? '채점에 실패했습니다.');
        setStep('solving');
        return;
      }

      setIsCorrect(data.isCorrect);
      setFeedback(data.feedback);
      setStep('result');
    } catch {
      setError('채점 요청 중 오류가 발생했습니다.');
      setStep('solving');
    }
  };

  const handleReset = () => {
    setStep('idle');
    setQuestionData(null);
    setStudentAnswer('');
    setSelectedOption('');
    setIsCorrect(null);
    setFeedback('');
    setError('');
  };

  // 파싱된 선택지
  const parsedOptions = questionData?.Options
    ? questionData.Options.split('###').map(o => o.trim())
    : [];

  return (
    <div className="min-h-screen bg-slate-50 pb-6">
      {/* 헤더 */}
      <div className="bg-gradient-to-br from-indigo-600 to-violet-600 px-5 pt-6 pb-5">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <Link href="/my/student" className="text-white/70 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-white font-bold text-lg">AI 자유 연습</h1>
            <p className="text-indigo-100 text-xs">지문을 붙여넣고 문제를 만들어보세요</p>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 mt-5 space-y-4">

        {/* IDLE — 지문 입력 */}
        {step === 'idle' && (
          <>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                영어 지문 붙여넣기
              </label>
              <textarea
                value={paragraph}
                onChange={(e) => setParagraph(e.target.value)}
                rows={8}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none transition-all text-slate-800 placeholder-slate-400 text-sm resize-none"
                placeholder="교과서, 모의고사, 뉴스 등 영어 지문을 여기에 붙여넣으세요. (100자 이상)"
              />
              <div className="flex justify-between mt-1.5">
                <span className={`text-xs ${paragraph.length < 100 ? 'text-slate-400' : 'text-emerald-600'}`}>
                  {paragraph.length}자 {paragraph.length < 100 ? `(${100 - paragraph.length}자 더 필요)` : ''}
                </span>
                <span className="text-xs text-slate-400">최대 3000자</span>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              <p className="text-sm font-semibold text-slate-700 mb-3">문제 유형 선택</p>
              <div className="space-y-2">
                {QUESTION_TYPES.map((qt) => (
                  <button
                    key={qt.value}
                    type="button"
                    onClick={() => setSelectedType(qt.value)}
                    className={`w-full flex items-center justify-between p-3.5 rounded-xl border text-left transition-all ${
                      selectedType === qt.value
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <p className={`font-medium text-sm ${selectedType === qt.value ? 'text-indigo-700' : 'text-slate-800'}`}>
                        {qt.label}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">{qt.desc}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      qt.tag === '서술형' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {qt.tag}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleGenerate}
              disabled={paragraph.length < 100}
              className="w-full py-4 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-base shadow-sm"
            >
              AI에게 문제 받기
            </button>
          </>
        )}

        {/* GENERATING */}
        {step === 'generating' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-indigo-50 flex items-center justify-center">
              <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" style={{ borderWidth: '3px' }} />
            </div>
            <p className="font-bold text-slate-800 text-lg mb-2">문제 만드는 중...</p>
            <div className="space-y-2 mt-4">
              {GENERATION_STEPS.map((s, i) => (
                <div key={i} className={`flex items-center gap-2 text-sm justify-center ${i <= genStepIdx ? 'text-indigo-600' : 'text-slate-300'}`}>
                  {i < genStepIdx ? (
                    <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  ) : i === genStepIdx ? (
                    <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-slate-200 flex-shrink-0" />
                  )}
                  <span className={i === genStepIdx ? 'font-medium' : ''}>{s}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-5">보통 15~30초 정도 걸려요</p>
          </div>
        )}

        {/* SOLVING */}
        {step === 'solving' && questionData && (
          <>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  isObjective ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'
                }`}>
                  {QUESTION_TYPES.find(t => t.value === questionType)?.label ?? questionType}
                </span>
              </div>

              {/* 발문 */}
              <p className="font-semibold text-slate-800 mb-4 leading-relaxed">{questionData.Question}</p>

              {/* 지문 */}
              <div className="bg-slate-50 rounded-xl p-4 mb-4 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: (questionData.Paragraph ?? '').replace(/<u>(.*?)<\/u>/g, '<u class="text-indigo-600 font-medium decoration-indigo-400">$1</u>') }}
              />

              {/* 서술형: 조건 + 요약문 틀 */}
              {!isObjective && questionData.Conditions && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-slate-600 mb-1">[조건]</p>
                  <div className="bg-amber-50 rounded-xl p-3 text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                    {questionData.Conditions}
                  </div>
                </div>
              )}
              {!isObjective && questionData.SummaryFrame && (
                <div className="mb-4">
                  <p className="text-xs font-semibold text-slate-600 mb-1">[요약문 틀]</p>
                  <div className="bg-slate-100 rounded-xl p-3 text-sm text-slate-800 font-medium leading-relaxed">
                    {questionData.SummaryFrame}
                  </div>
                </div>
              )}

              {/* 객관식 선택지 */}
              {isObjective && parsedOptions.length > 0 && (
                <div className="space-y-2">
                  {parsedOptions.map((opt, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedOption(opt.charAt(0))}
                      className={`w-full text-left p-3 rounded-xl border text-sm transition-all ${
                        selectedOption === opt.charAt(0)
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-700 font-medium'
                          : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {/* 서술형 답안 */}
              {!isObjective && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">내 답안</label>
                  <textarea
                    value={studentAnswer}
                    onChange={(e) => setStudentAnswer(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none transition-all text-slate-800 text-sm resize-none"
                    placeholder="빈칸에 들어갈 단어를 본문에서 찾아 영어로 써주세요"
                  />
                </div>
              )}
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl">
                {error}
              </div>
            )}

            <button
              type="button"
              onClick={handleGrade}
              disabled={isObjective ? !selectedOption : !studentAnswer.trim()}
              className="w-full py-4 rounded-2xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-base shadow-sm"
            >
              제출하고 채점받기
            </button>
          </>
        )}

        {/* GRADING */}
        {step === 'grading' && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-indigo-50 flex items-center justify-center">
              <div className="w-8 h-8 border-3 border-indigo-500 border-t-transparent rounded-full animate-spin" style={{ borderWidth: '3px' }} />
            </div>
            <p className="font-bold text-slate-800 text-lg">AI가 채점하는 중...</p>
            <p className="text-slate-500 text-sm mt-1">잠깐만 기다려 주세요</p>
          </div>
        )}

        {/* RESULT */}
        {step === 'result' && questionData && (
          <>
            <div className={`rounded-2xl shadow-sm border p-5 ${isCorrect ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <div className="flex items-center gap-3 mb-3">
                {isCorrect ? (
                  <svg className="w-8 h-8 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-8 h-8 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
                <p className={`font-bold text-lg ${isCorrect ? 'text-emerald-700' : 'text-red-600'}`}>
                  {isCorrect ? '정답!' : '오답'}
                </p>
              </div>
              <p className="text-sm text-slate-700 leading-relaxed">{feedback}</p>
            </div>

            {/* 모범 답안 */}
            {!isObjective && questionData.SampleAnswer && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
                <p className="text-xs font-semibold text-slate-600 mb-2">모범 답안</p>
                <p className="text-sm text-slate-800 leading-relaxed font-medium">{questionData.SampleAnswer}</p>
                {Array.isArray(questionData.Keywords) && questionData.Keywords.length > 0 && (
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {questionData.Keywords.map((k, i) => (
                      <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-xs rounded font-medium">{k}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 해설 */}
            {questionData.Explanation && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
                <p className="text-xs font-semibold text-slate-600 mb-2">해설</p>
                <p className="text-sm text-slate-700 leading-relaxed">{questionData.Explanation}</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep('solving')}
                className="flex-1 py-3.5 rounded-xl border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                다시 풀기
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="flex-1 py-3.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
              >
                새 지문으로
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
