'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DEFAULT_APP_BAR_TITLE } from '@/lib/site-branding';
import { STUDENT_GRADE_OPTIONS } from '@/lib/student-grade';

type Step = 1 | 2 | 3;

const STEPS = ['계정 만들기', '내 정보', '약관 동의'];

function ProgressBar({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map((label, i) => {
        const stepNum = (i + 1) as Step;
        const active = stepNum === step;
        const done = stepNum < step;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div
              className={`h-1.5 w-full rounded-full transition-all ${
                done ? 'bg-indigo-500' : active ? 'bg-indigo-400' : 'bg-slate-200'
              }`}
            />
            <span className={`text-xs ${active ? 'text-indigo-600 font-semibold' : done ? 'text-indigo-400' : 'text-slate-400'}`}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function StudentSignupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [idStatus, setIdStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [idError, setIdError] = useState('');

  // Step 2
  const [name, setName] = useState('');
  const [grade, setGrade] = useState('');

  // Step 3
  const [agreedTerms, setAgreedTerms] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // sessionStorage 임시 저장
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('signup_draft');
      if (saved) {
        const d = JSON.parse(saved);
        if (d.loginId) setLoginId(d.loginId);
        if (d.name) setName(d.name);
        if (d.grade) setGrade(d.grade);
        if (d.step) setStep(d.step);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem('signup_draft', JSON.stringify({ loginId, name, grade, step }));
    } catch {}
  }, [loginId, name, grade, step]);

  const checkId = useCallback(async () => {
    if (!loginId || loginId.length < 4) return;
    setIdStatus('checking');
    const res = await fetch('/api/auth/student-id-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginId }),
    });
    const data = await res.json();
    if (data.available) {
      setIdStatus('ok');
      setIdError('');
    } else {
      setIdStatus('error');
      setIdError(data.error ?? '사용할 수 없는 아이디입니다.');
    }
  }, [loginId]);

  const step1Valid =
    idStatus === 'ok' &&
    password.length >= 8 &&
    password === passwordConfirm;

  const step2Valid = name.trim().length > 0 && grade !== '';

  const handleNext = () => {
    setError('');
    if (step === 1 && !step1Valid) {
      setError('아이디 확인, 비밀번호(8자 이상), 비밀번호 확인을 완료해 주세요.');
      return;
    }
    if (step === 2 && !step2Valid) {
      setError('이름과 학년을 입력해 주세요.');
      return;
    }
    setStep((prev) => (prev < 3 ? (prev + 1) as Step : prev));
  };

  const handleSubmit = async () => {
    if (!agreedTerms) {
      setError('개인정보 처리방침에 동의해 주세요.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/student-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ loginId, password, name, grade, agreedTerms }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '가입에 실패했습니다.');
        return;
      }
      sessionStorage.removeItem('signup_draft');
      router.push('/my/student?welcome=1');
    } catch {
      setError('가입 요청 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-violet-50/40 to-purple-50/30 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-600 mb-3">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-800">{DEFAULT_APP_BAR_TITLE}</h1>
          <p className="text-sm text-slate-500 mt-0.5">학생 회원가입</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/50 border border-white/80 p-8">
          <ProgressBar step={step} />

          {/* Step 1 — 계정 */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-800">계정 만들기</h2>
              <div>
                <label htmlFor="loginId" className="block text-sm font-medium text-slate-700 mb-1">
                  아이디 <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    id="loginId"
                    type="text"
                    value={loginId}
                    onChange={(e) => { setLoginId(e.target.value); setIdStatus('idle'); setIdError(''); }}
                    onBlur={checkId}
                    className="flex-1 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none transition-all text-slate-800 placeholder-slate-400"
                    placeholder="영문+숫자 4-20자"
                    autoComplete="username"
                  />
                  <button
                    type="button"
                    onClick={checkId}
                    className="px-3 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-sm text-slate-600 transition-colors whitespace-nowrap"
                  >
                    {idStatus === 'checking' ? '확인중...' : '중복확인'}
                  </button>
                </div>
                {idStatus === 'ok' && <p className="text-xs text-emerald-600 mt-1">사용 가능한 아이디입니다.</p>}
                {idStatus === 'error' && <p className="text-xs text-red-500 mt-1">{idError}</p>}
              </div>
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                  비밀번호 <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none transition-all text-slate-800 placeholder-slate-400"
                    placeholder="8자 이상"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"
                  >
                    {showPw ? '숨기기' : '표시'}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="passwordConfirm" className="block text-sm font-medium text-slate-700 mb-1">
                  비밀번호 확인 <span className="text-red-500">*</span>
                </label>
                <input
                  id="passwordConfirm"
                  type={showPw ? 'text' : 'password'}
                  value={passwordConfirm}
                  onChange={(e) => setPasswordConfirm(e.target.value)}
                  className={`w-full px-4 py-3 rounded-xl border bg-slate-50/50 focus:bg-white focus:ring-2 outline-none transition-all text-slate-800 placeholder-slate-400 ${
                    passwordConfirm && password !== passwordConfirm
                      ? 'border-red-300 focus:border-red-400 focus:ring-red-400/20'
                      : 'border-slate-200 focus:border-indigo-400 focus:ring-indigo-400/20'
                  }`}
                  placeholder="비밀번호를 다시 입력해 주세요"
                  autoComplete="new-password"
                />
                {passwordConfirm && password !== passwordConfirm && (
                  <p className="text-xs text-red-500 mt-1">비밀번호가 일치하지 않습니다.</p>
                )}
              </div>
            </div>
          )}

          {/* Step 2 — 프로필 */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-800">내 정보</h2>
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-slate-700 mb-1">
                  이름 <span className="text-red-500">*</span>
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20 outline-none transition-all text-slate-800 placeholder-slate-400"
                  placeholder="홍길동"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  학년 <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {STUDENT_GRADE_OPTIONS.map((g) => (
                    <button
                      key={g.value}
                      type="button"
                      onClick={() => setGrade(g.value)}
                      className={`py-2.5 rounded-xl border text-sm font-medium transition-all ${
                        grade === g.value
                          ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                          : 'border-slate-200 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50'
                      }`}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3 — 약관 */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-bold text-slate-800">거의 다 됐어요!</h2>
              <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600 leading-relaxed">
                <p className="font-medium text-slate-800 mb-2">회원 정보 확인</p>
                <ul className="space-y-1">
                  <li>아이디: <span className="font-medium text-slate-800">{loginId}</span></li>
                  <li>이름: <span className="font-medium text-slate-800">{name}</span></li>
                  <li>학년: <span className="font-medium text-slate-800">{grade}</span></li>
                </ul>
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm text-slate-600">
                  <span className="font-medium text-slate-800">개인정보 처리방침</span>에 동의합니다. (학습 기록, AI 사용량 등이 서비스 개선 목적으로 수집됩니다.)
                </span>
              </label>
            </div>
          )}

          {error && (
            <div className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 px-4 py-3 rounded-xl">
              {error}
            </div>
          )}

          <div className="flex gap-3 mt-6">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((prev) => (prev > 1 ? (prev - 1) as Step : prev))}
                className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors"
              >
                이전
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                onClick={handleNext}
                disabled={step === 1 && !step1Valid}
                className="flex-1 py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                다음
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || !agreedTerms}
                className="flex-1 py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {loading ? '가입 중...' : '가입하고 시작하기'}
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-slate-500 text-sm mt-6">
          이미 계정이 있나요?{' '}
          <Link href="/student-login" className="text-indigo-600 hover:underline font-semibold">
            학생 로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
