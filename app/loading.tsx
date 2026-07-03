/**
 * 전역 라우트 전환 로딩 — 클릭 즉시 시각 피드백을 줘 "버튼이 안 먹는" 느낌 방지.
 * (loading.tsx 가 없으면 App Router 는 다음 페이지가 준비될 때까지 이전 화면을 그대로 유지)
 */
export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#F8FAFC' }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-9 h-9 border-4 border-[#2563eb] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-[#64748b]">불러오는 중…</p>
      </div>
    </div>
  );
}
