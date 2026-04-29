"use client";

import { useState } from "react";
import { AccountPanel } from "./AccountPanel";
import { PositionPanel } from "./PositionPanel";
import { OpenOrders } from "./OpenOrders";
import { TriggerOrders } from "./TriggerOrders";
import { Strategies } from "./Strategies";
import { OrderHistory } from "./OrderHistory";

type Tab =
  | "account"
  | "position"
  | "open"
  | "trigger"
  | "strategy"
  | "history";

const TABS: { id: Tab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "position", label: "Position" },
  { id: "open", label: "Open Orders" },
  { id: "trigger", label: "Trigger Orders" },
  { id: "strategy", label: "Strategy Orders" },
  { id: "history", label: "Order History" },
];

export function BottomPanel() {
  const [tab, setTab] = useState<Tab>("account");

  return (
    <div className="bg-kx-surface rounded-xl border kx-border overflow-hidden flex flex-col min-h-[300px]">
      <div className="flex items-center border-b kx-border shrink-0 overflow-x-auto">
        {TABS.map((t) => (
          <TabBtn
            key={t.id}
            active={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </TabBtn>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {tab === "account" && <AccountPanel />}
        {tab === "position" && <PositionPanel />}
        {tab === "open" && <OpenOrders />}
        {tab === "trigger" && <TriggerOrders />}
        {tab === "strategy" && <Strategies />}
        {tab === "history" && <OrderHistory />}
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
      className={`px-4 py-2.5 text-xs font-headline uppercase tracking-wider whitespace-nowrap transition-colors ${
        active
          ? "text-on-surface border-b-2 border-[#4dffb4] -mb-px"
          : "text-on-surface-variant/70 hover:text-on-surface"
      }`}
    >
      {children}
    </button>
  );
}
