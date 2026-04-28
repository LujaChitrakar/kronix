import { PublicKey } from "@solana/web3.js";
import {
  ORDERBOOK_PROGRAM_ID,
  RISK_PROGRAM_ID,
  TRIGGER_PROGRAM_ID,
  STRATEGY_PROGRAM_ID,
} from "./config";

// Browser Buffer polyfill lacks writeBigUInt64LE — use DataView and copy
// into a fresh Buffer/Uint8Array. PublicKey.findProgramAddressSync accepts
// Uint8Array seeds.
function u16Le(n: number): Uint8Array {
  const u = new Uint8Array(2);
  new DataView(u.buffer).setUint16(0, n & 0xffff, true);
  return u;
}

function u64Le(n: bigint): Uint8Array {
  const u = new Uint8Array(8);
  new DataView(u.buffer).setBigUint64(0, n, true);
  return u;
}

export function findMarketPda(marketIndex: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), u16Le(marketIndex)],
    ORDERBOOK_PROGRAM_ID,
  );
}

export function findBidsPda(marketIndex: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bids"), u16Le(marketIndex)],
    ORDERBOOK_PROGRAM_ID,
  );
}

export function findAsksPda(marketIndex: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("asks"), u16Le(marketIndex)],
    ORDERBOOK_PROGRAM_ID,
  );
}

export function findOpenOrdersPda(
  owner: PublicKey,
  market: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("open_orders"), owner.toBuffer(), market.toBuffer()],
    ORDERBOOK_PROGRAM_ID,
  );
}

export function findFillsLogPda(
  taker: PublicKey,
  clientOrderId: bigint,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fills_log"), taker.toBuffer(), u64Le(clientOrderId)],
    ORDERBOOK_PROGRAM_ID,
  );
}

export function findUserAccountPda(owner: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user"), owner.toBuffer()],
    RISK_PROGRAM_ID,
  );
}

export function findPositionPda(
  owner: PublicKey,
  marketIndex: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), owner.toBuffer(), u16Le(marketIndex)],
    RISK_PROGRAM_ID,
  );
}

export function findMarketConfigPda(
  marketIndex: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market_config"), u16Le(marketIndex)],
    RISK_PROGRAM_ID,
  );
}

export function findFundingStatePda(
  marketIndex: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("funding"), u16Le(marketIndex)],
    RISK_PROGRAM_ID,
  );
}

export function findInsuranceFundPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("insurance")],
    RISK_PROGRAM_ID,
  );
}

export function findVaultPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    RISK_PROGRAM_ID,
  );
}

export function findVaultAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    RISK_PROGRAM_ID,
  );
}

export function findTriggerOrderPda(
  owner: PublicKey,
  clientOrderId: bigint,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("trigger_order"), owner.toBuffer(), u64Le(clientOrderId)],
    TRIGGER_PROGRAM_ID,
  );
}

export function findTriggerAuthorityPda(
  owner: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("trigger_authority"), owner.toBuffer()],
    TRIGGER_PROGRAM_ID,
  );
}

export function findStrategyPda(
  owner: PublicKey,
  marketIndex: number,
  strategyType: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("strategy"),
      owner.toBuffer(),
      u16Le(marketIndex),
      Uint8Array.from([strategyType & 0xff]),
    ],
    STRATEGY_PROGRAM_ID,
  );
}

export function findStrategyAuthorityPda(
  owner: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("strategy_authority"), owner.toBuffer()],
    STRATEGY_PROGRAM_ID,
  );
}

export { STRATEGY_PROGRAM_ID } from "./config";
