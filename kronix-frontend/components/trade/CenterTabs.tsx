"use client";

import { useState, type ReactNode } from "react";
import { Orderbook } from "./Orderbook";
import { RecentTrades } from "./RecentTrades";

type TabId = "book" | "trades";

const TABS: [TabId, string][] = [
  ["book", "Order Book"],
  ["trades", "Trades"],
];

export function CenterTabs() {
  const [active, setActive] = useState<TabId>("book");

  let body: ReactNode = null;
  if (active === "book") body = <Orderbook />;
  else body = <RecentTrades />;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex border-b border-hl">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActive(id)}
            className={`px-4 py-3 text-[11px] font-mono uppercase tracking-wider transition ${
              active === id ? "hl-tab-active" : "hl-tab-inactive"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto kx-scroll p-2">{body}</div>
    </div>
  );
}
