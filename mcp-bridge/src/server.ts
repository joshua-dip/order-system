import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response, type NextFunction } from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * `claude mcp serve` 작업 디렉터리 — 여기에 .mcp.json 이 있어야 프로젝트 MCP(next-order-variant)가 로드됩니다.
 * 브리지 프로세스 cwd가 mcp-bridge/ 인 경우를 보정 (기본: 이 파일 기준 상위=저장소 루트).
 */
const CLAUDE_MCP_CWD =
  (process.env.MCP_BRIDGE_REPO_ROOT && process.env.MCP_BRIDGE_REPO_ROOT.trim()) ||
  path.resolve(__dirname, "..", "..");

// ── Config ──────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.MCP_BRIDGE_PORT || "3100", 10);
const BEARER_TOKEN = process.env.MCP_BRIDGE_TOKEN || "";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const REQUEST_TIMEOUT_MS = parseInt(process.env.MCP_BRIDGE_TIMEOUT || "120000", 10);

if (!BEARER_TOKEN) {
  console.error("⚠️  MCP_BRIDGE_TOKEN is not set — all requests will be rejected.");
  console.error("   Set it via: MCP_BRIDGE_TOKEN=your-secret-token");
  process.exit(1);
}

// ── MCP Process Manager ─────────────────────────────────────────────────
// Each request spawns a fresh `claude mcp serve` process (stateless).
// stdin/stdout carry JSON-RPC 2.0 messages.

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Spawn `claude mcp serve`, send a JSON-RPC request, and return the response.
 * The process is killed after the response is received or on timeout.
 */
function sendMcpRequest(rpcRequest: JsonRpcRequest): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess | null = null;
    let settled = false;
    let buffer = "";

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child?.kill("SIGKILL");
        reject(new Error(`MCP request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }
    }, REQUEST_TIMEOUT_MS);

    try {
      child = spawn(CLAUDE_PATH, ["mcp", "serve"], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
        cwd: CLAUDE_MCP_CWD,
      });
    } catch (err) {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn claude: ${err}`));
      return;
    }

    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");

      // JSON-RPC messages are newline-delimited
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as JsonRpcResponse;
          // Match by id — ignore notifications (no id)
          if (parsed.id === rpcRequest.id) {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              child?.kill("SIGTERM");
              resolve(parsed);
            }
          }
        } catch {
          // Not valid JSON yet — skip
        }
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      process.stderr.write(`[mcp-stderr] ${chunk.toString("utf-8")}`);
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`claude process error: ${err.message}`));
      }
    });

    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer.trim()) as JsonRpcResponse;
            if (parsed.id === rpcRequest.id) {
              resolve(parsed);
              return;
            }
          } catch {
            // ignore
          }
        }
        reject(new Error(`claude process exited with code ${code} before responding`));
      }
    });

    const initRequest: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: "__init__",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "mcp-bridge", version: "1.0.0" },
      },
    };

    child.stdin!.write(JSON.stringify(initRequest) + "\n");

    const origHandler = child.stdout!.listeners("data").at(-1) as (chunk: Buffer) => void;
    child.stdout!.removeListener("data", origHandler);

    let initBuffer = "";
    const initHandler = (chunk: Buffer) => {
      initBuffer += chunk.toString("utf-8");
      const lines = initBuffer.split("\n");
      initBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.id === "__init__") {
            child!.stdin!.write(
              JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"
            );
            child!.stdin!.write(JSON.stringify(rpcRequest) + "\n");
            child!.stdout!.removeListener("data", initHandler);
            if (initBuffer) {
              buffer = initBuffer;
            }
            child!.stdout!.on("data", origHandler);
            return;
          }
        } catch {
          // ignore
        }
      }
    };
    child.stdout!.on("data", initHandler);
  });
}

// ── Express App ─────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "1mb" }));

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${BEARER_TOKEN}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.use("/mcp", authMiddleware);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.post("/mcp/tools/list", async (_req: Request, res: Response) => {
  try {
    const rpcRequest: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/list",
      params: {},
    };
    const result = await sendMcpRequest(rpcRequest);

    if (result.error) {
      res.status(502).json({ error: "MCP error", details: result.error });
      return;
    }
    res.json({ tools: result.result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.post("/mcp/tools/call", async (req: Request, res: Response) => {
  const { name, arguments: args } = req.body as {
    name?: string;
    arguments?: Record<string, unknown>;
  };

  if (!name) {
    res.status(400).json({ error: "Missing required field: name" });
    return;
  }

  try {
    const rpcRequest: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "tools/call",
      params: { name, arguments: args || {} },
    };
    const result = await sendMcpRequest(rpcRequest);

    if (result.error) {
      res.status(502).json({ error: "MCP error", details: result.error });
      return;
    }
    res.json({ result: result.result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`🔌 MCP Bridge running on http://localhost:${PORT}`);
  console.log(`   claude mcp serve cwd: ${CLAUDE_MCP_CWD}`);
  console.log(`   POST /mcp/tools/list  — list available tools`);
  console.log(`   POST /mcp/tools/call  — call a tool`);
  console.log(`   GET  /health          — health check`);
});
