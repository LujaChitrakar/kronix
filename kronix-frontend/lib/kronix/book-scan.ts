import { Connection, PublicKey } from "@solana/web3.js";
import { findBidsPda, findAsksPda, findMarketPda } from "./pdas";
import { MARKET_INDEX } from "./config";

export type BookOrder = {
  owner: PublicKey;
  clientId: bigint;
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
const TAG_LEAF = 2;

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
): Array<{
  owner: PublicKey;
  clientId: bigint;
  priceLots: bigint;
  quantity: bigint;
  side: number;
}> {
  const out: BookOrder[] = [];
  for (let i = 0; i < MAX_NODES; i++) {
    const off = NODES_OFFSET + i * NODE_SIZE;
    if (off + NODE_SIZE > data.length) break;
    const tag = data.readUInt8(off);
    if (tag !== TAG_LEAF) continue;
    const clientId = data.readBigUInt64LE(off + 8);
    const quantity = data.readBigInt64LE(off + 16);
    // key is u128 little-endian; upper 64 bits = price_data
    const priceData = data.readBigUInt64LE(off + 32 + 8);
    const owner = new PublicKey(data.subarray(off + 48, off + 48 + 32));
    out.push({ owner, clientId, priceLots: priceData, quantity, side });
  }
  return out;
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
): Promise<BookSnapshot> {
  const [bidsPda] = findBidsPda(MARKET_INDEX);
  const [asksPda] = findAsksPda(MARKET_INDEX);
  const [bidsAcc, asksAcc] = await Promise.all([
    conn.getAccountInfo(bidsPda, "confirmed"),
    conn.getAccountInfo(asksPda, "confirmed"),
  ]);

  const bids = bidsAcc ? decodeBookSide(bidsAcc.data as Buffer, 0) : [];
  const asks = asksAcc ? decodeBookSide(asksAcc.data as Buffer, 1) : [];

  bids.sort((a, b) => (a.priceLots > b.priceLots ? -1 : 1));
  asks.sort((a, b) => (a.priceLots > b.priceLots ? 1 : -1));

  return { bids, asks, scannedAccounts: 2 };
}

// Optional helper if Orderbook PDA is needed elsewhere.
export function bookPdas() {
  const [market] = findMarketPda(MARKET_INDEX);
  const [bids] = findBidsPda(MARKET_INDEX);
  const [asks] = findAsksPda(MARKET_INDEX);
  return { market, bids, asks };
}
