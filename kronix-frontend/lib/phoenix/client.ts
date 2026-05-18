import { PublicKey, TransactionInstruction } from "@solana/web3.js";

export const PHOENIX_WS_URL =
  process.env.NEXT_PUBLIC_PHOENIX_WS_URL?.trim() ||
  "wss://perp-api.phoenix.trade/v1/ws";

export const PHOENIX_DEFAULT_SYMBOL = "SOL";

export type PhoenixSide = "bid" | "ask";
export type PhoenixOrderKind = "market" | "limit";
export type PhoenixStrategyType =
  | "RSI"
  | "EMA"
  | "Range DCA"
  | "Support/Resistance"
  | "Smart Money";
export type PhoenixStrategyStatus = "active" | "paused" | "executed" | "failed";

export type PhoenixStrategyParams = {
  rsiPeriod?: number;
  rsiOversold?: number;
  rsiOverbought?: number;
  emaFast?: number;
  emaSlow?: number;
  lowerPrice?: number;
  upperPrice?: number;
  gridCount?: number;
  toleranceBps?: number;
  levels?: number[];
  structureLookback?: number;
  orderBlockSensitivity?: number;
};

export type PhoenixStrategy = {
  id: string;
  owner?: string;
  symbol: string;
  strategyType: PhoenixStrategyType;
  side: PhoenixSide;
  orderKind: PhoenixOrderKind;
  quantity: number;
  limitPrice?: number;
  transferUsdc: number;
  reduceOnly: boolean;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  cooldownSecs: number;
  maxExecutionsPerDay: number;
  autoExecute: boolean;
  executionsToday: number;
  lastExecutedAt?: number;
  lastExecutedSignature?: string;
  lastExecutionError?: string;
  status: PhoenixStrategyStatus;
  params: PhoenixStrategyParams;
  createdAt: number;
};

export type ApiInstructionResponse = {
  programId: string;
  keys: Array<{
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  data: number[];
};

export type PhoenixOrderBuildArgs = {
  authority: string;
  feePayer?: string;
  positionAuthority?: string;
  symbol: string;
  side: PhoenixSide;
  orderKind: PhoenixOrderKind;
  quantity: number;
  limitPrice?: number;
  transferUsdc?: number;
  reduceOnly?: boolean;
  takeProfitPrice?: number;
  stopLossPrice?: number;
};

export type PhoenixBookLevel = [number, number];

export type PhoenixStrategyPatch = Partial<
  Pick<
    PhoenixStrategy,
    | "status"
    | "autoExecute"
    | "executionsToday"
    | "lastExecutedAt"
    | "lastExecutedSignature"
    | "lastExecutionError"
  >
>;

export type PhoenixTraderState = {
  authority: string;
  pdaIndex: number;
  traders: Array<{
    state: string;
    traderKey: string;
    collateralBalance: unknown;
    effectiveCollateral: unknown;
    portfolioValue: unknown;
    unrealizedPnl: unknown;
    riskState: string;
    riskTier: string;
    positions: Array<{
      symbol: string;
      positionSize: unknown;
      entryPrice: unknown;
      unrealizedPnl: unknown;
      liquidationPrice: unknown;
      takeProfitPrice?: unknown;
      stopLossPrice?: unknown;
    }>;
    limitOrders: Record<
      string,
      Array<{
        price: string;
        side: PhoenixSide;
        tradeSizeRemaining: string;
        isReduceOnly: boolean;
        orderSequenceNumber: string;
      }>
    >;
  }>;
};

const STORAGE_PREFIX = "kronix:phoenix:strategies";

function proxyPath(path: string): string {
  return `/api/phoenix${path.startsWith("/") ? path : `/${path}`}`;
}

function storageKey(owner: string): string {
  return `${STORAGE_PREFIX}:${owner}`;
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
  ) as Partial<T>;
}

function usdcToAtoms(value?: number): number {
  if (!value || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1_000_000);
}

