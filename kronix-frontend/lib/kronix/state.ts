import { Connection, PublicKey } from "@solana/web3.js";
import {
  getUserAccountDecoder,
  getPositionDecoder,
  getMarketConfigDecoder,
  getFundingStateDecoder,
  type UserAccount,
  type Position,
  type MarketConfig,
  type FundingState,
} from "@/lib/risk-sdk";
import {
  getMarketStateDecoder,
  getOpenOrdersAccountDecoder,
  type MarketState,
  type OpenOrdersAccount,
} from "@/lib/orderbook-sdk";

async function fetchAndDecode<T>(
  conn: Connection,
  pk: PublicKey,
  decode: (b: Uint8Array) => T,
): Promise<T | null> {
  const acc = await conn.getAccountInfo(pk, "confirmed");
  if (!acc) return null;
  return decode(new Uint8Array(acc.data));
}

export const fetchUser = (conn: Connection, pk: PublicKey) =>
  fetchAndDecode<UserAccount>(conn, pk, (b) => getUserAccountDecoder().decode(b));

export const fetchPosition = (conn: Connection, pk: PublicKey) =>
  fetchAndDecode<Position>(conn, pk, (b) => getPositionDecoder().decode(b));

export const fetchMarketConfig = (conn: Connection, pk: PublicKey) =>
  fetchAndDecode<MarketConfig>(conn, pk, (b) =>
    getMarketConfigDecoder().decode(b),
  );

export const fetchFundingState = (conn: Connection, pk: PublicKey) =>
  fetchAndDecode<FundingState>(conn, pk, (b) =>
    getFundingStateDecoder().decode(b),
  );

export const fetchMarketState = (conn: Connection, pk: PublicKey) =>
  fetchAndDecode<MarketState>(conn, pk, (b) => getMarketStateDecoder().decode(b));

export const fetchOpenOrders = (conn: Connection, pk: PublicKey) =>
  fetchAndDecode<OpenOrdersAccount>(conn, pk, (b) =>
    getOpenOrdersAccountDecoder().decode(b),
  );

export function bytesToPubkey(b: Uint8Array | ArrayLike<number>): PublicKey {
  return new PublicKey(Uint8Array.from(b));
}
