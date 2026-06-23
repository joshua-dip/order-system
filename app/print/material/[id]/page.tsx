'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import MaterialView, { type MaterialDoc } from '@/app/components/MaterialView';

export default function MaterialPrintPage() {
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : '';
  const [material, setMaterial] = useState<MaterialDoc | null>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'err'>('loading');
  const [showAnswers, setShowAnswers] = useState(true);

  useEffect(() => {
    fetch(`/api/my/vip/materials/${id}`, { credentials: 'include' }).then((r) => r.json()).then((d) => {
      if (d.ok) { setMaterial(d.material); setStatus('ok'); }
      else setStatus('err');
    }).catch(() => setStatus('err'));
  }, [id]);

  return (
    <div style={{ background: '#fff', minHeight: '100vh' }} className="text-black">
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 16mm; } body { background: #fff; } }
        .material-paper section { break-inside: avoid; }`}</style>

      {/* 툴바 (인쇄 시 숨김) */}
      <div className="no-print sticky top-0 z-10 flex items-center gap-3 px-4 py-2.5 bg-zinc-900 text-zinc-200 border-b border-zinc-700">
        <span className="text-sm font-medium">교재 인쇄</span>
        <label className="text-xs flex items-center gap-1.5 ml-2 cursor-pointer select-none">
          <input type="checkbox" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} className="accent-indigo-500" /> 정답 표시
        </label>
        <button onClick={() => window.print()} className="ml-auto px-3.5 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500">🖨 인쇄 / PDF 저장</button>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
        {status === 'loading' && <p className="text-gray-400 text-sm">불러오는 중…</p>}
        {status === 'err' && <p className="text-gray-500 text-sm">교재를 찾을 수 없거나 권한이 없습니다.</p>}
        {status === 'ok' && material && <MaterialView material={material} showAnswers={showAnswers} />}
      </div>
    </div>
  );
}
