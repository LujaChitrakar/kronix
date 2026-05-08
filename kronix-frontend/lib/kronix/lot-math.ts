import { USDC_DECIMALS } from "./config";

export const BASE_NATIVE_UNIT = 1_000_000_000n;
export const QUOTE_NATIVE_UNIT = 10n ** BigInt(USDC_DECIMALS);
export const DEFAULT_BASE_LOT_SIZE = 10_000_000n; // 0.01 base unit
export const DEFAULT_QUOTE_LOT_SIZE = 100n; // $0.0001

export type LotConfig = {
  baseLotSize: bigint;
  quoteLotSize: bigint;
};

const PRICE_INPUT_DECIMALS = 2;
const SIZE_INPUT_DECIMALS = 2;

function parseDecimalUnits(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === ".") return null;
  if (!/^\d+(?:\.\d*)?$|^\.\d+$/.test(trimmed)) return null;

  const [wholeRaw, fracRaw = ""] = trimmed.split(".");
  if (fracRaw.length > decimals) return null;

  const whole = BigInt(wholeRaw || "0");
  const fracPadded = fracRaw.padEnd(decimals, "0");
  const frac = BigInt(fracPadded || "0");
  const scale = 10n ** BigInt(decimals);
  return whole * scale + frac;
}

function formatDecimalUnits(
  units: bigint,
  decimals: number,
  displayDecimals = decimals,
  trimTrailingZeros = true,
): string {
  const sign = units < 0n ? "-" : "";
  const abs = units < 0n ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const whole = abs / scale;
  const fracFull = (abs % scale).toString().padStart(decimals, "0");
  const frac = fracFull.slice(0, displayDecimals);
  const trimmed = trimTrailingZeros ? frac.replace(/0+$/, "") : frac;
  return trimmed ? `${sign}${whole}.${trimmed}` : `${sign}${whole}`;
}

export function priceInputFromNumber(value: number): string {
  if (!Number.isFinite(value)) return "";
  return value.toFixed(PRICE_INPUT_DECIMALS).replace(/\.?0+$/, "");
}

export function parsePriceInput(value: string, cfg: LotConfig): bigint | null {
  if (cfg.baseLotSize <= 0n || cfg.quoteLotSize <= 0n) return null;
  const priceDisplay = parseDecimalUnits(value, PRICE_INPUT_DECIMALS);
  if (priceDisplay === null) return null;
  const quoteNative =
    (priceDisplay * QUOTE_NATIVE_UNIT) / (10n ** BigInt(PRICE_INPUT_DECIMALS));
  const numerator = quoteNative * cfg.baseLotSize;
  const denominator = BASE_NATIVE_UNIT * cfg.quoteLotSize;
  return numerator / denominator;
}

export function parseSizeInput(value: string, cfg: LotConfig): bigint | null {
  if (cfg.baseLotSize <= 0n) return null;
  const baseDisplay = parseDecimalUnits(value, SIZE_INPUT_DECIMALS);
  if (baseDisplay === null) return null;
  const baseNative =
    (baseDisplay * BASE_NATIVE_UNIT) / (10n ** BigInt(SIZE_INPUT_DECIMALS));
  return baseNative / cfg.baseLotSize;
}

export function nativePriceToLots(priceNative: bigint, cfg: LotConfig): bigint {
  if (cfg.baseLotSize <= 0n || cfg.quoteLotSize <= 0n) return 0n;
  return (priceNative * cfg.baseLotSize) / (BASE_NATIVE_UNIT * cfg.quoteLotSize);
}

export function priceLotsToNative(priceLots: bigint, cfg: LotConfig): bigint {
  if (cfg.baseLotSize <= 0n) return 0n;
  return (priceLots * cfg.quoteLotSize * BASE_NATIVE_UNIT) / cfg.baseLotSize;
}

export function sizeLotsToNative(sizeLots: bigint, cfg: LotConfig): bigint {
  return sizeLots * cfg.baseLotSize;
}

export function quoteLotsToNative(quoteLots: bigint, cfg: LotConfig): bigint {
  return quoteLots * cfg.quoteLotSize;
}

export function notionalNative(
  sizeLots: bigint,
  priceLots: bigint,
  cfg: LotConfig,
): bigint {
  const absSize = sizeLots < 0n ? -sizeLots : sizeLots;
  return absSize * priceLots * cfg.quoteLotSize;
}

export function formatPriceLots(priceLots: bigint, cfg: LotConfig): string {
  return formatDecimalUnits(priceLotsToNative(priceLots, cfg), USDC_DECIMALS, 2);
}

export function formatSizeLots(sizeLots: bigint, cfg: LotConfig): string {
  return formatDecimalUnits(sizeLotsToNative(sizeLots, cfg), 9, 2);
}

export function formatUsdcNative(amount: bigint, displayDecimals = 2): string {
  return formatDecimalUnits(amount, USDC_DECIMALS, displayDecimals, false);
}
