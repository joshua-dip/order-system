import type { NextConfig } from "next";
import path from "path";

/**
 * 상위 디렉터리에 다른 package-lock이 있으면 프로덕션 빌드 시 추적 루트가 어긋날 수 있음.
 * `next dev`에도 동일 옵션을 쓰면 `.next/required-server-files.json` 등이 꼬여 ENOENT가 나는 경우가 있어
 * 프로덕션 빌드에만 적용합니다.
 */
const prodTracing =
  process.env.NODE_ENV === "production"
    ? { outputFileTracingRoot: path.resolve(process.cwd()) }
    : {};

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  ...prodTracing,
};

export default nextConfig;
