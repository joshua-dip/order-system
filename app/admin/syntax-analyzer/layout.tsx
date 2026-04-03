import Link from 'next/link';

export default function SyntaxAnalyzerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-900 text-white pb-8">
      <div className="border-b border-slate-700 bg-slate-950/90 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center gap-2">
          <Link
            href="/admin/syntax-analyzer"
            className="text-sm font-bold text-slate-300 hover:text-white mr-2"
          >
            지문분석기
          </Link>
          <Link
            href="/admin"
            className="text-xs ml-auto text-sky-400 hover:text-sky-300"
          >
            관리자 홈
          </Link>
        </div>
      </div>
      {children}
    </div>
  );
}
