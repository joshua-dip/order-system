import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';
import { passageFromDoc } from '@/lib/workbook-kit/build';
import type { KitPassageInput } from '@/lib/workbook-kit/types';

export async function loadKitPassagesByIds(ids: string[]): Promise<KitPassageInput[]> {
  const oids: ObjectId[] = [];
  for (const id of ids) {
    try {
      oids.push(new ObjectId(id));
    } catch {
      /* skip */
    }
  }
  if (!oids.length) return [];
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('passages')
    .find({ _id: { $in: oids } })
    .project({
      textbook: 1,
      chapter: 1,
      number: 1,
      source_key: 1,
      'content.original': 1,
      'content.sentences_en': 1,
      'content.sentences_ko': 1,
    })
    .toArray();
  const byId = new Map(docs.map((d) => [String(d._id), d]));
  const out: KitPassageInput[] = [];
  for (const id of ids) {
    const d = byId.get(id);
    if (!d) continue;
    out.push(
      passageFromDoc({
        _id: String(d._id),
        textbook: d.textbook as string | undefined,
        chapter: d.chapter as string | undefined,
        number: d.number as string | undefined,
        source_key: d.source_key as string | undefined,
        content: d.content as KitPassageInput extends never ? never : {
          original?: string;
          sentences_en?: unknown;
          sentences_ko?: unknown;
        },
      }),
    );
  }
  return out;
}

export async function loadKitPassagesBySourceKeys(
  textbook: string,
  sourceKeys: string[],
): Promise<KitPassageInput[]> {
  const keys = sourceKeys.map((s) => s.trim()).filter(Boolean);
  if (!textbook.trim() || !keys.length) return [];
  const db = await getDb('gomijoshua');
  const docs = await db
    .collection('passages')
    .find({ textbook: textbook.trim(), source_key: { $in: keys } })
    .project({
      textbook: 1,
      chapter: 1,
      number: 1,
      source_key: 1,
      'content.original': 1,
      'content.sentences_en': 1,
      'content.sentences_ko': 1,
    })
    .toArray();
  const byKey = new Map(docs.map((d) => [String(d.source_key), d]));
  const out: KitPassageInput[] = [];
  for (const k of keys) {
    const d = byKey.get(k);
    if (!d) continue;
    out.push(
      passageFromDoc({
        _id: String(d._id),
        textbook: d.textbook as string | undefined,
        chapter: d.chapter as string | undefined,
        number: d.number as string | undefined,
        source_key: d.source_key as string | undefined,
        content: d.content as {
          original?: string;
          sentences_en?: unknown;
          sentences_ko?: unknown;
        },
      }),
    );
  }
  return out;
}
