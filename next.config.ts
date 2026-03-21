import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  /**
   * 상위 디렉터리에 다른 package-lock이 있으면 Next가 추적 루트를 잘못 잡아
   * 서버리스 번들에 필요한 파일이 빠지고 런타임 500이 날 수 있음 (gomijoshua.com 등).
   */
  outputFileTracingRoot: path.resolve(process.cwd()),
};

export default nextConfig;
