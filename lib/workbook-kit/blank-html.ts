/** 빈칸쓰기 HTML (학생용 + 답지) — payperic 샘플 톤 */

import type { BlankPassageResult } from './types';
import { KIT_TYPE_LABEL, type BlankKind } from './types';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CSS = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; font-size: 11pt; color: #111; line-height: 1.55; }
  .wk-head { display: flex; justify-content: space-between; border-bottom: 2px solid #1e3a5f; padding-bottom: 6px; margin-bottom: 14px; }
  .wk-brand { font-weight: 800; letter-spacing: 0.08em; color: #1e3a5f; }
  .wk-kind { font-weight: 700; color: #334155; }
  .wk-pass { margin: 0 0 18px; page-break-inside: avoid; }
  .wk-num { font-weight: 800; font-size: 12pt; margin: 0 0 6px; color: #0f172a; }
  .wk-en { margin: 2px 0; }
  .wk-ko { margin: 0 0 8px; color: #334155; font-size: 10.5pt; }
  .wk-ans-title { font-weight: 800; margin: 28px 0 10px; border-top: 1px dashed #94a3b8; padding-top: 14px; }
  .wk-ans-block { margin: 0 0 10px; font-size: 10pt; }
  .wk-ans-h { font-weight: 700; }
`;

function blankLabel(kind: BlankKind): string {
  return KIT_TYPE_LABEL[`blank_${kind}`];
}

export function buildBlankHtml(
  results: BlankPassageResult[],
  opts: { textbook: string; includeTranslation: boolean; kind: BlankKind },
): string {
  const title = blankLabel(opts.kind);
  const bodyParts: string[] = [];
  for (const r of results) {
    const num = r.sourceKey.replace(/^.*\s+/, '') || r.sourceKey;
    const lines: string[] = [];
    for (let i = 0; i < r.blankedLines.length; i++) {
      lines.push(`<div class="wk-en">${esc(r.blankedLines[i])}</div>`);
      if (opts.includeTranslation && r.koLines[i]) {
        lines.push(`<div class="wk-ko">${esc(r.koLines[i])}</div>`);
      }
    }
    bodyParts.push(`<section class="wk-pass"><div class="wk-num">${esc(num)}</div>${lines.join('')}</section>`);
  }

  const ansParts: string[] = [];
  for (const r of results) {
    const num = r.sourceKey.replace(/^.*\s+/, '') || r.sourceKey;
    const flat = r.answers.map((a) => `(${a.n}) ${esc(a.answer)}`).join(' ');
    ansParts.push(`<div class="wk-ans-block"><span class="wk-ans-h">${esc(num)}:</span> ${flat}</div>`);
  }

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)} — ${esc(opts.textbook)}</title><style>${CSS}</style></head><body>
<header class="wk-head"><span class="wk-brand">워크북</span><span class="wk-kind">빈칸쓰기 · ${esc(opts.kind.toUpperCase())}</span></header>
${bodyParts.join('\n')}
<div class="wk-ans-title">정답</div>
${ansParts.join('\n')}
</body></html>`;
}
