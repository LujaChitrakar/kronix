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
} from "../kronix-frontend/lib/risk-sdk";
import { getPruneOrdersInstruction } from "../kronix-frontend/lib/orderbook-sdk";

import {
  ORDERBOOK_PROGRAM_ID,
  RISK_PROGRAM_ID,
  TRIGGER_PROGRAM_ID,
  STRATEGY_PROGRAM_ID,
  USDC_MINT,
  MARKET_INDEX,
  TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TriggerStatus,
  StrategyStatus,
  StrategyType,
} from "../kronix-frontend/lib/kronix/config";
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
  findStrategyAuthorityPda,
  findTriggerOrderPda,
} from "../kronix-frontend/lib/kronix/pdas";
import { toLegacyIx, fakeSigner } from "../kronix-frontend/lib/kronix/ix-bridge";
import { getTriggerOrderDecoder } from "../kronix-frontend/lib/trigger-sdk";
import {
  getStrategyAccountDecoder,
  STRATEGY_ACCOUNT_LEN,
} from "../kronix-frontend/lib/strategy-sdk";

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
const EXECUTE_STRATEGY_DISC = 2;
const PRICE_HISTORY_MAX = 200;

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
    if (msg.includes("0xd")) return null; // FundingNotDue
    if (msg.includes("0x10")) return null; // NotLiquidatable
    if (msg.includes("0x11")) return null; // NotInBadDebt
    if (msg.includes("0xf") && label.startsWith("cover-bad-debt")) return null; // InsuranceFundDepleted
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

// ── Strategy keeper ──────────────────────────────────────────────────────

// Mark-price history per market in lots. Used to compute RSI/EMA signals
// for keeper-evaluated strategies. Sampled by runRecordPrice tick. Persisted
// to disk so a keeper restart does not blow away the warmup window.
const PRICE_HISTORY_PATH =
  process.env.KEEPER_PRICE_HISTORY_PATH ??
  path.join(path.dirname(KEYPAIR_PATH), "kronix-price-history.json");

const priceHistory = new Map<number, bigint[]>();

