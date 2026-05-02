"use client";

import { useState } from "react";
import { OrderForm } from "./OrderForm";
import { StrategyForm } from "./StrategyForm";
import { TriggerForm } from "./TriggerForm";
import { MARKET_NAME } from "@/lib/kronix/config";

type Tab = "order" | "strategy" | "trigger";

export function TradeForms() {
  const [tab, setTab] = useState<Tab>("order");

  return (
    <div className="bg-kx-surface rounded-xl border kx-border overflow-hidden flex flex-col h-full">
      <div className="flex items-center border-b kx-border shrink-0">
        <TabBtn active={tab === "order"} onClick={() => setTab("order")}>
          Order
        </TabBtn>
        <TabBtn active={tab === "strategy"} onClick={() => setTab("strategy")}>
          Strategy
        </TabBtn>
        {/*<TabBtn active={tab === "trigger"} onClick={() => setTab("trigger")}>
          Trigger
        </TabBtn>
        <div className="ml-auto pr-3 text-[10px] font-mono text-on-surface-variant/70">
          {MARKET_NAME}
        </div>*/}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "order" && <OrderForm />}
        {tab === "strategy" && <StrategyForm />}
        {tab === "trigger" && <TriggerForm />}
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
      className={`px-4 py-2.5 text-xs font-headline uppercase tracking-wider transition-colors ${
        active
          ? "text-on-surface border-b-2 border-[#4dffb4] -mb-px"
          : "text-on-surface-variant/70 hover:text-on-surface"
      }`}
    >
      {children}
    </button>
  );
}
