/**
 * 저장된 어법공략 워크북 doc 을 인쇄용 합본 HTML 로 만드는 공용 빌더.
 * 단일 print 라우트, bulk-print 라우트, bulk-pdf-zip 라우트가 공유한다.
 */
import {
  GRAMMAR_MODES,
  type GrammarMode,
  type GrammarWorkbookFull,
} from '@/lib/grammar-workbooks-store';
import {
  buildTransformHtml,
  buildEitherOrHtml,
  buildCorrectionHtml,
  buildOxHtml,
  buildPointsAnalysisHtml,
} from '@/lib/grammar-workbook-html';

const MODE_LABEL: Record<GrammarMode | 'P', string> = {
  F: '어형 변환',
  G: '양자택일',
  H: '어법 오류 수정',
  J: 'O·X 채점',
  P: '어법 포인트',
};

export type PrintLayout = 'interleaved' | 'back';

export interface BuildWorkbookPrintOptions {
  /** 어떤 모드 출력 (기본: doc.modes + (includePoints && doc.modeData.P) ? 'P' : 없음) */
  modes?: (GrammarMode | 'P')[];
  /** 포인트(P) 자동 포함 여부 (modes 미지정 시에만 영향) */
  includePoints?: boolean;
  /** 답지 위치 — interleaved(기본) / back */
  layout?: PrintLayout;
}

function extractStyleAndBody(html: string): { style: string; body: string } {
  let style = '';
  const styleMatches = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  if (styleMatches) {
    style = styleMatches
      .map((m) => m.replace(/^<style[^>]*>/i, '').replace(/<\/style>$/i, ''))
      .join('\n');
  }
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = (bodyMatch ? bodyMatch[1] : html).trim();
  return { style, body };
}