function loadPriceHistory(): void {
  try {
    if (!fs.existsSync(PRICE_HISTORY_PATH)) return;
    const raw = fs.readFileSync(PRICE_HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    for (const [k, arr] of Object.entries(parsed)) {
      priceHistory.set(Number(k), arr.map((s) => BigInt(s)));
    }
    console.log(
      `[init] loaded price history (${[...priceHistory.entries()]
        .map(([m, a]) => `m${m}:${a.length}`)
        .join(",")})`,
    );
  } catch (e) {
    console.log(`[init] price history load failed: ${(e as Error).message}`);
  }
}

function savePriceHistory(): void {
  try {
    const obj: Record<string, string[]> = {};
    for (const [m, arr] of priceHistory.entries()) {
      obj[String(m)] = arr.map((b) => b.toString());
    }
    fs.writeFileSync(PRICE_HISTORY_PATH, JSON.stringify(obj));
  } catch (e) {
    console.log(`[record-price] save failed: ${(e as Error).message}`);
  }
}

async function runRecordPrice(): Promise<void> {
  const markets = await loadMarkets();
  let dirty = false;
  for (const m of markets) {
    const native = await fetchMarkPriceNative(m.oracle);
    if (native === null) continue;
    const lots = native / m.quoteLotSize;
    const arr = priceHistory.get(m.marketIndex) ?? [];
    arr.push(lots);
    if (arr.length > PRICE_HISTORY_MAX) arr.shift();
    priceHistory.set(m.marketIndex, arr);
    dirty = true;
  }
  if (dirty) savePriceHistory();
}

// Wilder-smoothed RSI. Mirrors strategy_engine/indicators.md::rsi.
function computeRsi(prices: bigint[], period: number): number | null {
  if (period <= 0 || prices.length < period + 1) return null;
  const closes = prices.map((p) => Number(p));

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i] - closes[i - 1];
    if (delta > 0) avgGain += delta;
    else avgLoss += -delta;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? -delta : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// SMA-seeded EMA. Mirrors strategy_engine/indicators.md::ema.
function computeEma(prices: bigint[], period: number): number | null {
  if (period <= 0 || prices.length < period) return null;
  const closes = prices.map((p) => Number(p));
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += closes[i];
  seed /= period;
  let e = seed;
  for (let i = period; i < closes.length; i++) {
    e = closes[i] * k + e * (1 - k);
  }
  return e;
}

function computeEmaPrev(prices: bigint[], period: number): number | null {
  if (prices.length < period + 1) return null;
  return computeEma(prices.slice(0, -1), period);
}

// ── Structure / order-block detection (SmartMoney) ───────────────────────
// Mirrors strategy_engine/indicators.md::detect_structure + find_order_block.

type Structure = "bullish" | "bearish" | "ranging";

type Candle = {
  open: number;
  high: number;
  low: number;
  close: number;
};

function pivotHighAt(highs: number[], idx: number): number | null {
  if (idx <= 0 || idx + 1 >= highs.length) return null;
  if (highs[idx] > highs[idx - 1] && highs[idx] > highs[idx + 1]) return highs[idx];
  return null;
}

function pivotLowAt(lows: number[], idx: number): number | null {
  if (idx <= 0 || idx + 1 >= lows.length) return null;
  if (lows[idx] < lows[idx - 1] && lows[idx] < lows[idx + 1]) return lows[idx];
  return null;
}

function findPrevPivotHigh(highs: number[], before: number): number | null {
  for (let i = before - 1; i >= 1; i--) {
    const ph = pivotHighAt(highs, i);
    if (ph !== null) return ph;
  }
  return null;
}

function findPrevPivotLow(lows: number[], before: number): number | null {
  for (let i = before - 1; i >= 1; i--) {
    const pl = pivotLowAt(lows, i);
    if (pl !== null) return pl;
  }
  return null;
}

function detectStructure(candles: Candle[]): Structure {
  if (candles.length < 6) return "ranging";
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const n = candles.length;
  const phCurr = pivotHighAt(highs, n - 2);
  const plCurr = pivotLowAt(lows, n - 2);
  const phPrev = findPrevPivotHigh(highs, n - 3);
  const plPrev = findPrevPivotLow(lows, n - 3);
  if (phCurr === null || plCurr === null || phPrev === null || plPrev === null) {
    return "ranging";
  }
  if (phCurr > phPrev && plCurr > plPrev) return "bullish";
  if (phCurr < phPrev && plCurr < plPrev) return "bearish";
  return "ranging";
}

type OrderBlock = { high: number; low: number; isBullish: boolean };

function findOrderBlock(
  candles: Candle[],
  structure: Structure,
): OrderBlock | null {
  if (candles.length < 3 || structure === "ranging") return null;
  const n = candles.length;
  for (let i = n - 2; i >= 1; i--) {
    const c = candles[i];
    const next = candles[i + 1];
    if (structure === "bullish") {
      if (c.close < c.open && next.close > next.open && next.close > c.high) {
        return { high: c.high, low: c.low, isBullish: true };
      }
    } else {
      if (c.close > c.open && next.close < next.open && next.close < c.low) {
        return { high: c.high, low: c.low, isBullish: false };
      }
    }
  }
  return null;
}

// Build synthetic candles by bucketing scalar mark-price samples into bars
// of `bucketSize` samples each. Used by structure-based evaluators when
// keeper has only mark-price ticks (no OHLC feed).
function bucketSamplesToCandles(
  samples: bigint[],
  bucketSize: number,
): Candle[] {
  if (bucketSize <= 0 || samples.length === 0) return [];
  const out: Candle[] = [];
  for (let i = 0; i + bucketSize <= samples.length; i += bucketSize) {
    let high = -Infinity;
    let low = Infinity;
    const open = Number(samples[i]);
    const close = Number(samples[i + bucketSize - 1]);
    for (let j = i; j < i + bucketSize; j++) {
      const v = Number(samples[j]);
      if (v > high) high = v;
      if (v < low) low = v;
    }
    out.push({ open, high, low, close });
  }
  return out;
}

type StrategyRow = {
  pubkey: PublicKey;
  owner: PublicKey;
  strategyType: number;
  status: number;
  marketIndex: number;
  side: number;
  clientOrderId: bigint;
  takeProfitPrice: bigint;
  stopLossPrice: bigint;
  cooldownSecs: bigint;
  maxExecutionsPerDay: bigint;
  executionsToday: bigint;
  dayStartTs: bigint;
  lastExecutedTs: bigint;
  rsiPeriod: number;
  rsiOversold: number;
  rsiOverbought: number;
  emaFast: number;
  emaSlow: number;
  lowerPrice: bigint;
  upperPrice: bigint;
  gridCount: number;
  levels: bigint[];
  levelCount: number;
  toleranceBps: number;
  structureLookback: number;
  orderBlockSensitivity: number; // bps (1 = 0.01%)
};

async function scanStrategies(): Promise<StrategyRow[]> {
  const accs = await conn.getProgramAccounts(STRATEGY_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: STRATEGY_ACCOUNT_LEN }],
  });
  const decoder = getStrategyAccountDecoder();
  const out: StrategyRow[] = [];
  for (const { pubkey, account } of accs) {
    try {
      const s = decoder.decode(new Uint8Array(account.data));
      out.push({
        pubkey,
        owner: new PublicKey(s.owner),
        strategyType: s.strategyType,
        status: s.status,
        marketIndex: s.marketIndex,
        side: s.side,
        clientOrderId: s.clientOrderId,
        takeProfitPrice: s.takeProfitPrice,
        stopLossPrice: s.stopLossPrice,
        cooldownSecs: s.cooldownSecs,
        maxExecutionsPerDay: s.maxExecutionsPerDay,
        executionsToday: s.executionsToday,
        dayStartTs: s.dayStartTs,
        lastExecutedTs: s.lastExecutedTs,
        rsiPeriod: s.params.rsiPeriod,
        rsiOversold: s.params.rsiOversold,
        rsiOverbought: s.params.rsiOverbought,
        emaFast: s.params.emaFast,
        emaSlow: s.params.emaSlow,
        lowerPrice: s.params.lowerPrice,
        upperPrice: s.params.upperPrice,
        gridCount: s.params.gridCount,
        levels: s.params.levels.slice(),
        levelCount: s.params.levelCount,
        toleranceBps: s.params.toleranceBps,
        structureLookback: s.params.structureLookback,
        orderBlockSensitivity: s.params.orderBlockSensitivity,
      });
    } catch {
      continue;
    }
  }
  return out;
}

