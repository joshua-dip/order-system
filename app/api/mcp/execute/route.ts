import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { callMcpTool, McpBridgeError } from "@/lib/mcp-client";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const { error } = await requireAdmin(request);
  if (error) return error;

  try {
    const body = await request.json();
    const { name, arguments: args } = body as {
      name?: string;
      arguments?: Record<string, unknown>;
    };

    if (!name) {
      return NextResponse.json({ error: "Missing required field: name" }, { status: 400 });
    }

    const result = await callMcpTool(name, args || {});
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof McpBridgeError) {
      return NextResponse.json(
        { error: err.message, details: err.details },
        { status: err.statusCode }
      );
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
