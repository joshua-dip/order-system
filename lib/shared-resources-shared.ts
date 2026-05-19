/**
 * 공유자료 — 클라이언트·서버 공용 타입.
 *
 * 자료 파일 자체는 외부 블로그가 호스팅하고, 이 시스템은 메타데이터만 보관:
 *   - title:    회차/자료 이름 (예: "2026학년도 5월 고3 영어모의고사")
 *   - subtitle: 부제 (예: "전국연합학력평가") — 선택
 *   - blogUrl:  블로그 글 URL (외부)
 *   - order:    목록 정렬 순서 (작을수록 위)
 */

export interface SharedResourceLink {
  _id: string;
  title: string;
  subtitle?: string;
  blogUrl: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}
