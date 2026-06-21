import { redirect } from 'next/navigation';

// 문제 생성 진입 시 기본은 학생별 시험지 만들기
export default function VipGeneratePage() {
  redirect('/my/vip/generate/student');
}
