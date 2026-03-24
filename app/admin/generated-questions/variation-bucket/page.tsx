import { Suspense } from 'react';
import VariationBucketClient from './VariationBucketClient';

export default function VariationBucketPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400">
          불러오는 중…
        </div>
      }
    >
      <VariationBucketClient />
    </Suspense>
  );
}
