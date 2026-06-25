import { redirect } from 'next/navigation';

/** VIP 클래스키트 진입 — 강의용자료로 바로 이동 */
export default function VipClassKitPage() {
  redirect('/my/vip/class-kit/lecture');
}
