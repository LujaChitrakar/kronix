import { PublicKey } from "@solana/web3.js";

export const ORDERBOOK_PROGRAM_ID = new PublicKey(
  "j8VeDggFuwtiCjM8uo7am8i1bWWH2sj7mBRxqTaZniU",
);

export const RISK_PROGRAM_ID = new PublicKey(
  "5ivREpNsjSj4Gr27oxEfyAZ38KCfDDtDLdXQeHDtDpo4",
);

export const TRIGGER_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_TRIGGER_PROGRAM_ID ??
    "9KDXQmrMy71pVHTknapcv4jP8aHsr9yF5yXMmGNftUkX",
);

export const STRATEGY_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_STRATEGY_PROGRAM_ID ??
    "7jUHqPKWF4ebe4gSRMwy1FfAWyuiQjpjTdzqtbMK6S9q",
);

export enum StrategyType {
  RSI = 0,
  EMA = 1,
  RangeDCA = 2,
  SR = 3,
  SmartMoney = 4,
}

export enum StrategyStatus {
  Active = 0,
  Paused = 1,
  Completed = 2,
}

export enum TriggerType {
  StopLoss = 0,
  TakeProfit = 1,
}

export enum TriggerStatus {
  Active = 0,
  Triggered = 1,
  Canceled = 2,
  Paused = 3,
}

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

export const SYSTEM_PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111",
);

export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ??
    "4VwXppbTdzQvzt7SsMYUpXdrZcytrQeixJFXUcgsEetF",
);

export type MarketSymbol = "SOL" | "KXI";

export type MarketInfo = {
  symbol: MarketSymbol;
  marketIndex: number;
  name: string;
  oracle: PublicKey;
};

export const SOL_SWITCHBOARD_FEED = new PublicKey(
  process.env.NEXT_PUBLIC_SOL_SB_FEED_CONFIG ??
    process.env.NEXT_PUBLIC_SB_FEED_CONFIG ??
    "GgGVgSLWAyL9Xf4fGaAQQCkmWetBjX7PCNz8kTK97DKB",
);

export const KXI_SWITCHBOARD_FEED = new PublicKey(
  process.env.NEXT_PUBLIC_KXI_SB_FEED_CONFIG ??
    "8C9ZsFqtNSLwCeqcFDW1WL4qB8XugkQec6VNsKv3fos8",
);

export const MARKETS: Record<MarketSymbol, MarketInfo> = {
  SOL: {
    symbol: "SOL",
    marketIndex: Number(
      process.env.NEXT_PUBLIC_SOL_MARKET_INDEX ??
        process.env.NEXT_PUBLIC_MARKET_INDEX ??
        1,
    ),
    name: "SOL-PERP",
    oracle: SOL_SWITCHBOARD_FEED,
  },
  KXI: {
    symbol: "KXI",
    marketIndex: Number(process.env.NEXT_PUBLIC_KXI_MARKET_INDEX ?? 2),
    name: "KXI-PERP",
    oracle: KXI_SWITCHBOARD_FEED,
  },
};

export function isMarketSymbol(symbol: string | null | undefined): symbol is MarketSymbol {
  return symbol === "SOL" || symbol === "KXI";
}

const defaultMarketSymbolEnv = process.env.NEXT_PUBLIC_DEFAULT_MARKET_SYMBOL;
export const DEFAULT_MARKET_SYMBOL: MarketSymbol = isMarketSymbol(defaultMarketSymbolEnv)
  ? defaultMarketSymbolEnv
  : "SOL";

export function getMarketInfo(symbol: string | null | undefined): MarketInfo {
  return isMarketSymbol(symbol ?? "")
    ? MARKETS[symbol as MarketSymbol]
    : MARKETS[DEFAULT_MARKET_SYMBOL];
}

export function getMarketInfoByIndex(marketIndex: number): MarketInfo | null {
  return Object.values(MARKETS).find((m) => m.marketIndex === marketIndex) ?? null;
}

export const MARKET_INDEX = MARKETS[DEFAULT_MARKET_SYMBOL].marketIndex;

export const MARKET_NAME = MARKETS[DEFAULT_MARKET_SYMBOL].name;

export const USDC_DECIMALS = 6;

export const MAX_OPEN_ORDERS = 24;

export enum Side {
  Bid = 0,
  Ask = 1,
}

export enum PlaceOrderType {
  Limit = 0,
  ImmediateOrCancel = 1,
  PostOnly = 2,
  Market = 3,
  PostOnlySlide = 4,
  FillOrKill = 5,
}
