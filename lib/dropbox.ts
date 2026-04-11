/**
 * Dropbox API 유틸리티
 *
 * 환경 변수:
 *   DROPBOX_APP_KEY      - Dropbox 앱 키
 *   DROPBOX_APP_SECRET   - Dropbox 앱 시크릿
 *   DROPBOX_REFRESH_TOKEN - Dropbox 오프라인 리프레시 토큰
 *   DROPBOX_ROOT_FOLDER  - 최상위 폴더명 (기본값: "gomijoshua")
 */

const DROPBOX_TOKEN_URL = 'https://api.dropbox.com/oauth2/token';
const DROPBOX_API_URL = 'https://api.dropboxapi.com/2';

let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedAccessToken;
  }

  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;

  if (!appKey || !appSecret || !refreshToken) {
    throw new Error('DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN 환경 변수가 필요합니다.');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const credentials = Buffer.from(`${appKey}:${appSecret}`).toString('base64');
  const res = await fetch(DROPBOX_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dropbox 토큰 갱신 실패: ${text}`);
  }

  const data = await res.json();
  cachedAccessToken = data.access_token as string;
  // expires_in은 초 단위 (보통 14400 = 4시간)
  tokenExpiresAt = Date.now() + (data.expires_in ?? 14400) * 1000;

  return cachedAccessToken!;
}

/** 앱 폴더 권한일 때 API에는 루트 접두어 없이 상대 경로만 전달 (실제 경로는 /Apps/gomijoshua/...) */
function toApiPath(logicalPath: string): string {
  const root = process.env.DROPBOX_ROOT_FOLDER ?? 'gomijoshua';
  const prefix = `/${root}`;
  if (logicalPath === prefix || logicalPath === `${prefix}/`) return '';
  if (logicalPath.startsWith(`${prefix}/`)) return logicalPath.slice(prefix.length);
  return logicalPath;
}

/** 경로에 쓸 수 없는 문자만 제거 (한글 등은 유지) */
function safePathSegment(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '').trim() || '_';
}

/** Dropbox-API-Arg 헤더용: JSON에서 non-ASCII를 \uXXXX로 이스케이프해 헤더가 ByteString만 쓰이게 함 */
function dropboxApiArgHeader(obj: Record<string, unknown>): string {
  return JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (c) => {
    const code = c.charCodeAt(0);
    return '\\u' + code.toString(16).padStart(4, '0');
  });
}

/**
 * Dropbox에 폴더를 생성합니다. 이미 존재하면 무시합니다.
 * logicalPath는 우리가 저장하는 경로(/gomijoshua/...), API에는 앱 폴더 기준 상대 경로로 전달합니다.
 */
async function createFolder(logicalPath: string): Promise<void> {
  const apiPath = toApiPath(logicalPath);
  if (!apiPath) return; // 앱 루트는 이미 있음
  const token = await getAccessToken();
  const res = await fetch(`${DROPBOX_API_URL}/files/create_folder_v2`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: apiPath, autorename: false }),
  });

  if (!res.ok) {
    const text = await res.text();
    const data = (() => { try { return JSON.parse(text); } catch { return {}; } })();
    // 이미 존재하는 폴더는 오류가 아님
    const tag = data?.error?.['.tag'] ?? '';
    if (tag === 'path' && data?.error?.path?.['.tag'] === 'conflict') {
      return;
    }
    const detail = Object.keys(data).length ? JSON.stringify(data) : `status ${res.status}: ${text.slice(0, 200)}`;
    throw new Error(`Dropbox 폴더 생성 실패 (${logicalPath}): ${detail}`);
  }
}

/**
 * 회원 전용 드롭박스 폴더를 생성합니다.
 * 경로: /{root}/{이름}_{전화번호} (전화번호 있음) 또는 /{root}/{이름}_{loginId}
 * @returns 생성된 폴더 경로
 */
export async function createUserDropboxFolder(loginId: string, name: string, phone?: string): Promise<string> {
  const root = process.env.DROPBOX_ROOT_FOLDER ?? 'gomijoshua';
  const safeName = safePathSegment(name) || safePathSegment(loginId);
  const suffix = (typeof phone === 'string' && phone.trim())
    ? safePathSegment(phone.replace(/\s/g, ''))
    : safePathSegment(loginId);
  const userFolder = `/${root}/${safeName}_${suffix}`;
  await createFolder(userFolder);
  return userFolder;
}

/**
 * 주문에 해당하는 폴더 구조를 생성합니다.
 * - userDropboxFolderPath가 있으면: 해당 경로 아래에 {주문번호} 폴더만 생성
 * - 없으면: /{root}/{이름}_{전화번호 또는 loginId}/{주문번호}/ 구조로 생성
 *
 * @returns 생성된 주문 폴더 경로
 */
export async function createOrderFolder({
  loginId,
  name,
  orderNumber,
  userDropboxFolderPath,
  phone,
}: {
  loginId: string;
  name: string;
  orderNumber: string;
  userDropboxFolderPath?: string;
  phone?: string;
}): Promise<string> {
  const root = process.env.DROPBOX_ROOT_FOLDER ?? 'gomijoshua';
  const safeOrderNumber = orderNumber.replace(/[/\\:*?"<>|]/g, '').trim();

  if (userDropboxFolderPath && userDropboxFolderPath.trim()) {
    const base = userDropboxFolderPath.trim().replace(/\/+$/, '');
    const path = base.startsWith('/') ? base : `/${base}`;
    const orderFolder = `${path}/${safeOrderNumber}`;
    await createFolder(path);
    await createFolder(orderFolder);
    return orderFolder;
  }

  const safeName = safePathSegment(name) || safePathSegment(loginId);
  const suffix = (typeof phone === 'string' && phone.trim())
    ? safePathSegment(phone.replace(/\s/g, ''))
    : safePathSegment(loginId);
  const userFolder = `/${root}/${safeName}_${suffix}`;
  const orderFolder = `${userFolder}/${safeOrderNumber}`;

  await createFolder(userFolder);
  await createFolder(orderFolder);

  return orderFolder;
}

/**
 * 비회원 주문용 Dropbox 폴더를 생성합니다.
 * 경로: /{root}/비회원/{주문번호}
 */
export async function createOrderFolderForGuest(orderNumber: string): Promise<string> {
  const root = process.env.DROPBOX_ROOT_FOLDER ?? 'gomijoshua';
  const safeOrderNumber = orderNumber.replace(/[/\\:*?"<>|]/g, '').trim() || 'unknown';
  const guestBase = `/${root}/비회원`;
  const orderFolder = `${guestBase}/${safeOrderNumber}`;
  await createFolder(guestBase);
  await createFolder(orderFolder);
  return orderFolder;
}

const DROPBOX_CONTENT_URL = 'https://content.dropboxapi.com/2';

/**
 * 주문 폴더 안에 주문서 내용을 txt 파일로 업로드합니다.
 */
export async function uploadOrderTxt(
  orderFolderPath: string,
  orderNumber: string,
  orderText: string
): Promise<void> {
  const token = await getAccessToken();
  const fileName = `주문서_${orderNumber}.txt`;
  const filePathLogical = orderFolderPath.endsWith('/') ? `${orderFolderPath}${fileName}` : `${orderFolderPath}/${fileName}`;
  const filePathApi = toApiPath(filePathLogical) || `/${fileName}`;
  const utf8Bytes = new TextEncoder().encode(orderText);
  const res = await fetch(`${DROPBOX_CONTENT_URL}/files/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': dropboxApiArgHeader({ path: filePathApi, mode: { '.tag': 'overwrite' } }),
    },
    body: utf8Bytes,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Dropbox 주문서 업로드 실패 (${filePathLogical}): ${JSON.stringify(data)}`);
  }
}

export function isDropboxConfigured(): boolean {
  return !!(
    process.env.DROPBOX_APP_KEY &&
    process.env.DROPBOX_APP_SECRET &&
    process.env.DROPBOX_REFRESH_TOKEN
  );
}

/**
 * VIP 시험지 PDF를 Dropbox에 업로드하고 Dropbox 내부 경로를 반환합니다.
 * 경로: /{root}/vip-exams/{examId}_{filename}
 *
 * 공유 링크 대신 `files/get_temporary_link`을 사용합니다.
 * App folder 타입 앱에서도 동작하며, 링크는 4시간 유효합니다.
 */
export async function uploadVipExamPdf(
  examId: string,
  fileName: string,
  fileBuffer: Buffer,
): Promise<{ path: string; name: string; tempUrl: string }> {
  const token = await getAccessToken();
  const root = process.env.DROPBOX_ROOT_FOLDER ?? 'gomijoshua';
  const safeFileName = fileName.replace(/[/\\:*?"<>|]/g, '_');
  const logicalPath = `/${root}/vip-exams/${examId}_${safeFileName}`;
  const apiPath = toApiPath(logicalPath);

  // 파일 업로드
  const uploadRes = await fetch(`${DROPBOX_CONTENT_URL}/files/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Dropbox-API-Arg': dropboxApiArgHeader({
        path: apiPath,
        mode: { '.tag': 'overwrite' },
        autorename: false,
      }),
    },
    body: fileBuffer as unknown as BodyInit,
  });

  if (!uploadRes.ok) {
    const data = await uploadRes.json().catch(() => ({}));
    throw new Error(`Dropbox 파일 업로드 실패: ${JSON.stringify(data)}`);
  }

  // 임시 다운로드 링크 생성 (4시간 유효, App folder 앱에서도 동작)
  const tempUrl = await getDropboxTempLink(apiPath, token);
  return { path: apiPath, name: safeFileName, tempUrl };
}

/**
 * Dropbox 파일 경로로부터 임시 다운로드 링크를 생성합니다 (4시간 유효).
 */
export async function getDropboxTempLink(apiPath: string, existingToken?: string): Promise<string> {
  const token = existingToken ?? await getAccessToken();
  const res = await fetch(`${DROPBOX_API_URL}/files/get_temporary_link`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: apiPath }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Dropbox 임시 링크 생성 실패: ${JSON.stringify(data)}`);
  }

  const data = await res.json();
  return data.link as string;
}
