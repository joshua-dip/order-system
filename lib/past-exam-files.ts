/**
 * 기출 시험지 파일 저장 — GridFS.
 *
 * 원래는 로컬 파일시스템(uploads/past-exam/…)에 저장했는데, Amplify(Lambda)는
 * 파일시스템이 영구적이지 않아 인스턴스가 재활용되면 파일이 사라진다.
 * 새로 저장하는 건은 GridFS 에 넣고, 예전에 올라간 건(savedPath)은 그대로 읽을 수 있게
 * 두 형태를 모두 지원한다.
 */
import { ObjectId, GridFSBucket, type Db } from 'mongodb';

export const PAST_EXAM_BUCKET = 'past_exam_files';

/** DB 에 저장되는 파일 항목 — gridId(신규) 또는 savedPath(레거시) 중 하나를 가진다 */
export interface PastExamFileRef {
  originalName: string;
  /** GridFS 파일 id (신규 저장분) */
  gridId?: ObjectId;
  contentType?: string;
  size?: number;
  /** 로컬 파일 경로 (레거시 저장분) */
  savedPath?: string;
}

export function bucket(db: Db): GridFSBucket {
  return new GridFSBucket(db, { bucketName: PAST_EXAM_BUCKET });
}

export async function putPastExamFile(
  db: Db,
  buf: Buffer,
  filename: string,
  contentType: string,
): Promise<ObjectId> {
  const stream = bucket(db).openUploadStream(filename, { contentType });
  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject);
    stream.on('finish', () => resolve());
    stream.end(buf);
  });
  return stream.id as ObjectId;
}

export async function getPastExamFile(db: Db, gridId: ObjectId): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of bucket(db).openDownloadStream(gridId)) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

export async function delPastExamFile(db: Db, gridId: ObjectId): Promise<void> {
  try {
    await bucket(db).delete(gridId);
  } catch {
    /* 이미 없음 */
  }
}

/** 확장자로 대략적인 Content-Type 을 정한다 (기출은 PDF·이미지·한글 파일이 대부분) */
export function guessContentType(name: string): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    heic: 'image/heic',
    hwp: 'application/x-hwp',
    hwpx: 'application/haansofthwpx',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    zip: 'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}
