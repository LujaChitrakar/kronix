import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { Address } from "@solana/kit";

import {
  getInitializeFillsLogInstruction,
  getPlaceOrderInstruction,
  getCancelOrderByClientIdInstruction,
  getCancelAllOrdersInstruction,
  getEditOrderInstruction,
  getSetDelegateInstruction,
  getCreateOpenOrdersAccountInstruction,
  getCreateOrderbookMarketInstruction,
} from "@/lib/orderbook-sdk";
import {
  getDepositInstruction,
  getWithdrawInstruction,
  getOpenPositionInstruction,
  getClosePositionInstruction,
  getAddMarginInstruction,
  getRemoveMarginInstruction,
  getSettleFundingInstruction,
  getInitializeInsuranceFundInstruction,
  getInitializeVaultInstruction,
  getCreateRiskMarketInstruction,
} from "@/lib/risk-sdk";

import {
  MARKET_INDEX,
  USDC_MINT,
  TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
} from "./config";
import {
  findMarketPda,
  findBidsPda,
  findAsksPda,
  findOpenOrdersPda,
  findFillsLogPda,
  findUserAccountPda,
  findPositionPda,
  findMarketConfigPda,
  findFundingStatePda,
  findVaultPda,
  findVaultAuthorityPda,
  findInsuranceFundPda,
} from "./pdas";
import { toLegacyIx, fakeSigner } from "./ix-bridge";
import { fetchFillsLog } from "./fills-log";
import { buildSettleFillsIx, MAX_FILLS_PER_TX } from "./settle-fills";

type Send = (
  ixs: TransactionInstruction[],
  conn: Connection,
) => Promise<string>;

const PADDING_3 = new Uint8Array(3);
const PADDING_4 = new Uint8Array(4);
const PADDING_5 = new Uint8Array(5);
const PADDING_6 = new Uint8Array(6);
const PADDING_7 = new Uint8Array(7);

function addr(pk: PublicKey): Address {
  return pk.toBase58() as Address;
}

function priorityFeeIxs(): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
  ];
}

// ───────── Onboarding ─────────

export function buildCreateOpenOrdersIx(
  owner: PublicKey,
): TransactionInstruction {
  const [market] = findMarketPda(MARKET_INDEX);
  const [oo, bump] = findOpenOrdersPda(owner, market);
  const ix = getCreateOpenOrdersAccountInstruction({
    payer: fakeSigner(owner),
    openOrdersAccount: addr(oo),
    market: addr(market),
    owner: owner.toBytes(),
    bump,
    padding: PADDING_7,
  });
  return toLegacyIx(ix);
}

export async function sendCreateOpenOrders(
  owner: PublicKey,
  conn: Connection,
  send: Send,
) {
  const [market] = findMarketPda(MARKET_INDEX);
  const [oo] = findOpenOrdersPda(owner, market);
  const exists = await conn.getAccountInfo(oo, "confirmed");
  if (exists) return null;
  return send([...priorityFeeIxs(), buildCreateOpenOrdersIx(owner)], conn);
}

// ───────── Collateral ─────────

