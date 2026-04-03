import { Binary } from 'mongodb';

/** 유형 목록 조회 시 바이너리 필드 제외 (응답 크기·메모리) */
export const ESSAY_TYPE_LIST_PROJECTION = { 'exampleFile.data': 0 } as const;

export function essayExampleHasReadableContent(exampleFile: {
  data?: unknown;
  savedPath?: string;
} | null | undefined): boolean {
  if (!exampleFile) return false;
  if (exampleFile.data != null) return true;
  return typeof exampleFile.savedPath === 'string' && exampleFile.savedPath.length > 0;
}

export function bufferFromStoredExampleData(data: unknown): Buffer | null {
  if (data == null) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (data instanceof Binary) {
    const v = data.value();
    return Buffer.isBuffer(v) ? Buffer.from(v) : Buffer.from(v);
  }
  return null;
}

export function toMongoExampleBinary(buf: Buffer): Binary {
  return new Binary(buf);
}
