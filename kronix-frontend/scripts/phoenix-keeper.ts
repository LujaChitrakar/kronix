import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { phoenixInstructionToWeb3 } from "../lib/phoenix/client";
import type {
  ApiInstructionResponse,
  PhoenixStrategy,
} from "../lib/phoenix/client";
import { evaluatePhoenixStrategy } from "../lib/phoenix/strategy-engine";
import type { PhoenixCandle } from "../lib/phoenix/strategy-engine";
import {
  listPhoenixStrategies,
  patchPhoenixStrategy,
} from "../lib/phoenix/strategy-store";

const DEFAULT_PHOENIX_API_URL = "https://perp-api.phoenix.trade";
const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
const INTERVAL_MS = Number(process.env.PHOENIX_KEEPER_INTERVAL_MS ?? 30_000);

function loadDotEnvFile(file: string) {
  if (!existsSync(file)) return;
  const raw = readFileSync(file, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function loadLocalEnv() {
  loadDotEnvFile(path.join(process.cwd(), ".env"));
  loadDotEnvFile(path.join(process.cwd(), ".env.local"));
}

function phoenixApiUrl(): string {
  return (
    process.env.PHOENIX_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_PHOENIX_API_URL?.trim() ||
    DEFAULT_PHOENIX_API_URL
  );
}

function phoenixRpcUrl(): string {
  return (
    process.env.PHOENIX_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_PHOENIX_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_MAINNET_RPC_URL?.trim() ||
    DEFAULT_RPC_URL
  );
}

function loadKeeper(): Keypair {
  const raw =
    process.env.PHOENIX_KEEPER_KEYPAIR?.trim() ||
    process.env.PHOENIX_KEEPER_SECRET_KEY?.trim() ||
    process.env.KEEPER_SECRET_KEY?.trim() ||
    process.env.KEEPER_KEYPAIR_JSON?.trim() ||
    process.env.KEEPER_KEYPAIR_PATH?.trim();
  if (!raw) {
    throw new Error(
      "PHOENIX_KEEPER_KEYPAIR or KEEPER_KEYPAIR_PATH missing. Set a 64-byte JSON array, base58 secret key, or keypair file path.",
    );
  }

  const material = raw.startsWith("[") || raw.length > 90
    ? raw
    : existsSync(raw)
      ? readFileSync(raw, "utf8").trim()
      : raw;

  if (material.startsWith("[")) {
    const parsed = JSON.parse(material) as number[];
    if (!Array.isArray(parsed) || parsed.length !== 64) {
      throw new Error("Phoenix keeper JSON secret must be a 64-byte array");
    }
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  }

  const decoded = bs58.decode(material);
  if (decoded.length !== 64) {
    throw new Error("Phoenix keeper base58 secret must decode to 64 bytes");
  }
  return Keypair.fromSecretKey(decoded);
}

async function phoenixFetch<T>(pathPart: string, init?: RequestInit): Promise<T> {
  const url = new URL(pathPart, phoenixApiUrl());
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : text || `Phoenix API failed (${response.status})`;
    throw new Error(message);
  }
  return parsed as T;
}

function normalizeCandle(candle: unknown): PhoenixCandle | null {
  if (!candle || typeof candle !== "object") return null;
  const row = candle as {
    time?: unknown;
    open?: unknown;
    high?: unknown;
    low?: unknown;
    close?: unknown;
    volume?: unknown;
    tradeCount?: unknown;
  };
  const time = Number(row.time);
  const open = Number(row.open);
  const high = Number(row.high);
  const low = Number(row.low);
  const close = Number(row.close);
  if (![time, open, high, low, close].every(Number.isFinite)) return null;
  return {
    time,
    open,
    high,
    low,
    close,
    volume: typeof row.volume === "number" ? row.volume : undefined,
    tradeCount: typeof row.tradeCount === "number" ? row.tradeCount : undefined,
  };
}

async function loadCandles(symbol: string): Promise<PhoenixCandle[]> {
  const candles = await phoenixFetch<unknown[]>(
    `/candles?symbol=${encodeURIComponent(symbol)}&timeframe=1m&limit=180&enableExternalSource=true`,
  );
  return candles
    .map(normalizeCandle)
    .filter((candle): candle is PhoenixCandle => candle !== null)
    .sort((a, b) => a.time - b.time);
}

function usdcToAtoms(value?: number): number {
  if (!value || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1_000_000);
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<T>;
}

function tpSlConfig(strategy: PhoenixStrategy) {
  if (!strategy.takeProfitPrice && !strategy.stopLossPrice) return undefined;
  return compact({
    quantity: strategy.quantity,
    orderKind: "market",
    takeProfitTriggerPrice: strategy.takeProfitPrice,
    stopLossTriggerPrice: strategy.stopLossPrice,
  });
}

async function buildPhoenixOrderIxs(
  strategy: PhoenixStrategy,
  keeper: PublicKey,
): Promise<TransactionInstruction[]> {
  if (!strategy.owner) throw new Error("strategy owner missing");
  if (strategy.orderKind === "limit" && !strategy.limitPrice) {
    throw new Error("limit strategy missing limit price");
  }
  const transferAmount = usdcToAtoms(strategy.transferUsdc);
  if (!strategy.reduceOnly && transferAmount <= 0) {
    throw new Error(
      "transfer USDC must be greater than 0 for Phoenix isolated orders",
    );
  }

  const payload = compact({
    authority: strategy.owner,
    feePayer: keeper.toBase58(),
    positionAuthority: keeper.toBase58(),
    symbol: strategy.symbol,
    side: strategy.side,
    quantity: strategy.quantity,
    price: strategy.orderKind === "limit" ? strategy.limitPrice : undefined,
    transferAmount,
    isReduceOnly: strategy.reduceOnly,
    tpSl: tpSlConfig(strategy),
  });

  const pathPart =
    strategy.orderKind === "limit"
      ? "/v1/ix/place-isolated-limit-order"
      : "/v1/ix/place-isolated-market-order";
  const ixs = await phoenixFetch<ApiInstructionResponse[]>(pathPart, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!Array.isArray(ixs) || ixs.length === 0) {
    throw new Error("Phoenix returned no instructions");
  }
  return ixs.map(phoenixInstructionToWeb3);
}

async function sendKeeperTx(
  conn: Connection,
  keeper: Keypair,
  ixs: TransactionInstruction[],
): Promise<string> {
  const latest = await conn.getLatestBlockhash("confirmed");
  const tx = new Transaction().add(...ixs);
  tx.feePayer = keeper.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(keeper);

  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) {
    const logs = sim.value.logs?.slice(-8).join(" | ");
    throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}${logs ? ` - ${logs}` : ""}`);
  }

  const sig = await conn.sendRawTransaction(tx.serialize(), {
    skipPreflight: true,
    maxRetries: 3,
  });
  const conf = await conn.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );
  if (conf.value.err) {
    throw new Error(`tx ${sig} failed: ${JSON.stringify(conf.value.err)}`);
  }
  return sig;
}

function readiness(strategy: PhoenixStrategy): string | null {
  if (strategy.status !== "active") return `status=${strategy.status}`;
  if (!strategy.autoExecute) return "auto disabled";
  if (
    strategy.maxExecutionsPerDay > 0 &&
    strategy.executionsToday >= strategy.maxExecutionsPerDay
  ) {
    return "daily cap reached";
  }
  if (strategy.lastExecutedAt && strategy.cooldownSecs > 0) {
    const elapsed = Math.floor((Date.now() - strategy.lastExecutedAt) / 1000);
    if (elapsed < strategy.cooldownSecs) {
      return `${strategy.cooldownSecs - elapsed}s cooldown`;
    }
  }
  return null;
}

async function traderHasRestingOrder(strategy: PhoenixStrategy): Promise<boolean> {
  if (!strategy.owner) return false;
  const state = await phoenixFetch<{
    traders?: Array<{
      limitOrders?: Record<string, Array<{ tradeSizeRemaining?: string }>>;
    }>;
  }>(`/trader/${strategy.owner}/state?pdaIndex=0`);
  const orders =
    state.traders?.[0]?.limitOrders?.[strategy.symbol] ??
    state.traders?.[0]?.limitOrders?.[`${strategy.symbol}-PERP`] ??
    [];
  return orders.some((order) => Number(order.tradeSizeRemaining ?? "0") !== 0);
}

async function runOnce(conn: Connection, keeper: Keypair): Promise<void> {
  const strategies = await listPhoenixStrategies();
  for (const strategy of strategies) {
    if (!strategy.owner) continue;
    const notReady = readiness(strategy);
    if (notReady) continue;

    try {
      const candles = await loadCandles(strategy.symbol);
      const signal = evaluatePhoenixStrategy(
        strategy,
        candles,
        candles[candles.length - 1]?.close,
      );
      if (signal.signal !== strategy.side) {
        console.log(
          `[phoenix-keeper] ${strategy.owner.slice(0, 6)}/${strategy.strategyType} waiting: ${signal.reason}`,
        );
        continue;
      }
      if (await traderHasRestingOrder(strategy)) {
        console.log(
          `[phoenix-keeper] ${strategy.owner.slice(0, 6)}/${strategy.symbol} skip: resting order exists`,
        );
        continue;
      }

      const ixs = await buildPhoenixOrderIxs(strategy, keeper.publicKey);
      const sig = await sendKeeperTx(conn, keeper, ixs);
      await patchPhoenixStrategy(strategy.owner, strategy.id, {
        status: "executed",
        executionsToday: strategy.executionsToday + 1,
        lastExecutedAt: Date.now(),
        lastExecutedSignature: sig,
        lastExecutionError: undefined,
      });
      console.log(
        `[phoenix-keeper] executed ${strategy.owner.slice(0, 6)}/${strategy.strategyType} ${strategy.symbol} ${strategy.side}: ${sig}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await patchPhoenixStrategy(strategy.owner, strategy.id, {
        status: "failed",
        lastExecutionError: message,
      }).catch(() => undefined);
      console.error(
        `[phoenix-keeper] failed ${strategy.owner.slice(0, 6)}/${strategy.strategyType}: ${message}`,
      );
    }
  }
}

async function main() {
  loadLocalEnv();
  const keeper = loadKeeper();
  const conn = new Connection(phoenixRpcUrl(), "confirmed");
  const once = process.argv.includes("--once");
  console.log(`[phoenix-keeper] keeper=${keeper.publicKey.toBase58()}`);
  console.log(`[phoenix-keeper] api=${phoenixApiUrl()} rpc=${phoenixRpcUrl()}`);
  if (once) {
    await runOnce(conn, keeper);
    return;
  }
  for (;;) {
    await runOnce(conn, keeper);
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
