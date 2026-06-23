'use client';

/**
 * 「서술형 출제기」 사이드바 메뉴 그룹 — CollapsibleNavGroup 래퍼.
 *
 * 유형: 조건영작배열(배열 쓰기 / put-in-order), 글의 의미 서술형(밑줄 함의 서술·영작).
 *   유형이 늘면 children 에 형제로 추가 → /admin/essay-generator/<type>
 *
 * 대시보드·AdminSidebar 양쪽에서 동일하게 쓰여 통일감 보장.
 */

import CollapsibleNavGroup from './CollapsibleNavGroup';

export default function EssayGeneratorNav() {
  return (
    <CollapsibleNavGroup
      header={{ href: '/admin/essay-generator', label: '서술형 출제기' }}
      autoExpandPrefix="/admin/essay-generator"
      children={[
        // 베이스 경로(배열·영작형) — exact 로 sub-route(/meaning) 활성 충돌 방지.
        { href: '/admin/essay-generator', label: '조건영작배열', exact: true },
        { href: '/admin/essay-generator/meaning', label: '글의 의미 서술형' },
        // 새 유형 추가 예시:
        // { href: '/admin/essay-generator/summary', label: '요약문 완성' },
      ]}
    />
  );
}
