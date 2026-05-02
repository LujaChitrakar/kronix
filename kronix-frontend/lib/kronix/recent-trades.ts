import { Connection, PublicKey } from "@solana/web3.js";
import { ORDERBOOK_PROGRAM_ID, MARKET_INDEX } from "./config";
import { findMarketPda } from "./pdas";

export type RecentTrade = {
  takerSide: number; // 0 bid, 1 ask
  priceLots: bigint;
  quantity: bigint;
  slot: bigint;
  takerClientId: bigint;
  makerClientId: bigint;
  taker: PublicKey;
  maker: PublicKey;
};

const FILL_ENTRY_LEN = 104;
const HEADER_LEN = 24;
const FILLS_LEN = 8 * FILL_ENTRY_LEN; // 832
const TAIL = HEADER_LEN + FILLS_LEN; // 856
const FILLS_LOG_LEN = TAIL + 32 + 32 + 32; // 952

function decodeOne(buf: Uint8Array): RecentTrade[] {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const slot = dv.getBigUint64(8, true);
  const fillCount = dv.getUint8(16);
  const taker = new PublicKey(buf.subarray(TAIL + 32, TAIL + 64));
  const out: RecentTrade[] = [];
  for (let i = 0; i < fillCount; i++) {
    const o = HEADER_LEN + i * FILL_ENTRY_LEN;
    const takerClientId = dv.getBigUint64(o, true);
    const makerClientId = dv.getBigUint64(o + 8, true);
    const price = dv.getBigInt64(o + 16, true);
    const qty = dv.getBigInt64(o + 24, true);
    const takerSide = dv.getUint8(o + 32);
    const makerPk = new PublicKey(buf.subarray(o + 72, o + 104));
    if (qty <= 0n || price <= 0n) continue;
    out.push({
      takerSide,
      priceLots: price,
      quantity: qty,
      slot,
      takerClientId,
      makerClientId,
      taker,
      maker: makerPk,
    });
  }
  return out;
}

export async function fetchRecentTrades(
  conn: Connection,
  limit = 30,
  marketIndex = MARKET_INDEX,
): Promise<RecentTrade[]> {
  const [market] = findMarketPda(marketIndex);
  const accounts = await conn.getProgramAccounts(ORDERBOOK_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { dataSize: FILLS_LOG_LEN },
      { memcmp: { offset: TAIL, bytes: market.toBase58() } },
    ],
  });

  const all: RecentTrade[] = [];
  for (const a of accounts) {
    try {
      const trades = decodeOne(new Uint8Array(a.account.data as Buffer));
      all.push(...trades);
    } catch {
      // skip
    }
  }

  all.sort((a, b) => {
    if (a.slot !== b.slot) return a.slot > b.slot ? -1 : 1;
    return Number(b.takerClientId - a.takerClientId);
  });
  return all.slice(0, limit);
}
