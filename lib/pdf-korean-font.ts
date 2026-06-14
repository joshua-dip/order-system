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
 * - NanumGothic: 한글·라틴·대부분의 기호. 단 원형 숫자 ①②③④⑤·▸·✓ 등 일부 기호가 없음.
 * - CircledFallback(DejaVu 서브셋, 4KB): NanumGothic 에 없는 ①-⑩, ✓✔, ▸ 등 기하 기호만 담은 초소형 폰트.
 *   시험지 보기·정답·라벨에 ①②③④⑤·▸ 가 항상 쓰여 누락 시 Lambda 에서 빈칸이 되므로 필수.
 *
 * 사용법(권장): 완성된 HTML 문자열을 prepareKoreanPdfHtml(html) 로 감싼 뒤 page.setContent.
 *   - 시스템 한글 폰트 이름(Noto Sans CJK KR 등)을 임베드 스택으로 치환
 *   - @font-face 정의를 <head> 에 주입
 *   - Lambda 에 폰트 없는 이모지 제거
 */
export const EMBEDDED_KOREAN_FONT_FAMILY = 'NanumGothicEmbedded';
export const EMBEDDED_CIRCLED_FONT_FAMILY = 'CircledFallbackEmbedded';
/** body font-family 선두에 그대로 넣을 수 있는 임베드 폰트 스택(시스템 폴백 앞) */
export const EMBEDDED_FONT_STACK = `'${EMBEDDED_KOREAN_FONT_FAMILY}', '${EMBEDDED_CIRCLED_FONT_FAMILY}'`;

/** Lambda 에 폰트가 없어 깨지는 시스템/웹 한글 폰트 이름 — 임베드 스택으로 치환 대상.
 *  (Pretendard·Nanum Pen Script 등 의도적 웹폰트는 제외. 그건 @import 로 로드되며 호출부가 명시할 때만 치환.) */
const DEFAULT_REMAP_NAMES = [
  'Noto Sans CJK KR', 'Noto Serif CJK KR', 'Noto Sans KR', 'Noto Serif KR',
  'Malgun Gothic', 'Apple SD Gothic Neo', 'AppleGothic',
];

let cachedCss: string | null = null;

function loadCircledFallbackBase64(): string | null {
  try {
    const p = path.join(process.cwd(), 'lib', 'fonts', 'CircledFallback-subset.ttf');
    if (fs.existsSync(p)) return fs.readFileSync(p).toString('base64');
  } catch {
    /* 폴백 폰트 없으면 원형 숫자·▸ 만 깨질 뿐, 한글 본문은 정상 */
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

/**
 * CSS/HTML 문자열에서 시스템 한글 폰트 이름을 임베드 스택으로 치환.
 * 따옴표로 감싼 정확한 이름만 바꿔(본문 텍스트 오염 방지) 안전하다.
 * @param names 치환할 폰트 이름(미지정 시 시스템 CJK 기본 목록)
 */
export function remapKoreanFontFamilies(input: string, names: string[] = DEFAULT_REMAP_NAMES): string {
  let out = input;
  for (const n of names) {
    out = out.split(`'${n}'`).join(EMBEDDED_FONT_STACK);
    out = out.split(`"${n}"`).join(EMBEDDED_FONT_STACK);
  }
  return out;
}

/**
 * <style> 안 모든 font-family 체인의 generic(sans-serif/serif/monospace) 바로 앞에
 * 임베드 스택을 끼워 넣는다. 폰트 이름을 일일이 몰라도 어떤 체인이든 한글 폴백이 보장됨:
 *   'Pretendard',sans-serif          → 'Pretendard', <임베드>, sans-serif
 *   'Noto Sans CJK KR',sans-serif    → 'Noto Sans CJK KR', <임베드>, sans-serif
 * (소문자 generic 키워드만 매칭 — 'Noto Serif KR' 같은 폰트명은 건드리지 않음.)
 * 본문 텍스트 오염을 막기 위해 <style> 블록 안에서만 치환한다.
 */
function insertEmbeddedBeforeGenerics(html: string): string {
  return html.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open, body, close) => {
    let patched: string = body.replace(
      /(^|,)(\s*)(sans-serif|serif|monospace)\b/g,
      (_mm: string, pre: string, sp: string, gen: string) => `${pre}${sp}${EMBEDDED_FONT_STACK}, ${gen}`,
    );
    /* var(--ko-font, …)/var(--en-font, …) 는 변수가 '설정되면' 안쪽 폴백을 무시하므로,
       닫는 괄호 뒤에 임베드 스택을 한 번 더 붙여 웹폰트 실패 시에도 한글이 살아나게 한다. */
    patched = patched.replace(
      /var\(\s*--[a-z-]*font[^)]*\)/gi,
      (mm: string) => `${mm}, ${EMBEDDED_FONT_STACK}`,
    );
    return `${open}${patched}${close}`;
  });
}

/** Lambda Chromium 에 이모지 폰트가 없어 tofu 로 찍히는 이모지 제거 (✓▸① 등 기호는 보존). */
function stripEmoji(html: string): string {
  return html.replace(
    /[\u{1F000}-\u{1FAFF}\u{FE00}-\u{FE0F}\u{200D}\u{2B50}\u{2705}\u{274C}\u{2728}\u{2764}\u{2757}\u{2049}\u{203C}]/gu,
    '',
  );
}

/**
 * 완성된 HTML 문자열을 서버 PDF 렌더용으로 변환:
 *  1) 모든 font-family 체인의 generic 앞에 임베드 스택 삽입(어떤 폰트든 한글 폴백 보장)
 *  2) (옵션) 특정 시스템 폰트 이름을 임베드 스택으로 직접 치환
 *  3) 이모지 제거(Lambda 폰트 없음)
 *  4) @font-face 정의를 </head> 직전에 주입(@import 순서 영향 없음)
 *
 * Pretendard·Nanum Pen Script 등 의도적 웹폰트는 그대로 두고(네트워크 되면 로드), 그 뒤에
 * 임베드 한글이 폴백으로 붙으므로 웹폰트 실패 시에도 한글이 깨지지 않는다.
 *
 * @param opts.remapNames 추가로 임베드 스택으로 치환할 폰트 이름(선택)
 */
export async function prepareKoreanPdfHtml(
  html: string,
  opts?: { remapNames?: string[] },
): Promise<string> {
  const fontCss = await getEmbeddedKoreanFontFaceCss();
  let out = insertEmbeddedBeforeGenerics(html);
  if (opts?.remapNames && opts.remapNames.length > 0) {
    out = remapKoreanFontFamilies(out, opts.remapNames);
  }
  out = stripEmoji(out);
  const styleTag = `<style>${fontCss}</style>`;
  if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, `${styleTag}</head>`);
  else if (/<style[^>]*>/i.test(out)) out = out.replace(/<style[^>]*>/i, (m) => `${styleTag}\n${m}`);
  else out = `${styleTag}\n${out}`;
  return out;
}
