import {
  PublicKey,
  TransactionInstruction,
  AccountMeta,
} from "@solana/web3.js";
import {
  ORDERBOOK_PROGRAM_ID,
  RISK_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
} from "./config";
import {
  findUserAccountPda,
  findPositionPda,
  findOpenOrdersPda,
  findMarketPda,
  findMarketConfigPda,
  findFundingStatePda,
} from "./pdas";
import type { FillEntry } from "./fills-log";

export const SETTLE_FILLS_DISCRIMINATOR = 5;
export const MAX_FILLS_PER_TX = 4;
const DEBUG_SETTLE_FILLS = process.env.NEXT_PUBLIC_DEBUG_SETTLE_FILLS === "1";

type FillSettleParams = {
  takerBumpUser: number;
  takerBumpPosition: number;
  makerBumpUser: number;
  makerBumpPosition: number;
  makerBumpOo: number;
};

function encodeData(
  start: number,
  end: number,
  fillParams: FillSettleParams[],
): Buffer {
  // Layout matches Rust SettleFillsParams (see settle_fills.rs):
  //   discriminator: u8
  //   start: u8
  //   end: u8
  //   padding: [u8; 6]
  //   fill_params: [FillSettleParams; 8]   (8 bytes each = 64)
  // Total: 1 + 1 + 1 + 6 + 64 = 73 bytes
  const buf = Buffer.alloc(73);
  buf.writeUInt8(SETTLE_FILLS_DISCRIMINATOR, 0);
  buf.writeUInt8(start, 1);
  buf.writeUInt8(end, 2);
  // padding [3..9)
  for (let i = 0; i < 8; i++) {
    const o = 9 + i * 8;
    const p = fillParams[i];
    if (p) {
      buf.writeUInt8(p.takerBumpUser, o);
      buf.writeUInt8(p.takerBumpPosition, o + 1);
      buf.writeUInt8(p.makerBumpUser, o + 2);
      buf.writeUInt8(p.makerBumpPosition, o + 3);
      buf.writeUInt8(p.makerBumpOo, o + 4);
    }
    // remaining 3 bytes padding zero
  }
  return buf;
}

/**
 * Build a settle_fills instruction for fills [start, end).
 *
 * Range must be small enough to fit Solana's 1232-byte TX limit:
 * each fill adds 5 remaining accounts (5 * 32 = 160 bytes of metas),
 * so the safe upper bound is 4 fills per IX.
 */
export function buildSettleFillsIx(
  caller: PublicKey,
  marketIndex: number,
  fillsLog: PublicKey,
  fills: FillEntry[],
  start: number,
  end: number,
): TransactionInstruction {
  if (end - start > MAX_FILLS_PER_TX) {
    throw new Error(`settle_fills: max ${MAX_FILLS_PER_TX} fills per TX`);
  }

  const [market] = findMarketPda(marketIndex);
  const [marketConfig] = findMarketConfigPda(marketIndex);
  const [fundingState] = findFundingStatePda(marketIndex);

  if (DEBUG_SETTLE_FILLS) {
    console.log("market PDA:", market.toBase58());
    console.log("marketConfig PDA:", marketConfig.toBase58());
    console.log("fundingState PDA:", fundingState.toBase58());
    console.log("fillsLog:", fillsLog.toBase58());
    console.log("caller:", caller.toBase58());
  }

  // Per-fill params live in fixed-size [8] array indexed by GLOBAL fill
  // index (rust uses `params.fill_params[i]` where i is the absolute index),
  // not by local-slice index.
  const fillParamsAll: FillSettleParams[] = new Array(8).fill(null);
  const remaining: AccountMeta[] = [];

  for (let i = start; i < end; i++) {
    const f = fills[i];
    const [takerUa, bumpTakerUa] = findUserAccountPda(f.takerPubkey);
    const [takerPos, bumpTakerPos] = findPositionPda(
      f.takerPubkey,
      f.marketIndex,
    );
    const [makerOo, bumpMakerOo] = findOpenOrdersPda(f.makerPubkey, market);
    const [makerUa, bumpMakerUa] = findUserAccountPda(f.makerPubkey);
    const [makerPos, bumpMakerPos] = findPositionPda(
      f.makerPubkey,
      f.marketIndex,
    );

    fillParamsAll[i] = {
      takerBumpUser: bumpTakerUa,
      takerBumpPosition: bumpTakerPos,
      makerBumpUser: bumpMakerUa,
      makerBumpPosition: bumpMakerPos,
      makerBumpOo: bumpMakerOo,
    };

    remaining.push(
      { pubkey: takerUa, isSigner: false, isWritable: true },
      { pubkey: takerPos, isSigner: false, isWritable: true },
      { pubkey: makerOo, isSigner: false, isWritable: true },
      { pubkey: makerUa, isSigner: false, isWritable: true },
      { pubkey: makerPos, isSigner: false, isWritable: true },
    );

    if (DEBUG_SETTLE_FILLS) {
      console.log(`fill[${i}]:`, {
        takerPubkey: f.takerPubkey.toBase58?.() ?? f.takerPubkey,
        makerPubkey: f.makerPubkey.toBase58?.() ?? f.makerPubkey,
        marketIndex: f.marketIndex,
        takerUa: takerUa.toBase58(),
        takerPos: takerPos.toBase58(),
        makerOo: makerOo.toBase58(),
        makerUa: makerUa.toBase58(),
        makerPos: makerPos.toBase58(),
      });
    }
  }

  const keys: AccountMeta[] = [
    { pubkey: caller, isSigner: true, isWritable: true },
    { pubkey: fillsLog, isSigner: false, isWritable: true },
    { pubkey: market, isSigner: false, isWritable: false },
    { pubkey: marketConfig, isSigner: false, isWritable: false },
    { pubkey: fundingState, isSigner: false, isWritable: true },
    { pubkey: RISK_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ...remaining,
  ];

  return new TransactionInstruction({
    programId: ORDERBOOK_PROGRAM_ID,
    keys,
    data: encodeData(start, end, fillParamsAll),
  });
}
