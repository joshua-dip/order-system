'use client';

import { useState, useEffect, useCallback } from 'react';

type Step = 'form' | 'done';
type ApplicantType = 'student' | 'parent' | 'teacher';

const TYPE_OPTIONS: { value: ApplicantType; label: string }[] = [
  { value: 'student', label: '학생' },
  { value: 'parent', label: '학부모' },
  { value: 'teacher', label: '선생님' },
];

/**
 * 개인정보 수집·이용 동의 안내 본문. 버전이 바뀌면 PRIVACY_CONSENT_VERSION 도 같이 올린다.
 * 서버는 이 버전 문자열을 그대로 받아 DB 에 기록 → 동의 시점의 정책 본문을 추적할 수 있다.
 */
const PRIVACY_CONSENT_VERSION = 'v1.1-2026-05-27';
const PRIVACY_CONSENT_ITEMS: { label: string; value: string }[] = [
  { label: '수집 항목', value: '이름, 전화번호, 신청 유형(학생/학부모/선생님)' },
  { label: '수집·이용 목적', value: '가입 상담 연락 및 본인 식별' },
  {
    label: '보유·이용 기간',
    value:
      '가입 처리 완료 또는 거절 시 즉시 이름·전화번호 마스킹, IP·접속 정보 삭제. 신청일로부터 90일 후 모든 정보 자동 파기.',
  },
  { label: '거부 권리', value: '동의를 거부할 수 있으며, 거부 시 가입 신청이 제한됩니다.' },
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
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [showConsentDetails, setShowConsentDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setStep('form');
    setApplicantType(null);
    setName('');
    setPhone('');
    setPrivacyConsent(false);
    setShowConsentDetails(false);
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
    if (!privacyConsent) {
      setError('개인정보 수집·이용에 동의해 주세요.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/membership-applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicantType,
          name: name.trim(),
          phone,
          privacyConsent: true,
          privacyConsentVersion: PRIVACY_CONSENT_VERSION,
        }),
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
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
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
          <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 overflow-y-auto flex-1 min-h-0">
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

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={privacyConsent}
                  onChange={(e) => {
                    setPrivacyConsent(e.target.checked);
                    if (e.target.checked) setError('');
                  }}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                />
                <span className="text-sm leading-relaxed text-slate-700">
                  <span className="font-semibold text-rose-600">[필수]</span>{' '}
                  개인정보 수집·이용에 동의합니다.
                  <button
                    type="button"
                    onClick={() => setShowConsentDetails((v) => !v)}
                    className="ml-1 text-xs font-medium text-amber-700 underline underline-offset-2 hover:text-amber-800"
                  >
                    {showConsentDetails ? '상세 닫기' : '상세 보기'}
                  </button>
                </span>
              </label>
              {showConsentDetails && (
                <dl className="mt-3 space-y-1.5 border-t border-slate-200 pt-3 text-[11.5px] leading-relaxed text-slate-600">
                  {PRIVACY_CONSENT_ITEMS.map((item) => (
                    <div key={item.label} className="flex gap-2">
                      <dt className="shrink-0 font-semibold text-slate-700">· {item.label}:</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-2.5">{error}</p>}

            <p className="text-xs text-slate-500 leading-relaxed">
              제출하시면 담당 매니저가 신청 내용을 확인한 뒤, 남겨주신 연락처로 순차적으로 연락드립니다.
            </p>

            <button
              type="submit"
              disabled={submitting || !privacyConsent}
              className="w-full py-3.5 rounded-xl font-bold text-slate-900 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ backgroundColor: '#FEE500' }}
            >
              {submitting ? '제출 중…' : '신청하기'}
            </button>
          </form>
        )}

        {step === 'done' && (
          <div className="p-8 flex flex-col items-center text-center gap-6 overflow-y-auto flex-1 min-h-0">
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
