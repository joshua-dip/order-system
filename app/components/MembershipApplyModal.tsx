'use client';

import { useState, useEffect, useCallback } from 'react';

type Step = 'form' | 'done';
type ApplicantType = 'student' | 'parent' | 'teacher';

const TYPE_OPTIONS: { value: ApplicantType; label: string }[] = [
  { value: 'student', label: '학생' },
  { value: 'parent', label: '학부모' },
  { value: 'teacher', label: '선생님' },
];

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function MembershipApplyModal({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>('form');
  const [applicantType, setApplicantType] = useState<ApplicantType | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setStep('form');
    setApplicantType(null);
    setName('');
    setPhone('');
    setSubmitting(false);
    setError('');
  }, []);

  const handleClose = useCallback(() => {
    onClose();
    setTimeout(reset, 300);
  }, [onClose, reset]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhone(e.target.value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!applicantType) {
      setError('신청 유형(학생·학부모·선생님)을 선택해 주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/membership-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicantType, name: name.trim(), phone }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? '신청 중 오류가 발생했습니다.');
        return;
      }
      setStep('done');
    } catch {
      setError('네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-800">가입 신청</h2>
            {step === 'form' && (
              <p className="text-xs text-slate-500 mt-0.5">이름·전화번호·신청 유형을 입력한 뒤 제출해 주세요</p>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 transition-colors"
            aria-label="닫기"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {step === 'form' && (
          <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4">
            <div>
              <label htmlFor="membership-apply-name" className="block text-sm font-medium text-slate-700 mb-1.5">
                이름
              </label>
              <input
                id="membership-apply-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="홍길동"
                maxLength={30}
                required
                autoComplete="name"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100 text-slate-800 placeholder-slate-400 transition"
              />
            </div>

            <div>
              <label htmlFor="membership-apply-phone" className="block text-sm font-medium text-slate-700 mb-1.5">
                전화번호
              </label>
              <input
                id="membership-apply-phone"
                type="tel"
                value={phone}
                onChange={handlePhoneChange}
                placeholder="010-0000-0000"
                required
                autoComplete="tel"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-100 text-slate-800 placeholder-slate-400 transition"
              />
            </div>

            <fieldset className="min-w-0 border-0 p-0 m-0">
              <legend className="block text-sm font-medium text-slate-700 mb-2">신청 유형</legend>
              <div className="flex flex-col gap-2">
                {TYPE_OPTIONS.map((opt) => {
                  const checked = applicantType === opt.value;
                  return (
                    <label
                      key={opt.value}
                      className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 cursor-pointer transition-colors ${
                        checked ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <input
                        type="radio"
                        name="membership-applicant-type"
                        value={opt.value}
                        checked={checked}
                        onChange={() => {
                          setApplicantType(opt.value);
                          setError('');
                        }}
                        className="h-4 w-4 shrink-0 border-slate-300 text-amber-500 focus:ring-amber-500"
                      />
                      <span className={`text-sm font-semibold ${checked ? 'text-slate-900' : 'text-slate-700'}`}>
                        {opt.label}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2.5">{error}</p>}

            <p className="text-xs text-slate-500 leading-relaxed">
              제출하시면 담당 매니저가 신청 내용을 확인한 뒤, 남겨주신 연락처로 순차적으로 연락드립니다.
            </p>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 rounded-xl font-bold text-slate-900 transition-all disabled:opacity-60"
              style={{ backgroundColor: '#FEE500' }}
            >
              {submitting ? '제출 중…' : '신청하기'}
            </button>
          </form>
        )}

        {step === 'done' && (
          <div className="p-8 flex flex-col items-center text-center gap-6">
            <div className="space-y-3">
              <p className="text-lg font-bold text-slate-800 leading-snug">가입 신청이 완료되었습니다</p>
              <p className="text-sm text-slate-600 leading-relaxed">담당 매니저가 확인 후 연락드립니다.</p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="w-full py-3.5 rounded-xl font-bold text-slate-900 transition-all"
              style={{ backgroundColor: '#FEE500' }}
            >
              확인
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
