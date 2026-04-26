import { Connection, PublicKey } from "@solana/web3.js";

export type FillEntry = {
  takerClientId: bigint;
  makerClientId: bigint;
  price: bigint;
  quantity: bigint;
  takerSide: number;
  makerSlot: number;
  makerOut: number;
  settled: number;
  marketIndex: number;
  takerPubkey: PublicKey;
  makerPubkey: PublicKey;
};

export type FillsLog = {
  clientOrderId: bigint;
  createdSlot: bigint;
  fillCount: number;
  allSettled: number;
  bump: number;
  market: PublicKey;
  taker: PublicKey;
  fills: FillEntry[];
};

const FILL_ENTRY_LEN = 104;
const HEADER_LEN = 8 + 8 + 1 + 1 + 1 + 5; // 24
const FILLS_LEN = 8 * FILL_ENTRY_LEN; // 832

export function decodeFillsLog(buf: Uint8Array): FillsLog {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const clientOrderId = dv.getBigUint64(0, true);
  const createdSlot = dv.getBigUint64(8, true);
  const fillCount = dv.getUint8(16);
  const allSettled = dv.getUint8(17);
  const bump = dv.getUint8(18);

  const fills: FillEntry[] = [];
  for (let i = 0; i < 8; i++) {
    const o = HEADER_LEN + i * FILL_ENTRY_LEN;
    fills.push({
      takerClientId: dv.getBigUint64(o, true),
      makerClientId: dv.getBigUint64(o + 8, true),
      price: dv.getBigInt64(o + 16, true),
      quantity: dv.getBigInt64(o + 24, true),
      takerSide: dv.getUint8(o + 32),
      makerSlot: dv.getUint8(o + 33),
      makerOut: dv.getUint8(o + 34),
      settled: dv.getUint8(o + 35),
      marketIndex: dv.getUint16(o + 36, true),
      takerPubkey: new PublicKey(buf.subarray(o + 40, o + 72)),
      makerPubkey: new PublicKey(buf.subarray(o + 72, o + 104)),
    });
  }

  const tail = HEADER_LEN + FILLS_LEN;
  const market = new PublicKey(buf.subarray(tail, tail + 32));
  const taker = new PublicKey(buf.subarray(tail + 32, tail + 64));

  return {
    clientOrderId,
    createdSlot,
    fillCount,
    allSettled,
    bump,
    market,
    taker,
    fills: fills.slice(0, fillCount),
  };
}

export async function fetchFillsLog(
  conn: Connection,
  pk: PublicKey,
): Promise<FillsLog | null> {
  const a = await conn.getAccountInfo(pk, "confirmed");
  if (!a) return null;
  return decodeFillsLog(new Uint8Array(a.data));
}
