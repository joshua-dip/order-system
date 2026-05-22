'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PassageAnalyzerEditor } from '@/app/components/admin/PassageAnalyzerEditor';

function AnalyzeInner() {
  const sp = useSearchParams();
  const passageId = sp.get('passageId');

  if (!passageId) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center text-slate-400">
        <p className="mb-4">
          URL에 <code className="text-slate-300">passageId</code>(passages 문서 ObjectId)가 필요합니다.
        </p>
        <Link href="/admin/syntax-analyzer" className="text-sky-400 hover:underline">
          홈에서 지문을 선택한 뒤 분석 작업대로 이동하세요
        </Link>
      </div>
    );
  }

  return <PassageAnalyzerEditor passageId={passageId} />;
}

export default function AnalyzePage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-20">
          <div className="animate-spin w-10 h-10 border-4 border-slate-600 border-t-white rounded-full" />
        </div>
      }
    >
      <AnalyzeInner />
    </Suspense>
  );
}
