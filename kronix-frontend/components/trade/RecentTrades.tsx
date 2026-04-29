"use client";

export function RecentTrades() {
  return (
    <div>
      <div className="grid grid-cols-3 px-2 py-1.5 text-[10px] font-mono uppercase text-hl-muted tracking-wider">
        <div className="text-left">Price</div>
        <div className="text-right">Size</div>
        <div className="text-right">Time</div>
      </div>
      <div className="py-10 text-center text-[11px] font-mono text-on-surface-variant/60">
        No recent trades.
        <div className="mt-1 text-[10px] text-on-surface-variant/40">
          Fills land here once taker activity hits the book.
        </div>
      </div>
    </div>
  );
}
