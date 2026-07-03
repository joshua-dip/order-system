/** VIP 라우트 전환 로딩 — VIP 다크 테마(#09090b)에 맞춘 즉시 피드백. */
export default function VipLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-[#c9a44e] rounded-full animate-spin" />
        <p className="text-sm text-zinc-500">불러오는 중…</p>
      </div>
    </div>
  );
}
