import { NextResponse } from "next/server";
import { getServerRpcUrl } from "@/lib/kronix/server-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RPC_BODY_BYTES = 2_000_000;

function isJsonRpcRequest(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const maybe = value as { jsonrpc?: unknown; method?: unknown };
  return maybe.jsonrpc === "2.0" && typeof maybe.method === "string";
}

function isJsonRpcPayload(value: unknown): boolean {
  return Array.isArray(value)
    ? value.length > 0 && value.every(isJsonRpcRequest)
    : isJsonRpcRequest(value);
}

export async function POST(req: Request) {
  const body = await req.text();
  if (body.length > MAX_RPC_BODY_BYTES) {
    return NextResponse.json({ error: "RPC request too large" }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON-RPC body" }, { status: 400 });
  }

  if (!isJsonRpcPayload(payload)) {
    return NextResponse.json({ error: "Invalid JSON-RPC request" }, { status: 400 });
  }

  const upstream = await fetch(getServerRpcUrl(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    cache: "no-store",
  });
  const responseBody = await upstream.text();

  return new Response(responseBody, {
    status: upstream.status,
    headers: {
      "cache-control": "no-store",
      "content-type": upstream.headers.get("content-type") ?? "application/json",
    },
  });
}
