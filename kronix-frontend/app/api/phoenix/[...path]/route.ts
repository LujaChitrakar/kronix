import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PHOENIX_API_URL = "https://perp-api.phoenix.trade";
const MAX_BODY_BYTES = 1_000_000;

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

function phoenixApiBase(): string {
  return (
    process.env.PHOENIX_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_PHOENIX_API_URL?.trim() ||
    DEFAULT_PHOENIX_API_URL
  );
}

async function forwardPhoenixRequest(req: Request, context: RouteContext) {
  const { path = [] } = await context.params;
  const incoming = new URL(req.url);
  const upstream = new URL(`/${path.join("/")}`, phoenixApiBase());
  upstream.search = incoming.search;

  const headers = new Headers({
    accept: "application/json",
  });
  const contentType = req.headers.get("content-type");
  const authorization = req.headers.get("authorization");
  if (contentType) headers.set("content-type", contentType);
  if (authorization) headers.set("authorization", authorization);

  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.text();
    if (body.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { error: "Phoenix request body too large" },
        { status: 413 },
      );
    }
  }

  const response = await fetch(upstream, {
    method: req.method,
    headers,
    body,
    cache: "no-store",
  });
  const responseBody = await response.text();

  return new Response(responseBody, {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function GET(req: Request, context: RouteContext) {
  return forwardPhoenixRequest(req, context);
}

export async function POST(req: Request, context: RouteContext) {
  return forwardPhoenixRequest(req, context);
}
