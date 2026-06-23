import { ObjectId, type Db } from 'mongodb';
import { BLOCK_KINDS, MATERIAL_TYPES, type BlockKind, type MaterialBlock, type MaterialType } from './material-types';

/**
 * VIP 교재 만들기 — 선생님이 특강·문법·리딩 교재를 블록(단원·설명·지문·예문·단어·문제)으로 조립.
 * 콘텐츠는 직접 작성(무과금). 인쇄/PDF 는 별도 인쇄 뷰에서 브라우저 출력.
 */
export const VIP_MATERIALS_COLLECTION = 'vip_materials';

export interface VipMaterial {
  _id?: ObjectId;
  userId: ObjectId; // 선생님(VIP)
  type: MaterialType;
  title: string;
  grade?: string;
  subtitle?: string;
  blocks: MaterialBlock[];
  createdAt: Date;
  updatedAt?: Date;
}

const KIND_SET = new Set<string>(BLOCK_KINDS);
export function isMaterialType(v: unknown): v is MaterialType {
  return typeof v === 'string' && (MATERIAL_TYPES as readonly string[]).includes(v);
}

const MAX_BLOCKS = 200;
let _uidCounter = 0;
function blockUid(): string {
  _uidCounter = (_uidCounter + 1) % 1_000_000;
  return `b${Date.now().toString(36)}${_uidCounter.toString(36)}`;
}

/** 들어온 blocks 배열을 검증·정리 (kind 화이트리스트, 길이 제한, id 보강). */
export function sanitizeBlocks(raw: unknown): MaterialBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: MaterialBlock[] = [];
  for (const item of raw.slice(0, MAX_BLOCKS)) {
    if (!item || typeof item !== 'object') continue;
    const b = item as Record<string, unknown>;
    const kind = (typeof b.kind === 'string' ? b.kind : '') as BlockKind;
    if (!KIND_SET.has(kind)) continue;
    const block: MaterialBlock = {
      id: typeof b.id === 'string' && b.id ? b.id.slice(0, 40) : blockUid(),
      kind,
    };
    if (typeof b.title === 'string' && b.title.trim()) block.title = b.title.slice(0, 200);
    if (typeof b.content === 'string' && b.content) block.content = b.content.slice(0, 20000);
    if (typeof b.ko === 'string' && b.ko) block.ko = b.ko.slice(0, 20000);
    out.push(block);
  }
  return out;
}

let _indexed = false;
export async function ensureMaterialIndexes(db: Db): Promise<void> {
  if (_indexed) return;
  _indexed = true;
  await Promise.all([
    db.collection(VIP_MATERIALS_COLLECTION).createIndex({ userId: 1, updatedAt: -1, createdAt: -1 }),
    db.collection(VIP_MATERIALS_COLLECTION).createIndex({ userId: 1, type: 1 }),
  ]);
}
