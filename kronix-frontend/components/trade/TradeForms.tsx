"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AccountFundingControls } from "./AccountPanel";
import { OrderForm } from "./OrderForm";
import { StrategyForm } from "./StrategyForm";
import { TriggerForm } from "./TriggerForm";
import { findMarketPda, findOpenOrdersPda } from "@/lib/kronix/pdas";
import { getMarketInfo } from "@/lib/kronix/config";
import { useStore } from "@/lib/store";

type Tab = "order" | "strategy" | "trigger";

export function TradeForms() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;
  const [tab, setTab] = useState<Tab>("order");
  const [hasOpenOrders, setHasOpenOrders] = useState<boolean | null>(null);
  const selectedSymbol = useStore((s) => s.selectedSymbol);
  const marketIndex = useStore((s) => s.selectedMarketIndex);
  const marketName = getMarketInfo(selectedSymbol).name;
  const blurFunding = !!owner && hasOpenOrders === false;

  useEffect(() => {
    if (!owner) {
      setHasOpenOrders(null);
      return;
    }
    setHasOpenOrders(null);
    let alive = true;
    const refresh = async () => {
      const [market] = findMarketPda(marketIndex);
      const [oo] = findOpenOrdersPda(owner, market);
      const info = await connection.getAccountInfo(oo, "confirmed");
      if (alive) setHasOpenOrders(!!info);
    };
    refresh().catch(() => null);
    const t = setInterval(() => refresh().catch(() => null), 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [connection, owner, marketIndex]);

  return (
    <div className="bg-kx-surface rounded-xl border kx-border overflow-hidden flex flex-col h-full">
      <div className="grid grid-cols-2 items-center border-b kx-border shrink-0">
        <TabBtn active={tab === "order"} onClick={() => setTab("order")}>
          Order
        </TabBtn>
        <TabBtn active={tab === "strategy"} onClick={() => setTab("strategy")}>
          Strategy
        </TabBtn>
        {/*<TabBtn active={tab === "trigger"} onClick={() => setTab("trigger")}>
          Trigger
        </TabBtn>*/}
        {/*<div className="ml-auto pr-3 text-[10px] font-mono text-on-surface-variant/70">
          {marketName}
        </div>*/}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "order" && <OrderForm />}
        {tab === "strategy" && <StrategyForm />}
        {tab === "trigger" && <TriggerForm />}
      </div>

      <div
        className={`border-t kx-border px-4 pt-10 pb-20 shrink-0 ${
          blurFunding ? "pointer-events-none select-none blur-[2px] opacity-35" : ""
        }`}
        aria-hidden={blurFunding}
      >
        <div className="mb-2 text-sm text-center font-headline font-bold uppercase tracking-wider text-on-surface">
          Deposit Collateral
        </div>
        <AccountFundingControls />
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full px-4 py-2.5 text-xs font-headline uppercase tracking-wider transition-colors ${
        active
          ? "text-on-surface border-b-2 border-[#4dffb4] -mb-px"
          : "text-on-surface-variant/70 hover:text-on-surface"
      }`}
    >
      {children}
    </button>
  );
}
