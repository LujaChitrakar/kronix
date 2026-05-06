"use client";

import ChartWrapper from "@/components/ChartWrapper";
import { useStore } from "@/lib/store";

export function TradeChartPanel() {
  const selectedSymbol = useStore((s) => s.selectedSymbol);

  return (
    <div className="kx-panel h-[520px] overflow-hidden lg:h-[650px]">
      <div className="flex h-10 items-center justify-between border-b kx-border px-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#4dffb4] shadow-[0_0_14px_rgba(77,255,180,0.65)]" />
          <span className="font-headline text-xs font-extrabold uppercase tracking-[0.18em] text-white">
            Live Market
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant">
          {selectedSymbol} / USDC
        </span>
      </div>
      <div className="h-[calc(100%-2.5rem)]">
        <ChartWrapper symbol={selectedSymbol} />
      </div>
    </div>
  );
}
