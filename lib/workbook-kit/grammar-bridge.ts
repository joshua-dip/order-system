/**
 * 어법 G/H — 저장된 grammar_workbooks 만 사용 (Claude 호출 없음).
 */
import {
  getGrammarWorkbook,
  getGrammarWorkbookByPassage,
  listGrammarWorkbooks,
  type GrammarWorkbookFull,
} from '@/lib/grammar-workbooks-store';
import { buildSingleWorkbookHtml } from '@/lib/grammar-workbook-print';
import type { KitHtmlEntry, KitMaterialType, KitPassageInput } from './types';
import { KIT_TYPE_LABEL } from './types';

function modeForType(t: KitMaterialType): 'G' | 'H' | null {
  if (t === 'grammar_either_or') return 'G';
  if (t === 'grammar_correction') return 'H';
  return null;
}

export async function buildGrammarKitEntries(
  passages: KitPassageInput[],
  types: KitMaterialType[],
): Promise<KitHtmlEntry[]> {
  const wanted = types.filter((t) => t === 'grammar_either_or' || t === 'grammar_correction');
  if (!wanted.length || !passages.length) return [];

  const textbook = passages[0].textbook;
  const bySource = new Map(passages.map((p) => [p.sourceKey, p]));

  /* passageId 우선, 없으면 textbook 목록에서 sourceKey 매칭 */
  const docs: GrammarWorkbookFull[] = [];
  const seen = new Set<string>();

  for (const p of passages) {
    if (p.id) {
      try {
        const d = await getGrammarWorkbookByPassage(p.id);
        if (d && !seen.has(d._id)) {
          seen.add(d._id);
          docs.push(d);
          continue;
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (docs.length < passages.length) {
    const listed = await listGrammarWorkbooks({ textbook, limit: 500 });
    for (const row of listed) {
      if (!bySource.has(row.sourceKey)) continue;
      if (seen.has(row._id)) continue;
      const full = await getGrammarWorkbook(row._id);
      if (full) {
        seen.add(full._id);
        docs.push(full);
      }
    }
  }

  const entries: KitHtmlEntry[] = [];
  for (const t of wanted) {
    const mode = modeForType(t)!;
    const matched = docs.filter((d) => d.modes.includes(mode) || (mode === 'G' ? d.modeData.G : d.modeData.H));
    if (!matched.length) {
      entries.push({
        type: t,
        fileName: `${KIT_TYPE_LABEL[t]}.pdf`,
        title: KIT_TYPE_LABEL[t],
        html: '',
        questionCount: 0,
        warning: `선택 지문에 저장된 어법공략(${mode}) 자료가 없습니다. /admin/workbook-maker/grammar 에서 포인트를 만든 뒤 다시 시도하세요.`,
      });
      continue;
    }

    /* 지문마다 별도 PDF 엔트리 */
    for (const doc of matched) {
      const built = buildSingleWorkbookHtml(doc, {
        modes: [mode],
        includePoints: false,
        layout: 'interleaved',
      });
      if (!built) continue;
      const safe = (doc.sourceKey || doc.title || doc._id).replace(/[\\/:*?"<>|]+/g, '_');
      entries.push({
        type: t,
        fileName: `${KIT_TYPE_LABEL[t]}/${safe}.pdf`,
        title: `${KIT_TYPE_LABEL[t]} · ${doc.sourceKey}`,
        html: built.html,
        questionCount: 1,
      });
    }
  }

  return entries;
}
