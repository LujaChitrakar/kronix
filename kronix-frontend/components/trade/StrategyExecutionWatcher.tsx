"use client";

import { useCallback, useEffect, useRef } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  ORDERBOOK_PROGRAM_ID,
  Side,
  STRATEGY_PROGRAM_ID,
  StrategyStatus,
  StrategyType,
} from "@/lib/kronix/config";
import { fetchFillsLog } from "@/lib/kronix/fills-log";
import {
  findFillsLogPda,
  findMarketPda,
  findOpenOrdersPda,
  findStrategyAuthorityPda,
} from "@/lib/kronix/pdas";
import { fetchOpenOrders } from "@/lib/kronix/state";
import { notifySuccess, notifyTxSuccess } from "@/lib/notifications";
import { useStore } from "@/lib/store";
import { getStrategyAccountDecoder, STRATEGY_ACCOUNT_LEN } from "@/lib/strategy-sdk";

const OWNER_OFFSET_IN_STRATEGY = 248;
const POLL_MS = 6000;
const SIGNATURE_LOOKUP_ATTEMPTS = 8;
const SIGNATURE_LOOKUP_DELAY_MS = 1500;

type StrategySnapshot = {
  key: string;
  pubkey: PublicKey;
  strategyType: number;
  status: number;
  side: number;
  clientOrderId: bigint;
  marketIndex: number;
};

type ExecutionOutcome = "resting" | "filled";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function typeLabel(t: number): string {
  if (t === StrategyType.RSI) return "RSI";
  if (t === StrategyType.EMA) return "EMA";
  if (t === StrategyType.RangeDCA) return "DCA";
  if (t === StrategyType.SR) return "S/R";
  if (t === StrategyType.SmartMoney) return "SMART";
  return `type ${t}`;
}

function sideLabel(side: number): string {
  if (side === Side.Bid) return "BUY";
  if (side === Side.Ask) return "SELL";
  return `side ${side}`;
}

async function fetchStrategySnapshots(
  connection: Connection,
  owner: PublicKey,
  marketIndex: number,
): Promise<Map<string, StrategySnapshot>> {
  const accs = await connection.getProgramAccounts(STRATEGY_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { dataSize: STRATEGY_ACCOUNT_LEN },
      { memcmp: { offset: OWNER_OFFSET_IN_STRATEGY, bytes: owner.toBase58() } },
    ],
  });
  const decoder = getStrategyAccountDecoder();
  const snapshots = new Map<string, StrategySnapshot>();

  for (const { pubkey, account } of accs) {
    try {
      const s = decoder.decode(new Uint8Array(account.data));
      if (s.marketIndex !== marketIndex) continue;
      const key = `${pubkey.toBase58()}:${s.clientOrderId}`;
      snapshots.set(key, {
        key,
        pubkey,
        strategyType: s.strategyType,
        status: s.status,
        side: s.side,
        clientOrderId: s.clientOrderId,
        marketIndex: s.marketIndex,
      });
    } catch {
      continue;
    }
  }

  return snapshots;
}

async function hasOpenOrder(
  connection: Connection,
  owner: PublicKey,
  strategy: StrategySnapshot,
): Promise<boolean> {
  const [market] = findMarketPda(strategy.marketIndex);
  const [openOrders] = findOpenOrdersPda(owner, market);
  const account = await fetchOpenOrders(connection, openOrders);
  return (
    account?.openOrders.some(
      (order) => order.isFree !== 1 && order.clientId === strategy.clientOrderId,
    ) ?? false
  );
}

async function hasExecutionFill(
  connection: Connection,
  owner: PublicKey,
  strategy: StrategySnapshot,
): Promise<boolean> {
  const [strategyAuthority] = findStrategyAuthorityPda(owner);
  const [fillsLog] = findFillsLogPda(strategyAuthority, strategy.clientOrderId);
  const log = await fetchFillsLog(connection, fillsLog, "confirmed");
  return (log?.fillCount ?? 0) > 0;
}

async function executionOutcome(
  connection: Connection,
  owner: PublicKey,
  strategy: StrategySnapshot,
): Promise<ExecutionOutcome | null> {
  if (await hasOpenOrder(connection, owner, strategy)) return "resting";
  if (await hasExecutionFill(connection, owner, strategy)) return "filled";
  return null;
}

