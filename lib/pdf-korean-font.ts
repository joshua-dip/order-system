import path from 'path';
import fs from 'fs';
import { getKoreanFontBuffer } from './member-variant-export-build';

/**
 * puppeteer( @sparticuz/chromium ) 서버 PDF 렌더용 한글 폰트 임베드.
 *
 * Amplify/Lambda 의 Chromium 에는 CJK(한글) 시스템 폰트가 없어서
 * 'Malgun Gothic'·'Noto Sans CJK KR' 같은 system font-family 를 지정해도
 * 한글이 빈칸으로 렌더된다. 그래서 폰트를 base64 @font-face 로 HTML 안에
 * 직접 실어 보내 환경과 무관하게 한글이 보이도록 한다.
 *
 * - NanumGothic: 한글·라틴·대부분의 기호. 단 원형 숫자 ①②③④⑤ 가 없음.
 * - CircledFallback(DejaVu 서브셋): NanumGothic 에 없는 ①-⑩, ✓✔ 만 담은 초소형 폰트.
 *   시험지 보기·정답에 ①②③④⑤ 가 항상 쓰여 누락 시 Lambda 에서 빈칸이 되므로 필수.
 *
 * 사용법: 빌더 <style> 맨 앞에 getEmbeddedKoreanFontFaceCss() 를 넣고,
 * body font-family 선두에 EMBEDDED_FONT_STACK 순서대로 둔다.
 */
export const EMBEDDED_KOREAN_FONT_FAMILY = 'NanumGothicEmbedded';
export const EMBEDDED_CIRCLED_FONT_FAMILY = 'CircledFallbackEmbedded';
/** body font-family 선두에 그대로 넣을 수 있는 임베드 폰트 스택(시스템 폴백 앞) */
export const EMBEDDED_FONT_STACK = `'${EMBEDDED_KOREAN_FONT_FAMILY}', '${EMBEDDED_CIRCLED_FONT_FAMILY}'`;

let cachedCss: string | null = null;

function loadCircledFallbackBase64(): string | null {
  try {
    const p = path.join(process.cwd(), 'lib', 'fonts', 'CircledFallback-subset.ttf');
    if (fs.existsSync(p)) return fs.readFileSync(p).toString('base64');
  } catch {
    /* 폴백 폰트 없으면 원형 숫자만 깨질 뿐, 한글 본문은 정상 */
  }
  return null;
}

export async function getEmbeddedKoreanFontFaceCss(): Promise<string> {
  if (cachedCss) return cachedCss;
  const korean = (await getKoreanFontBuffer()).toString('base64');
  /* font-weight 100 900 — Regular 한 벌로 모든 굵기를 커버(굵은 글씨는 Chromium 합성 볼드).
     범위를 좁히면 800 같은 굵은 한글 제목이 다음 폰트로 빠져 다시 빈칸이 됨. */
  let css = `@font-face {
  font-family: '${EMBEDDED_KOREAN_FONT_FAMILY}';
  src: url(data:font/ttf;base64,${korean}) format('truetype');
  font-weight: 100 900;
  font-style: normal;
  font-display: block;
}`;
  const circled = loadCircledFallbackBase64();
  if (circled) {
    css += `\n@font-face {
  font-family: '${EMBEDDED_CIRCLED_FONT_FAMILY}';
  src: url(data:font/ttf;base64,${circled}) format('truetype');
  font-weight: 100 900;
  font-style: normal;
  font-display: block;
}`;
  }
  cachedCss = css;
  return cachedCss;
}
