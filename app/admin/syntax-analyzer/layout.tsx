import Link from 'next/link';

const nav = [
  { href: '/admin/syntax-analyzer', label: '홈' },
  { href: '/admin/syntax-analyzer/analyze', label: '분석 작업대' },
  { href: '/admin/syntax-analyzer/pdf-export', label: 'PDF보내기' },
  { href: '/admin/syntax-analyzer/problem-creation', label: '문제 출제' },
  { href: '/admin/syntax-analyzer/descriptive-blank', label: '서술형(빈칸재배열)' },
  { href: '/admin/syntax-analyzer/question-types', label: '문제 유형 설정' },
];

export default function SyntaxAnalyzerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-900 text-white pb-8">
      <div className="border-b border-slate-700 bg-slate-950/90 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-slate-300 mr-2">지문분석기</span>
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="text-xs px-2.5 py-1 rounded-md bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-600"
            >
              {n.label}
            </Link>
          ))}
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
