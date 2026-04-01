/**
 * stdio MCP 서버와 JSON-RPC(줄 단위)로 통신 — 요청마다 프로세스 1회 스폰.
 * `claude mcp serve` 없이 next-order-variant 스크립트만 부를 때 사용.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function getMcpRepoRoot(): string {
  const e = process.env.MCP_BRIDGE_REPO_ROOT?.trim();
  if (e) return path.resolve(e);
  return process.cwd();
}

function sendMcpStdioRequest(options: {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  rpcRequest: JsonRpcRequest;
  timeoutMs: number;
  stderrPrefix: string;
}): Promise<JsonRpcResponse> {
  const { command, args, cwd, env, rpcRequest, timeoutMs, stderrPrefix } = options;

  return new Promise((resolve, reject) => {
    let child: ChildProcess | null = null;
    let settled = false;
    let buffer = '';

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child?.kill('SIGKILL');
        reject(new Error(`MCP stdio request timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    try {
      child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
        cwd,
      });
    } catch (err) {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn MCP server: ${err}`));
      return;
    }

    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as JsonRpcResponse;
          if (parsed.id === rpcRequest.id) {
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              child?.kill('SIGTERM');
              resolve(parsed);
            }
          }
        } catch {
          // skip non-json lines
        }
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      process.stderr.write(`${stderrPrefix}${chunk.toString('utf-8')}`);
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`MCP server process error: ${err.message}`));
      }
    });

    child.on('close', (code) => {
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
        reject(new Error(`MCP server exited with code ${code} before responding`));
      }
    });

    const initRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: '__init__',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'next-order-mcp-direct', version: '1.0.0' },
      },
    };

    child.stdin!.write(JSON.stringify(initRequest) + '\n');

    const origHandler = child.stdout!.listeners('data').at(-1) as (chunk: Buffer) => void;
    child.stdout!.removeListener('data', origHandler);

    let initBuffer = '';
    const initHandler = (chunk: Buffer) => {
      initBuffer += chunk.toString('utf-8');
      const lines = initBuffer.split('\n');
      initBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as { id?: unknown };
          if (parsed.id === '__init__') {
            child!.stdin!.write(
              JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'
            );
            child!.stdin!.write(JSON.stringify(rpcRequest) + '\n');
            child!.stdout!.removeListener('data', initHandler);
            if (initBuffer) {
              buffer = initBuffer;
            }
            child!.stdout!.on('data', origHandler);
            return;
          }
        } catch {
          // ignore
        }
      }
    };
    child.stdout!.on('data', initHandler);
  });
}

export type McpToolResultBody = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

/**
 * `npm run mcp:variant` 로 뜨는 next-order-variant 서버에 tools/call.
 */
export async function callVariantScriptMcpTool(
  toolName: string,
  toolArguments: Record<string, unknown>,
  timeoutMs = 120_000
): Promise<McpToolResultBody> {
  const cwd = getMcpRepoRoot();
  const isWin = process.platform === 'win32';
  const npm = isWin ? 'npm.cmd' : 'npm';

  const rpcRequest: JsonRpcRequest = {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'tools/call',
    params: { name: toolName, arguments: toolArguments },
  };

  const result = await sendMcpStdioRequest({
    command: npm,
    args: ['run', 'mcp:variant'],
    cwd,
    rpcRequest,
    timeoutMs,
    stderrPrefix: '[mcp-variant-stderr] ',
  });

  if (result.error) {
    const msg = result.error.message || 'MCP tool error';
    const err = new Error(msg) as Error & { code?: number; data?: unknown };
    err.code = result.error.code;
    err.data = result.error.data;
    throw err;
  }

  return result.result as McpToolResultBody;
}
