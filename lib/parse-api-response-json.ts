export type ApiJsonBody = Record<string, unknown>;

export function apiJsonErrorMessage(body: ApiJsonBody, fallback: string): string {
  const e = body.error;
  return typeof e === 'string' && e.trim() !== '' ? e : fallback;
}

/** fetch 응답이 HTML(로그인 페이지·404 등)일 때 `.json()` 대신 명확한 오류를 던짐 */
export async function parseApiResponseJson(res: Response): Promise<ApiJsonBody> {
  const text = await res.text();
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<!') || trimmed.startsWith('<')) {
    let extra = '';
    if (res.status === 401 || res.status === 403) {
      extra =
        ' 로그인이 필요하거나 세션이 만료되었을 수 있습니다. 관리자 화면에서 다시 로그인해 주세요.';
    } else if (res.status === 404) {
      extra = ' 요청한 API 경로가 없습니다.';
    } else if (res.status >= 500) {
      extra = ' 서버 오류일 수 있습니다. 터미널 로그를 확인해 주세요.';
    }
    throw new Error(`JSON 대신 HTML 응답을 받았습니다(HTTP ${res.status}).${extra}`);
  }
  try {
    return JSON.parse(text) as ApiJsonBody;
  } catch {
    const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
    throw new Error(`JSON 파싱 실패: ${preview}`);
  }
}
