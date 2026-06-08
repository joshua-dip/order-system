import { redirect } from 'next/navigation';

/** 클래스키트 진입 — 강의용자료로 바로 이동 */
export default function ClassKitPage() {
  redirect('/class-kit/lecture');
}
