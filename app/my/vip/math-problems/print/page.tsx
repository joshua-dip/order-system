'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { CIRCLED_NUMS, answerLabel, mathTextHtml, type MathBankProblem } from '../shared';

/** 수학 문제지 인쇄 뷰 — 흰 배경 워크시트 + 정답·해설(별지). 브라우저 인쇄(A4)로 PDF 저장. */
function PrintInner() {
  const params = useSearchParams();
  const topicKey = params.get('topicKey') ?? '';
  const sourceParam = params.get('source') ?? '';
  const [problems, setProblems] = useState<MathBankProblem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withAnswers, setWithAnswers] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrBusy, setQrBusy] = useState(false);
  const [qrErr, setQrErr] = useState('');

  const makeQr = async () => {
    if (!problems || problems.length === 0) return;
    setQrBusy(true); setQrErr('');
    try {
      const res = await fetch('/api/my/vip/math-problems/grade-paper', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ topicKey, title, source: sourceParam, problemIds: problems.map((p) => p.id) }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { setQrErr(d.error || 'QR 채점지 생성에 실패했습니다.'); setQrBusy(false); return; }
      setQrDataUrl(await QRCode.toDataURL(d.url, { margin: 1, width: 240 }));
    } catch { setQrErr('QR 생성 중 오류가 발생했습니다.'); }
    setQrBusy(false);
  };

  useEffect(() => {
    if (!topicKey) { setError('topicKey 가 없습니다.'); return; }
    fetch(`/api/my/vip/math-problems?topicKey=${encodeURIComponent(topicKey)}${sourceParam ? `&source=${encodeURIComponent(sourceParam)}` : ''}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && Array.isArray(d.problems)) setProblems(d.problems as MathBankProblem[]);
        else setError('문제를 불러오지 못했습니다.');
      })
      .catch(() => setError('문제를 불러오지 못했습니다.'));
  }, [topicKey, sourceParam]);

  const segs = topicKey.split(' > ');
  const title = segs[segs.length - 1] ?? '';
  const subtitle = segs.slice(0, -1).join(' · ');

  const doPrint = () => {
    try { window.print(); } catch { /* 임베디드 브라우저 등 인쇄 미지원 환경 */ }
  };

  return (
    <div className="print-root fixed inset-0 z-50 overflow-auto bg-zinc-200 print:bg-white">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-root, .print-root * { visibility: visible; }
          .print-root { position: absolute !important; inset: 0; background: #fff !important; }
          .no-print { display: none !important; }
          .answer-sheet { page-break-before: always; }
        }
      `}</style>

      {/* 도구 막대 (인쇄 시 숨김) */}
      <div className="no-print sticky top-0 z-10 flex items-center gap-2 border-b border-zinc-300 bg-white/95 px-4 py-2.5 shadow-sm">
        <p className="text-sm font-bold text-zinc-800">수학 문제지 인쇄 미리보기</p>
        <label className="ml-3 flex items-center gap-1.5 text-[12px] text-zinc-600">
          <input type="checkbox" checked={withAnswers} onChange={(e) => setWithAnswers(e.target.checked)} />
          정답·해설 포함
        </label>
        {qrErr && <span className="text-[11px] text-rose-600">{qrErr}</span>}
        <button onClick={makeQr} disabled={qrBusy || !problems?.length}
          className="ml-auto rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">
          {qrBusy ? 'QR 생성 중…' : qrDataUrl ? '🔄 QR 재생성' : '🔗 QR 채점지 만들기'}
        </button>
        <button onClick={doPrint} className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-bold text-white hover:bg-zinc-700">🖨 인쇄 / PDF 저장</button>
        <button onClick={() => window.close()} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100">닫기</button>
      </div>

      {error ? (
        <p className="p-10 text-center text-sm text-rose-600">{error}</p>
      ) : !problems ? (
        <p className="p-10 text-center text-sm text-zinc-500">불러오는 중…</p>
      ) : problems.length === 0 ? (
        <p className="p-10 text-center text-sm text-zinc-500">이 진도의 문제가 없습니다.</p>
      ) : (
        <div className="mx-auto my-4 max-w-[210mm] bg-white p-[15mm] text-zinc-900 shadow print:my-0 print:shadow-none">
          {/* 머리글 */}
          <div className="flex items-start justify-between gap-3 border-b-2 border-zinc-900 pb-2">
            <div className="flex-1">
              <p className="text-[11px] tracking-wide text-zinc-500">{subtitle}</p>
              <h1 className="text-xl font-extrabold">{title}</h1>
              <p className="mt-1 text-[11px] text-zinc-500">이름 ______________ &nbsp; 날짜 ____월 ____일</p>
            </div>
            {qrDataUrl && (
              <div className="flex shrink-0 flex-col items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="채점 QR" className="h-[72px] w-[72px]" />
                <span className="text-[9px] font-semibold text-zinc-600">📱 스캔·채점</span>
              </div>
            )}
          </div>

          {/* 문항 */}
          <ol className="mt-5 space-y-4">
            {problems.map((p, i) => (
              <li key={p.id} className="text-[13.5px] leading-relaxed">
                <div className="flex gap-2">
                  <span className="font-bold">{i + 1}.</span>
                  <div className="flex-1">
                    <span dangerouslySetInnerHTML={{ __html: mathTextHtml(p.question) }} />
                    {p.choices && p.choices.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
                        {p.choices.map((o, ci) => <span key={ci}>{CIRCLED_NUMS[ci]} {o}</span>)}
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {/* 정답·해설 (별지) */}
          {withAnswers && (
            <div className="answer-sheet mt-10 border-t-2 border-dashed border-zinc-400 pt-4">
              <h2 className="text-base font-extrabold">정답 및 해설 — {title}</h2>
              <ol className="mt-2 space-y-1.5">
                {problems.map((p, i) => (
                  <li key={p.id} className="text-[12px] leading-relaxed">
                    <b>{i + 1}.</b> <span className="text-emerald-700 font-semibold">{answerLabel(p)}</span>
                    <span className="ml-1 font-mono text-[10px] text-zinc-400">{p.serial}</span>
                    {p.solution && (
                      <span className="block text-zinc-600" dangerouslySetInnerHTML={{ __html: mathTextHtml(p.solution) }} />
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MathPrintPage() {
  return (
    <Suspense fallback={<p className="p-10 text-center text-sm text-zinc-500">불러오는 중…</p>}>
      <PrintInner />
    </Suspense>
  );
}
