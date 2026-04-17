import path from 'path';
import fs from 'fs/promises';
import type { Db } from 'mongodb';

export const TEXTBOOK_LINKS_COLLECTION = 'textbook_links';

export type TextbookLinkDoc = {
  textbookKey: string;
  kyoboUrl: string;
  description: string;
  /** 교재 카드 아래 표시할 추가 링크(예: 쏠북 안내 블로그) */
  extraUrl?: string;
  extraLabel?: string;
  updatedAt: Date;
};

/** API·클라이언트용 맵 (기존 textbook-links.json과 동일 형태 + 선택 extra) */
export type TextbookLinksMap = Record<
  string,
  { kyoboUrl: string; description: string; extraUrl?: string; extraLabel?: string }
>;

/**
 * 컬렉션이 비어 있으면 app/data/textbook-links.json을 읽어 upsert (최초 1회 마이그레이션).
 */
export async function ensureTextbookLinksSeeded(db: Db): Promise<void> {
  const col = db.collection(TEXTBOOK_LINKS_COLLECTION);
  const n = await col.countDocuments();
  if (n > 0) return;

  const jsonPath = path.join(process.cwd(), 'app', 'data', 'textbook-links.json');
  let raw: string;
  try {
    raw = await fs.readFile(jsonPath, 'utf-8');
  } catch {
    console.warn('[textbook_links] 시드 파일 없음:', jsonPath);
    return;
  }

  let obj: TextbookLinksMap;
  try {
    obj = JSON.parse(raw) as TextbookLinksMap;
  } catch (e) {
    console.error('[textbook_links] JSON 파싱 실패:', e);
    return;
  }

  const now = new Date();
  const entries = Object.entries(obj).filter(([k, v]) => {
    if (typeof k !== 'string' || !k.trim() || !v || typeof v !== 'object') return false;
    const rec = v as TextbookLinksMap[string];
    if (typeof rec.kyoboUrl !== 'string' || typeof rec.description !== 'string') return false;
    const ky = rec.kyoboUrl.trim();
    const desc = rec.description.trim();
    const ex = typeof rec.extraUrl === 'string' ? rec.extraUrl.trim() : '';
    return ky !== '' || desc !== '' || ex !== '';
  });

  if (entries.length === 0) return;

  await col.bulkWrite(
    entries.map(([textbookKey, v]) => ({
      updateOne: {
        filter: { textbookKey },
        update: {
          $set: {
            textbookKey,
            kyoboUrl: typeof v.kyoboUrl === 'string' ? v.kyoboUrl.trim() : '',
            description: typeof v.description === 'string' ? v.description.trim() : '',
            ...(typeof v.extraUrl === 'string' && v.extraUrl.trim()
              ? { extraUrl: v.extraUrl.trim(), extraLabel: typeof v.extraLabel === 'string' ? v.extraLabel.trim() : '' }
              : {}),
            updatedAt: now,
          },
        },
        upsert: true,
      },
    }))
  );

  await col.createIndex({ textbookKey: 1 }, { unique: true }).catch(() => {
    /* 이미 있으면 무시 */
  });
}

export async function textbookLinksMapFromDb(db: Db): Promise<TextbookLinksMap> {
  await ensureTextbookLinksSeeded(db);
  const col = db.collection(TEXTBOOK_LINKS_COLLECTION);
  const docs = await col
    .find({})
    .project({ _id: 0, textbookKey: 1, kyoboUrl: 1, description: 1, extraUrl: 1, extraLabel: 1 })
    .toArray();
  const map: TextbookLinksMap = {};
  for (const d of docs) {
    const key = typeof d.textbookKey === 'string' ? d.textbookKey : '';
    if (!key) continue;
    const ex = typeof d.extraUrl === 'string' ? d.extraUrl.trim() : '';
    const el = typeof d.extraLabel === 'string' ? d.extraLabel.trim() : '';
    map[key] = {
      kyoboUrl: String(d.kyoboUrl ?? ''),
      description: String(d.description ?? ''),
      ...(ex ? { extraUrl: ex, ...(el ? { extraLabel: el } : {}) } : {}),
    };
  }
  return map;
}
