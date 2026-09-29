'use client';

/** 오류 신고 — 문장·해석·분석·문항에서 틀린 곳을 관리자에게 알린다. */

import { useState } from 'react';

const KINDS = ['문장·원문', '해석', '분석', '문항', '기타'] as const;

export type ErrorReportTarget = { sentenceIndex: number; questionId?: string; label: string };

export function LiveErrorReportDialog({
  passageId,
  target,
  onClose,
}: {
  passageId: string;
  target: ErrorReportTarget;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>(target.questionId ? '문항' : '해석');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (busy || message.trim().length < 2) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/class-kit/error-reports', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passageId, sentenceIndex: target.sentenceIndex, questionId: target.questionId, kind, message }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || '보내지 못했어요.');
      setDone(true);
      setTimeout(onClose, 1200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-5 text-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold">오류 신고</h3>
        <p className="mt-0.5 text-xs text-slate-500">{target.label} — 확인해서 고칠게요.</p>
        {done ? (
          <p className="py-8 text-center text-sm font-semibold text-emerald-600">고맙습니다. 신고가 접수됐어요.</p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${kind === k ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-300 text-slate-600'}`}
                >
                  {k}
                </button>
              ))}
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              rows={4}
              autoFocus
              placeholder="어디가 어떻게 틀렸는지 적어 주세요. 예) 3번 문장 해석에서 주어가 빠졌어요."
              className="mt-3 w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-rose-400"
            />
            {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
                취소
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy || message.trim().length < 2}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-40"
              >
                {busy ? '보내는 중…' : '보내기'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
