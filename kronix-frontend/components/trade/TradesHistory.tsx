"use client";

export function TradesHistory() {
  return (
    <div className="px-1">
      <table className="w-full font-mono text-xs">
        <thead>
          <tr className="text-[10px] text-hl-muted uppercase tracking-wider text-left border-b border-hl">
            <th className="py-2 font-normal">Time</th>
            <th className="font-normal">Side</th>
            <th className="font-normal">Price</th>
            <th className="font-normal">Size</th>
            <th className="font-normal">Notional</th>
            <th className="font-normal">Fee</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td colSpan={6} className="py-10 text-center text-[11px] text-on-surface-variant/60">
              No trade history. Filled orders land here.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
