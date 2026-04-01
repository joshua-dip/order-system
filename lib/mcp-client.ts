/**
 * Server-side client for the MCP Bridge (claude mcp serve over HTTP).
 * Used by Next.js API routes under /api/mcp/*.
 */

const MCP_BRIDGE_URL = process.env.MCP_BRIDGE_URL || "http://localhost:3100";
const MCP_BRIDGE_TOKEN = process.env.MCP_BRIDGE_TOKEN || "";

interface McpToolInput {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

class McpBridgeError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public details?: unknown
  ) {
    super(message);
    this.name = "McpBridgeError";
  }
}

async function mcpFetch<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);

  try {
    const res = await fetch(`${MCP_BRIDGE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MCP_BRIDGE_TOKEN}`,
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });

    const data = await res.json();

    if (!res.ok) {
      const base = typeof data.error === "string" ? data.error : "Bridge request failed";
      let message = base;
      if (data.details != null) {
        const extra =
          typeof data.details === "string"
            ? data.details
            : JSON.stringify(data.details);
        if (extra && extra !== "{}") {
          message = `${base}: ${extra}`;
        }
      }
      throw new McpBridgeError(message, res.status, data.details);
    }

    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function listMcpTools(): Promise<McpToolInput[]> {
  const data = await mcpFetch<{ tools: { tools: McpToolInput[] } }>("/mcp/tools/list");
  return data.tools?.tools || [];
}

export async function callMcpTool(
  name: string,
  args: Record<string, unknown> = {}
): Promise<McpToolResult> {
  const data = await mcpFetch<{ result: McpToolResult }>("/mcp/tools/call", {
    name,
    arguments: args,
  });
  return data.result;
}

export { McpBridgeError };
export type { McpToolInput, McpToolResult };
