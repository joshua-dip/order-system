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
  serverExternalPackages: ["pdfkit", "xlsx", "docx"],
  /** Amplify SSR Lambda 번들에 fs로 읽는 파일들 명시 포함 */
  outputFileTracingIncludes: {
    "/api/my/member-variant/export": [
      "./lib/fonts/**/*",
      "./node_modules/pdfkit/js/data/**/*",
    ],
  },
};

export default nextConfig;