// Bucket size when synthesizing candles from per-tick mark-price samples.
// 12 samples × 5s tick = 1-minute synthetic bars.
const CANDLE_BUCKET_SAMPLES = 12;

// Returns 0 (Buy), 1 (Sell), or null (no action).
// Mirrors strategy_engine/evaluator.md per type.
function computeSignal(s: StrategyRow, markLots: bigint): number | null {
  const hist = priceHistory.get(s.marketIndex) ?? [];

  if (s.strategyType === StrategyType.RSI) {
    const rsi = computeRsi(hist, s.rsiPeriod);
    if (rsi === null) return null;
    if (rsi < s.rsiOversold) return 0;
    if (rsi > s.rsiOverbought) return 1;
    return null;
  }

  if (s.strategyType === StrategyType.EMA) {
    const fastNow = computeEma(hist, s.emaFast);
    const slowNow = computeEma(hist, s.emaSlow);
    const fastPrev = computeEmaPrev(hist, s.emaFast);
    const slowPrev = computeEmaPrev(hist, s.emaSlow);
    if (
      fastNow === null ||
      slowNow === null ||
      fastPrev === null ||
      slowPrev === null
    )
      return null;
    const bullishCross = fastPrev <= slowPrev && fastNow > slowNow;
    const bearishCross = fastPrev >= slowPrev && fastNow < slowNow;
    if (bullishCross) return 0;
    if (bearishCross) return 1;
    return null;
  }

  if (s.strategyType === StrategyType.RangeDCA) {
    if (s.gridCount === 0 || s.upperPrice <= s.lowerPrice) return null;
    const price = Number(markLots);
    const lower = Number(s.lowerPrice);
    const upper = Number(s.upperPrice);
    const range = upper - lower;
    const step = range / s.gridCount;
    const tolerance = step * 0.001; // 0.1% of step
    for (let i = 0; i <= s.gridCount; i++) {
      const level = lower + step * i;
      if (Math.abs(price - level) <= tolerance) {
        // Buy at lower half, sell at upper half (engine kept fixed side from
        // config; strategy_program StrategyAccount has only `side` so use it
        // when the price is on the matching half of the grid).
        return s.side;
      }
    }
    return null;
  }

  if (s.strategyType === StrategyType.SR) {
    if (s.levelCount === 0 || s.toleranceBps === 0) return null;
    const price = Number(markLots);
    const bpsFraction = s.toleranceBps / 10_000;
    for (let i = 0; i < s.levelCount && i < s.levels.length; i++) {
      const level = Number(s.levels[i]);
      if (level <= 0) continue;
      const dist = Math.abs(price - level);
      if (dist <= level * bpsFraction) {
        return s.side;
      }
    }
    return null;
  }

  if (s.strategyType === StrategyType.SmartMoney) {
    const needed = Math.max(s.structureLookback, 6) * CANDLE_BUCKET_SAMPLES;
    if (hist.length < needed) return null;
    const candles = bucketSamplesToCandles(
      hist.slice(hist.length - needed),
      CANDLE_BUCKET_SAMPLES,
    );
    if (candles.length < 6) return null;
    const structure = detectStructure(candles);
    if (structure === "ranging") return null;
    const ob = findOrderBlock(candles, structure);
    if (!ob) return null;
    const price = Number(markLots);
    // orderBlockSensitivity is bps (1 = 0.01%).
    const fuzz = (price * s.orderBlockSensitivity) / 10_000;
    const inOb = price >= ob.low - fuzz && price <= ob.high + fuzz;
    if (!inOb) return null;
    return ob.isBullish ? 0 : 1;
  }

  return null;
}

