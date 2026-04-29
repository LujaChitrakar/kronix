"use client";

import { useState, type ReactNode } from "react";
import { AccountPanel } from "./AccountPanel";
import { PositionPanel } from "./PositionPanel";
import { OpenOrders } from "./OpenOrders";
import { TriggerOrders } from "./TriggerOrders";
import { Strategies } from "./Strategies";
import { TradesHistory } from "./TradesHistory";
import { OrderHistory } from "./OrderHistory";

type TabId =
  | "account"
  | "positions"
  | "open"
  | "strategies"
  | "triggers"
  | "trades"
  | "orders";

const TABS: [TabId, string][] = [
  ["account", "Account"],
  ["positions", "Positions"],
  ["open", "Open Orders"],
  ["strategies", "Strategy Orders"],
  ["triggers", "Trigger Orders"],
  ["trades", "Trades History"],
  ["orders", "Order History"],
];

export function BottomTabs() {
  const [active, setActive] = useState<TabId>("positions");

  let body: ReactNode = null;
  if (active === "account") body = <AccountPanel />;
  else if (active === "positions") body = <PositionPanel />;
  else if (active === "open") body = <OpenOrders />;
  else if (active === "strategies") body = <Strategies />;
  else if (active === "triggers") body = <TriggerOrders />;
  else if (active === "trades") body = <TradesHistory />;
  else body = <OrderHistory />;

  return (
    <div className="flex flex-col">
      <div className="flex border-b border-hl overflow-x-auto kx-scroll">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActive(id)}
            className={`px-4 py-3 text-[11px] font-mono uppercase tracking-wider whitespace-nowrap transition ${
              active === id ? "hl-tab-active" : "hl-tab-inactive"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="p-3 min-h-[180px]">{body}</div>
    </div>
  );
}
