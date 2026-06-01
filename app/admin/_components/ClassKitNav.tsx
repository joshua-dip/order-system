'use client';

/**
 * 「클래스키트」 사이드바 메뉴 그룹 — CollapsibleNavGroup 래퍼.
 *
 * 수업 운영에 쓰는 자료 모음. 하위 메뉴:
 *   - 강의용자료 (/admin/class-kit/lecture) : 교사가 강의할 때 쓰는 자료
 *   - 수업용자료 (/admin/class-kit/lesson)  : 수업·배부용 자료
 *
 * 앞으로 유형이 늘면 children 에 형제로 추가.
 * 대시보드·AdminSidebar 양쪽에서 동일하게 쓰여 통일감 보장.
 */

import CollapsibleNavGroup from './CollapsibleNavGroup';

export default function ClassKitNav() {
  return (
    <CollapsibleNavGroup
      header={{ href: '/admin/class-kit', label: '클래스키트' }}
      autoExpandPrefix="/admin/class-kit"
      children={[
        { href: '/admin/class-kit/lecture', label: '강의용자료' },
        // 수업용자료(영한대조, 기본) + 유형별 하위 경로
        { href: '/admin/class-kit/lesson', label: '수업용자료', exact: true },
        { href: '/admin/class-kit/lesson/line', label: '한줄해석' },
        { href: '/admin/class-kit/lesson/write-en', label: '영작하기' },
        { href: '/admin/class-kit/lesson/write-ko', label: '해석쓰기' },
      ]}
    />
  );
}