function buildExecuteStrategyIx(args: {
  keeper: PublicKey;
  strategyAuthority: PublicKey;
  strategyOwner: PublicKey;
  strategyAccount: PublicKey;
  openOrdersAccount: PublicKey;
  market: PublicKey;
  bids: PublicKey;
  asks: PublicKey;
  fillsLog: PublicKey;
  signal: number;
  bumpOoAccount: number;
  bumpFillsLog: number;
  bumpTriggerTp: number;
  bumpTriggerSl: number;
  bumpAuthority: number;
  bumpTriggerAuthority: number;
  bumpTpFillsLog: number;
  bumpSlFillsLog: number;
  hasTp: boolean;
  hasSl: boolean;
  triggerAuthorityForStrat?: PublicKey;
  tpTriggerOrder?: PublicKey;
  tpFillsLog?: PublicKey;
  slTriggerOrder?: PublicKey;
  slFillsLog?: PublicKey;
}): TransactionInstruction {
  // ix data: [disc u8] + ExecuteStrategyParams (16 bytes)
  const data = Buffer.alloc(17);
  data.writeUInt8(EXECUTE_STRATEGY_DISC, 0);
  data.writeUInt8(args.signal, 1);
  data.writeUInt8(args.bumpOoAccount, 2);
  data.writeUInt8(args.bumpFillsLog, 3);
  data.writeUInt8(args.bumpTriggerTp, 4);
  data.writeUInt8(args.bumpTriggerSl, 5);
  data.writeUInt8(args.bumpAuthority, 6);
  data.writeUInt8(args.bumpTriggerAuthority, 7);
  data.writeUInt8(args.bumpTpFillsLog, 8);
  data.writeUInt8(args.bumpSlFillsLog, 9);
  // bytes 10..17 are padding (already zero)

  const keys = [
    { pubkey: args.keeper, isSigner: true, isWritable: true },
    { pubkey: args.strategyAuthority, isSigner: false, isWritable: true },
    { pubkey: args.strategyOwner, isSigner: false, isWritable: false },
    { pubkey: args.strategyAccount, isSigner: false, isWritable: true },
    { pubkey: args.openOrdersAccount, isSigner: false, isWritable: true },
    { pubkey: args.market, isSigner: false, isWritable: true },
    { pubkey: args.bids, isSigner: false, isWritable: true },
    { pubkey: args.asks, isSigner: false, isWritable: true },
    { pubkey: args.fillsLog, isSigner: false, isWritable: true },
    { pubkey: ORDERBOOK_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  if ((args.hasTp || args.hasSl) && args.triggerAuthorityForStrat) {
    keys.push({
      pubkey: TRIGGER_PROGRAM_ID,
      isSigner: false,
      isWritable: false,
    });
    keys.push({
      pubkey: args.triggerAuthorityForStrat,
      isSigner: false,
      isWritable: false,
    });
  }
  if (args.hasTp && args.tpTriggerOrder && args.tpFillsLog) {
    keys.push({
      pubkey: args.tpTriggerOrder,
      isSigner: false,
      isWritable: true,
    });
    keys.push({
      pubkey: args.tpFillsLog,
      isSigner: false,
      isWritable: true,
    });
  }
  if (args.hasSl && args.slTriggerOrder && args.slFillsLog) {
    keys.push({
      pubkey: args.slTriggerOrder,
      isSigner: false,
      isWritable: true,
    });
    keys.push({
      pubkey: args.slFillsLog,
      isSigner: false,
      isWritable: true,
    });
  }

  return new TransactionInstruction({
    programId: STRATEGY_PROGRAM_ID,
    keys,
    data,
  });
}

async function runExecuteStrategies(): Promise<void> {
  const markets = await loadMarkets();
  const strategies = await scanStrategies();
  const now = BigInt(Math.floor(Date.now() / 1000));

  for (const s of strategies) {
    if (s.status !== StrategyStatus.Active) continue;

    // Cooldown gate (mirrors program check).
    if (s.lastExecutedTs > 0n && s.cooldownSecs > 0n) {
      const elapsed = now - s.lastExecutedTs;
      if (elapsed < s.cooldownSecs) continue;
    }

    // Daily cap gate (with rollover).
    if (s.maxExecutionsPerDay > 0n) {
      const dayElapsed = now - s.dayStartTs;
      const used = dayElapsed >= 86_400n ? 0n : s.executionsToday;
      if (used >= s.maxExecutionsPerDay) continue;
    }

    const m = markets.find((x) => x.marketIndex === s.marketIndex);
    if (!m) continue;
    const markNative = await fetchMarkPriceNative(m.oracle);
    if (markNative === null) continue;
    const markLots = markNative / m.quoteLotSize;

    const signal = computeSignal(s, markLots);
    if (signal === null) continue;

    const [strategyAuthority, bumpAuthority] = findStrategyAuthorityPda(s.owner);
    const [market] = findMarketPda(s.marketIndex);
    const [bids] = findBidsPda(s.marketIndex);
    const [asks] = findAsksPda(s.marketIndex);
    const [openOrdersAccount, bumpOoAccount] = findOpenOrdersPda(
      strategyAuthority,
      market,
    );
    const [fillsLog, bumpFillsLog] = findFillsLogPda(
      strategyAuthority,
      s.clientOrderId,
    );

    const hasTp = s.takeProfitPrice > 0n;
    const hasSl = s.stopLossPrice > 0n;

    // trigger_authority for strategy_authority (NOT for s.owner)
    const [triggerAuthorityForStrat, bumpTriggerAuthority] =
      findTriggerAuthorityPda(strategyAuthority);

    let tpTriggerOrder: PublicKey | undefined;
    let bumpTriggerTp = 0;
    let tpFillsLog: PublicKey | undefined;
    let bumpTpFillsLog = 0;
    let slTriggerOrder: PublicKey | undefined;
    let bumpTriggerSl = 0;
    let slFillsLog: PublicKey | undefined;
    let bumpSlFillsLog = 0;

    if (hasTp) {
      // trigger_order seed: [b"trigger_order", strategy_authority, client_id_le]
      const [tp, btp] = findTriggerOrderPda(strategyAuthority, s.clientOrderId);
      tpTriggerOrder = tp;
      bumpTriggerTp = btp;
      // fills_log seed (orderbook): [b"fills_log", trigger_authority_of_strat, client_id_le]
      const [tpFl, btpFl] = findFillsLogPda(
        triggerAuthorityForStrat,
        s.clientOrderId,
      );
      tpFillsLog = tpFl;
      bumpTpFillsLog = btpFl;
    }
    if (hasSl) {
      const [sl, bsl] = findTriggerOrderPda(
        strategyAuthority,
        s.clientOrderId + 1n,
      );
      slTriggerOrder = sl;
      bumpTriggerSl = bsl;
      const [slFl, bslFl] = findFillsLogPda(
        triggerAuthorityForStrat,
        s.clientOrderId + 1n,
      );
      slFillsLog = slFl;
      bumpSlFillsLog = bslFl;
    }

    const ix = buildExecuteStrategyIx({
      keeper: keeper.publicKey,
      strategyAuthority,
      strategyOwner: s.owner,
      strategyAccount: s.pubkey,
      openOrdersAccount,
      market,
      bids,
      asks,
      fillsLog,
      signal,
      bumpOoAccount,
      bumpFillsLog,
      bumpTriggerTp,
      bumpTriggerSl,
      bumpAuthority,
      bumpTriggerAuthority,
      bumpTpFillsLog,
      bumpSlFillsLog,
      hasTp,
      hasSl,
      triggerAuthorityForStrat,
      tpTriggerOrder,
      tpFillsLog,
      slTriggerOrder,
      slFillsLog,
    });
    await send(
      [...priorityFeeIxs(), ix],
      `execute-strategy ${s.owner.toBase58().slice(0, 6)}/t${s.strategyType}/sig${signal}`,
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
  { name: "record-price", intervalMs: 5_000, run: runRecordPrice, running: false },
  { name: "execute-strategies", intervalMs: 30_000, run: runExecuteStrategies, running: false },
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
  loadPriceHistory();

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