function splitSheetAndAnswer(body: string): { sheet: string; answer: string } {
  const re = /<section\b[^>]*class=["'][^"']*\bgw-answer-key\b[^"']*["'][^>]*>[\s\S]*?<\/section>/i;
  const m = body.match(re);
  if (!m || m.index == null) return { sheet: body, answer: '' };
  const before = body.slice(0, m.index);
  const after = body.slice(m.index + m[0].length);
  return {
    sheet: (before + after).trim(),
    answer: m[0].trim(),
  };
}

/** 한 모드 body 의 맨 앞 「<header class="gw-header">…</header>」 를 제거. */
function stripGwHeader(body: string): string {
  const re = /<header\b[^>]*class=["'][^"']*\bgw-header\b[^"']*["'][^>]*>[\s\S]*?<\/header>\s*/i;
  return body.replace(re, '').trim();
}

/**
 * 한 워크북에서 wanted 모드별로 HTML 을 확보.
 * - modeData 가 있으면 **항상 재빌드** (lib 코드 변경이 즉시 반영되도록 — 저장된 doc.html 캐시는 무시).
 * - modeData 가 없을 때만 저장된 doc.html 캐시를 fallback 으로 사용.
 */
function getPerModeHtmls(
  doc: GrammarWorkbookFull,
  wanted: (GrammarMode | 'P')[],
): { mode: GrammarMode | 'P'; html: string }[] {
  const buildOpts = {
    title: doc.title || '어법공략 워크북',
    textbook: doc.textbook || '',
    sourceKey: doc.sourceKey || '',
    ...(doc.examMeta ?? {}),
  };
  const sentences = Array.isArray(doc.sentences) ? doc.sentences : [];
  const out: { mode: GrammarMode | 'P'; html: string }[] = [];
  for (const m of wanted) {
    let html: string | undefined;
    try {
      if (m === 'F' && doc.modeData?.F) {
        html = buildTransformHtml({ ...buildOpts, sentences, blocks: doc.modeData.F.blocks ?? [] });
      } else if (m === 'G' && doc.modeData?.G) {
        html = buildEitherOrHtml({ ...buildOpts, sentences, points: doc.modeData.G.points ?? [] });
      } else if (m === 'H' && doc.modeData?.H) {
        html = buildCorrectionHtml({ ...buildOpts, sentences, spans: doc.modeData.H.spans ?? [] });
      } else if (m === 'J' && doc.modeData?.J) {
        html = buildOxHtml({ ...buildOpts, intro: doc.modeData.J.intro, items: doc.modeData.J.items ?? [] });
      } else if (m === 'P' && doc.modeData?.P) {
        html = buildPointsAnalysisHtml({ ...buildOpts, sentences, points: doc.modeData.P.points ?? [] });
      }
    } catch (e) {
      console.error(`grammar print: build ${m} failed`, e);
    }
    // 빌드 실패하거나 modeData 가 없는 경우에만 저장된 캐시 fallback
    if (!html && m !== 'P') html = doc.html?.[m];
    if (html && html.trim()) out.push({ mode: m, html });
  }
  return out;
}

function resolveWantedModes(
  doc: GrammarWorkbookFull,
  opts: BuildWorkbookPrintOptions,
): (GrammarMode | 'P')[] {
  if (opts.modes && opts.modes.length > 0) {
    return opts.modes.filter(
      (m): m is GrammarMode | 'P' => m === 'P' || (GRAMMAR_MODES as string[]).includes(m),
    );
  }
  const base: (GrammarMode | 'P')[] = [];
  if (opts.includePoints !== false && doc.modeData?.P?.points?.length) base.push('P');
  for (const m of GRAMMAR_MODES) if (doc.modes.includes(m)) base.push(m);
  return base;
}

/**
 * 한 워크북 → 모드별 시험지+답지 섹션 배열 (style 도 모음).
 * 합본(bulk) 빌더에서 여러 워크북의 섹션을 모아 한 페이지로 조립할 때 사용.
 */
export interface WorkbookSections {
  id: string;
  title: string;
  styles: Set<string>;
  /** layout=interleaved 용 — 모드별로 sheet+answer 가 한 묶음 */
  combined: { mode: GrammarMode | 'P'; section: string }[];
  /** layout=back 용 — 시험지·정답지 분리 */
  sheets: { mode: GrammarMode | 'P'; section: string }[];
  answers: { mode: GrammarMode | 'P'; section: string }[];
  /** 출력된 모드 목록 */
  modes: (GrammarMode | 'P')[];
}

export function buildWorkbookSections(
  doc: GrammarWorkbookFull,
  opts: BuildWorkbookPrintOptions = {},
): WorkbookSections | null {
  const wanted = resolveWantedModes(doc, opts);
  const perMode = getPerModeHtmls(doc, wanted);
  if (perMode.length === 0) return null;
  const styles = new Set<string>();
  const combined: { mode: GrammarMode | 'P'; section: string }[] = [];
  const sheets: { mode: GrammarMode | 'P'; section: string }[] = [];
  const answers: { mode: GrammarMode | 'P'; section: string }[] = [];
  for (const { mode, html } of perMode) {
    const { style, body } = extractStyleAndBody(html);
    if (style) styles.add(style);
    const tag = MODE_LABEL[mode];
    combined.push({
      mode,
      section: `<section class="gw-print-mode" data-mode="${mode}" aria-label="${tag}">\n${body}\n</section>`,
    });
    const { sheet, answer } = splitSheetAndAnswer(body);
    if (sheet) {
      sheets.push({
        mode,
        section: `<section class="gw-print-mode gw-print-sheet" data-mode="${mode}" aria-label="${tag}">\n${sheet}\n</section>`,
      });
    }
    if (answer) {
      answers.push({
        mode,
        section: `<section class="gw-print-mode gw-print-answer" data-mode="${mode}" aria-label="${tag} 정답">\n${answer}\n</section>`,
      });
    }
  }
  return {
    id: String(doc._id ?? ''),
    title: doc.title || '어법공략 워크북',
    styles,
    combined,
    sheets,
    answers,
    modes: perMode.map((p) => p.mode),
  };
}

const PRINT_SHELL_CSS = `
/* === print 합본 전용 보정 === */
.page-break { break-after: page; page-break-after: always; height: 0; }
section.gw-print-mode { break-inside: auto; }
@media print {
  section.gw-print-mode { page-break-inside: auto; }
}
`;

/** bulk 합본 전용 — 강제 페이지 분리를 풀고, 워크북 사이 가벼운 구분선을 두어 공간 효율적으로. */
const BULK_PRINT_SHELL_CSS = `
/* bulk: 모드/답지/워크북 사이 강제 페이지 분리 해제 — 내용이 자연스럽게 흐름 */
@media print {
  .gw-section + .gw-answer-key { page-break-before: auto !important; break-before: auto !important; }
  section.gw-print-mode { page-break-inside: auto; break-inside: auto; }
}
/* 다음 워크북 시작 시 가벼운 시각 구분선 (페이지 분리는 하지 않음) */
.gw-workbook-divider {
  margin: 14pt 0 10pt;
  border-top: 1pt dashed #999;
  height: 0;
}
/* bulk 출력에서 출처 라벨 (학교/학년 헤더 대체용) */
.gw-source-label {
  font-family: 'Noto Sans CJK KR', sans-serif;
  font-size: 9pt;
  color: #555;
  margin: 4pt 0 6pt;
  padding: 2pt 6pt;
  background: #f3f4f6;
  border-left: 3pt solid #6b7280;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}
`;

function shell(titleSafe: string, styleBlock: string, body: string, extraCss = ''): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${titleSafe}</title>
<style>
${styleBlock}
${PRINT_SHELL_CSS}
${extraCss}
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** bulk 모드에서 워크북이 바뀔 때 노출하는 가벼운 출처 라벨 + 점선 구분. */
function bulkSourceBanner(doc: GrammarWorkbookFull, isFirst: boolean, kind: '시험지' | '정답·해설' | '' = ''): string {
  const tb = (doc.textbook || '').trim();
  const sk = (doc.sourceKey || '').trim();
  const title = (doc.title || '').trim();
  const labelParts = [tb, sk, kind].filter(Boolean);
  const labelText = labelParts.join(' · ') || title || '어법공략';
  const divider = isFirst ? '' : '<div class="gw-workbook-divider"></div>';
  return `${divider}<div class="gw-source-label">📘 ${escapeHtmlAttr(labelText)}</div>`;
}

function titleSafe(s: string): string {
  return s.replace(/[<>]/g, '');
}

/**
 * 단일 워크북에서 모드 섹션들을 합본할 때 — P(어법 포인트 분석) 다음에 다른 모드가 있을 때만 page-break.
 * F·G·H·J 사이에는 자연 흐름.
 */
function joinSectionsForSingle(
  sections: { mode: GrammarMode | 'P'; section: string }[],
): string {
  const parts: string[] = [];
  sections.forEach((s, idx) => {
    parts.push(s.section);
    const isPandMore = s.mode === 'P' && idx < sections.length - 1;
    if (isPandMore) parts.push('<div class="page-break"></div>');
  });
  return parts.join('\n');
}

/** 단일 워크북 인쇄용 HTML 합본. (기존 single print API 가 사용) */
export function buildSingleWorkbookHtml(
  doc: GrammarWorkbookFull,
  opts: BuildWorkbookPrintOptions = {},
): { html: string; modes: (GrammarMode | 'P')[]; layout: PrintLayout } | null {
  const sections = buildWorkbookSections(doc, opts);
  if (!sections) return null;
  const layout: PrintLayout = opts.layout === 'back' ? 'back' : 'interleaved';
  const styleBlock = [...sections.styles].join('\n');
  const body =
    layout === 'back'
      ? [
          joinSectionsForSingle(sections.sheets),
          sections.answers.length > 0
            ? `<div class="page-break"></div>\n${joinSectionsForSingle(sections.answers)}`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : joinSectionsForSingle(sections.combined);
  return {
    html: shell(titleSafe(doc.title || '어법공략 워크북'), styleBlock, body),
    modes: sections.modes,
    layout,
  };
}

/**
 * 여러 워크북 → 한 합본 HTML — 「콤팩트」 출력 모드.
 *
 * 공간 효율과 가독성의 균형:
 * - 첫 워크북의 첫 모드만 「학교/학년/성명/출처」 헤더(.gw-header) 표시, 나머지 섹션은 헤더 제거.
 * - 한 워크북 안의 모드 사이엔 page-break 없음 (P → F → G → H → J 자연 흐름).
 * - 시험지 ↔ 정답지 사이 강제 page-break(`gw-section + gw-answer-key`) 해제.
 * - **다음 워크북(다음 강) 시작 시엔 page-break** — 강이 바뀌면 새 페이지에서 시작.
 *
 * layout=interleaved: 워크북마다 (모드들 차례) — 워크북 경계에서만 새 페이지.
 * layout=back: 모든 시험지 → page-break → 모든 답지. 각 영역 안에서도 워크북 경계엔 page-break.
 */
export function buildBulkWorkbookHtml(
  docs: GrammarWorkbookFull[],
  opts: BuildWorkbookPrintOptions & { title?: string } = {},
): { html: string; perWorkbook: { id: string; title: string; modes: (GrammarMode | 'P')[] }[] } | null {
  const builtList = docs
    .map((d) => ({ doc: d, sec: buildWorkbookSections(d, opts) }))
    .filter((x): x is { doc: GrammarWorkbookFull; sec: WorkbookSections } => x.sec != null);
  if (builtList.length === 0) return null;
  const layout: PrintLayout = opts.layout === 'back' ? 'back' : 'interleaved';

  // 공통 style 합치기
  const styleSet = new Set<string>();
  for (const { sec } of builtList) for (const s of sec.styles) styleSet.add(s);
  const styleBlock = [...styleSet].join('\n');

  // 「첫 섹션만 헤더 유지」 카운터 — interleaved/back 모두 공통 적용
  let printedHeaderCount = 0;
  const headerSafe = (section: string): string => {
    if (printedHeaderCount === 0) {
      printedHeaderCount += 1;
      return section; // 첫 섹션: 원본 그대로 (gw-header 포함)
    }
    return stripGwHeader(section);
  };

  // 워크북 경계 page-break — 한 워크북 안에서는 자연 흐름, 다음 워크북(다음 강) 은 새 페이지 시작.
  const WB_BREAK = '<div class="page-break"></div>';
  // 한 워크북 안에서 P(어법 포인트 분석) 다음에 다른 모드가 있으면 새 페이지로.
  const pushSectionsWithPBreak = (
    target: string[],
    sections: { mode: GrammarMode | 'P'; section: string }[],
    safeFn: (s: string) => string,
  ) => {
    sections.forEach((s, idx) => {
      target.push(safeFn(s.section));
      const isPandMore = s.mode === 'P' && idx < sections.length - 1;
      if (isPandMore) target.push(WB_BREAK);
    });
  };

  let body: string;
  if (layout === 'back') {
    // 모든 워크북 시험지 → (한 번의 page-break) → 모든 워크북 답지
    const sheetParts: string[] = [];
    builtList.forEach(({ doc, sec }, i) => {
      if (sec.sheets.length === 0) return;
      if (i > 0) {
        sheetParts.push(WB_BREAK);
        // 첫 워크북은 gw-header 가 출처를 보여주므로 배너 생략. 2번째 이후 워크북만 배너.
        sheetParts.push(bulkSourceBanner(doc, false));
      }
      pushSectionsWithPBreak(sheetParts, sec.sheets, headerSafe);
    });
    // 답지는 새 워크북에서도 헤더 다시 그리지 않으므로, 답지 첫 항목부터 정답지 인덱스를 별도 카운트
    let printedAnswerHeader = 0;
    const answerHeaderSafe = (section: string): string => {
      if (printedAnswerHeader === 0) {
        printedAnswerHeader += 1;
        return section;
      }
      return stripGwHeader(section);
    };
    const answerParts: string[] = [];
    let answerWorkbookIdx = 0;
    builtList.forEach(({ doc, sec }) => {
      if (sec.answers.length === 0) return;
      if (answerWorkbookIdx > 0) {
        answerParts.push(WB_BREAK);
        answerParts.push(bulkSourceBanner(doc, false, '정답·해설'));
      }
      for (const a of sec.answers) answerParts.push(answerHeaderSafe(a.section));
      answerWorkbookIdx += 1;
    });
    body = [
      sheetParts.join('\n'),
      answerParts.length > 0
        ? `${WB_BREAK}\n${answerParts.join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
  } else {
    // interleaved: 워크북마다 (모드들 차례) — 다음 워크북은 새 페이지
    const parts: string[] = [];
    builtList.forEach(({ doc, sec }, i) => {
      if (i > 0) {
        parts.push(WB_BREAK);
        // 첫 워크북은 gw-header 가 출처를 보여주므로 배너 생략.
        parts.push(bulkSourceBanner(doc, false));
      }
      pushSectionsWithPBreak(parts, sec.combined, headerSafe);
    });
    body = parts.join('\n');
  }
  const shellTitle = titleSafe(opts.title || `어법공략 워크북 ${builtList.length}건 합본`);
  return {
    html: shell(shellTitle, styleBlock, body, BULK_PRINT_SHELL_CSS),
    perWorkbook: builtList.map(({ doc, sec }) => ({
      id: String(doc._id ?? ''),
      title: doc.title || '어법공략 워크북',
      modes: sec.modes,
    })),
  };
}