async function isExecutionSignature(
  connection: Connection,
  signature: string,
): Promise<boolean> {
  const tx = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const meta = tx?.meta;
  if (!meta || meta.err) return false;
  const logs = meta.logMessages ?? [];
  return (
    logs.some((line) => line.includes(ORDERBOOK_PROGRAM_ID.toBase58())) &&
    logs.some((line) => line.includes("disc byte: 3"))
  );
}

async function fetchExecutionSignature(
  connection: Connection,
  owner: PublicKey,
  strategy: StrategySnapshot,
): Promise<string | null> {
  const [strategyAuthority] = findStrategyAuthorityPda(owner);
  const [fillsLog] = findFillsLogPda(strategyAuthority, strategy.clientOrderId);
  const lookupAddresses = [strategy.pubkey, fillsLog];

  for (let attempt = 0; attempt < SIGNATURE_LOOKUP_ATTEMPTS; attempt++) {
    const signatures = (
      await Promise.all(
        lookupAddresses.map((address) =>
          connection.getSignaturesForAddress(
            address,
            { limit: 6 },
            "confirmed",
          ),
        ),
      )
    )
      .flat()
      .filter((entry) => entry.err === null)
      .sort((a, b) => b.slot - a.slot);

    const seen = new Set<string>();
    for (const entry of signatures) {
      if (seen.has(entry.signature)) continue;
      seen.add(entry.signature);
      if (await isExecutionSignature(connection, entry.signature).catch(() => false)) {
        return entry.signature;
      }
    }

    if (attempt < SIGNATURE_LOOKUP_ATTEMPTS - 1) {
      await sleep(SIGNATURE_LOOKUP_DELAY_MS);
    }
  }

  return null;
}

function notifyExecuted(
  strategy: StrategySnapshot,
  outcome: ExecutionOutcome,
  signature: string | null,
) {
  const result =
    outcome === "resting" ? "opened in Open Orders" : "filled during execution";
  const description = `${typeLabel(strategy.strategyType)} ${sideLabel(strategy.side)} ${result}`;
  if (signature) notifyTxSuccess("Strategy executed", signature, description);
  else notifySuccess("Strategy executed", description);
}

export function StrategyExecutionWatcher() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;
  const marketIndex = useStore((s) => s.selectedMarketIndex);
  const previousRef = useRef<Map<string, StrategySnapshot>>(new Map());
  const readyRef = useRef(false);
  const inFlightRef = useRef(false);
  const scopeRef = useRef<string | null>(null);
  const notifiedRef = useRef<Set<string>>(new Set());

  const reset = useCallback((scope: string | null) => {
    scopeRef.current = scope;
    readyRef.current = false;
    previousRef.current = new Map();
  }, []);

  const poll = useCallback(async () => {
    if (!owner) {
      reset(null);
      return;
    }

    const scope = `${owner.toBase58()}:${marketIndex}`;
    if (scopeRef.current !== scope) reset(scope);
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    try {
      const current = await fetchStrategySnapshots(connection, owner, marketIndex);

      if (!readyRef.current) {
        previousRef.current = current;
        readyRef.current = true;
        return;
      }

      const missingActive = Array.from(previousRef.current.values()).filter(
        (strategy) =>
          strategy.status === StrategyStatus.Active && !current.has(strategy.key),
      );

      for (const strategy of missingActive) {
        const notifyKey = `${scope}:${strategy.strategyType}:${strategy.clientOrderId}`;
        if (notifiedRef.current.has(notifyKey)) continue;

        const outcome = await executionOutcome(connection, owner, strategy);
        if (!outcome) continue;

        notifiedRef.current.add(notifyKey);
        const signature = await fetchExecutionSignature(
          connection,
          owner,
          strategy,
        ).catch(() => null);
        notifyExecuted(strategy, outcome, signature);
      }

      previousRef.current = current;
    } catch (err) {
      console.warn("strategy execution watcher failed", err);
    } finally {
      inFlightRef.current = false;
    }
  }, [connection, marketIndex, owner, reset]);

  useEffect(() => {
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [poll]);

  return null;
}
