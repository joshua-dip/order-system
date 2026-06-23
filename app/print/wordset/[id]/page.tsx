'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import WordSetView, { type WordSetDoc } from '@/app/components/WordSetView';
import { WORDSET_PRINT_MODES, type WordsetPrintMode } from '@/lib/word-types';

export default function WordSetPrintPage() {
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const [set, setSet] = useState<WordSetDoc | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'err'>('loading');
  const [mode, setMode] = useState<WordsetPrintMode>('전체');
  const [showAnswers, setShowAnswers] = useState(true);

  useEffect(() => {
    fetch(`/api/my/vip/word-sets/${id}`, { credentials: 'include' }).then((r) => r.json()).then((d) => {
      if (d.ok) { setSet(d.set); setStatus('ok'); }
      else setStatus('err');
    }).catch(() => setStatus('err'));
  }, [id]);

  const isQuiz = mode !== '전체';

  return (
    <div style={{ background: '#fff', minHeight: '100vh' }} className="text-black">
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 14mm; } body { background: #fff; } }
        .material-paper li { break-inside: avoid; }`}</style>

      <div className="no-print sticky top-0 z-10 flex items-center gap-3 flex-wrap px-4 py-2.5 bg-zinc-900 text-zinc-200 border-b border-zinc-700">
        <span className="text-sm font-medium">단어장 인쇄</span>
        <div className="flex rounded-lg overflow-hidden border border-zinc-700">
          {WORDSET_PRINT_MODES.map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`px-3 py-1.5 text-xs transition-colors ${mode === m ? 'bg-zinc-100 text-zinc-900' : 'bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800'}`}>{m}</button>
          ))}
        </div>
        {isQuiz && (
          <label className="text-xs flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} className="accent-indigo-500" /> 정답 표시
          </label>
        )}
        <button onClick={() => window.print()} className="ml-auto px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500">🖨 인쇄 / PDF 저장</button>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
        {status === 'loading' && <p className="text-gray-400 text-sm">불러오는 중…</p>}
        {status === 'err' && <p className="text-gray-500 text-sm">단어장을 찾을 수 없거나 권한이 없습니다.</p>}
        {status === 'ok' && set && <WordSetView set={set} mode={mode} showAnswers={isQuiz ? showAnswers : true} />}
      </div>
    </div>
  );
}
