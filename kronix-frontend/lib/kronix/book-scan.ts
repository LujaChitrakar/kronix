import { Connection, PublicKey } from "@solana/web3.js";
import { findBidsPda, findAsksPda, findMarketPda } from "./pdas";
import { MARKET_INDEX } from "./config";

export type BookOrder = {
  owner: PublicKey;
  clientId: bigint;
  orderKey: bigint;
  priceLots: bigint;
  side: number; // 0 = bid, 1 = ask
  quantity: bigint;
};

export type BookSnapshot = {
  bids: BookOrder[]; // sorted desc by price
  asks: BookOrder[]; // sorted asc by price
  scannedAccounts: number;
};

// BookSide layout (matches orderbook_program/src/states/orderbook/bookside.rs):
//   roots:           OrderTreeRoot   = 8  bytes (maybe_node u32 + leaf_count u32)
//   reserved_roots:  [OrderTreeRoot;5] = 40 bytes
//   reserved:        [u8;256]        = 256 bytes
//   nodes (OrderTreeNodes):
//     order_tree_type u8 + padding[3]  = 4
//     bump_index u32                    = 4
//     free_list_len u32                 = 4
//     free_list_head u32                = 4
//     reserved [u8;512]                 = 512
//     nodes [AnyNode; 100] (88 each)    = 8800
const BOOKSIDE_PREAMBLE = 8 + 5 * 8 + 256; // 304
const ORDERTREE_PREAMBLE = 4 + 4 + 4 + 4 + 512; // 528
const NODES_OFFSET = BOOKSIDE_PREAMBLE + ORDERTREE_PREAMBLE; // 832
const NODE_SIZE = 88;
const MAX_NODES = 100;
const TAG_INNER = 1;
const TAG_LEAF = 2;
const INNER_CHILDREN_OFFSET = 40;

// LeafNode field offsets within a node (88 bytes):
//   tag u8                @ 0
//   owner_slot u8         @ 1
//   time_in_force u16     @ 2
//   padding [u8;4]        @ 4
//   client_order_id u64   @ 8
//   quantity i64          @ 16
//   timestamp u64         @ 24
//   key [u8;16]           @ 32
//   owner [u8;32]         @ 48
//   reserved [u8;8]       @ 80

function decodeBookSide(
  data: Buffer,
  side: number,
  nowTs: bigint,
): Array<{
  owner: PublicKey;
  clientId: bigint;
  orderKey: bigint;
  priceLots: bigint;
  quantity: bigint;
  side: number;
}> {
  const out: BookOrder[] = [];
  const root = data.readUInt32LE(0);
  const leafCount = data.readUInt32LE(4);
  if (leafCount === 0) return out;

  const stack = [root];
  const seen = new Set<number>();

  while (stack.length > 0 && seen.size < MAX_NODES) {
    const handle = stack.pop();
    if (handle === undefined) break;
    if (handle >= MAX_NODES || seen.has(handle)) continue;
    seen.add(handle);

    const off = NODES_OFFSET + handle * NODE_SIZE;
    if (off + NODE_SIZE > data.length) continue;

    const tag = data.readUInt8(off);
    if (tag === TAG_INNER) {
      stack.push(
        data.readUInt32LE(off + INNER_CHILDREN_OFFSET + 4),
        data.readUInt32LE(off + INNER_CHILDREN_OFFSET),
      );
      continue;
    }

    if (tag !== TAG_LEAF) continue;
    const clientId = data.readBigUInt64LE(off + 8);
    const quantity = data.readBigInt64LE(off + 16);
    if (quantity <= 0n) continue;
    const timeInForce = data.readUInt16LE(off + 2);
    const timestamp = data.readBigUInt64LE(off + 24);
    if (
      timeInForce > 0 &&
      timestamp > 0n &&
      nowTs >= timestamp + BigInt(timeInForce)
    ) {
      continue;
    }
    // key is u128 little-endian; upper 64 bits = price_data
    const keyLow = data.readBigUInt64LE(off + 32);
    const priceData = data.readBigUInt64LE(off + 32 + 8);
    const orderKey = (priceData << 64n) | keyLow;
    const owner = new PublicKey(data.subarray(off + 48, off + 48 + 32));
    out.push({ owner, clientId, orderKey, priceLots: priceData, quantity, side });
  }
  return out;
}

function compareBids(a: BookOrder, b: BookOrder): number {
  if (a.priceLots !== b.priceLots) return a.priceLots > b.priceLots ? -1 : 1;
  if (a.orderKey === b.orderKey) return 0;
  return a.orderKey > b.orderKey ? -1 : 1;
}

function compareAsks(a: BookOrder, b: BookOrder): number {
  if (a.priceLots !== b.priceLots) return a.priceLots > b.priceLots ? 1 : -1;
  if (a.orderKey === b.orderKey) return 0;
  return a.orderKey > b.orderKey ? 1 : -1;
}

/**
 * Read both bids and asks BookSide accounts, decode the critbit node array
 * directly, return a snapshot with quantities. This is the authoritative
 * book state — does not depend on per-user OpenOrdersAccount mirrors that
 * lag matching by a settle_fills round-trip.
 */
export async function scanBook(
  conn: Connection,
  _market: PublicKey,
  marketIndex = MARKET_INDEX,
): Promise<BookSnapshot> {
  const [bidsPda] = findBidsPda(marketIndex);
  const [asksPda] = findAsksPda(marketIndex);
  const [bidsAcc, asksAcc] = await Promise.all([
    conn.getAccountInfo(bidsPda, "confirmed"),
    conn.getAccountInfo(asksPda, "confirmed"),
  ]);

  const nowTs = BigInt(Math.floor(Date.now() / 1000));
  const bids = bidsAcc ? decodeBookSide(bidsAcc.data as Buffer, 0, nowTs) : [];
  const asks = asksAcc ? decodeBookSide(asksAcc.data as Buffer, 1, nowTs) : [];

  bids.sort(compareBids);
  asks.sort(compareAsks);

  return { bids, asks, scannedAccounts: 2 };
}

// Optional helper if Orderbook PDA is needed elsewhere.
export function bookPdas(marketIndex = MARKET_INDEX) {
  const [market] = findMarketPda(marketIndex);
  const [bids] = findBidsPda(marketIndex);
  const [asks] = findAsksPda(marketIndex);
  return { market, bids, asks };
}
