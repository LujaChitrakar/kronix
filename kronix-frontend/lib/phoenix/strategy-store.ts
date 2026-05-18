import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  PhoenixStrategy,
  PhoenixStrategyPatch,
} from "./client";

type StoreShape = {
  strategies: PhoenixStrategy[];
};

const STORE_PATH =
  process.env.PHOENIX_STRATEGY_STORE_PATH?.trim() ||
  path.join(
    /* turbopackIgnore: true */ process.cwd(),
    ".data",
    "phoenix-strategies.json",
  );

function nowDayStart(): number {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as StoreShape;
    return Array.isArray(parsed.strategies) ? parsed : { strategies: [] };
  } catch {
    return { strategies: [] };
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2));
  await rename(tmp, STORE_PATH);
}

function resetDailyCounters(strategy: PhoenixStrategy): PhoenixStrategy {
  const dayStart = nowDayStart();
  const last = strategy.lastExecutedAt ?? 0;
  if (last >= dayStart) return strategy;
  return {
    ...strategy,
    executionsToday: 0,
  };
}

export async function listPhoenixStrategies(
  owner?: string,
): Promise<PhoenixStrategy[]> {
  const store = await readStore();
  return store.strategies
    .map(resetDailyCounters)
    .filter((strategy) => !owner || strategy.owner === owner);
}

export async function upsertPhoenixStrategy(
  strategy: PhoenixStrategy,
): Promise<PhoenixStrategy> {
  if (!strategy.owner) throw new Error("strategy owner missing");
  const store = await readStore();
  const next = {
    ...strategy,
    status: strategy.status ?? "active",
    executionsToday: strategy.executionsToday ?? 0,
  };
  const idx = store.strategies.findIndex(
    (entry) => entry.id === next.id && entry.owner === next.owner,
  );
  if (idx >= 0) store.strategies[idx] = next;
  else store.strategies.unshift(next);
  await writeStore(store);
  return next;
}

export async function patchPhoenixStrategy(
  owner: string,
  id: string,
  patch: PhoenixStrategyPatch,
): Promise<PhoenixStrategy> {
  const store = await readStore();
  const idx = store.strategies.findIndex(
    (entry) => entry.owner === owner && entry.id === id,
  );
  if (idx < 0) throw new Error("Phoenix strategy not found");
  const next = { ...store.strategies[idx], ...patch };
  store.strategies[idx] = next;
  await writeStore(store);
  return next;
}

export async function deletePhoenixStrategy(
  owner: string,
  id: string,
): Promise<void> {
  const store = await readStore();
  const before = store.strategies.length;
  store.strategies = store.strategies.filter(
    (entry) => entry.owner !== owner || entry.id !== id,
  );
  if (store.strategies.length === before) {
    throw new Error("Phoenix strategy not found");
  }
  await writeStore(store);
}
