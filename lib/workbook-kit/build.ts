/**
 * 선택 지문 × 유형 → HTML 엔트리 목록 (PDF/ZIP 입력).
 */
import { blankKindFromType, generateBlankPassage } from './blank-generate';
import { buildBlankHtml } from './blank-html';
import { buildGrammarKitEntries } from './grammar-bridge';
import type { KitGenerateOptions, KitHtmlEntry, KitMaterialType, KitPassageInput } from './types';
import { KIT_TYPE_LABEL } from './types';
import { generateWordArrangePassage } from './word-arrange-generate';
import { buildWordArrangeHtml } from './word-arrange-html';

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'workbook';
}

export async function buildWorkbookKitEntries(
  passages: KitPassageInput[],
  opts: KitGenerateOptions,
): Promise<KitHtmlEntry[]> {
  if (!passages.length) return [];
  const textbook = passages[0].textbook;
  const includeTranslation = opts.includeTranslation !== false;
  const entries: KitHtmlEntry[] = [];

  const blankTypes = opts.types.filter((t) => t.startsWith('blank_'));
  for (const t of blankTypes) {
    const kind = blankKindFromType(t);
    if (!kind) continue;
    const results = passages.map((p) => generateBlankPassage(p, kind));
    const withBlanks = results.filter((r) => r.answers.length > 0);
    if (!withBlanks.length) {
      entries.push({
        type: t as KitMaterialType,
        fileName: `${KIT_TYPE_LABEL[t as KitMaterialType]}.pdf`,
        title: KIT_TYPE_LABEL[t as KitMaterialType],
        html: '',
        questionCount: 0,
        warning: '선택한 지문에서 해당 품사 빈칸을 만들지 못했습니다.',
      });
      continue;
    }
    const html = buildBlankHtml(withBlanks, { textbook, includeTranslation, kind });
    const q = withBlanks.reduce((n, r) => n + r.answers.length, 0);
    entries.push({
      type: t as KitMaterialType,
      fileName: `${safeName(KIT_TYPE_LABEL[t as KitMaterialType])}.pdf`,
      title: KIT_TYPE_LABEL[t as KitMaterialType],
      html,
      questionCount: q,
    });
  }

  if (opts.types.includes('word_arrange')) {
    const results = passages.map(generateWordArrangePassage).filter((r) => r.items.length > 0);
    if (!results.length) {
      entries.push({
        type: 'word_arrange',
        fileName: '낱말배열.pdf',
        title: KIT_TYPE_LABEL.word_arrange,
        html: '',
        questionCount: 0,
        warning: '낱말배열을 만들 문장이 없습니다.',
      });
    } else {
      entries.push({
        type: 'word_arrange',
        fileName: '낱말배열.pdf',
        title: KIT_TYPE_LABEL.word_arrange,
        html: buildWordArrangeHtml(results, { textbook }),
        questionCount: results.reduce((n, r) => n + r.items.length, 0),
      });
    }
  }

  const grammar = await buildGrammarKitEntries(passages, opts.types);
  entries.push(...grammar);

  return entries;
}

export function passageFromDoc(doc: {
  _id: string;
  textbook?: string;
  chapter?: string;
  number?: string;
  source_key?: string;
  content?: {
    original?: string;
    sentences_en?: unknown;
    sentences_ko?: unknown;
  };
}): KitPassageInput {
  const c = doc.content ?? {};
  const en = Array.isArray(c.sentences_en)
    ? (c.sentences_en as unknown[]).map((v) => String(v ?? '').trim()).filter(Boolean)
    : [];
  const ko = Array.isArray(c.sentences_ko)
    ? (c.sentences_ko as unknown[]).map((v) => String(v ?? '').trim())
    : [];
  let sentencesEn = en;
  if (!sentencesEn.length && c.original) {
    sentencesEn = String(c.original)
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const chapter = String(doc.chapter ?? '');
  const number = String(doc.number ?? '');
  const sourceKey = String(doc.source_key ?? `${chapter} ${number}`.trim());
  return {
    id: String(doc._id),
    textbook: String(doc.textbook ?? ''),
    chapter,
    number,
    sourceKey,
    sentencesEn,
    sentencesKo: ko,
  };
}