function tpSlConfig(args: PhoenixOrderBuildArgs) {
  if (!args.takeProfitPrice && !args.stopLossPrice) return undefined;
  return compact({
    quantity: args.quantity,
    orderKind: "market",
    takeProfitTriggerPrice: args.takeProfitPrice,
    stopLossTriggerPrice: args.stopLossPrice,
  });
}

export function loadPhoenixStrategies(owner: string): PhoenixStrategy[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(storageKey(owner));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePhoenixStrategies(owner: string, strategies: PhoenixStrategy[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(owner), JSON.stringify(strategies));
}

export function createPhoenixStrategyId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function phoenixFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(proxyPath(path), {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!response.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : text || `Phoenix API request failed (${response.status})`;
    throw new Error(message);
  }

  return json as T;
}

async function appJsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  const text = await response.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!response.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? String((json as { error: unknown }).error)
        : text || `Request failed (${response.status})`;
    throw new Error(message);
  }

  return json as T;
}

export async function getServerPhoenixStrategies(
  owner: string,
): Promise<PhoenixStrategy[]> {
  return appJsonFetch<PhoenixStrategy[]>(
    `/api/phoenix-strategies?owner=${encodeURIComponent(owner)}`,
  );
}

export async function createServerPhoenixStrategy(
  strategy: PhoenixStrategy,
): Promise<PhoenixStrategy> {
  return appJsonFetch<PhoenixStrategy>("/api/phoenix-strategies", {
    method: "POST",
    body: JSON.stringify({ strategy }),
  });
}

export async function patchServerPhoenixStrategy(
  owner: string,
  id: string,
  patch: PhoenixStrategyPatch,
): Promise<PhoenixStrategy> {
  return appJsonFetch<PhoenixStrategy>("/api/phoenix-strategies", {
    method: "PATCH",
    body: JSON.stringify({ owner, id, patch }),
  });
}

export async function deleteServerPhoenixStrategy(
  owner: string,
  id: string,
): Promise<{ ok: true }> {
  return appJsonFetch<{ ok: true }>("/api/phoenix-strategies", {
    method: "DELETE",
    body: JSON.stringify({ owner, id }),
  });
}

export function phoenixInstructionToWeb3(
  ix: ApiInstructionResponse,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.keys.map((key) => ({
      pubkey: new PublicKey(key.pubkey),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: Buffer.from(ix.data),
  });
}

export async function getPhoenixTraderState(
  authority: string,
): Promise<PhoenixTraderState> {
  return phoenixFetch<PhoenixTraderState>(`/trader/${authority}/state?pdaIndex=0`);
}

export async function buildPhoenixIsolatedOrderIxs(
  args: PhoenixOrderBuildArgs,
): Promise<TransactionInstruction[]> {
  if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
    throw new Error("Phoenix order quantity must be greater than 0");
  }
  if (args.orderKind === "limit" && (!args.limitPrice || args.limitPrice <= 0)) {
    throw new Error("Phoenix limit order requires a limit price");
  }
  const transferAmount = usdcToAtoms(args.transferUsdc);
  if (!args.reduceOnly && transferAmount <= 0) {
    throw new Error(
      "Transfer USDC must be greater than 0 for Phoenix isolated orders. New isolated subaccounts start with 0 collateral.",
    );
  }

  const payload = compact({
    authority: args.authority,
    feePayer: args.feePayer,
    positionAuthority: args.positionAuthority,
    symbol: args.symbol,
    side: args.side,
    quantity: args.quantity,
    price: args.orderKind === "limit" ? args.limitPrice : undefined,
    transferAmount,
    isReduceOnly: args.reduceOnly,
    tpSl: tpSlConfig(args),
  });

  const path =
    args.orderKind === "limit"
      ? "/v1/ix/place-isolated-limit-order"
      : "/v1/ix/place-isolated-market-order";

  const ixs = await phoenixFetch<ApiInstructionResponse[]>(path, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!Array.isArray(ixs) || ixs.length === 0) {
    throw new Error("Phoenix API returned no transaction instructions");
  }

  return ixs.map(phoenixInstructionToWeb3);
}
