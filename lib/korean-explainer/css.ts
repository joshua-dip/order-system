/**
 * 국어 해설지 CSS 로더 — 서버 전용.
 *
 * reference_styles.css 는 `body`, `*` 등 root-level 셀렉터를 포함해 그대로 페이지에
 * 임포트하면 admin 셸에 스타일이 누수된다. 그래서 미리보기/인쇄 본문은 항상
 * 별도 document 컨텍스트(iframe srcDoc / 새 창 / 단독 HTML 파일)에서 렌더한다.
 *
 * 본 모듈은 그 단독 HTML 의 `<style>` 안에 인라인 삽입할 CSS 문자열을 돌려준다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'lib', 'korean-explainer');

let cached: { styles: string; printFix: string } | null = null;

export function getKoreanExplainerCss(): { stylesCss: string; printFixCss: string; combined: string } {
  if (!cached) {
    cached = {
      styles: readFileSync(join(DIR, 'styles.css'), 'utf8'),
      printFix: readFileSync(join(DIR, 'print-fix.css'), 'utf8'),
    };
  }
  return {
    stylesCss: cached.styles,
    printFixCss: cached.printFix,
    combined: `${cached.styles}\n${cached.printFix}`,
  };
}
