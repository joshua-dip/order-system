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
  // kordoc는 제거: serverExternal로 두면 Amplify 파일 트레이싱이 cfb 등 하위 deps를
  // 누락시켜 런타임 500. webpack 번들링하면 cfb·jszip 등이 자동 포함됨.
  // kordoc는 순수 JS(바이너리 없음)라 번들링 안전.
  serverExternalPackages: ["pdfkit", "xlsx", "docx"],
  /** Vercel 등 standalone 빌드에서 fs로 읽는 한글 폰트 + pdfkit 내장 데이터가 번들에 포함되도록 */
  outputFileTracingIncludes: {
    "/api/my/member-variant/export": [
      "./lib/fonts/**/*",
      "./node_modules/pdfkit/js/data/**/*",
    ],
  },
};

export default nextConfig;
