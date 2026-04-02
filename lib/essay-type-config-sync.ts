import type { Collection, Document } from 'mongodb';
import { ESSAY_CATEGORIES } from '@/app/data/essay-categories';

export function essayTypeSeedDocuments(): Document[] {
  let order = 0;
  return ESSAY_CATEGORIES.flatMap((cat) =>
    (cat.소분류 || []).map((소) => {
      const base: Document = {
        대분류: cat.대분류,
        소분류: 소,
        문제: '',
        태그: [] as string[],
        조건: '',
        order: order++,
        enabled: true,
        common: true,
        createdAt: new Date(),
      };
      if (typeof cat.pricePerPassage === 'number' && cat.pricePerPassage >= 0) {
        base.price = cat.pricePerPassage;
      }
      return base;
    })
  );
}

/** 설정에 있는 대분류·소분류가 DB에 없으면 공통 유형으로 추가 */
export async function ensureEssayTypesFromConfig(coll: Collection<Document>) {
  const agg = await coll
    .aggregate<{ maxOrder: number | null }>([{ $group: { _id: null, maxOrder: { $max: '$order' } } }])
    .next();
  const lastOrder = typeof agg?.maxOrder === 'number' ? agg.maxOrder : -1;
  let nextOrder = lastOrder + 1;
  for (const cat of ESSAY_CATEGORIES) {
    for (const 소분류 of cat.소분류 || []) {
      const exists = await coll.findOne({ 대분류: cat.대분류, 소분류 });
      if (exists) continue;
      const doc: Document = {
        대분류: cat.대분류,
        소분류,
        문제: '',
        태그: [],
        조건: '',
        order: nextOrder++,
        enabled: true,
        common: true,
        createdAt: new Date(),
      };
      if (typeof cat.pricePerPassage === 'number' && cat.pricePerPassage >= 0) {
        doc.price = cat.pricePerPassage;
      }
      await coll.insertOne(doc);
    }
  }
}

/** essayTypes 컬렉션을 설정 파일과 맞춤(빈 컬렉션이면 시드 후 누락 행 보충) */
export async function syncEssayTypesCollection(coll: Collection<Document>) {
  const count = await coll.countDocuments();
  if (count === 0) {
    const seed = essayTypeSeedDocuments();
    if (seed.length > 0) await coll.insertMany(seed);
  }
  await ensureEssayTypesFromConfig(coll);
}
