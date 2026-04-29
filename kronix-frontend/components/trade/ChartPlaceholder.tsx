"use client";

export function ChartPlaceholder() {
  return (
    <div className="bg-hl-panel border border-hl flex-1 flex items-center justify-center min-h-[420px]">
      <div className="flex flex-col items-center gap-2 text-hl-muted">
        <div className="text-xs uppercase tracking-widest">Chart</div>
        <div className="text-sm font-mono">TradingView</div>
      </div>
    </div>
  );
}
