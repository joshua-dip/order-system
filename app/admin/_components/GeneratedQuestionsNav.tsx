'use client';

/**
 * 「변형문제 관리 (DB)」 사이드바 메뉴 그룹 — CollapsibleNavGroup 래퍼.
 * 하위: 객관식 관리 / 서술형 관리 (query string mode 로 구분).
 * 대시보드·AdminSidebar 양쪽에서 동일하게 쓰여 통일감 보장.
 *
 * review-logs(`/admin/generated-questions/review-logs`) 는 별도 메뉴이므로 자동 펼침에서 제외.
 */

import CollapsibleNavGroup from './CollapsibleNavGroup';

export default function GeneratedQuestionsNav() {
  return (
    <CollapsibleNavGroup
      header={{ href: '/admin/generated-questions', label: '변형문제 관리 (DB)' }}
      autoExpandPrefix="/admin/generated-questions"
      excludePrefixes={['/admin/generated-questions/review-logs']}
      children={[
        { href: '/admin/generated-questions?mode=objective', label: '객관식 관리' },
        { href: '/admin/generated-questions?mode=essay', label: '서술형 관리' },
      ]}
    />
  );
}
