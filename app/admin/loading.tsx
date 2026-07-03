/** admin 라우트 전환 로딩 — 다크 테마에 맞춘 즉시 피드백. */
export default function AdminLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="flex flex-col items-center gap-3">
        <div className="w-9 h-9 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-400">불러오는 중…</p>
      </div>
    </div>
  );
}
