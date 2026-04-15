import { markdownToHwpx } from 'kordoc';
import type { MemberVariantExportDoc } from '@/lib/member-variant-export-build';
import { flattenMemberQuestionData, safeExportText } from '@/lib/member-variant-export-build';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 마크다운 펜스와 충돌하지 않도록 가변 길이 백틱 펜스 */
function mdFencedBlock(text: string): string {
  const t = safeExportText(text);
  if (!t) return '';
  let fence = '```';
  while (t.includes(fence)) fence += '`';
  return `${fence}\n${t}\n${fence}`;
}

/** docx/xlsx보내기와 동일한 필드 구성 → kordoc 마크다운 → HWPX ZIP */
export function memberVariantExportDocsToMarkdown(docs: MemberVariantExportDoc[]): string {
  const parts: string[] = ['# 회원 변형 문항', ''];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const f = flattenMemberQuestionData(d.question_data ?? {});
    const head = `${i + 1}. [${safeExportText(str(d.type))}] (${safeExportText(str(d.difficulty))}) · ${safeExportText(str(d.textbook))}`;
    parts.push(`## ${head}`, '');
    if (f.question) {
      parts.push('### 발문', '', mdFencedBlock(f.question), '');
    }
    if (f.paragraph) {
      parts.push('### 지문', '', mdFencedBlock(f.paragraph), '');
    }
    if (f.optionsDisplay) {
      parts.push('### 선택지', '', mdFencedBlock(f.optionsDisplay), '');
    }
    parts.push(`**정답:** ${safeExportText(f.answer) || '—'}`, '');
    if (f.explanation) {
      parts.push('### 해설', '', mdFencedBlock(f.explanation), '');
    }
    if (i < docs.length - 1) parts.push('---', '');
  }
  return parts.join('\n');
}

export async function buildMemberVariantHwpxBuffer(docs: MemberVariantExportDoc[]): Promise<Buffer> {
  const md = memberVariantExportDocsToMarkdown(docs);
  const ab = await markdownToHwpx(md);
  return Buffer.from(new Uint8Array(ab));
}
