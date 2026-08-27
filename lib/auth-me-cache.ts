/**
 * `/api/auth/me` 중복 호출 제거.
 *
 * 한 화면에 여러 컴포넌트가 각자 `fetch('/api/auth/me')` 를 하고 있었다.
 * 주문서(/textbook)만 해도 TextbookSelection 과 LessonSelection 이 동시에 불러
 * 같은 응답을 두 번 받는다. 요청이 하나 늘면 그만큼 다른 요청과 서로 밀린다
 * (Amplify 는 동시 요청마다 인스턴스를 띄우고 각각 콜드스타트를 문다).
 *
 * 그래서 **진행 중인 요청을 공유**한다. 동시에 부르면 왕복은 한 번뿐이다.
 * 결과는 짧게만 들고 있는다 — 권한이 바뀌었는데 옛 값을 오래 보여주면 안 된다.
 */

/* 컴포넌트마다 필요한 필드가 달라 형태를 좁히지 않는다(이전 res.json() 과 동일). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthMeResponse = { user: any | null };

/** 진행 중인 요청 — 동시 호출은 이걸 함께 기다린다. */
let inFlight: Promise<AuthMeResponse> | null = null;
/** 방금 받은 응답 (TTL 안에서만 재사용) */
let cached: { at: number; value: AuthMeResponse } | null = null;

/** 같은 화면에서 잇따라 나는 호출만 묶을 정도로 짧게. */
const TTL_MS = 3000;

export function fetchAuthMe(): Promise<AuthMeResponse> {
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.value);
  if (inFlight) return inFlight;

  inFlight = fetch('/api/auth/me', { credentials: 'include' })
    .then((res) => res.json())
    .then((json: AuthMeResponse) => {
      cached = { at: Date.now(), value: json };
      return json;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** 로그인·로그아웃처럼 권한이 바뀌는 시점에 호출해 캐시를 버린다. */
export function clearAuthMeCache(): void {
  cached = null;
  inFlight = null;
}
