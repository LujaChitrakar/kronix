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
  getPlaceTriggerOrderInstruction,
  getCancelTriggerOrderInstruction,
  getEditTriggerInstruction,
} from "@/lib/trigger-sdk";
import {
  getCreateStrategyInstruction,
  getEditStrategyInstruction,
  getPauseStrategyInstruction,
  getResumeStrategyInstruction,
  getCloseStrategyInstruction,
  emptyStrategyParamsArgs,
  type StrategyParamsArgs,
} from "@/lib/strategy-sdk";
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
  getDepositInsuranceInstruction,
} from "@/lib/risk-sdk";

import {
  MARKET_INDEX,
  USDC_MINT,
  TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TRIGGER_PROGRAM_ID,
  ORDERBOOK_PROGRAM_ID,
  STRATEGY_PROGRAM_ID,
  RISK_PROGRAM_ID,
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
  findTriggerOrderPda,
  findTriggerAuthorityPda,
  findStrategyPda,
  findStrategyAuthorityPda,
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
  marketIndex = MARKET_INDEX,
): TransactionInstruction {
  const [market] = findMarketPda(marketIndex);
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
  marketIndex = MARKET_INDEX,
) {
  const [market] = findMarketPda(marketIndex);
  const [oo] = findOpenOrdersPda(owner, market);
  const exists = await conn.getAccountInfo(oo, "confirmed");
  if (exists) return null;
  return send([...priorityFeeIxs(), buildCreateOpenOrdersIx(owner, marketIndex)], conn);
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
  marketIndex = MARKET_INDEX,
): Promise<string> {
  const [userAccount, bumpUser] = findUserAccountPda(owner);
  const [position, bumpPosition] = findPositionPda(owner, marketIndex);
  const [marketConfig] = findMarketConfigPda(marketIndex);
  const [fundingState] = findFundingStatePda(marketIndex);

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
    marketIndex,
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
  marketIndex = MARKET_INDEX,
): Promise<string> {
  const [userAccount] = findUserAccountPda(owner);
  const [position] = findPositionPda(owner, marketIndex);
  const [marketConfig] = findMarketConfigPda(marketIndex);
  const [fundingState] = findFundingStatePda(marketIndex);

  const ix = getClosePositionInstruction({
    signer: fakeSigner(owner),
    userAccount: addr(userAccount),
    position: addr(position),
    marketConfig: addr(marketConfig),
    fundingState: addr(fundingState),
    oracle: addr(oracle),
    sizeLots,
    marketIndex,
    padding: PADDING_6,
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendAddMargin(
  owner: PublicKey,
  amount: bigint,
  conn: Connection,
  send: Send,
  marketIndex = MARKET_INDEX,
): Promise<string> {
  const [userAccount] = findUserAccountPda(owner);
  const [position] = findPositionPda(owner, marketIndex);
  const [marketConfig] = findMarketConfigPda(marketIndex);

  const ix = getAddMarginInstruction({
    signer: fakeSigner(owner),
    userAccount: addr(userAccount),
    position: addr(position),
    marketConfig: addr(marketConfig),
    amount,
    marketIndex,
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
  marketIndex = MARKET_INDEX,
): Promise<string> {
  const [userAccount] = findUserAccountPda(owner);
  const [position] = findPositionPda(owner, marketIndex);
  const [marketConfig] = findMarketConfigPda(marketIndex);

  const ix = getRemoveMarginInstruction({
    signer: fakeSigner(owner),
    userAccount: addr(userAccount),
    position: addr(position),
    marketConfig: addr(marketConfig),
    oracle: addr(oracle),
    amount,
    marketIndex,
    padding: PADDING_6,
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendSettleFunding(
  owner: PublicKey,
  conn: Connection,
  send: Send,
  marketIndex = MARKET_INDEX,
): Promise<string> {
  const [userAccount] = findUserAccountPda(owner);
  const [position] = findPositionPda(owner, marketIndex);
  const [marketConfig] = findMarketConfigPda(marketIndex);
  const [fundingState] = findFundingStatePda(marketIndex);

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
    marketIndex?: number;
  },
  conn: Connection,
  send: Send,
): Promise<string> {
  const marketIndex = args.marketIndex ?? MARKET_INDEX;
  const [market] = findMarketPda(marketIndex);
  const [bids] = findBidsPda(marketIndex);
  const [asks] = findAsksPda(marketIndex);
  const [oo] = findOpenOrdersPda(owner, market);
  const [userAccount] = findUserAccountPda(owner);
  const [marketConfig] = findMarketConfigPda(marketIndex);
  const [fillsLog, bumpFillsLog] = findFillsLogPda(owner, args.clientOrderId);

  const initFillsLog = getInitializeFillsLogInstruction({
    feePayer: fakeSigner(owner),
    taker: addr(owner),
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

  const placeIx = toLegacyIx(place);
  placeIx.keys.push(
    { pubkey: userAccount, isSigner: false, isWritable: true },
    { pubkey: marketConfig, isSigner: false, isWritable: false },
    { pubkey: RISK_PROGRAM_ID, isSigner: false, isWritable: false },
  );

  return send([...priorityFeeIxs(), toLegacyIx(initFillsLog), placeIx], conn);
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
    marketIndex?: number;
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
      args.marketIndex ?? MARKET_INDEX,
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
      throw err;
    }
  }
  return { placeSig, settleSigs, fillCount: log.fillCount };
}

export async function sendCancelOrderByClientId(
  owner: PublicKey,
  clientId: bigint,
  conn: Connection,
  send: Send,
  marketIndex = MARKET_INDEX,
): Promise<string> {
  const [market] = findMarketPda(marketIndex);
  const [bids] = findBidsPda(marketIndex);
  const [asks] = findAsksPda(marketIndex);
  const [oo] = findOpenOrdersPda(owner, market);
  const [userAccount] = findUserAccountPda(owner);
  const [marketConfig] = findMarketConfigPda(marketIndex);

  const ix = getCancelOrderByClientIdInstruction({
    signer: fakeSigner(owner),
    openOrdersAccount: addr(oo),
    market: addr(market),
    bids: addr(bids),
    asks: addr(asks),
    clientId,
  });
  const cancelIx = toLegacyIx(ix);
  cancelIx.keys.push(
    { pubkey: userAccount, isSigner: false, isWritable: true },
    { pubkey: marketConfig, isSigner: false, isWritable: false },
    { pubkey: RISK_PROGRAM_ID, isSigner: false, isWritable: false },
  );
  return send([...priorityFeeIxs(), cancelIx], conn);
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
  marketIndex = MARKET_INDEX,
): Promise<string> {
  const [market] = findMarketPda(marketIndex);
  const [bids] = findBidsPda(marketIndex);
  const [asks] = findAsksPda(marketIndex);
  const [oo] = findOpenOrdersPda(owner, market);
  const [userAccount] = findUserAccountPda(owner);
  const [marketConfig] = findMarketConfigPda(marketIndex);

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
  const cancelIx = toLegacyIx(ix);
  cancelIx.keys.push(
    { pubkey: userAccount, isSigner: false, isWritable: true },
    { pubkey: marketConfig, isSigner: false, isWritable: false },
    { pubkey: RISK_PROGRAM_ID, isSigner: false, isWritable: false },
  );
  return send([...priorityFeeIxs(), cancelIx], conn);
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
    marketIndex?: number;
  },
  conn: Connection,
  send: Send,
): Promise<string> {
  const marketIndex = args.marketIndex ?? MARKET_INDEX;
  const [market] = findMarketPda(marketIndex);
  const [bids] = findBidsPda(marketIndex);
  const [asks] = findAsksPda(marketIndex);
  const [oo] = findOpenOrdersPda(owner, market);
  const [fillsLog, bumpFillsLog] = findFillsLogPda(owner, args.clientOrderId);
  const [userAccount] = findUserAccountPda(owner);
  const [marketConfig] = findMarketConfigPda(marketIndex);

  const initFillsLog = getInitializeFillsLogInstruction({
    feePayer: fakeSigner(owner),
    taker: addr(owner),
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

  const editIx = toLegacyIx(edit);
  editIx.keys.push(
    { pubkey: userAccount, isSigner: false, isWritable: true },
    { pubkey: marketConfig, isSigner: false, isWritable: false },
    { pubkey: RISK_PROGRAM_ID, isSigner: false, isWritable: false },
  );

  return send([...priorityFeeIxs(), toLegacyIx(initFillsLog), editIx], conn);
}

export async function sendSetDelegate(
  owner: PublicKey,
  delegate: PublicKey,
  conn: Connection,
  send: Send,
  marketIndex = MARKET_INDEX,
): Promise<string> {
  const [market] = findMarketPda(marketIndex);
  const [oo] = findOpenOrdersPda(owner, market);
  const ix = getSetDelegateInstruction({
    signer: fakeSigner(owner),
    openOrdersAccount: addr(oo),
    delegate: delegate.toBytes(),
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

// ───────── Trigger orders (Stop-Loss / Take-Profit) ─────────

export async function sendPlaceTriggerOrder(
  owner: PublicKey,
  args: {
    clientOrderId: bigint;
    triggerPrice: bigint;
    sizeLots: bigint;
    expiry: bigint;
    triggerType: number; // 0=StopLoss, 1=TakeProfit
    side: number; // 0=Buy, 1=Sell
    marketIndex?: number;
  },
  conn: Connection,
  send: Send,
): Promise<string> {
  const marketIndex = args.marketIndex ?? MARKET_INDEX;
  const [market] = findMarketPda(marketIndex);
  const [oo] = findOpenOrdersPda(owner, market);
  const [triggerOrder, bump] = findTriggerOrderPda(owner, args.clientOrderId);
  const [triggerAuthority, bumpAuthority] = findTriggerAuthorityPda(owner);
  const [fillsLog, bumpFillsLog] = findFillsLogPda(
    triggerAuthority,
    args.clientOrderId,
  );

  const ix = getPlaceTriggerOrderInstruction({
    signer: fakeSigner(owner),
    triggerOrder: addr(triggerOrder),
    openOrdersAccount: addr(oo),
    triggerAuthority: addr(triggerAuthority),
    fillsLog: addr(fillsLog),
    market: addr(market),
    orderbookProgram: addr(ORDERBOOK_PROGRAM_ID),
    systemProgram: addr(SYSTEM_PROGRAM_ID),
    clientOrderId: args.clientOrderId,
    triggerPrice: args.triggerPrice,
    sizeLots: args.sizeLots,
    expiry: args.expiry,
    marketIndex,
    triggerType: args.triggerType,
    side: args.side,
    bump,
    bumpAuthority,
    bumpFillsLog,
    padding: new Uint8Array(1),
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendCancelTriggerOrder(
  owner: PublicKey,
  clientOrderId: bigint,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [triggerOrder] = findTriggerOrderPda(owner, clientOrderId);
  const ix = getCancelTriggerOrderInstruction({
    signer: fakeSigner(owner),
    triggerOrder: addr(triggerOrder),
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

// Pause = disc 5, Resume = disc 6. Both ix layout: [signer (writable, signer), trigger_order (writable)] + 1-byte data.
function buildSimpleTriggerIx(
  disc: number,
  owner: PublicKey,
  triggerOrder: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: TRIGGER_PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: triggerOrder, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([disc]),
  });
}

export async function sendPauseTrigger(
  owner: PublicKey,
  clientOrderId: bigint,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [triggerOrder] = findTriggerOrderPda(owner, clientOrderId);
  return send(
    [...priorityFeeIxs(), buildSimpleTriggerIx(5, owner, triggerOrder)],
    conn,
  );
}

export async function sendResumeTrigger(
  owner: PublicKey,
  clientOrderId: bigint,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [triggerOrder] = findTriggerOrderPda(owner, clientOrderId);
  return send(
    [...priorityFeeIxs(), buildSimpleTriggerIx(6, owner, triggerOrder)],
    conn,
  );
}

export async function sendEditTrigger(
  owner: PublicKey,
  args: {
    clientOrderId: bigint;
    newTriggerPrice: bigint; // 0 = no change
    newSizeLots: bigint; // 0 = no change
    newExpiry: bigint; // -1 = no change, 0 = remove expiry
  },
  conn: Connection,
  send: Send,
): Promise<string> {
  const [triggerOrder] = findTriggerOrderPda(owner, args.clientOrderId);
  const ix = getEditTriggerInstruction({
    signer: fakeSigner(owner),
    triggerOrder: addr(triggerOrder),
    newTriggerPrice: args.newTriggerPrice,
    newSizeLots: args.newSizeLots,
    newExpiry: args.newExpiry,
    padding: new Uint8Array(8),
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

export async function sendDepositInsurance(
  payer: PublicKey,
  amountBaseUnits: bigint,
  conn: Connection,
  send: Send,
): Promise<string> {
  const [insuranceFund] = findInsuranceFundPda();
  const [vault, bumpVault] = findVaultPda();
  const userAta = getAssociatedTokenAddressSync(USDC_MINT, payer);

  const ix = getDepositInsuranceInstruction({
    signer: fakeSigner(payer),
    insuranceFund: addr(insuranceFund),
    userTokenAccount: addr(userAta),
    vault: addr(vault),
    tokenProgram: addr(TOKEN_PROGRAM_ID),
    systemProgram: addr(SYSTEM_PROGRAM_ID),
    amount: amountBaseUnits,
    bumpVault,
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

// ───────── Strategies ─────────

export async function sendCreateStrategy(
  owner: PublicKey,
  args: {
    clientOrderId: bigint;
    strategyType: number; // 0..4
    side: number;
    sizeLots: bigint;
    limitPriceLots: bigint; // 0 = market
    takeProfitPrice: bigint; // 0 = none
    stopLossPrice: bigint; // 0 = none
    cooldownSecs: bigint;
    maxExecutionsPerDay: bigint;
    params?: StrategyParamsArgs; // strategy-specific
    marketIndex?: number;
  },
  conn: Connection,
  send: Send,
): Promise<string> {
  const marketIndex = args.marketIndex ?? MARKET_INDEX;
  const [market] = findMarketPda(marketIndex);
  const [oo] = findOpenOrdersPda(owner, market);
  const [strategyAccount, bump] = findStrategyPda(
    owner,
    marketIndex,
    args.strategyType,
  );
  const [strategyAuthority, bumpAuthority] = findStrategyAuthorityPda(owner);
  const [fillsLog, bumpFillsLog] = findFillsLogPda(
    strategyAuthority,
    args.clientOrderId,
  );

  const ix = getCreateStrategyInstruction({
    signer: fakeSigner(owner),
    strategyAccount: addr(strategyAccount),
    strategyAuthority: addr(strategyAuthority),
    openOrdersAccount: addr(oo),
    fillsLog: addr(fillsLog),
    market: addr(market),
    orderbookProgram: addr(ORDERBOOK_PROGRAM_ID),
    systemProgram: addr(SYSTEM_PROGRAM_ID),
    createStrategyParams: {
      clientOrderId: args.clientOrderId,
      sizeLots: args.sizeLots,
      limitPriceLots: args.limitPriceLots,
      takeProfitPrice: args.takeProfitPrice,
      stopLossPrice: args.stopLossPrice,
      cooldownSecs: args.cooldownSecs,
      maxExecutionsPerDay: args.maxExecutionsPerDay,
      marketIndex,
      bump,
      strategyType: args.strategyType,
      side: args.side,
      bumpAuthority,
      bumpFillsLog,
      padding: new Uint8Array(1),
      params: args.params ?? emptyStrategyParamsArgs(),
    },
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendEditStrategy(
  owner: PublicKey,
  args: {
    strategyType: number;
    newLimitPriceLots: bigint;
    newTakeProfitPrice: bigint;
    newStopLossPrice: bigint;
    newSizeLots: bigint;
    newCooldownSecs: bigint;
    newMaxExecutionsPerDay: bigint;
    newStatus: number; // 255 = no change
  },
  conn: Connection,
  send: Send,
  marketIndex = MARKET_INDEX,
): Promise<string> {
  const [strategyAccount] = findStrategyPda(
    owner,
    marketIndex,
    args.strategyType,
  );
  const ix = getEditStrategyInstruction({
    signer: fakeSigner(owner),
    strategyAccount: addr(strategyAccount),
    editStrategyParams: {
      newLimitPriceLots: args.newLimitPriceLots,
      newTakeProfitPrice: args.newTakeProfitPrice,
      newStopLossPrice: args.newStopLossPrice,
      newSizeLots: args.newSizeLots,
      newCooldownSecs: args.newCooldownSecs,
      newMaxExecutionsPerDay: args.newMaxExecutionsPerDay,
      newStatus: args.newStatus,
      padding: new Uint8Array(7),
    },
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendPauseStrategy(
  owner: PublicKey,
  strategyType: number,
  conn: Connection,
  send: Send,
  marketIndex = MARKET_INDEX,
): Promise<string> {
  const [strategyAccount] = findStrategyPda(owner, marketIndex, strategyType);
  const ix = getPauseStrategyInstruction({
    signer: fakeSigner(owner),
    strategyAccount: addr(strategyAccount),
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendResumeStrategy(
  owner: PublicKey,
  strategyType: number,
  conn: Connection,
  send: Send,
  marketIndex = MARKET_INDEX,
): Promise<string> {
  const [strategyAccount] = findStrategyPda(owner, marketIndex, strategyType);
  const ix = getResumeStrategyInstruction({
    signer: fakeSigner(owner),
    strategyAccount: addr(strategyAccount),
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}

export async function sendCloseStrategy(
  owner: PublicKey,
  strategyType: number,
  conn: Connection,
  send: Send,
  marketIndex = MARKET_INDEX,
): Promise<string> {
  const [strategyAccount] = findStrategyPda(owner, marketIndex, strategyType);
  const ix = getCloseStrategyInstruction({
    signer: fakeSigner(owner),
    strategyAccount: addr(strategyAccount),
  });
  return send([...priorityFeeIxs(), toLegacyIx(ix)], conn);
}
