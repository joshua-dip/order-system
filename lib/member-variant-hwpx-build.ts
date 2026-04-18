import { markdownToHwpx } from 'kordoc';
import type { MemberVariantExportDoc, ExportMode } from '@/lib/member-variant-export-build';
import {
  exportPlainText,
  flattenMemberQuestionData,
  flattenEssayQuestionData,
  isEssayQuestionType,
} from '@/lib/member-variant-export-build';

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 마크다운 펜스와 충돌하지 않도록 가변 길이 백틱 펜스 */
function mdFencedBlock(text: string): string {
  const t = exportPlainText(text);
  if (!t) return '';
  let fence = '```';
  while (t.includes(fence)) fence += '`';
  return `${fence}\n${t}\n${fence}`;
}

export function memberVariantExportDocsToMarkdown(
  docs: MemberVariantExportDoc[],
  mode: ExportMode = 'teacher',
): string {
  const titleSuffix = mode === 'student' ? ' (학생용)' : ' (교사용)';
  const parts: string[] = [`# 회원 변형 문항${titleSuffix}`, ''];

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i];
    const qd = d.question_data ?? {};
    const docType = str(d.type);
    const isEssay = isEssayQuestionType(docType);
    const head = `${i + 1}. [${exportPlainText(docType)}] (${exportPlainText(str(d.difficulty))}) · ${exportPlainText(str(d.textbook))}`;
    parts.push(`## ${head}`, '');

    if (isEssay) {
      for (const { label, text } of flattenEssayQuestionData(qd, mode)) {
        parts.push(`### ${label}`, '', mdFencedBlock(text), '');
      }
    } else {
      const f = flattenMemberQuestionData(qd);
      if (f.question) parts.push('### 발문', '', mdFencedBlock(f.question), '');
      if (f.paragraph) parts.push('### 지문', '', mdFencedBlock(f.paragraph), '');
      if (f.optionsDisplay) parts.push('### 선택지', '', mdFencedBlock(f.optionsDisplay), '');
      if (mode === 'teacher') {
        parts.push(`**정답:** ${exportPlainText(f.answer) || '—'}`, '');
        if (f.explanation) parts.push('### 해설', '', mdFencedBlock(f.explanation), '');
      }
    }

    if (i < docs.length - 1) parts.push('---', '');
  }
  return parts.join('\n');
}

export async function buildMemberVariantHwpxBuffer(
  docs: MemberVariantExportDoc[],
  mode: ExportMode = 'teacher',
): Promise<Buffer> {
  const md = memberVariantExportDocsToMarkdown(docs, mode);
  const ab = await markdownToHwpx(md);
  return Buffer.from(new Uint8Array(ab));
}
