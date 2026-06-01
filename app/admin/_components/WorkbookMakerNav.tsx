'use client';

/**
 * 「워크북 제작기」 사이드바 메뉴 그룹 — CollapsibleNavGroup 래퍼.
 * 대시보드·AdminSidebar 양쪽에서 동일하게 쓰여 통일감 보장.
 */

import CollapsibleNavGroup from './CollapsibleNavGroup';

export default function WorkbookMakerNav() {
  return (
    <CollapsibleNavGroup
      header={{ href: '/admin/workbook-maker', label: '워크북 제작기' }}
      autoExpandPrefix="/admin/workbook-maker"
      children={[
        { href: '/admin/workbook-maker/block-blank', label: '블록 빈칸' },
        { href: '/admin/workbook-maker/sentence-order', label: '순서배열' },
        { href: '/admin/workbook-maker/grammar', label: '어법공략' },
        { href: '/admin/workbook-maker/essay-step', label: '서술형집중' },
      ]}
    />
  );
}
