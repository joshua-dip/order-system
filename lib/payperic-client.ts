/**
 * payperic(커머스 사이트) 상품 적재 API 클라이언트.
 *
 * env:
 *   PAYPERIC_INGEST_URL    — (선택) ingest 베이스 덮어쓰기. 없으면 DEFAULT_INGEST_URL 사용
 *   PAYPERIC_INGEST_SECRET — 공유 시크릿 (payperic 의 같은 env 와 일치)
 *
 * 흐름: presign(파일명) → S3 로 직접 PUT → create(메타+s3Key).
 * 큰 파일(풀세트 ZIP)도 API Gateway(6MB) 한계 없이 올라간다.
 */

/**
 * ingest 엔드포인트 기본값. 시크릿과 달리 **비밀이 아니라 고정 주소**라 코드에 둔다
 * (env 로 덮어쓸 수는 있다).
 *
 * ★ 반드시 www — apex(payperic.com) 는 www 로 302 리다이렉트되는데, fetch 가 이를
 *   따라가면서 POST 가 GET 으로 강등된다. 그러면 /status 의 GET 핸들러에 도달해
 *   엉뚱하게 「batchKey 필요」(400) 가 나고 적재가 통째로 막힌다.
 */
const DEFAULT_INGEST_URL = 'https://www.payperic.com/api/admin/products/ingest';

function baseUrl(): string {
  const raw = (process.env.PAYPERIC_INGEST_URL || DEFAULT_INGEST_URL).trim().replace(/\/$/, '');
  // 콘솔에 apex 주소가 남아 있어도 리다이렉트를 타지 않도록 www 로 교정.
  return raw.replace(/^https:\/\/payperic\.com(?=\/|$)/, 'https://www.payperic.com');
}
function secret(): string {
  return process.env.PAYPERIC_INGEST_SECRET || '';
}

export function paypericConfigured(): boolean {
  return !!baseUrl() && !!secret();
}

function headers(extra?: Record<string, string>): Record<string, string> {
  return { 'x-ingest-secret': secret(), ...(extra ?? {}) };
}

async function postJson<T>(url: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
    if (!res.ok || !json || (json as { ok?: boolean }).ok === false) {
      const msg = (json as { error?: string })?.error || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return json as T;
  } finally {
    clearTimeout(t);
  }
}

export interface PresignResult {
  uploadUrl: string;
  s3Key: string;
  contentType: string;
}

export async function paypericPresign(originalFileName: string, contentType?: string): Promise<PresignResult> {
  return postJson<PresignResult>(`${baseUrl()}/presign`, { originalFileName, contentType });
}

/** presign 으로 받은 URL 에 파일 바이트를 직접 PUT (S3). */
export async function paypericPutFile(uploadUrl: string, data: Buffer, contentType: string, timeoutMs = 120_000): Promise<void> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: new Uint8Array(data),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`S3 PUT 실패 HTTP ${res.status} ${body.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(t);
  }
}

export interface IngestMeta {
  title: string;
  description: string;
  price: number;
  originalPrice?: number;
  category: string;
  tags: string[];
  isFree: boolean;
  batchKey: string;
  s3Key: string;
  originalFileName: string;
  fileSize: number;
  overwrite?: boolean;
}

export interface IngestResult {
  ok: true;
  action: 'created' | 'updated' | 'skipped';
  productId: string;
  s3Key?: string;
}

export async function paypericCreate(meta: IngestMeta): Promise<IngestResult> {
  return postJson<IngestResult>(`${baseUrl()}`, meta);
}

export interface ExistingProduct {
  title: string;
  price: number;
  isActive: boolean;
  isFree: boolean;
}

export async function paypericStatus(titles: string[]): Promise<ExistingProduct[]> {
  if (titles.length === 0) return [];
  const r = await postJson<{ existing: ExistingProduct[] }>(`${baseUrl()}/status`, { titles });
  return Array.isArray(r.existing) ? r.existing : [];
}

/** 파일 1개를 presign→PUT→create 로 적재. */
export async function paypericUploadOne(
  data: Buffer,
  originalFileName: string,
  meta: Omit<IngestMeta, 's3Key' | 'originalFileName' | 'fileSize'>,
): Promise<IngestResult> {
  const contentType = originalFileName.toLowerCase().endsWith('.zip') ? 'application/zip' : 'application/pdf';
  const presigned = await paypericPresign(originalFileName, contentType);
  await paypericPutFile(presigned.uploadUrl, data, presigned.contentType);
  return paypericCreate({
    ...meta,
    s3Key: presigned.s3Key,
    originalFileName,
    fileSize: data.length,
  });
}
