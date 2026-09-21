/** 낱말배열 HTML — KO + 셔플 보기, 뒤쪽에 정답 */

import type { WordArrangePassageResult } from './types';

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
  body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; font-size: 11pt; color: #111; line-height: 1.5; }
  .wk-head { display: flex; justify-content: space-between; border-bottom: 2px solid #1e3a5f; padding-bottom: 6px; margin-bottom: 12px; }
  .wk-brand { font-weight: 800; letter-spacing: 0.08em; color: #1e3a5f; }
  .wk-kind { font-weight: 700; }
  .wk-prompt { margin: 0 0 14px; font-size: 10.5pt; color: #334155; }
  .wk-pass { margin: 0 0 22px; page-break-inside: avoid; }
  .wk-src { font-weight: 800; margin: 0 0 8px; }
  .wk-item { margin: 0 0 12px; }
  .wk-ko { margin: 0 0 4px; }
  .wk-words { color: #0f172a; font-family: "Times New Roman", "Malgun Gothic", serif; }
  .wk-ans-title { font-weight: 800; margin: 28px 0 10px; border-top: 1px dashed #94a3b8; padding-top: 14px; page-break-before: always; }
  .wk-ans-block { margin: 0 0 12px; font-size: 10pt; }
  .wk-ans-h { font-weight: 700; }
`;

export function buildWordArrangeHtml(
  results: WordArrangePassageResult[],
  opts: { textbook: string },
): string {
  const body: string[] = [];
  for (const r of results) {
    const items = r.items
      .map((it) => {
        const words = it.shuffled.join(' / ');
        return `<div class="wk-item"><div class="wk-ko">(${it.n}) ${esc(it.ko)}</div><div class="wk-words">${esc(words)}</div></div>`;
      })
      .join('');
    body.push(
      `<section class="wk-pass"><div class="wk-src">${esc(r.sourceKey)}</div><div class="wk-prompt">${esc(r.prompt)} [${esc(opts.textbook)} ${esc(r.sourceKey)}]</div>${items}</section>`,
    );
  }

  const ans = results
    .map((r) => {
      const lines = r.items.map((it) => `(${it.n}) ${esc(it.answer)}`).join('<br/>');
      return `<div class="wk-ans-block"><div class="wk-ans-h">${esc(r.sourceKey)}</div>${lines}</div>`;
    })
    .join('');

  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>낱말배열 — ${esc(opts.textbook)}</title><style>${CSS}</style></head><body>
<header class="wk-head"><span class="wk-brand">워크북</span><span class="wk-kind">낱말배열</span></header>
${body.join('\n')}
<div class="wk-ans-title">정답</div>
${ans}
</body></html>`;
}
