import { NextResponse } from "next/server";
import {
  deletePhoenixStrategy,
  listPhoenixStrategies,
  patchPhoenixStrategy,
  upsertPhoenixStrategy,
} from "@/lib/phoenix/strategy-store";
import type { PhoenixStrategy, PhoenixStrategyPatch } from "@/lib/phoenix/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const owner = url.searchParams.get("owner") ?? undefined;
    return NextResponse.json(await listPhoenixStrategies(owner));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { strategy?: PhoenixStrategy };
    if (!body.strategy) {
      return NextResponse.json({ error: "strategy missing" }, { status: 400 });
    }
    return NextResponse.json(await upsertPhoenixStrategy(body.strategy));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as {
      owner?: string;
      id?: string;
      patch?: PhoenixStrategyPatch;
    };
    if (!body.owner || !body.id || !body.patch) {
      return NextResponse.json(
        { error: "owner, id, and patch are required" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      await patchPhoenixStrategy(body.owner, body.id, body.patch),
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const body = (await req.json()) as { owner?: string; id?: string };
    if (!body.owner || !body.id) {
      return NextResponse.json({ error: "owner and id required" }, { status: 400 });
    }
    await deletePhoenixStrategy(body.owner, body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
