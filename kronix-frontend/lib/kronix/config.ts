import { PublicKey } from "@solana/web3.js";

export const ORDERBOOK_PROGRAM_ID = new PublicKey(
  "j8VeDggFuwtiCjM8uo7am8i1bWWH2sj7mBRxqTaZniU",
);

export const RISK_PROGRAM_ID = new PublicKey(
  "C8kAYt7vpmFxhguEJxbg6hMZY3LLNYACrU8mKveZ8eMu",
);

export const TRIGGER_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_TRIGGER_PROGRAM_ID ??
    "FBux8UY7koXsvDp3GThjvtiMo4GagsDdkPDbU4VbQzV2",
);

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

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

export const USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_USDC_MINT ??
    "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

export const MARKET_INDEX = Number(process.env.NEXT_PUBLIC_MARKET_INDEX ?? 12);

export const MARKET_NAME = process.env.NEXT_PUBLIC_MARKET_NAME ?? "SOL-PERP";

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
