import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 홈 디렉터리 등 상위에 package-lock.json 이 있으면 Next가 워크스페이스 루트를 잘못 잡습니다.
 * 이 저장소 디렉터리를 추적 루트로 고정합니다(import.meta.url — cwd 와 무관).
 */
const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingRoot: __dirname,
  // kordoc는 webpack 번들 대상 (cfb/canvas 동적 require 문제 회피 위해 serverExternal 제외).
  // hwpx 생성은 kordoc 대신 jszip 직접 구현으로 교체.
  serverExternalPackages: ["pdfkit", "xlsx", "docx", "puppeteer-core", "@sparticuz/chromium"],
  /** Amplify SSR Lambda 번들에 fs로 읽는 파일들 명시 포함 */
  outputFileTracingIncludes: {
    "/api/my/member-variant/export": [
      "./lib/fonts/**/*",
      "./node_modules/pdfkit/js/data/**/*",
    ],
    /* VIP 시험지 PDF(pdfkit) — 한글(NanumGothic)·원형숫자(CircledFallback) 폰트 + pdfkit 데이터를
       Lambda 번들에 포함해야 배포에서 PDF 폰트가 깨지지 않음 (QR 채점본 다운로드 포함). */
    "/api/my/vip/generate/download": [
      "./lib/fonts/**/*",
      "./node_modules/pdfkit/js/data/**/*",
    ],
    /* puppeteer 서버 PDF — chromium 바이너리 + 한글 임베드 폰트(lib/fonts)를 Lambda 번들에 포함.
       (한글 PDF 폰트 깨짐 방지: lib/pdf-korean-font.ts 가 lib/fonts/*.ttf 를 fs 로 읽음) */
    "/api/admin/essay-generator/bulk-pdf-zip": [
      "./lib/fonts/**/*",
      "./node_modules/@sparticuz/chromium/**/*",
    ],
    "/api/admin/grammar-workbook/bulk-pdf-zip": [
      "./lib/fonts/**/*",
      "./node_modules/@sparticuz/chromium/**/*",
    ],
    "/api/my/final-exams/[id]/download": [
      "./lib/fonts/**/*",
      "./node_modules/@sparticuz/chromium/**/*",
    ],
    "/api/admin/class-kit/lecture-pdf": ["./lib/fonts/**/*", "./node_modules/@sparticuz/chromium/**/*"],
    "/api/admin/class-kit/lecture-pdf-bulk": ["./lib/fonts/**/*", "./node_modules/@sparticuz/chromium/**/*"],
    "/api/admin/class-kit/lesson-pdf": ["./lib/fonts/**/*", "./node_modules/@sparticuz/chromium/**/*"],
    "/api/admin/class-kit/lesson-pdf-bulk": ["./lib/fonts/**/*", "./node_modules/@sparticuz/chromium/**/*"],
    "/api/class-kit/lecture-pdf": ["./lib/fonts/**/*", "./node_modules/@sparticuz/chromium/**/*"],
    "/api/class-kit/lecture-pdf-bulk": ["./lib/fonts/**/*", "./node_modules/@sparticuz/chromium/**/*"],
    "/api/class-kit/lesson-pdf": ["./lib/fonts/**/*", "./node_modules/@sparticuz/chromium/**/*"],
    "/api/class-kit/lesson-pdf-bulk": ["./lib/fonts/**/*", "./node_modules/@sparticuz/chromium/**/*"],
  },
};

export default nextConfig;
