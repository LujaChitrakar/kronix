"use client";

import { useState, type ReactNode } from "react";
import { OrderForm } from "./OrderForm";
import { StrategyForm } from "./StrategyForm";
import { TriggerForm } from "./TriggerForm";

type TabId = "order" | "strategy" | "trigger";

const TABS: [TabId, string][] = [
  ["order", "Order"],
  ["strategy", "Strategy"],
  ["trigger", "Trigger"],
];

export function RightTabs() {
  const [active, setActive] = useState<TabId>("order");

  let body: ReactNode = null;
  if (active === "order") body = <OrderForm />;
  else if (active === "strategy") body = <StrategyForm />;
  else body = <TriggerForm />;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex border-b border-hl">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActive(id)}
            className={`flex-1 px-3 py-3 text-[11px] font-mono uppercase tracking-wider transition ${
              active === id ? "hl-tab-active" : "hl-tab-inactive"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto kx-scroll p-3">{body}</div>
    </div>
  );
}
