'use client';

/**
 * 「구문 분석기」 사이드바 메뉴 그룹 — CollapsibleNavGroup 래퍼.
 *
 * 대시보드·AdminSidebar 양쪽에서 동일하게 쓰여 통일감 보장(서술형 출제기와 같은 패턴).
 * 분석 작업대(analyze)는 지문을 골라야 여는 화면이라 목록에 넣지 않는다 —
 * 홈·지문 분석지 양쪽의 행에서 들어간다.
 */

import CollapsibleNavGroup from './CollapsibleNavGroup';

export default function SyntaxAnalyzerNav() {
  return (
    <CollapsibleNavGroup
      header={{ href: '/admin/syntax-analyzer', label: '구문 분석기' }}
      autoExpandPrefix="/admin/syntax-analyzer"
      children={[
        { href: '/admin/syntax-analyzer', label: '분석 홈', exact: true },
        { href: '/admin/syntax-analyzer/analysis-sheet', label: '지문 분석지' },
      ]}
    />
  );
}
