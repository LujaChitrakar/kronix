import type { PhoenixSide, PhoenixStrategy } from "./client";

export type PhoenixCandle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  tradeCount?: number;
};

export type PhoenixStrategySignal = {
  signal: PhoenixSide | null;
  ready: boolean;
  label: string;
  reason: string;
};

const CANDLE_BUCKET_SIZE = 1;

function computeRsi(prices: number[], period: number): number | null {
  if (period <= 0 || prices.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = prices[i] - prices[i - 1];
    if (delta > 0) avgGain += delta;
    else avgLoss += -delta;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < prices.length; i++) {
    const delta = prices[i] - prices[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function computeEma(prices: number[], period: number): number | null {
  if (period <= 0 || prices.length < period) return null;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += prices[i];
  seed /= period;
  let ema = seed;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function computeEmaPrev(prices: number[], period: number): number | null {
  if (prices.length < period + 1) return null;
  return computeEma(prices.slice(0, -1), period);
}

type Structure = "bullish" | "bearish" | "ranging";

function pivotHighAt(highs: number[], idx: number): number | null {
  if (idx <= 0 || idx + 1 >= highs.length) return null;
  return highs[idx] > highs[idx - 1] && highs[idx] > highs[idx + 1]
    ? highs[idx]
    : null;
}

function pivotLowAt(lows: number[], idx: number): number | null {
  if (idx <= 0 || idx + 1 >= lows.length) return null;
  return lows[idx] < lows[idx - 1] && lows[idx] < lows[idx + 1]
    ? lows[idx]
    : null;
}

function findPrevPivotHigh(highs: number[], before: number): number | null {
  for (let i = before - 1; i >= 1; i--) {
    const high = pivotHighAt(highs, i);
    if (high !== null) return high;
  }
  return null;
}

function findPrevPivotLow(lows: number[], before: number): number | null {
  for (let i = before - 1; i >= 1; i--) {
    const low = pivotLowAt(lows, i);
    if (low !== null) return low;
  }
  return null;
}

function detectStructure(candles: PhoenixCandle[]): Structure {
  if (candles.length < 6) return "ranging";
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const n = candles.length;
  const phCurr = pivotHighAt(highs, n - 2);
  const plCurr = pivotLowAt(lows, n - 2);
  const phPrev = findPrevPivotHigh(highs, n - 3);
  const plPrev = findPrevPivotLow(lows, n - 3);
  if (phCurr === null || plCurr === null || phPrev === null || plPrev === null) {
    return "ranging";
  }
  if (phCurr > phPrev && plCurr > plPrev) return "bullish";
  if (phCurr < phPrev && plCurr < plPrev) return "bearish";
  return "ranging";
}

type OrderBlock = { high: number; low: number; isBullish: boolean };

function findOrderBlock(
  candles: PhoenixCandle[],
  structure: Structure,
): OrderBlock | null {
  if (candles.length < 3 || structure === "ranging") return null;
  for (let i = candles.length - 2; i >= 1; i--) {
    const candle = candles[i];
    const next = candles[i + 1];
    if (structure === "bullish") {
      if (
        candle.close < candle.open &&
        next.close > next.open &&
        next.close > candle.high
      ) {
        return { high: candle.high, low: candle.low, isBullish: true };
      }
    } else if (
      candle.close > candle.open &&
      next.close < next.open &&
      next.close < candle.low
    ) {
      return { high: candle.high, low: candle.low, isBullish: false };
    }
  }
  return null;
}

function withCurrentPrice(candles: PhoenixCandle[], price?: number): number[] {
  const closes = candles.map((candle) => candle.close);
  if (price === undefined || !Number.isFinite(price)) return closes;
  if (closes[closes.length - 1] === price) return closes;
  return [...closes, price];
}

function formatPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function evaluatePhoenixStrategy(
  strategy: PhoenixStrategy,
  candles: PhoenixCandle[],
  currentPrice?: number,
): PhoenixStrategySignal {
  const price =
    currentPrice ??
    candles[candles.length - 1]?.close ??
    strategy.limitPrice ??
    undefined;

  if (!price || !Number.isFinite(price)) {
    return {
      signal: null,
      ready: false,
      label: "No price",
      reason: "Waiting for Phoenix market data",
    };
  }

  const prices = withCurrentPrice(candles, price);
  const params = strategy.params;

  if (strategy.strategyType === "RSI") {
    const period = params.rsiPeriod ?? 14;
    const oversold = params.rsiOversold ?? 30;
    const overbought = params.rsiOverbought ?? 70;
    const rsi = computeRsi(prices, period);
    if (rsi === null) {
      return {
        signal: null,
        ready: false,
        label: `RSI ${period}`,
        reason: `Need ${period + 1} closes`,
      };
    }
    const signal =
      strategy.side === "bid" && rsi <= oversold
        ? "bid"
        : strategy.side === "ask" && rsi >= overbought
          ? "ask"
          : null;
    return {
      signal,
      ready: true,
      label: `RSI ${rsi.toFixed(1)}`,
      reason: signal
        ? `${signal.toUpperCase()} threshold hit`
        : `Waiting for ${strategy.side === "bid" ? oversold : overbought}`,
    };
  }

  if (strategy.strategyType === "EMA") {
    const fast = params.emaFast ?? 9;
    const slow = params.emaSlow ?? 21;
    const fastNow = computeEma(prices, fast);
    const slowNow = computeEma(prices, slow);
    const fastPrev = computeEmaPrev(prices, fast);
    const slowPrev = computeEmaPrev(prices, slow);
    if (
      fastNow === null ||
      slowNow === null ||
      fastPrev === null ||
      slowPrev === null
    ) {
      return {
        signal: null,
        ready: false,
        label: `EMA ${fast}/${slow}`,
        reason: `Need ${Math.max(fast, slow) + 1} closes`,
      };
    }
    const bullishCross = fastPrev <= slowPrev && fastNow > slowNow;
    const bearishCross = fastPrev >= slowPrev && fastNow < slowNow;
    const signal =
      strategy.side === "bid" && bullishCross
        ? "bid"
        : strategy.side === "ask" && bearishCross
          ? "ask"
          : null;
    return {
      signal,
      ready: true,
      label: `EMA ${fastNow.toFixed(2)}/${slowNow.toFixed(2)}`,
      reason: signal ? `${signal.toUpperCase()} cross` : "Waiting for cross",
    };
  }

  if (strategy.strategyType === "Range DCA") {
    const lower = params.lowerPrice ?? 0;
    const upper = params.upperPrice ?? 0;
    const gridCount = params.gridCount ?? 0;
    if (gridCount <= 0 || upper <= lower) {
      return {
        signal: null,
        ready: false,
        label: "Range",
        reason: "Invalid range config",
      };
    }
    const step = (upper - lower) / gridCount;
    const tolerance = step * 0.001;
    let nearest: number | null = null;
    for (let i = 0; i <= gridCount; i++) {
      const level = lower + step * i;
      if (nearest === null || Math.abs(price - level) < Math.abs(price - nearest)) {
        nearest = level;
      }
      if (Math.abs(price - level) <= tolerance) {
        return {
          signal: strategy.side,
          ready: true,
          label: `Grid ${formatPrice(level)}`,
          reason: `${strategy.side.toUpperCase()} range level hit`,
        };
      }
    }
    return {
      signal: null,
      ready: true,
      label: nearest === null ? "Range" : `Near ${formatPrice(nearest)}`,
      reason: "Waiting for grid touch",
    };
  }

  if (strategy.strategyType === "Support/Resistance") {
    const levels = params.levels ?? [];
    const toleranceBps = params.toleranceBps ?? 0;
    if (!levels.length || toleranceBps <= 0) {
      return {
        signal: null,
        ready: false,
        label: "S/R",
        reason: "Missing levels or tolerance",
      };
    }
    for (const level of levels) {
      if (level <= 0) continue;
      const dist = Math.abs(price - level);
      if (dist <= level * (toleranceBps / 10_000)) {
        return {
          signal: strategy.side,
          ready: true,
          label: `Level ${formatPrice(level)}`,
          reason: `${strategy.side.toUpperCase()} S/R level hit`,
        };
      }
    }
    return {
      signal: null,
      ready: true,
      label: `S/R ${levels.length}`,
      reason: "Waiting for level touch",
    };
  }

  const lookback = Math.max(params.structureLookback ?? 40, 6);
  const sensitivity = params.orderBlockSensitivity ?? 3;
  const needed = lookback * CANDLE_BUCKET_SIZE;
  if (candles.length < needed) {
    return {
      signal: null,
      ready: false,
      label: "Structure",
      reason: `Need ${needed} candles`,
    };
  }
  const window = candles.slice(-needed);
  const structure = detectStructure(window);
  if (structure === "ranging") {
    return {
      signal: null,
      ready: true,
      label: "Ranging",
      reason: "Waiting for structure break",
    };
  }
  const orderBlock = findOrderBlock(window, structure);
  if (!orderBlock) {
    return {
      signal: null,
      ready: true,
      label: structure,
      reason: "Waiting for order block",
    };
  }
  const fuzz = (price * sensitivity) / 10_000;
  const inBlock = price >= orderBlock.low - fuzz && price <= orderBlock.high + fuzz;
  const blockSide: PhoenixSide = orderBlock.isBullish ? "bid" : "ask";
  const signal = inBlock && blockSide === strategy.side ? blockSide : null;
  return {
    signal,
    ready: true,
    label: `${structure} OB`,
    reason: signal ? `${signal.toUpperCase()} order block hit` : "Waiting for block retest",
  };
}
