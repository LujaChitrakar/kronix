"use client";

import { useCallback, useEffect, useRef } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
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
import { notifySuccess } from "@/lib/notifications";
import { useStore } from "@/lib/store";
import { getStrategyAccountDecoder, STRATEGY_ACCOUNT_LEN } from "@/lib/strategy-sdk";

const OWNER_OFFSET_IN_STRATEGY = 248;
const POLL_MS = 6000;

type StrategySnapshot = {
  key: string;
  strategyType: number;
  status: number;
  side: number;
  clientOrderId: bigint;
  marketIndex: number;
};

type ExecutionOutcome = "resting" | "filled";

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

function notifyExecuted(strategy: StrategySnapshot, outcome: ExecutionOutcome) {
  const result =
    outcome === "resting" ? "opened in Open Orders" : "filled during execution";
  notifySuccess(
    "Strategy executed",
    `${typeLabel(strategy.strategyType)} ${sideLabel(strategy.side)} ${result}`,
  );
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
        notifyExecuted(strategy, outcome);
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
