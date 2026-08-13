'use client';

import { useMemo } from 'react';
import { renderStandaloneDocument } from '@/lib/korean-explainer/render';
import type { KoreanExplanation } from '@/lib/korean-explainer/types';

interface PreviewPaneProps {
  doc: KoreanExplanation;
  stylesCss: string;
  printFixCss: string;
}

export default function PreviewPane({ doc, stylesCss, printFixCss }: PreviewPaneProps) {
  const srcDoc = useMemo(
    () => renderStandaloneDocument(doc, { stylesCss, printFixCss }),
    [doc, stylesCss, printFixCss],
  );

  return (
    <iframe
      title="국어 해설지 미리보기"
      srcDoc={srcDoc}
      className="w-full h-full min-h-[500px] bg-white border border-gray-300 rounded"
    />
  );
}
