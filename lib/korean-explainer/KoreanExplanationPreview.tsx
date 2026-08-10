'use client';

/**
 * 국어 해설지 미리보기 (편집기 우측 패널용).
 *
 * iframe srcDoc 으로 격리된 document 안에서 렌더한다.
 *   - styles.css 가 `body`, `*`, `@page` 등 root 셀렉터를 포함해 admin 셸에 누수되는 것을 방지
 *   - 인쇄 페이지와 동일한 출력을 그대로 미리 보여줌
 *
 * 데이터 → HTML 변환은 단일 진실 공급원 [./render.ts](./render.ts) 의 `renderStandaloneDocument`.
 */

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { KoreanExplanation } from './types';
import { renderStandaloneDocument } from './render';

export interface KoreanExplanationPreviewProps {
  doc: KoreanExplanation;
  stylesCss: string;
  printFixCss?: string;
  className?: string;
  style?: CSSProperties;
}

export function KoreanExplanationPreview({
  doc,
  stylesCss,
  printFixCss,
  className,
  style,
}: KoreanExplanationPreviewProps) {
  const srcDoc = useMemo(
    () => renderStandaloneDocument(doc, { stylesCss, printFixCss }),
    [doc, stylesCss, printFixCss],
  );

  return (
    <iframe
      title="국어 해설지 미리보기"
      srcDoc={srcDoc}
      className={className}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 600,
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        ...style,
      }}
    />
  );
}
