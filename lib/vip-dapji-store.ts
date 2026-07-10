import { ObjectId, GridFSBucket, type Db } from 'mongodb';

/**
 * 답지닷컴 — 답지(정답·해설) 파일 라이브러리.
 * - 소유자(userId)별로 답지 PDF·이미지를 보관·열람·다운로드. 계정 간 공유 없음.
 * - 파일 본체는 GridFS(vip_dapji_fs)에 저장 → 서버리스(Amplify) 재배포에도 유지.
 * - 메타데이터는 vip_dapji_files 컬렉션.
 * ⚠️ 업로드 답지 중 출판 교재(그래머와이즈 등)의 해설 PDF 는 출판사 저작물 — 내부 참고 전용,
 *    공개 API(/api/public/*)로 노출하지 않는다. (owner-scoped 서빙만)
 */
export const DAPJI_FILES_COLLECTION = 'vip_dapji_files';
export const DAPJI_BUCKET = 'vip_dapji_fs';

export const DAPJI_MAX_SIZE = 30 * 1024 * 1024; // 30MB
export const DAPJI_ALLOWED: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export interface DapjiFileDoc {
  _id?: ObjectId;
  userId: ObjectId;
  title: string; // 표시 제목 (예: 그래머와이즈 LEVEL 1 답지)
  level: string; // 분류 라벨 (예: LEVEL 1 / 중등 / 자유)
  note: string; // 메모
  filename: string; // 원본 파일명
  contentType: string;
  size: number;
  gridId: ObjectId; // GridFS 파일 id
  copyrighted: boolean; // 출판 교재 답지 여부 (내부 전용 배지)
  createdAt: Date;
}

export function bucket(db: Db): GridFSBucket {
  return new GridFSBucket(db, { bucketName: DAPJI_BUCKET });
}

/** GridFS 에 버퍼 저장 → fileId 반환 */
export async function putFile(db: Db, buf: Buffer, filename: string, contentType: string): Promise<ObjectId> {
  const b = bucket(db);
  const stream = b.openUploadStream(filename, { contentType });
  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject);
    stream.on('finish', () => resolve());
    stream.end(buf);
  });
  return stream.id as ObjectId;
}

/** GridFS 에서 파일 버퍼 로드 */
export async function getFile(db: Db, gridId: ObjectId): Promise<Buffer> {
  const b = bucket(db);
  const chunks: Buffer[] = [];
  const dl = b.openDownloadStream(gridId);
  for await (const c of dl) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** GridFS 파일 삭제 (없어도 무시) */
export async function delFile(db: Db, gridId: ObjectId): Promise<void> {
  try { await bucket(db).delete(gridId); } catch { /* 이미 없음 */ }
}