export async function sendDeposit(
  owner: PublicKey,
  amountBaseUnits: bigint,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [userAccount, bumpUser] = findUserAccountPda(owner);
  const [vault, bumpVault] = findVaultPda();
  const userAta = getAssociatedTokenAddressSync(USDC_MINT, owner);

  const ix = getDepositInstruction({
    signer: fakeSigner(owner),
    userAccount: addr(userAccount),
    userTokenAccount: addr(userAta),
    vault: addr(vault),
    tokenProgram: addr(TOKEN_PROGRAM_ID),
    systemProgram: addr(SYSTEM_PROGRAM_ID),
    amount: amountBaseUnits,
    bumpUser,
    bumpVault,
    padding: PADDING_6,
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendWithdraw(
  owner: PublicKey,
  amountBaseUnits: bigint,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [userAccount, bumpUser] = findUserAccountPda(owner);
  const [vault, bumpVault] = findVaultPda();
  const [vaultAuthority, bumpAuthority] = findVaultAuthorityPda();
  const userAta = getAssociatedTokenAddressSync(USDC_MINT, owner);

  const ix = getWithdrawInstruction({
    signer: fakeSigner(owner),
    userAccount: addr(userAccount),
    userTokenAccount: addr(userAta),
    vault: addr(vault),
    vaultAuthority: addr(vaultAuthority),
    tokenProgram: addr(TOKEN_PROGRAM_ID),
    amount: amountBaseUnits,
    bumpUser,
    bumpVault,
    bumpAuthority,
    padding: PADDING_5,
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

// ───────── Positions (direct OTC-style open / close) ─────────

export async function sendOpenPosition(
  owner: PublicKey,
  oracle: PublicKey,
  sizeLots: bigint,
  side: number,
  leverageBps: number,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [userAccount, bumpUser] = findUserAccountPda(owner);
  const [position, bumpPosition] = findPositionPda(owner, MARKET_INDEX);
  const [marketConfig] = findMarketConfigPda(MARKET_INDEX);
  const [fundingState] = findFundingStatePda(MARKET_INDEX);

  const ix = getOpenPositionInstruction({
    signer: fakeSigner(owner),
    userAccount: addr(userAccount),
    position: addr(position),
    marketConfig: addr(marketConfig),
    fundingState: addr(fundingState),
    oracle: addr(oracle),
    systemProgram: addr(SYSTEM_PROGRAM_ID),
    sizeLots,
    leverageBps,
    marketIndex: MARKET_INDEX,
    side,
    bumpPosition,
    bumpUser,
    padding: new Uint8Array(1),
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendClosePosition(
  owner: PublicKey,
  oracle: PublicKey,
  sizeLots: bigint,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [userAccount] = findUserAccountPda(owner);
  const [position] = findPositionPda(owner, MARKET_INDEX);
  const [marketConfig] = findMarketConfigPda(MARKET_INDEX);
  const [fundingState] = findFundingStatePda(MARKET_INDEX);

  const ix = getClosePositionInstruction({
    signer: fakeSigner(owner),
    userAccount: addr(userAccount),
    position: addr(position),
    marketConfig: addr(marketConfig),
    fundingState: addr(fundingState),
    oracle: addr(oracle),
    sizeLots,
    marketIndex: MARKET_INDEX,
    padding: PADDING_6,
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendAddMargin(
  owner: PublicKey,
  amount: bigint,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [userAccount] = findUserAccountPda(owner);
  const [position] = findPositionPda(owner, MARKET_INDEX);
  const [marketConfig] = findMarketConfigPda(MARKET_INDEX);

  const ix = getAddMarginInstruction({
    signer: fakeSigner(owner),
    userAccount: addr(userAccount),
    position: addr(position),
    marketConfig: addr(marketConfig),
    amount,
    marketIndex: MARKET_INDEX,
    padding: PADDING_6,
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendRemoveMargin(
  owner: PublicKey,
  oracle: PublicKey,
  amount: bigint,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [userAccount] = findUserAccountPda(owner);
  const [position] = findPositionPda(owner, MARKET_INDEX);
  const [marketConfig] = findMarketConfigPda(MARKET_INDEX);

  const ix = getRemoveMarginInstruction({
    signer: fakeSigner(owner),
    userAccount: addr(userAccount),
    position: addr(position),
    marketConfig: addr(marketConfig),
    oracle: addr(oracle),
    amount,
    marketIndex: MARKET_INDEX,
    padding: PADDING_6,
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendSettleFunding(
  owner: PublicKey,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [userAccount] = findUserAccountPda(owner);
  const [position] = findPositionPda(owner, MARKET_INDEX);
  const [marketConfig] = findMarketConfigPda(MARKET_INDEX);
  const [fundingState] = findFundingStatePda(MARKET_INDEX);

  const ix = getSettleFundingInstruction({
    signer: fakeSigner(owner),
    userAccount: addr(userAccount),
    position: addr(position),
    marketConfig: addr(marketConfig),
    fundingState: addr(fundingState),
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

// ───────── Orders ─────────

export async function sendPlaceOrder(
  owner: PublicKey,
  args: {
    side: number;
    orderType: number;
    priceLots: bigint;
    maxBaseLots: bigint;
    maxQuoteLots: bigint;
    clientOrderId: bigint;
    expiryTimestamp: bigint;
    limit: number;
  },
  conn: Connection,
  send: Send,
): Promise<string> {
  const [market] = findMarketPda(MARKET_INDEX);
  const [bids] = findBidsPda(MARKET_INDEX);
  const [asks] = findAsksPda(MARKET_INDEX);
  const [oo] = findOpenOrdersPda(owner, market);
  const [fillsLog, bumpFillsLog] = findFillsLogPda(owner, args.clientOrderId);

  const initFillsLog = getInitializeFillsLogInstruction({
    signer: fakeSigner(owner),
    fillsLog: addr(fillsLog),
    market: addr(market),
    systemProgram: addr(SYSTEM_PROGRAM_ID),
    bump: bumpFillsLog,
    padding: PADDING_7,
    clientOrderId: args.clientOrderId,
  });

  const place = getPlaceOrderInstruction({
    signer: fakeSigner(owner),
    openOrdersAccount: addr(oo),
    market: addr(market),
    bids: addr(bids),
    asks: addr(asks),
    fillsLogs: addr(fillsLog),
    systemProgram: addr(SYSTEM_PROGRAM_ID),
    maxBaseLots: args.maxBaseLots,
    maxQuoteLots: args.maxQuoteLots,
    clientOrderId: args.clientOrderId,
    expiryTimestamp: args.expiryTimestamp,
    priceLots: args.priceLots,
    side: args.side,
    orderType: args.orderType,
    limit: args.limit,
    bumpFillsLog,
    padding: PADDING_4,
  });

  console.log("📤 placing order:", {
    side: args.side, // 0=bid, 1=ask?
    orderType: args.orderType, // 0=limit?
    priceLots: args.priceLots,
    maxBaseLots: args.maxBaseLots,
    maxQuoteLots: args.maxQuoteLots,
    clientOrderId: args.clientOrderId,
    owner: owner.toBase58(),
  });

  return send(
    [...priorityFeeIxs(), toLegacyIx(initFillsLog), toLegacyIx(place)],
    conn,
  );
}

export type PlaceAndSettleResult = {
  placeSig: string;
  settleSigs: string[];
  fillCount: number;
};

/**
 * Full taker pipeline:
 *   TX1 = init_fills_log + place_order   (matches, writes FillsLog)
 *   TX2 = settle_fills(0..min(4,n))      (settles taker + maker positions)
 *   TX3 = settle_fills(4..n)             (only if n > 4)
 *
 * settle_fills cannot share a TX with place_order: the caller does not
 * know which maker accounts to pass as remaining_accounts until matching
 * has run and FillsLog is written. We must fetch the log between TXs.
 */
export async function sendPlaceOrderAndSettle(
  owner: PublicKey,
  args: {
    side: number;
    orderType: number;
    priceLots: bigint;
    maxBaseLots: bigint;
    maxQuoteLots: bigint;
    clientOrderId: bigint;
    expiryTimestamp: bigint;
    limit: number;
  },
  conn: Connection,
  send: Send,
): Promise<PlaceAndSettleResult> {
  const placeSig = await sendPlaceOrder(owner, args, conn, send);
  console.log("✅ place_order sig:", placeSig);
  console.log(
    "🔍 https://explorer.solana.com/tx/" + placeSig + "?cluster=devnet",
  );

  const [fillsLog] = findFillsLogPda(owner, args.clientOrderId);
  console.log("📋 fillsLog PDA:", fillsLog.toBase58());

  const log = await fetchFillsLog(conn, fillsLog);
  console.log("📊 fillsLog data:", log);
  console.log("📊 fillCount:", log?.fillCount);

  if (!log || log.fillCount === 0) {
    console.warn("⚠️ No fills found — order did not match");
    return { placeSig, settleSigs: [], fillCount: 0 };
  }

  const settleSigs: string[] = [];
  for (let start = 0; start < log.fillCount; start += MAX_FILLS_PER_TX) {
    const end = Math.min(log.fillCount, start + MAX_FILLS_PER_TX);
    const ix = buildSettleFillsIx(
      owner,
      MARKET_INDEX,
      fillsLog,
      log.fills,
      start,
      end,
    );
    try {
      const sig = await send([...priorityFeeIxs(), ix], conn);
      console.log("✅ settle_fills sig:", sig);
      console.log(
        "🔍 https://explorer.solana.com/tx/" + sig + "?cluster=devnet",
      );
      settleSigs.push(sig);
    } catch (err) {
      console.error("❌ settle_fills FAILED:", err);
      // this is where your tx is dying — err will show missing accounts
    }
  }
  return { placeSig, settleSigs, fillCount: log.fillCount };
}

export async function sendCancelOrderByClientId(
  owner: PublicKey,
  clientId: bigint,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [market] = findMarketPda(MARKET_INDEX);
  const [bids] = findBidsPda(MARKET_INDEX);
  const [asks] = findAsksPda(MARKET_INDEX);
  const [oo] = findOpenOrdersPda(owner, market);

  const ix = getCancelOrderByClientIdInstruction({
    signer: fakeSigner(owner),
    openOrdersAccount: addr(oo),
    market: addr(market),
    bids: addr(bids),
    asks: addr(asks),
    clientId,
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendCancelAllOrders(
  owner: PublicKey,
  args: {
    sideFilter?: number; // 0=bids only, 1=asks only, 2=both (program convention)
    clientIdFilter?: bigint;
    limit?: number;
  },
  conn: Connection,
  send: Send,
): Promise<string> {
  const [market] = findMarketPda(MARKET_INDEX);
  const [bids] = findBidsPda(MARKET_INDEX);
  const [asks] = findAsksPda(MARKET_INDEX);
  const [oo] = findOpenOrdersPda(owner, market);

  const ix = getCancelAllOrdersInstruction({
    signer: fakeSigner(owner),
    openOrdersAccount: addr(oo),
    market: addr(market),
    bids: addr(bids),
    asks: addr(asks),
    clientIdFilter: args.clientIdFilter ?? 0n,
    sideFilter: args.sideFilter ?? 255,
    hasClientFilter: args.clientIdFilter !== undefined ? 1 : 0,
    limit: args.limit ?? 24,
    padding: PADDING_5,
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendEditOrder(
  owner: PublicKey,
  args: {
    orderId: Uint8Array; // 16 bytes — existing critbit key
    newPriceLots: bigint;
    newBaseLots: bigint;
    newQuoteLots: bigint;
    clientOrderId: bigint;
    expiryTimestamp: bigint;
    side: number;
    orderType: number;
    limit: number;
  },
  conn: Connection,
  send: Send,
): Promise<string> {
  const [market] = findMarketPda(MARKET_INDEX);
  const [bids] = findBidsPda(MARKET_INDEX);
  const [asks] = findAsksPda(MARKET_INDEX);
  const [oo] = findOpenOrdersPda(owner, market);
  const [fillsLog, bumpFillsLog] = findFillsLogPda(owner, args.clientOrderId);

  const initFillsLog = getInitializeFillsLogInstruction({
    signer: fakeSigner(owner),
    fillsLog: addr(fillsLog),
    market: addr(market),
    systemProgram: addr(SYSTEM_PROGRAM_ID),
    bump: bumpFillsLog,
    padding: PADDING_7,
    clientOrderId: args.clientOrderId,
  });

  const edit = getEditOrderInstruction({
    signer: fakeSigner(owner),
    openOrdersAccount: addr(oo),
    market: addr(market),
    bids: addr(bids),
    asks: addr(asks),
    fillsLogs: addr(fillsLog),
    systemProgram: addr(SYSTEM_PROGRAM_ID),
    newPriceLots: args.newPriceLots,
    newBaseLots: args.newBaseLots,
    newQuoteLots: args.newQuoteLots,
    clientOrderId: args.clientOrderId,
    expiryTimestamp: args.expiryTimestamp,
    side: args.side,
    orderType: args.orderType,
    limit: args.limit,
    bumpFillsLog,
    padding: PADDING_4,
    orderId: args.orderId,
  });

  return send(
    [...priorityFeeIxs(), toLegacyIx(initFillsLog), toLegacyIx(edit)],
    conn,
  );
}

export async function sendSetDelegate(
  owner: PublicKey,
  delegate: PublicKey,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [market] = findMarketPda(MARKET_INDEX);
  const [oo] = findOpenOrdersPda(owner, market);
  const ix = getSetDelegateInstruction({
    signer: fakeSigner(owner),
    openOrdersAccount: addr(oo),
    delegate: delegate.toBytes(),
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

// ───────── Admin Setup ─────────

export async function sendInitInsuranceFund(
  payer: PublicKey,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [insuranceFund, bump] = findInsuranceFundPda();
  const ix = getInitializeInsuranceFundInstruction({
    payer: fakeSigner(payer),
    insuranceFund: addr(insuranceFund),
    systemProgram: addr(SYSTEM_PROGRAM_ID),
    bump,
    padding: PADDING_7,
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendInitVault(
  payer: PublicKey,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [vault, vaultBump] = findVaultPda();
  const [vaultAuthority, authorityBump] = findVaultAuthorityPda();
  const ix = getInitializeVaultInstruction({
    payer: fakeSigner(payer),
    vault: addr(vault),
    vaultAuthority: addr(vaultAuthority),
    mint: addr(USDC_MINT),
    tokenProgram: addr(TOKEN_PROGRAM_ID),
    systemProgram: addr(SYSTEM_PROGRAM_ID),
    vaultBump,
    authorityBump,
    padding: PADDING_6,
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendCreateRiskMarket(
  payer: PublicKey,
  args: {
    marketIndex: number;
    baseLotSize: bigint;
    quoteLotSize: bigint;
    initialMarginBps: number;
    maintenanceMarginBps: number;
    liquidationFeeBps: number;
    maxLeverage: number;
    oracle: PublicKey;
  },
  conn: Connection,
  send: Send,
): Promise<string> {
  const [marketConfig, bumpConfig] = findMarketConfigPda(args.marketIndex);
  const [fundingState, bumpFunding] = findFundingStatePda(args.marketIndex);
  const ix = getCreateRiskMarketInstruction({
    payer: fakeSigner(payer),
    marketConfig: addr(marketConfig),
    fundingState: addr(fundingState),
    systemProgram: addr(SYSTEM_PROGRAM_ID),
    baseLotSize: args.baseLotSize,
    quoteLotSize: args.quoteLotSize,
    marketIndex: args.marketIndex,
    initialMarginBps: args.initialMarginBps,
    maintenanceMarginBps: args.maintenanceMarginBps,
    liquidationFeeBps: args.liquidationFeeBps,
    bumpConfig,
    bumpFunding,
    maxLeverage: args.maxLeverage,
    padding: PADDING_5,
    oracle: args.oracle.toBytes(),
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendCreateOrderbookMarket(
  payer: PublicKey,
  args: {
    marketIndex: number;
    baseLotSize: bigint;
    quoteLotSize: bigint;
    timeExpiry: bigint;
    name: string;
  },
  conn: Connection,
  send: Send,
): Promise<string> {
  const [market, bump] = findMarketPda(args.marketIndex);
  const [bids, bidsBump] = findBidsPda(args.marketIndex);
  const [asks, asksBump] = findAsksPda(args.marketIndex);

  const nameBytes = new Uint8Array(16);
  const enc = new TextEncoder().encode(args.name).slice(0, 16);
  nameBytes.set(enc);

  const ix = getCreateOrderbookMarketInstruction({
    payer: fakeSigner(payer),
    market: addr(market),
    bids: addr(bids),
    asks: addr(asks),
    systemProgram: addr(SYSTEM_PROGRAM_ID),
    baseLotSize: args.baseLotSize,
    quoteLotSize: args.quoteLotSize,
    timeExpiry: args.timeExpiry,
    marketIndex: args.marketIndex,
    bump,
    bidsBump,
    asksBump,
    padding: PADDING_3,
    name: nameBytes,
    admin: payer.toBytes(),
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}
