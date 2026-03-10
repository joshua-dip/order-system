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

/**
 * Dropbox에 폴더를 생성합니다. 이미 존재하면 무시합니다.
 */
async function createFolder(path: string): Promise<void> {
  const token = await getAccessToken();
  const res = await fetch(`${DROPBOX_API_URL}/files/create_folder_v2`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, autorename: false }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // 이미 존재하는 폴더는 오류가 아님
    const tag = data?.error?.['.tag'] ?? '';
    if (tag === 'path' && data?.error?.path?.['.tag'] === 'conflict') {
      return;
    }
    throw new Error(`Dropbox 폴더 생성 실패 (${path}): ${JSON.stringify(data)}`);
  }
}

/**
 * 주문에 해당하는 폴더 구조를 생성합니다.
 *
 * 구조: /{root}/{이름}_{loginId}/{주문번호}/
 *
 * @returns 생성된 폴더 경로
 */
export async function createOrderFolder({
  loginId,
  name,
  orderNumber,
}: {
  loginId: string;
  name: string;
  orderNumber: string;
}): Promise<string> {
  const root = process.env.DROPBOX_ROOT_FOLDER ?? 'gomijoshua';

  // 파일 시스템에서 허용되지 않는 문자 제거
  const safeName = name.replace(/[/\\:*?"<>|]/g, '').trim() || loginId;
  const safeLoginId = loginId.replace(/[/\\:*?"<>|]/g, '').trim();
  const safeOrderNumber = orderNumber.replace(/[/\\:*?"<>|]/g, '').trim();

  const userFolder = `/${root}/${safeName}_${safeLoginId}`;
  const orderFolder = `${userFolder}/${safeOrderNumber}`;

  // 순서대로 생성 (상위 폴더가 없으면 하위 폴더도 못 만듦)
  await createFolder(`/${root}`);
  await createFolder(userFolder);
  await createFolder(orderFolder);

  return orderFolder;
}

export function isDropboxConfigured(): boolean {
  return !!(
    process.env.DROPBOX_APP_KEY &&
    process.env.DROPBOX_APP_SECRET &&
    process.env.DROPBOX_REFRESH_TOKEN
  );
}
