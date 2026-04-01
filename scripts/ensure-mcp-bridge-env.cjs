/**
 * .env.local 에 MCP_BRIDGE_TOKEN 등이 없으면 자동으로 추가합니다.
 * 한 번만 실행하면 됩니다: npm run mcp-bridge:setup
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const envLocal = path.join(root, ".env.local");

let raw = "";
try {
  raw = fs.readFileSync(envLocal, "utf8");
} catch {
  raw = "";
}

const hasToken = /^\s*MCP_BRIDGE_TOKEN\s*=\s*\S+/m.test(raw);

if (hasToken) {
  console.log("[mcp-bridge:setup] .env.local 에 이미 MCP_BRIDGE_TOKEN 이 있습니다. 그대로 두었습니다.");
  process.exit(0);
}

const token = crypto.randomBytes(32).toString("hex");
const block = `
# ─── Claude MCP 브리지 (npm run mcp-bridge:setup 로 자동 추가) ───
MCP_BRIDGE_TOKEN=${token}
MCP_BRIDGE_URL=http://localhost:3100
`;

const next = raw ? `${raw.replace(/\s*$/, "")}\n${block}` : block.trimStart();
fs.writeFileSync(envLocal, next, "utf8");
console.log("[mcp-bridge:setup] .env.local 에 MCP_BRIDGE_TOKEN 을 추가했습니다.");
console.log("            이제 터미널에서: npm run dev:with-mcp  또는  별도 창에서 npm run mcp-bridge:dev");
