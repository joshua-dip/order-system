'use client';

/**
 * 「서술형 출제기」 사이드바 메뉴 그룹 — CollapsibleNavGroup 래퍼.
 *
 * 유형: 조건영작배열(배열 쓰기 / put-in-order), 글의 의미 서술형(밑줄 함의 서술·영작),
 *       요지 조건영작배열(<보기> 단어를 순서대로 써서 요지 한 문장 영작).
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
        { href: '/admin/essay-generator/main-idea', label: '요지파악영작형' },
        // 유형을 더 붙일 때: 여기에 형제로 추가 + ESSAY_SPECIAL_EXAM_TYPES 에 등록
        // (등록을 빠뜨리면 배열형 목록에 새 유형이 섞여 보인다)
      ]}
    />
  );
}
