/**
 * 프로젝트 루트의 .env.local 을 읽은 뒤 mcp-bridge 를 띄웁니다.
 */
const path = require("path");
const { spawn } = require("child_process");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env.local") });

const token = process.env.MCP_BRIDGE_TOKEN;
if (!token || !String(token).trim()) {
  console.error("");
  console.error("[mcp-bridge:dev] MCP_BRIDGE_TOKEN 이 없습니다.");
  console.error("            먼저 실행: npm run mcp-bridge:setup");
  console.error("");
  process.exit(1);
}

const bridgeDir = path.join(__dirname, "..", "mcp-bridge");
const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";

const child = spawn(npx, ["tsx", "src/server.ts"], {
  cwd: bridgeDir,
  stdio: "inherit",
  env: { ...process.env },
});

child.on("exit", (code) => process.exit(code ?? 0));
