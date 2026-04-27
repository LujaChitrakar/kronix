/**
 * Kronix keeper bot.
 *
 * Runs five permissionless cranks against the deployed risk_program and
 * orderbook_program at fixed cadences:
 *
 *   update_funding_rate   every  10s    (cranker keeps mark/index fresh)
 *   liquidate             every  30s    (sweep underwater positions)
 *   cover_bad_debt        every  60s    (pay InsuranceFund for negative-equity accounts)
 *   prune_orders          every  60s    (drop expired TIF orders, both sides)
 *   settle_funding        every   8h    (apply funding to every open position)
 *
 * Run with:  pnpm keeper
 *
 * Env (place in kronix-frontend/.env.local):
 *   KEEPER_KEYPAIR_PATH  – path to a Solana JSON keypair file (default ~/.config/solana/id.json)
 *   NEXT_PUBLIC_RPC_URL  – RPC endpoint
 *   NEXT_PUBLIC_USDC_MINT
 *   NEXT_PUBLIC_MARKET_INDEX
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import type { Address } from "@solana/kit";

import {
  getLiquidateInstruction,
  getCoverBadDebtInstruction,
  getUpdateFundingRateInstruction,
  getSettleFundingInstruction,
} from "../lib/risk-sdk";
import { getPruneOrdersInstruction } from "../lib/orderbook-sdk";

import {
  ORDERBOOK_PROGRAM_ID,
  RISK_PROGRAM_ID,
  TRIGGER_PROGRAM_ID,
  USDC_MINT,
  MARKET_INDEX,
  TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TriggerStatus,
} from "../lib/kronix/config";
import {
  findUserAccountPda,
  findPositionPda,
  findMarketConfigPda,
  findFundingStatePda,
  findMarketPda,
  findBidsPda,
  findAsksPda,
  findInsuranceFundPda,
  findVaultPda,
  findVaultAuthorityPda,
  findTriggerAuthorityPda,
  findFillsLogPda,
  findOpenOrdersPda,
} from "../lib/kronix/pdas";
import { toLegacyIx, fakeSigner } from "../lib/kronix/ix-bridge";
import { getTriggerOrderDecoder } from "../lib/trigger-sdk";

// ── Config ───────────────────────────────────────────────────────────────

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
const KEYPAIR_PATH =
  process.env.KEEPER_KEYPAIR_PATH ??
  path.join(os.homedir(), ".config", "solana", "id.json");

const POSITION_SIZE = 104;
const USER_ACCOUNT_SIZE = 88;
const TRIGGER_ORDER_SIZE = 144;
const PRUNE_BATCH = 16;
const EXECUTE_TRIGGER_DISC = 2;
const PRUNE_EXPIRED_TRIGGER_DISC = 4;

const PADDING_5 = new Uint8Array(5);
const PADDING_6 = new Uint8Array(6);

const addr = (pk: PublicKey): Address => pk.toBase58() as Address;

// ── Bootstrap ────────────────────────────────────────────────────────────

const conn = new Connection(RPC_URL, "confirmed");
const secret = JSON.parse(fs.readFileSync(KEYPAIR_PATH, "utf8")) as number[];
const keeper = Keypair.fromSecretKey(Uint8Array.from(secret));
console.log(`keeper pubkey: ${keeper.publicKey.toBase58()}`);
console.log(`rpc:           ${RPC_URL}`);
console.log(`market_index:  ${MARKET_INDEX}`);

// ── Helpers ──────────────────────────────────────────────────────────────

function priorityFeeIxs(units = 600_000): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5_000 }),
  ];
}

async function send(ixs: TransactionInstruction[], label: string): Promise<string | null> {
  try {
    const tx = new Transaction().add(...ixs);
    const sig = await sendAndConfirmTransaction(conn, tx, [keeper], {
      commitment: "confirmed",
      skipPreflight: false,
    });
    console.log(`[${label}] ✓ ${sig.slice(0, 12)}…`);
    return sig;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (msg.includes("0xd")) return null;
    const logs = (e as { logs?: string[] }).logs;
    const tail = logs ? "\n" + logs.slice(-12).join("\n") : "";
    console.log(`[${label}] ✗ ${msg}${tail}`);
    return null;
  }
}

let cachedAta: PublicKey | null = null;
async function ensureKeeperUsdcAta(): Promise<PublicKey> {
  if (cachedAta) return cachedAta;
  const ata = getAssociatedTokenAddressSync(USDC_MINT, keeper.publicKey);
  const info = await conn.getAccountInfo(ata, "confirmed");
  if (!info) {
    console.log(`[init] creating keeper USDC ATA ${ata.toBase58()}`);
    const ix = createAssociatedTokenAccountInstruction(
      keeper.publicKey,
      ata,
      keeper.publicKey,
      USDC_MINT,
    );
    await send([ix], "init-ata");
  }
  cachedAta = ata;
  return ata;
}

// Decode Pyth PriceUpdateV2 mark price → USDC native (×10⁶).
async function fetchMarkPriceNative(oracle: PublicKey): Promise<bigint | null> {
  const acc = await conn.getAccountInfo(oracle, "confirmed");
  if (!acc || acc.data.length < 134) return null;
  const buf = acc.data;
  const rawPrice = buf.readBigInt64LE(73);
  const exponent = buf.readInt32LE(89);
  const scaleExp = 6 + exponent;
  return scaleExp >= 0
    ? rawPrice * 10n ** BigInt(scaleExp)
    : rawPrice / 10n ** BigInt(-scaleExp);
}

type MarketCtx = {
  marketIndex: number;
  marketConfig: PublicKey;
  fundingState: PublicKey;
  bumpAuthority: number;
  oracle: PublicKey;
  quoteLotSize: bigint;
  maintenanceMarginBps: number;
};

let cachedMarkets: MarketCtx[] | null = null;
async function loadMarkets(): Promise<MarketCtx[]> {
  if (cachedMarkets) return cachedMarkets;
  // Single-market deployment for now. Extend by scanning MarketConfig PDAs.
  const idx = MARKET_INDEX;
  const [marketConfig] = findMarketConfigPda(idx);
  const [fundingState] = findFundingStatePda(idx);
  const [, bumpAuthority] = findVaultAuthorityPda();
  const cfgAcc = await conn.getAccountInfo(marketConfig, "confirmed");
  if (!cfgAcc) throw new Error(`MarketConfig ${marketConfig.toBase58()} missing`);
  const data = cfgAcc.data;
  // MarketConfig layout (see risk_program/src/state/market_config.rs):
  //   base_lot_size i64        @ 0
  //   quote_lot_size i64       @ 8
  //   market_index u16         @ 16
  //   initial_margin_bps u16   @ 18
  //   maintenance_margin_bps u16 @ 20
  //   liquidation_fee_bps u16  @ 22
  //   bump u8                  @ 24
  //   max_leverage u8          @ 25
  //   padding [u8;6]           @ 26
  //   oracle [u8;32]           @ 32
  const quoteLotSize = data.readBigInt64LE(8);
  const maintenanceMarginBps = data.readUInt16LE(20);
  const oracle = new PublicKey(data.subarray(32, 64));
  cachedMarkets = [
    {
      marketIndex: idx,
      marketConfig,
      fundingState,
      bumpAuthority,
      oracle,
      quoteLotSize,
      maintenanceMarginBps,
    },
  ];
  console.log(
    `[init] market ${idx} oracle=${oracle.toBase58()} quote_lot=${quoteLotSize} maint_bps=${maintenanceMarginBps}`,
  );
  return cachedMarkets;
}

// ── Position scan ────────────────────────────────────────────────────────

type PositionRow = {
  pubkey: PublicKey;
  owner: PublicKey;
  marketIndex: number;
  size: bigint;
  side: number;
  entryPrice: bigint;
  initialMargin: bigint;
};

async function scanPositions(): Promise<PositionRow[]> {
  const accs = await conn.getProgramAccounts(RISK_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: POSITION_SIZE }],
  });
  const out: PositionRow[] = [];
  for (const { pubkey, account } of accs) {
    const d = account.data;
    if (d.length !== POSITION_SIZE) continue;
    const size = d.readBigInt64LE(0);
    if (size === 0n) continue;
    out.push({
      pubkey,
      owner: new PublicKey(d.subarray(40, 72)),
      entryPrice: d.readBigInt64LE(8),
      initialMargin: d.readBigInt64LE(24),
      marketIndex: d.readUInt16LE(32),
      side: d.readUInt8(35),
      size,
    });
  }
  return out;
}

type UserRow = {
  pubkey: PublicKey;
  owner: PublicKey;
  collateral: bigint;
  marginUsed: bigint;
};

async function scanUserAccounts(): Promise<Map<string, UserRow>> {
  const accs = await conn.getProgramAccounts(RISK_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: USER_ACCOUNT_SIZE }],
  });
  const out = new Map<string, UserRow>();
  for (const { pubkey, account } of accs) {
    const d = account.data;
    if (d.length !== USER_ACCOUNT_SIZE) continue;
    const owner = new PublicKey(d.subarray(24, 56));
    out.set(owner.toBase58(), {
      pubkey,
      owner,
      collateral: d.readBigInt64LE(0),
      marginUsed: d.readBigInt64LE(8),
    });
  }
  return out;
}

// ── Bots ─────────────────────────────────────────────────────────────────

async function runUpdateFundingRate(): Promise<void> {
  const markets = await loadMarkets();
  for (const m of markets) {
    const markNative = await fetchMarkPriceNative(m.oracle);
    if (markNative === null) {
      console.log(`[funding-rate] oracle missing for market ${m.marketIndex}`);
      continue;
    }
    // Program receives mark in same scale validate_pyth_price returns
    // (native USDC ×10⁶). update_funding_rate.rs converts internally.
    const ix = getUpdateFundingRateInstruction({
      cranker: fakeSigner(keeper.publicKey),
      marketConfig: addr(m.marketConfig),
      fundingState: addr(m.fundingState),
      oracle: addr(m.oracle),
      markPrice: markNative,
      marketIndex: m.marketIndex,
      padding: PADDING_6,
    });
    await send([...priorityFeeIxs(200_000), toLegacyIx(ix)], "funding-rate");
  }
}

async function runSettleFunding(): Promise<void> {
  const markets = await loadMarkets();
  const positions = await scanPositions();
  const users = await scanUserAccounts();
  console.log(`[settle-funding] scanning ${positions.length} positions`);
  for (const p of positions) {
    const m = markets.find((x) => x.marketIndex === p.marketIndex);
    if (!m) continue;
    const ua = users.get(p.owner.toBase58());
    if (!ua) continue;
    const ix = getSettleFundingInstruction({
      signer: fakeSigner(keeper.publicKey),
      userAccount: addr(ua.pubkey),
      position: addr(p.pubkey),
      marketConfig: addr(m.marketConfig),
      fundingState: addr(m.fundingState),
    });
    await send(
      [...priorityFeeIxs(200_000), toLegacyIx(ix)],
      `settle-funding ${p.owner.toBase58().slice(0, 6)}`,
    );
  }
}

async function runLiquidate(): Promise<void> {
  const markets = await loadMarkets();
  const positions = await scanPositions();
  const users = await scanUserAccounts();
  await ensureKeeperUsdcAta();

  for (const m of markets) {
    const markNative = await fetchMarkPriceNative(m.oracle);
    if (markNative === null) continue;
    const markLots = markNative / m.quoteLotSize;

    for (const p of positions) {
      if (p.marketIndex !== m.marketIndex) continue;
      const ua = users.get(p.owner.toBase58());
      if (!ua) continue;

      // Health = collateral / maintenance_margin × 100. Below 100 → liquidate.
      const notional = p.size * markLots * m.quoteLotSize;
      const maintenance =
        (notional * BigInt(m.maintenanceMarginBps)) / 10_000n;
      if (maintenance === 0n) continue;
      const healthFactor = (ua.collateral * 100n) / maintenance;
      if (healthFactor >= 100n) continue;

      console.log(
        `[liquidate] ${p.owner.toBase58().slice(0, 6)} health=${healthFactor} ` +
          `coll=${ua.collateral} maint=${maintenance}`,
      );
      const [insuranceFund] = findInsuranceFundPda();
      const [vault] = findVaultPda();
      const [vaultAuthority] = findVaultAuthorityPda();
      const ata = await ensureKeeperUsdcAta();
      const ix = getLiquidateInstruction({
        liquidator: fakeSigner(keeper.publicKey),
        userAccount: addr(ua.pubkey),
        position: addr(p.pubkey),
        marketConfig: addr(m.marketConfig),
        fundingState: addr(m.fundingState),
        insuranceFund: addr(insuranceFund),
        vault: addr(vault),
        vaultAuthority: addr(vaultAuthority),
        liquidatorTokenAccount: addr(ata),
        oracle: addr(m.oracle),
        tokenProgram: addr(TOKEN_PROGRAM_ID),
        marketIndex: m.marketIndex,
        bumpAuthority: m.bumpAuthority,
        padding: PADDING_5,
      });
      await send(
        [...priorityFeeIxs(), toLegacyIx(ix)],
        `liquidate ${p.owner.toBase58().slice(0, 6)}`,
      );
    }
  }
}

async function runCoverBadDebt(): Promise<void> {
  const markets = await loadMarkets();
  const positions = await scanPositions();
  const users = await scanUserAccounts();
  for (const p of positions) {
    const ua = users.get(p.owner.toBase58());
    if (!ua) continue;
    if (ua.collateral >= 0n) continue; // not in bad debt

    const m = markets.find((x) => x.marketIndex === p.marketIndex);
    if (!m) continue;
    const [insuranceFund] = findInsuranceFundPda();

    console.log(
      `[bad-debt] ${p.owner.toBase58().slice(0, 6)} collateral=${ua.collateral}`,
    );
    const ix = getCoverBadDebtInstruction({
      caller: fakeSigner(keeper.publicKey),
      userAccount: addr(ua.pubkey),
      position: addr(p.pubkey),
      marketConfig: addr(m.marketConfig),
      fundingState: addr(m.fundingState),
      insuranceFund: addr(insuranceFund),
      oracle: addr(m.oracle),
      marketIndex: m.marketIndex,
      padding: PADDING_6,
    });
    await send(
      [...priorityFeeIxs(), toLegacyIx(ix)],
      `cover-bad-debt ${p.owner.toBase58().slice(0, 6)}`,
    );
  }
}

// ── Trigger keeper ───────────────────────────────────────────────────────

type TriggerRow = {
  pubkey: PublicKey;
  clientId: bigint;
  triggerPrice: bigint;
  expiry: bigint;
  marketIndex: number;
  triggerType: number;
  side: number;
  status: number;
  owner: PublicKey;
};

async function scanTriggerOrders(): Promise<TriggerRow[]> {
  const accs = await conn.getProgramAccounts(TRIGGER_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: TRIGGER_ORDER_SIZE }],
  });
  const decoder = getTriggerOrderDecoder();
  const out: TriggerRow[] = [];
  for (const { pubkey, account } of accs) {
    try {
      const t = decoder.decode(new Uint8Array(account.data));
      out.push({
        pubkey,
        clientId: t.clientOrderId,
        triggerPrice: t.triggerPrice,
        expiry: t.expiry,
        marketIndex: t.marketIndex,
        triggerType: t.triggerType,
        side: t.side,
        status: t.status,
        owner: new PublicKey(t.owner),
      });
    } catch {
      continue;
    }
  }
  return out;
}

function shouldTrigger(
  triggerType: number,
  side: number,
  triggerPrice: bigint,
  markPrice: bigint,
): boolean {
  // Mirror TriggerOrder::should_trigger in trigger_program/src/states/trigger_order.rs
  if (triggerType === 0 && side === 1) return markPrice <= triggerPrice; // SL Sell (Long SL)
  if (triggerType === 1 && side === 1) return markPrice >= triggerPrice; // TP Sell (Long TP)
  if (triggerType === 0 && side === 0) return markPrice >= triggerPrice; // SL Buy (Short SL)
  if (triggerType === 1 && side === 0) return markPrice <= triggerPrice; // TP Buy (Short TP)
  return false;
}

function buildExecuteTriggerIx(args: {
  keeper: PublicKey;
  triggerAuthority: PublicKey;
  triggerOrderOwner: PublicKey;
  triggerOrder: PublicKey;
  market: PublicKey;
  openOrdersAccount: PublicKey;
  bids: PublicKey;
  asks: PublicKey;
  fillsLog: PublicKey;
  oracle: PublicKey;
  marketIndex: number;
  bumpFillsLog: number;
  bumpAuthority: number;
}): TransactionInstruction {
  // ix data: [disc u8, market_index u16le, bump_fills_log u8, bump_authority u8, padding [u8;4]]
  const data = Buffer.alloc(9);
  data.writeUInt8(EXECUTE_TRIGGER_DISC, 0);
  data.writeUInt16LE(args.marketIndex & 0xffff, 1);
  data.writeUInt8(args.bumpFillsLog, 3);
  data.writeUInt8(args.bumpAuthority, 4);
  // bytes 5..9 already zero
  return new TransactionInstruction({
    programId: TRIGGER_PROGRAM_ID,
    keys: [
      { pubkey: args.keeper, isSigner: true, isWritable: true },
      { pubkey: args.triggerAuthority, isSigner: false, isWritable: true },
      { pubkey: args.triggerOrderOwner, isSigner: false, isWritable: true },
      { pubkey: args.triggerOrder, isSigner: false, isWritable: true },
      { pubkey: args.market, isSigner: false, isWritable: true },
      { pubkey: args.openOrdersAccount, isSigner: false, isWritable: true },
      { pubkey: args.bids, isSigner: false, isWritable: true },
      { pubkey: args.asks, isSigner: false, isWritable: true },
      { pubkey: args.fillsLog, isSigner: false, isWritable: true },
      { pubkey: args.oracle, isSigner: false, isWritable: false },
      { pubkey: ORDERBOOK_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function runExecuteTriggers(): Promise<void> {
  const markets = await loadMarkets();
  const triggers = await scanTriggerOrders();
  const now = BigInt(Math.floor(Date.now() / 1000));

  for (const t of triggers) {
    if (t.status !== TriggerStatus.Active) continue;
    if (t.expiry !== 0n && now >= t.expiry) continue; // prune handles
    const m = markets.find((x) => x.marketIndex === t.marketIndex);
    if (!m) continue;
    const markNative = await fetchMarkPriceNative(m.oracle);
    if (markNative === null) continue;
    if (!shouldTrigger(t.triggerType, t.side, t.triggerPrice, markNative)) {
      continue;
    }

    const [triggerAuthority, bumpAuthority] = findTriggerAuthorityPda(t.owner);
    const [market] = findMarketPda(t.marketIndex);
    const [bids] = findBidsPda(t.marketIndex);
    const [asks] = findAsksPda(t.marketIndex);
    const [openOrdersAccount] = findOpenOrdersPda(t.owner, market);
    const [fillsLog, bumpFillsLog] = findFillsLogPda(
      triggerAuthority,
      t.clientId,
    );

    const ix = buildExecuteTriggerIx({
      keeper: keeper.publicKey,
      triggerAuthority,
      triggerOrderOwner: t.owner,
      triggerOrder: t.pubkey,
      market,
      openOrdersAccount,
      bids,
      asks,
      fillsLog,
      oracle: m.oracle,
      marketIndex: t.marketIndex,
      bumpFillsLog,
      bumpAuthority,
    });
    await send(
      [...priorityFeeIxs(), ix],
      `execute-trigger ${t.owner.toBase58().slice(0, 6)}/${t.clientId}`,
    );
  }
}

async function runPruneExpiredTriggers(): Promise<void> {
  const triggers = await scanTriggerOrders();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const expired = triggers.filter(
    (t) => t.status === TriggerStatus.Active && t.expiry !== 0n && now >= t.expiry,
  );
  if (expired.length === 0) return;

  for (let i = 0; i < expired.length; i += PRUNE_BATCH) {
    const slice = expired.slice(i, i + PRUNE_BATCH);
    const keys = [
      { pubkey: keeper.publicKey, isSigner: true, isWritable: true },
      ...slice.map((t) => ({
        pubkey: t.pubkey,
        isSigner: false,
        isWritable: true,
      })),
    ];
    const ix = new TransactionInstruction({
      programId: TRIGGER_PROGRAM_ID,
      keys,
      data: Buffer.from([PRUNE_EXPIRED_TRIGGER_DISC]),
    });
    await send(
      [...priorityFeeIxs(200_000), ix],
      `prune-triggers ${slice.length}`,
    );
  }
}

async function runPruneOrders(): Promise<void> {
  const [market] = findMarketPda(MARKET_INDEX);
  const [bids] = findBidsPda(MARKET_INDEX);
  const [asks] = findAsksPda(MARKET_INDEX);

  for (const sideTag of [
    { side: 0, name: "bids" },
    { side: 1, name: "asks" },
  ]) {
    const ix = getPruneOrdersInstruction({
      keeper: fakeSigner(keeper.publicKey),
      market: addr(market),
      bids: addr(bids),
      asks: addr(asks),
      side: sideTag.side,
      limit: 24,
      padding: PADDING_6,
    });
    await send(
      [...priorityFeeIxs(300_000), toLegacyIx(ix)],
      `prune-${sideTag.name}`,
    );
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────

type Job = {
  name: string;
  intervalMs: number;
  run: () => Promise<void>;
  running: boolean;
};

const jobs: Job[] = [
  { name: "update-funding-rate", intervalMs: 3_600_000, run: runUpdateFundingRate, running: false },
  { name: "liquidate", intervalMs: 30_000, run: runLiquidate, running: false },
  { name: "cover-bad-debt", intervalMs: 60_000, run: runCoverBadDebt, running: false },
  { name: "prune-orders", intervalMs: 60_000, run: runPruneOrders, running: false },
  { name: "settle-funding", intervalMs: 8 * 3_600_000, run: runSettleFunding, running: false },
  { name: "execute-triggers", intervalMs: 10_000, run: runExecuteTriggers, running: false },
  { name: "prune-expired-triggers", intervalMs: 60_000, run: runPruneExpiredTriggers, running: false },
];

async function tick(j: Job): Promise<void> {
  if (j.running) {
    console.log(`[${j.name}] skip (still running)`);
    return;
  }
  j.running = true;
  const t0 = Date.now();
  try {
    await j.run();
  } catch (e) {
    console.error(`[${j.name}] crashed:`, e);
  } finally {
    j.running = false;
    console.log(`[${j.name}] done in ${Date.now() - t0}ms`);
  }
}

async function main(): Promise<void> {
  await loadMarkets();
  await ensureKeeperUsdcAta();

  // Kick each job once on startup, then schedule.
  for (const j of jobs) {
    tick(j).catch(() => null);
    setInterval(() => {
      tick(j).catch(() => null);
    }, j.intervalMs);
  }

  console.log("[keeper] all schedulers armed");
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
