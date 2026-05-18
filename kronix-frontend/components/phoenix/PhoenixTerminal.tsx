"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  PHOENIX_DEFAULT_SYMBOL,
  PHOENIX_WS_URL,
  PhoenixBookLevel,
  PhoenixOrderKind,
  PhoenixSide,
  PhoenixStrategy,
  PhoenixStrategyType,
  PhoenixTraderState,
  buildPhoenixIsolatedOrderIxs,
  createPhoenixStrategyId,
  createServerPhoenixStrategy,
  deleteServerPhoenixStrategy,
  getServerPhoenixStrategies,
  getPhoenixTraderState,
  patchServerPhoenixStrategy,
  phoenixFetch,
} from "@/lib/phoenix/client";
import { formatTxError, sendTx } from "@/components/trade/tx";
import {
  notifyError,
  notifyInfo,
  notifySuccess,
  notifyTxSuccess,
  notifyWarning,
} from "@/lib/notifications";
import {
  PhoenixCandle,
  PhoenixStrategySignal,
  evaluatePhoenixStrategy,
} from "@/lib/phoenix/strategy-engine";

const STRATEGY_TYPES: PhoenixStrategyType[] = [
  "RSI",
  "EMA",
  "Range DCA",
  "Support/Resistance",
  "Smart Money",
];

const DEFAULT_MARKETS = ["SOL"];

type WsStatus = "idle" | "connecting" | "live" | "error";

type MarketStats = {
  markPx?: number;
  midPx?: number;
  oraclePx?: number;
  funding?: number;
  openInterest?: number;
  dayNtlVlm?: number;
};

type MarketsResponse =
  | Array<{ symbol?: string }>
  | { markets?: Array<{ symbol?: string }> };

type CandlesResponse = Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  tradeCount?: number | null;
}>;

function asNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fmt(value?: number, digits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return "--";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtCompact(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return "--";
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function amountScalar(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value.trim() ? value.trim() : null;
  if (typeof value !== "object") return null;

  const row = value as Record<string, unknown>;
  const preferredKeys = [
    "formatted",
    "display",
    "uiAmountString",
    "uiAmount",
    "ui",
    "usd",
    "usdc",
    "value",
    "amount",
    "decimal",
  ];
  for (const key of preferredKeys) {
    const scalar = amountScalar(row[key]);
    if (scalar !== null) return scalar;
  }
  for (const entry of Object.values(row)) {
    const scalar = amountScalar(entry);
    if (scalar !== null) return scalar;
  }
  return null;
}

function formatAmount(value: unknown, options?: { currency?: boolean; digits?: number }) {
  const scalar = amountScalar(value);
  if (scalar === null) return "--";
  const raw = typeof scalar === "number" ? String(scalar) : scalar;
  const cleaned = raw.replace(/,/g, "");
  const numeric = Number(cleaned);
  const prefix = options?.currency ? "$" : "";
  if (!Number.isFinite(numeric)) return `${prefix}${raw}`;
  return `${prefix}${numeric.toLocaleString("en-US", {
    minimumFractionDigits: options?.digits ?? 0,
    maximumFractionDigits: options?.digits ?? 4,
  })}`;
}

function sideLabel(side: PhoenixSide): string {
  return side === "bid" ? "LONG" : "SHORT";
}

function strategyPrice(strategy: PhoenixStrategy, fallback?: number): string {
  if (strategy.orderKind === "limit" && strategy.limitPrice) {
    return `$${fmt(strategy.limitPrice)}`;
  }
  if (fallback !== undefined) return `MKT ~$${fmt(fallback)}`;
  return "MKT";
}

function bookMaxQty(bids: PhoenixBookLevel[], asks: PhoenixBookLevel[]): number {
  return Math.max(1, ...bids.map((level) => level[1]), ...asks.map((level) => level[1]));
}

function bookSpread(bid?: number, ask?: number): { mid?: number; spread?: number; bps?: number } {
  if (bid === undefined || ask === undefined) return {};
  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  return {
    mid,
    spread,
    bps: mid > 0 ? (spread / mid) * 10_000 : undefined,
  };
}

function DepthColumn({
  title,
  side,
  levels,
  maxQty,
}: {
  title: string;
  side: "bid" | "ask";
  levels: PhoenixBookLevel[];
  maxQty: number;
}) {
  const isBid = side === "bid";
  const color = isBid ? "text-[#4dffb4]" : "text-[#ff7b72]";
  const fill = isBid ? "bg-[#4dffb4]/12" : "bg-[#ff6b6b]/12";
  const border = isBid ? "border-[#4dffb4]/18" : "border-[#ff6b6b]/18";

  return (
    <div className={`min-w-0 border ${border} bg-[#090d0d]`}>
      <div className="flex h-10 items-center justify-between border-b border-white/10 px-3">
        <div className={`font-headline text-xs font-extrabold uppercase ${color}`}>
          {title}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/60">
          Price / Qty / Total
        </div>
      </div>
      <div className="grid grid-cols-[1fr_0.8fr_0.95fr] border-b border-white/5 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-on-surface-variant/50">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>
      <div className="min-h-[244px] p-1.5">
        {levels.length ? (
          levels.map((level, index) => {
            const pct = Math.min(100, (level[1] / maxQty) * 100);
            return (
              <div
                key={`${side}-${level[0]}-${index}`}
                className="relative grid grid-cols-[1fr_0.8fr_0.95fr] items-center overflow-hidden px-2 py-[5px] font-mono text-xs transition-colors hover:bg-white/[0.035]"
              >
                <span
                  className={`absolute inset-y-0 ${isBid ? "right-0" : "left-0"} ${fill}`}
                  style={{ width: `${pct}%` }}
                  aria-hidden="true"
                />
                <span className={`relative truncate ${color}`}>{fmt(level[0])}</span>
                <span className="relative truncate text-right text-on-surface">
                  {fmt(level[1], 3)}
                </span>
                <span className="relative truncate text-right text-on-surface-variant">
                  {fmt(level[0] * level[1], 2)}
                </span>
              </div>
            );
          })
        ) : (
          <div className="grid min-h-[228px] place-items-center font-mono text-xs text-on-surface-variant/60">
            Waiting
          </div>
        )}
      </div>
    </div>
  );
}

function statusDot(status: WsStatus): string {
  if (status === "live") return "bg-[#4dffb4]";
  if (status === "connecting") return "bg-[#ffcc66]";
  if (status === "error") return "bg-[#ff6b6b]";
  return "bg-white/25";
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  step = "any",
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  step?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block truncate font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/70">
        {label}
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="number"
        step={step}
        disabled={disabled}
        className="h-10 w-full rounded border border-white/10 bg-[#030505] px-3 font-mono text-sm text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/35 focus:border-white/35 disabled:cursor-not-allowed disabled:opacity-45"
      />
    </label>
  );
}

function Segmented<T extends string>({
  label,
  value,
  values,
  onChange,
  render,
}: {
  label: string;
  value: T;
  values: T[];
  onChange: (value: T) => void;
  render?: (value: T) => string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 truncate font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/70">
        {label}
      </div>
      <div className="grid grid-cols-2 gap-1 rounded border border-white/10 bg-black/20 p-1">
        {values.map((entry) => {
          const selected = entry === value;
          return (
            <button
              key={entry}
              type="button"
              onClick={() => onChange(entry)}
              className={`h-8 rounded font-headline text-xs font-bold transition-colors ${
                selected
                  ? "bg-[#d7dde2] text-[#060707]"
                  : "text-on-surface-variant hover:bg-white/[0.05] hover:text-on-surface"
              }`}
            >
              {render ? render(entry) : entry}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "bad" | "blue";
}) {
  const color =
    tone === "good"
      ? "text-[#4dffb4]"
      : tone === "bad"
        ? "text-[#ff8a80]"
        : tone === "blue"
          ? "text-[#d7dde2]"
          : "text-on-surface";
  return (
    <div className="min-w-0 border border-white/10 bg-[#050707] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
      <div className="truncate font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/60">
        {label}
      </div>
      <div className={`mt-1 truncate font-mono text-sm font-bold ${color}`}>
        {value}
      </div>
    </div>
  );
}

function extractMarkets(response: MarketsResponse): string[] {
  const rows = Array.isArray(response) ? response : response.markets ?? [];
  const symbols = rows
    .map((market) => market.symbol)
    .filter((symbol): symbol is string => Boolean(symbol));
  return symbols.length ? Array.from(new Set(symbols)).sort() : DEFAULT_MARKETS;
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
  const time = typeof row.time === "number" ? row.time : Number(row.time);
  const open = typeof row.open === "number" ? row.open : Number(row.open);
  const high = typeof row.high === "number" ? row.high : Number(row.high);
  const low = typeof row.low === "number" ? row.low : Number(row.low);
  const close = typeof row.close === "number" ? row.close : Number(row.close);
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

function mergeCandle(history: PhoenixCandle[], candle: PhoenixCandle): PhoenixCandle[] {
  const next = history.filter((entry) => entry.time !== candle.time);
  next.push(candle);
  return next.sort((a, b) => a.time - b.time).slice(-240);
}

function bestBidAsk(bids: PhoenixBookLevel[], asks: PhoenixBookLevel[]) {
  return {
    bid: bids[0]?.[0],
    ask: asks[0]?.[0],
  };
}

function isStrategyReady(strategy: PhoenixStrategy): string | null {
  if (strategy.status === "paused") return "Strategy is paused";
  if (strategy.status === "executed") return "Strategy already executed";
  if (strategy.status === "failed") return "Last execution failed";
  if (strategy.maxExecutionsPerDay > 0 && strategy.executionsToday >= strategy.maxExecutionsPerDay) {
    return "Daily execution cap reached";
  }
  if (strategy.lastExecutedAt && strategy.cooldownSecs > 0) {
    const elapsed = Math.floor((Date.now() - strategy.lastExecutedAt) / 1000);
    if (elapsed < strategy.cooldownSecs) {
      return `${strategy.cooldownSecs - elapsed}s cooldown remaining`;
    }
  }
  return null;
}

export function PhoenixTerminal() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const owner = wallet.publicKey?.toBase58();

  const [markets, setMarkets] = useState<string[]>(DEFAULT_MARKETS);
  const [symbol, setSymbol] = useState(PHOENIX_DEFAULT_SYMBOL);
  const [wsStatus, setWsStatus] = useState<WsStatus>("idle");
  const [book, setBook] = useState<{ bids: PhoenixBookLevel[]; asks: PhoenixBookLevel[]; mid?: number }>({
    bids: [],
    asks: [],
  });
  const [candles, setCandles] = useState<PhoenixCandle[]>([]);
  const [stats, setStats] = useState<MarketStats>({});
  const [trader, setTrader] = useState<PhoenixTraderState | null>(null);
  const [traderLoading, setTraderLoading] = useState(false);
  const [strategies, setStrategies] = useState<PhoenixStrategy[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [strategyType, setStrategyType] = useState<PhoenixStrategyType>("RSI");
  const [side, setSide] = useState<PhoenixSide>("bid");
  const [orderKind, setOrderKind] = useState<PhoenixOrderKind>("market");
  const [quantity, setQuantity] = useState("0.1");
  const [limitPrice, setLimitPrice] = useState("");
  const [transferUsdc, setTransferUsdc] = useState("10");
  const [takeProfitPrice, setTakeProfitPrice] = useState("");
  const [stopLossPrice, setStopLossPrice] = useState("");
  const [cooldownSecs, setCooldownSecs] = useState("300");
  const [maxPerDay, setMaxPerDay] = useState("5");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [autoExecute, setAutoExecute] = useState(false);
  const [rsiPeriod, setRsiPeriod] = useState("14");
  const [rsiOversold, setRsiOversold] = useState("30");
  const [rsiOverbought, setRsiOverbought] = useState("70");
  const [emaFast, setEmaFast] = useState("9");
  const [emaSlow, setEmaSlow] = useState("21");
  const [rangeLower, setRangeLower] = useState("");
  const [rangeUpper, setRangeUpper] = useState("");
  const [gridCount, setGridCount] = useState("6");
  const [srTolerance, setSrTolerance] = useState("50");
  const [srLevels, setSrLevels] = useState("");
  const [structureLookback, setStructureLookback] = useState("40");
  const [orderBlockSensitivity, setOrderBlockSensitivity] = useState("3");

  const { bid, ask } = bestBidAsk(book.bids, book.asks);
  const displayedMid = stats.midPx ?? book.mid;
  const maxDepthQty = useMemo(
    () => bookMaxQty(book.bids, book.asks),
    [book.asks, book.bids],
  );
  const spread = useMemo(() => bookSpread(bid, ask), [ask, bid]);
  const selectedTrader = trader?.traders?.[0];
  const selectedPosition = selectedTrader?.positions.find(
    (position) => position.symbol === symbol || position.symbol === `${symbol}-PERP`,
  );
  const selectedOrders =
    selectedTrader?.limitOrders?.[symbol] ??
    selectedTrader?.limitOrders?.[`${symbol}-PERP`] ??
    [];
  const strategySignals = useMemo(() => {
    const entries = strategies.map((strategy) => [
      strategy.id,
      evaluatePhoenixStrategy(strategy, candles, displayedMid ?? stats.markPx),
    ] as const);
    return new Map<string, PhoenixStrategySignal>(entries);
  }, [candles, displayedMid, stats.markPx, strategies]);

  const updateStrategies = useCallback(
    (next: PhoenixStrategy[]) => {
      setStrategies(next);
    },
    [],
  );

  const refreshStrategies = useCallback(async () => {
    if (!owner) {
      setStrategies([]);
      return;
    }
    try {
      setStrategies(await getServerPhoenixStrategies(owner));
    } catch (error) {
      notifyWarning(
        "Phoenix strategies unavailable",
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [owner]);

  const refreshTrader = useCallback(async () => {
    if (!owner) {
      setTrader(null);
      return;
    }
    setTraderLoading(true);
    try {
      setTrader(await getPhoenixTraderState(owner));
    } catch (error) {
      setTrader(null);
      notifyWarning("Phoenix trader state unavailable", error instanceof Error ? error.message : String(error));
    } finally {
      setTraderLoading(false);
    }
  }, [owner]);

  useEffect(() => {
    let cancelled = false;
    phoenixFetch<MarketsResponse>("/exchange/markets")
      .then((response) => {
        if (cancelled) return;
        const next = extractMarkets(response);
        setMarkets(next);
        if (!next.includes(symbol)) setSymbol(next[0] ?? PHOENIX_DEFAULT_SYMBOL);
      })
      .catch(() => {
        if (!cancelled) setMarkets(DEFAULT_MARKETS);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    let cancelled = false;
    setCandles([]);
    phoenixFetch<CandlesResponse>(
      `/candles?symbol=${encodeURIComponent(symbol)}&timeframe=1m&limit=180&enableExternalSource=true`,
    )
      .then((response) => {
        if (cancelled) return;
        setCandles(
          response
            .map(normalizeCandle)
            .filter((candle): candle is PhoenixCandle => candle !== null)
            .sort((a, b) => a.time - b.time)
            .slice(-240),
        );
      })
      .catch(() => {
        if (!cancelled) setCandles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  useEffect(() => {
    if (!owner) {
      setStrategies([]);
      setTrader(null);
      return;
    }
    void refreshStrategies();
    void refreshTrader();
  }, [owner, refreshStrategies, refreshTrader]);

  useEffect(() => {
    setWsStatus("connecting");
    const ws = new WebSocket(PHOENIX_WS_URL);
    let traderRefreshTimer: ReturnType<typeof setTimeout> | null = null;

    ws.onopen = () => {
      setWsStatus("live");
      ws.send(
        JSON.stringify({
          type: "subscribe",
          subscription: { channel: "orderbook", symbol, bypassExecutionBand: false },
        }),
      );
      ws.send(JSON.stringify({ type: "subscribe", subscription: { channel: "market", symbol } }));
      ws.send(
        JSON.stringify({
          type: "subscribe",
          subscription: { channel: "candles", symbol, timeframe: "1m" },
        }),
      );
      if (owner) {
        ws.send(
          JSON.stringify({
            type: "subscribe",
            subscription: { channel: "traderState", authority: owner, traderPdaIndex: 0 },
          }),
        );
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        if (message.type === "subscriptionError") {
          setWsStatus("error");
          return;
        }

        if (message.channel === "orderbook") {
          const orderbook = message.orderbook as
            | { bids?: PhoenixBookLevel[]; asks?: PhoenixBookLevel[]; mid?: number }
            | undefined;
          if (orderbook) {
            setBook({
              bids: Array.isArray(orderbook.bids) ? orderbook.bids.slice(0, 8) : [],
              asks: Array.isArray(orderbook.asks) ? orderbook.asks.slice(0, 8) : [],
              mid: typeof orderbook.mid === "number" ? orderbook.mid : undefined,
            });
          }
        }

        if (message.channel === "market") {
          setStats({
            markPx: typeof message.markPx === "number" ? message.markPx : undefined,
            midPx: typeof message.midPx === "number" ? message.midPx : undefined,
            oraclePx: typeof message.oraclePx === "number" ? message.oraclePx : undefined,
            funding: typeof message.funding === "number" ? message.funding : undefined,
            openInterest:
              typeof message.openInterest === "number" ? message.openInterest : undefined,
            dayNtlVlm: typeof message.dayNtlVlm === "number" ? message.dayNtlVlm : undefined,
          });
        }

        if (message.channel === "candle" || message.channel === "candles") {
          const candle = normalizeCandle(message.candle);
          if (candle) setCandles((history) => mergeCandle(history, candle));
        }

        if (message.channel === "traderState" && owner) {
          if (traderRefreshTimer) clearTimeout(traderRefreshTimer);
          traderRefreshTimer = setTimeout(() => void refreshTrader(), 450);
        }
      } catch {
        setWsStatus("error");
      }
    };

    ws.onerror = () => setWsStatus("error");
    ws.onclose = () => setWsStatus((current) => (current === "live" ? "idle" : current));

    return () => {
      if (traderRefreshTimer) clearTimeout(traderRefreshTimer);
      ws.close();
    };
  }, [owner, refreshTrader, symbol]);

  const params = useMemo(() => {
    if (strategyType === "RSI") {
      return {
        rsiPeriod: asNumber(rsiPeriod),
        rsiOversold: asNumber(rsiOversold),
        rsiOverbought: asNumber(rsiOverbought),
      };
    }
    if (strategyType === "EMA") {
      return { emaFast: asNumber(emaFast), emaSlow: asNumber(emaSlow) };
    }
    if (strategyType === "Range DCA") {
      return {
        lowerPrice: asNumber(rangeLower),
        upperPrice: asNumber(rangeUpper),
        gridCount: asNumber(gridCount),
      };
    }
    if (strategyType === "Support/Resistance") {
      return {
        toleranceBps: asNumber(srTolerance),
        levels: srLevels
          .split(",")
          .map((entry) => asNumber(entry))
          .filter((entry): entry is number => entry !== undefined),
      };
    }
    return {
      structureLookback: asNumber(structureLookback),
      orderBlockSensitivity: asNumber(orderBlockSensitivity),
    };
  }, [
    emaFast,
    emaSlow,
    gridCount,
    orderBlockSensitivity,
    rangeLower,
    rangeUpper,
    rsiOverbought,
    rsiOversold,
    rsiPeriod,
    srLevels,
    srTolerance,
    strategyType,
    structureLookback,
  ]);

  async function createStrategy() {
    if (!owner) {
      notifyInfo("Connect wallet", "Phoenix strategies are stored per wallet.");
      return;
    }
    const parsedQuantity = asNumber(quantity);
    if (!parsedQuantity || parsedQuantity <= 0) {
      notifyError("Invalid size", "Quantity must be greater than 0.");
      return;
    }
    const parsedLimit = asNumber(limitPrice);
    if (orderKind === "limit" && (!parsedLimit || parsedLimit <= 0)) {
      notifyError("Invalid limit price", "Limit strategies need a Phoenix price.");
      return;
    }
    const parsedTransfer = asNumber(transferUsdc) ?? 0;
    if (!reduceOnly && parsedTransfer <= 0) {
      notifyError(
        "Transfer USDC required",
        "Phoenix isolated orders need a positive USDC transfer when the isolated subaccount is created.",
      );
      return;
    }

    const strategy: PhoenixStrategy = {
      id: createPhoenixStrategyId(),
      owner,
      symbol,
      strategyType,
      side,
      orderKind,
      quantity: parsedQuantity,
      limitPrice: orderKind === "limit" ? parsedLimit : undefined,
      transferUsdc: parsedTransfer,
      reduceOnly,
      takeProfitPrice: asNumber(takeProfitPrice),
      stopLossPrice: asNumber(stopLossPrice),
      cooldownSecs: Math.max(0, Math.floor(asNumber(cooldownSecs) ?? 0)),
      maxExecutionsPerDay: Math.max(0, Math.floor(asNumber(maxPerDay) ?? 0)),
      autoExecute,
      executionsToday: 0,
      status: "active",
      params,
      createdAt: Date.now(),
    };

    try {
      const saved = await createServerPhoenixStrategy(strategy);
      updateStrategies([saved, ...strategies]);
      notifySuccess("Phoenix strategy created", `${strategy.symbol} ${sideLabel(strategy.side)} ${strategy.strategyType}`);
    } catch (error) {
      notifyError(
        "Create strategy failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const executeStrategy = useCallback(async (strategy: PhoenixStrategy) => {
    if (!owner) {
      notifyInfo("Connect wallet", "Wallet signature is required for Phoenix orders.");
      return;
    }
    const readiness = isStrategyReady(strategy);
    if (readiness) {
      notifyWarning("Strategy not ready", readiness);
      return;
    }

    setBusyId(strategy.id);
    try {
      const ixs = await buildPhoenixIsolatedOrderIxs({
        authority: owner,
        feePayer: owner,
        symbol: strategy.symbol,
        side: strategy.side,
        orderKind: strategy.orderKind,
        quantity: strategy.quantity,
        limitPrice: strategy.limitPrice,
        transferUsdc: strategy.transferUsdc,
        reduceOnly: strategy.reduceOnly,
        takeProfitPrice: strategy.takeProfitPrice,
        stopLossPrice: strategy.stopLossPrice,
      });
      const sig = await sendTx(wallet, connection, ixs);
      const saved = await patchServerPhoenixStrategy(owner, strategy.id, {
        status: "executed",
        executionsToday: strategy.executionsToday + 1,
        lastExecutedAt: Date.now(),
        lastExecutedSignature: sig,
        lastExecutionError: undefined,
      });
      updateStrategies(
        strategies.map((entry) => (entry.id === strategy.id ? saved : entry)),
      );
      notifyTxSuccess(
        "Phoenix order sent",
        sig,
        `${strategy.symbol} ${sideLabel(strategy.side)} ${strategy.orderKind}`,
        "mainnet-beta",
      );
      void refreshTrader();
    } catch (error) {
      notifyError("Phoenix execution failed", formatTxError(error));
    } finally {
      setBusyId(null);
    }
  }, [connection, owner, refreshTrader, strategies, updateStrategies, wallet]);

  async function setStrategyStatus(strategy: PhoenixStrategy, status: "active" | "paused") {
    if (!owner) return;
    try {
      const saved = await patchServerPhoenixStrategy(owner, strategy.id, {
        status,
        lastExecutionError: undefined,
      });
      updateStrategies(
        strategies.map((entry) => (entry.id === strategy.id ? saved : entry)),
      );
    } catch (error) {
      notifyError(
        "Update strategy failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function deleteStrategy(strategy: PhoenixStrategy) {
    if (!owner) return;
    try {
      await deleteServerPhoenixStrategy(owner, strategy.id);
      updateStrategies(strategies.filter((entry) => entry.id !== strategy.id));
      notifySuccess("Phoenix strategy removed", strategy.symbol);
    } catch (error) {
      notifyError(
        "Delete strategy failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const strategyParamFields =
    strategyType === "RSI" ? (
      <div className="grid grid-cols-3 gap-3">
        <Field label="Period" value={rsiPeriod} onChange={setRsiPeriod} step="1" />
        <Field label="Oversold" value={rsiOversold} onChange={setRsiOversold} step="1" />
        <Field label="Overbought" value={rsiOverbought} onChange={setRsiOverbought} step="1" />
      </div>
    ) : strategyType === "EMA" ? (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Fast EMA" value={emaFast} onChange={setEmaFast} step="1" />
        <Field label="Slow EMA" value={emaSlow} onChange={setEmaSlow} step="1" />
      </div>
    ) : strategyType === "Range DCA" ? (
      <div className="grid grid-cols-3 gap-3">
        <Field label="Lower" value={rangeLower} onChange={setRangeLower} />
        <Field label="Upper" value={rangeUpper} onChange={setRangeUpper} />
        <Field label="Grids" value={gridCount} onChange={setGridCount} step="1" />
      </div>
    ) : strategyType === "Support/Resistance" ? (
      <div className="grid grid-cols-[0.8fr_1.2fr] gap-3 max-sm:grid-cols-1">
        <Field label="Tolerance BPS" value={srTolerance} onChange={setSrTolerance} step="1" />
        <label className="block min-w-0">
          <span className="mb-1.5 block truncate font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/70">
            Levels
          </span>
          <input
            value={srLevels}
            onChange={(event) => setSrLevels(event.target.value)}
            placeholder="145, 150, 155"
            className="h-10 w-full rounded border border-white/10 bg-[#030505] px-3 font-mono text-sm text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/35 focus:border-white/35"
          />
        </label>
      </div>
    ) : (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Lookback" value={structureLookback} onChange={setStructureLookback} step="1" />
        <Field
          label="Sensitivity"
          value={orderBlockSensitivity}
          onChange={setOrderBlockSensitivity}
          step="1"
        />
      </div>
    );

  return (
    <main className="min-h-screen bg-[#020303] text-on-surface">
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(255,255,255,0.028)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.022)_1px,transparent_1px)] bg-[size:56px_56px]" />
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#050707]/92 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="grid h-10 w-10 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.035] text-on-surface-variant shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-colors hover:border-[#4dffb4]/30 hover:text-[#4dffb4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4dffb4]/40"
              title="Back to Kronix"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_back</span>
            </Link>
            <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded border border-white/10 bg-[#050505] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_10px_35px_rgba(0,0,0,0.35)]">
              <Image src="/logo.png" alt="Kronix" width={42} height={42} priority />
            </div>
            <div className="min-w-0">
              <div className="truncate font-headline text-xl font-extrabold tracking-normal text-white">
                KRONIX <span className="text-[#d7dde2]">PHOENIX</span>
              </div>
              <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-on-surface-variant/70">
                <span className={`h-1.5 w-1.5 rounded-full ${statusDot(wsStatus)}`} />
                <span>{wsStatus}</span>
                <span className="hidden sm:inline">strategy terminal</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void refreshTrader()}
              disabled={!owner || traderLoading}
              title="Refresh trader state"
              className="grid h-10 w-10 place-items-center rounded border border-white/10 bg-white/[0.035] text-on-surface-variant transition-colors hover:border-[#d7dde2]/35 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[18px]">
                {traderLoading ? "progress_activity" : "refresh"}
              </span>
            </button>
            <WalletMultiButton />
          </div>
        </div>
      </header>

      <div className="relative mx-auto grid max-w-[1500px] grid-cols-[minmax(330px,0.9fr)_minmax(0,1.35fr)] gap-4 px-4 py-4 max-xl:grid-cols-1">
        <section className="min-w-0 space-y-4">
          <div className="overflow-hidden border border-white/10 bg-[#080b0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.025] px-4 py-3">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-on-surface-variant/65">
                  Market
                </div>
                <select
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value)}
                  className="mt-1 h-10 rounded border border-white/10 bg-[#030505] px-2 font-headline text-xl font-extrabold text-on-surface outline-none transition-colors focus:border-[#d7dde2]/60"
                >
                  {markets.map((market) => (
                    <option key={market} value={market}>
                      {market}
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-right">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-on-surface-variant/65">
                  Mid
                </div>
                <div className="font-mono text-2xl font-bold text-white">
                  ${fmt(displayedMid)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-white/10 p-px sm:grid-cols-3">
              <Stat label="Mark" value={`$${fmt(stats.markPx)}`} tone="blue" />
              <Stat label="Oracle" value={`$${fmt(stats.oraclePx)}`} />
              <Stat label="Funding" value={stats.funding === undefined ? "--" : `${(stats.funding * 100).toFixed(4)}%`} />
              <Stat label="Bid" value={`$${fmt(bid)}`} tone="good" />
              <Stat label="Ask" value={`$${fmt(ask)}`} tone="bad" />
              <Stat label="24h Ntl" value={`$${fmtCompact(stats.dayNtlVlm)}`} />
            </div>
          </div>

          <div className="overflow-hidden border border-white/10 bg-[#080b0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.025] px-4 py-3">
              <div>
                <h2 className="font-headline text-sm font-extrabold uppercase tracking-[0.08em] text-white">
                  Orderbook
                </h2>
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/55">
                  side by side depth
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-[11px] text-on-surface-variant">
                  OI {fmtCompact(stats.openInterest)}
                </div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/60">
                  Spread {spread.spread === undefined ? "--" : `$${fmt(spread.spread)}`}{" "}
                  {spread.bps === undefined ? "" : `${spread.bps.toFixed(1)}bps`}
                </div>
              </div>
            </div>
            <div className="border-b border-white/10 bg-[#050707] px-4 py-2">
              <div className="flex items-center justify-center gap-3">
                <span className="font-mono text-lg font-bold text-white">
                  ${fmt(spread.mid ?? displayedMid)}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/60">
                  mid price
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-white/10 p-px">
              <DepthColumn title="Bids" side="bid" levels={book.bids.slice(0, 12)} maxQty={maxDepthQty} />
              <DepthColumn title="Asks" side="ask" levels={book.asks.slice(0, 12)} maxQty={maxDepthQty} />
            </div>
          </div>

          <div className="overflow-hidden border border-white/10 bg-[#080b0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.025] px-4 py-3">
              <h2 className="font-headline text-sm font-extrabold">Trader</h2>
              <span className="font-mono text-[11px] text-on-surface-variant">
                {selectedTrader?.state ?? "not loaded"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-px bg-white/10 p-px">
              <Stat
                label="Collateral"
                value={selectedTrader ? formatAmount(selectedTrader.collateralBalance, { currency: true }) : "--"}
              />
              <Stat
                label="Portfolio"
                value={selectedTrader ? formatAmount(selectedTrader.portfolioValue, { currency: true }) : "--"}
              />
              <Stat label="Risk" value={selectedTrader?.riskState ?? "--"} />
              <Stat label="Tier" value={selectedTrader?.riskTier ?? "--"} />
            </div>
            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="text-on-surface-variant">Position</span>
                <span className={Number(amountScalar(selectedPosition?.positionSize) ?? 0) >= 0 ? "text-[#4dffb4]" : "text-[#ff8a80]"}>
                  {selectedPosition ? formatAmount(selectedPosition.positionSize) : "0"}
                </span>
              </div>
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="text-on-surface-variant">Entry</span>
                <span>{selectedPosition ? formatAmount(selectedPosition.entryPrice, { currency: true }) : "--"}</span>
              </div>
              <div className="flex items-center justify-between font-mono text-xs">
                <span className="text-on-surface-variant">Open Orders</span>
                <span>{selectedOrders.length}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="min-w-0 space-y-4">
          <div className="overflow-hidden border border-white/10 bg-[#080b0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.025] px-4 py-3">
              <div>
                <h1 className="font-headline text-base font-extrabold uppercase tracking-[0.06em] text-white">
                  Create Phoenix Strategy
                </h1>
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/55">
                  keeper-ready execution
                </div>
              </div>
              <span className="grid h-9 w-9 place-items-center rounded border border-white/10 bg-[#050707] text-on-surface-variant">
                <span className="material-symbols-outlined text-[18px]">bolt</span>
              </span>
            </div>
            <div className="space-y-4 p-4">
              <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr] gap-3 max-md:grid-cols-1">
                <label className="block min-w-0">
                  <span className="mb-1.5 block truncate font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/70">
                    Strategy
                  </span>
                  <select
                    value={strategyType}
                    onChange={(event) => setStrategyType(event.target.value as PhoenixStrategyType)}
                    className="h-10 w-full rounded border border-white/10 bg-[#030505] px-3 font-headline text-sm font-bold text-on-surface outline-none transition-colors focus:border-white/35"
                  >
                    {STRATEGY_TYPES.map((entry) => (
                      <option key={entry} value={entry}>
                        {entry}
                      </option>
                    ))}
                  </select>
                </label>
                <Segmented<PhoenixSide>
                  label="Side"
                  value={side}
                  values={["bid", "ask"]}
                  onChange={setSide}
                  render={sideLabel}
                />
                <Segmented<PhoenixOrderKind>
                  label="Order"
                  value={orderKind}
                  values={["market", "limit"]}
                  onChange={setOrderKind}
                />
              </div>

              {strategyParamFields}

              <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
                <Field label="Quantity" value={quantity} onChange={setQuantity} placeholder="0.1" />
                <Field
                  label="Limit Price"
                  value={limitPrice}
                  onChange={setLimitPrice}
                  placeholder={displayedMid ? fmt(displayedMid) : "150"}
                  disabled={orderKind === "market"}
                />
                <Field label="TP Price" value={takeProfitPrice} onChange={setTakeProfitPrice} />
                <Field label="SL Price" value={stopLossPrice} onChange={setStopLossPrice} />
              </div>

              <div className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
                <Field label="Transfer USDC" value={transferUsdc} onChange={setTransferUsdc} />
                <Field label="Cooldown Sec" value={cooldownSecs} onChange={setCooldownSecs} step="1" />
                <Field label="Max / Day" value={maxPerDay} onChange={setMaxPerDay} step="1" />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 font-mono text-xs text-on-surface-variant">
                    <input
                      type="checkbox"
                      checked={reduceOnly}
                      onChange={(event) => setReduceOnly(event.target.checked)}
                    className="h-4 w-4 accent-[#d7dde2]"
                    />
                    Reduce only
                  </label>
                  <label className="inline-flex items-center gap-2 font-mono text-xs text-on-surface-variant">
                    <input
                      type="checkbox"
                      checked={autoExecute}
                      onChange={(event) => setAutoExecute(event.target.checked)}
                      className="h-4 w-4 accent-[#d7dde2]"
                    />
                    Auto execute
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void createStrategy()}
                  className="inline-flex h-10 items-center gap-2 rounded bg-[#d7dde2] px-4 font-headline text-sm font-extrabold text-[#060707] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
                >
                  <span className="material-symbols-outlined text-[18px]">add</span>
                  Create Strategy
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-hidden border border-white/10 bg-[#080b0b] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.025] px-4 py-3">
              <h2 className="font-headline text-sm font-extrabold uppercase tracking-[0.08em] text-white">
                Phoenix Strategies
              </h2>
              <span className="font-mono text-[11px] text-on-surface-variant">
                {strategies.length} total
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1020px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-white/10 bg-[#050707] font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/60">
                    <th className="px-4 py-3 font-medium">Strategy</th>
                    <th className="px-3 py-3 font-medium">Side</th>
                    <th className="px-3 py-3 font-medium">Order</th>
                    <th className="px-3 py-3 font-medium">Price</th>
                    <th className="px-3 py-3 font-medium">Size</th>
                    <th className="px-3 py-3 font-medium">Protection</th>
                    <th className="px-3 py-3 font-medium">Signal</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {strategies.length ? (
                    strategies.map((strategy) => {
                      const signal = strategySignals.get(strategy.id);
                      const readyReason = isStrategyReady(strategy);
                      return (
                        <tr key={strategy.id} className="border-b border-white/5 transition-colors last:border-b-0 hover:bg-white/[0.025]">
                          <td className="px-4 py-3">
                            <div className="font-headline text-sm font-bold">{strategy.strategyType}</div>
                            <div className="mt-0.5 font-mono text-[11px] text-on-surface-variant">
                              {strategy.symbol}
                            </div>
                          </td>
                          <td className="px-3 py-3 font-mono text-xs">
                            <span className={strategy.side === "bid" ? "text-[#4dffb4]" : "text-[#ff8a80]"}>
                              {sideLabel(strategy.side)}
                            </span>
                          </td>
                          <td className="px-3 py-3 font-mono text-xs">
                            {strategy.orderKind}
                          </td>
                          <td className="px-3 py-3 font-mono text-xs text-on-surface">
                            {strategyPrice(strategy, displayedMid ?? stats.markPx)}
                          </td>
                          <td className="px-3 py-3 font-mono text-xs">{strategy.quantity}</td>
                          <td className="px-3 py-3 font-mono text-xs text-on-surface-variant">
                            TP {strategy.takeProfitPrice ? fmt(strategy.takeProfitPrice) : "--"} / SL{" "}
                            {strategy.stopLossPrice ? fmt(strategy.stopLossPrice) : "--"}
                          </td>
                          <td className="px-3 py-3">
                            <div
                              className={`font-mono text-xs ${
                                signal?.signal === strategy.side
                                  ? "text-[#d7dde2]"
                                  : signal?.ready
                                    ? "text-on-surface"
                                    : "text-on-surface-variant"
                              }`}
                            >
                              {signal?.label ?? "--"}
                            </div>
                            <div className="mt-0.5 max-w-[180px] truncate font-mono text-[10px] text-on-surface-variant/65">
                              {signal?.reason ?? "Waiting for candles"}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="font-mono text-xs text-on-surface">
                              {strategy.status}
                              {strategy.autoExecute ? " / auto" : ""}
                            </div>
                            <div className="mt-0.5 font-mono text-[10px] text-on-surface-variant/65">
                              {readyReason ??
                                `${strategy.executionsToday}/${strategy.maxExecutionsPerDay || "unlimited"}`}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => void executeStrategy(strategy)}
                                disabled={busyId === strategy.id}
                                title="Execute strategy"
                                className="grid h-8 w-8 place-items-center rounded border border-white/15 bg-white/[0.06] text-[#d7dde2] transition-colors hover:bg-white/[0.1] disabled:cursor-wait disabled:opacity-50"
                              >
                                <span className="material-symbols-outlined text-[17px]">
                                  {busyId === strategy.id ? "progress_activity" : "play_arrow"}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void setStrategyStatus(
                                    strategy,
                                    strategy.status === "active" ? "paused" : "active",
                                  )
                                }
                                title={strategy.status === "active" ? "Pause" : "Resume"}
                                className="grid h-8 w-8 place-items-center rounded border border-white/10 bg-white/[0.03] text-on-surface-variant transition-colors hover:text-on-surface"
                              >
                                <span className="material-symbols-outlined text-[17px]">
                                  {strategy.status === "active" ? "pause" : "play_arrow"}
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteStrategy(strategy)}
                                title="Delete strategy"
                                className="grid h-8 w-8 place-items-center rounded border border-white/10 bg-white/[0.03] text-[#ff8a80] transition-colors hover:border-[#ff8a80]/40 hover:bg-[#ff8a80]/8"
                              >
                                <span className="material-symbols-outlined text-[17px]">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center font-mono text-sm text-on-surface-variant">
                        No Phoenix strategies yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
