"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  fetchRecentTrades,
  type RecentTrade,
} from "@/lib/kronix/recent-trades";

const SLOT_MS = 400;

function fmtAge(ms: number): string {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

type Row = {
  side: "BUY" | "SELL";
  role: "TAKER" | "MAKER";
  priceLots: bigint;
  qty: bigint;
  slot: bigint;
  key: string;
};

export function OrderHistory() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;
  const [rows, setRows] = useState<Row[]>([]);
  const [currentSlot, setCurrentSlot] = useState<bigint>(0n);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!owner) {
      setRows([]);
      return;
    }
    try {
      const [trades, slot] = await Promise.all([
        fetchRecentTrades(connection, 200),
        connection.getSlot("confirmed"),
      ]);
      const filtered: Row[] = [];
      for (const t of trades as RecentTrade[]) {
        const isTaker = t.taker.equals(owner);
        const isMaker = t.maker.equals(owner);
        if (!isTaker && !isMaker) continue;
        // taker_side 0 = bid; maker side opposite
        const takerBuy = t.takerSide === 0;
        const youBuy = isTaker ? takerBuy : !takerBuy;
        filtered.push({
          side: youBuy ? "BUY" : "SELL",
          role: isTaker ? "TAKER" : "MAKER",
          priceLots: t.priceLots,
          qty: t.quantity,
          slot: t.slot,
          key: `${t.slot}-${t.takerClientId}-${t.makerClientId}-${isTaker ? "t" : "m"}`,
        });
      }
      setRows(filtered.slice(0, 60));
      setCurrentSlot(BigInt(slot));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [connection, owner]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!owner) {
    return (
      <div className="p-4 text-on-surface-variant text-sm">
        Connect wallet.
      </div>
    );
  }

  return (
    <div className="p-4">
      {err && (
        <div className="text-[11px] font-mono text-[#ff6b6b] mb-2 break-all">
          {err}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="text-on-surface-variant text-sm">No fill history.</div>
      ) : (
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="text-[10px] text-on-surface-variant/70 uppercase">
              <th className="text-left py-1">Side</th>
              <th className="text-left py-1">Role</th>
              <th className="text-right py-1">Price</th>
              <th className="text-right py-1">Size</th>
              <th className="text-right py-1">Total</th>
              <th className="text-right py-1">Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ageMs =
                currentSlot > 0n && r.slot > 0n && currentSlot > r.slot
                  ? Number(currentSlot - r.slot) * SLOT_MS
                  : 0;
              const sideColor =
                r.side === "BUY" ? "text-[#4dffb4]" : "text-[#ff6b6b]";
              return (
                <tr key={r.key} className="border-t kx-border">
                  <td className={`py-1.5 ${sideColor} font-bold`}>{r.side}</td>
                  <td className="py-1.5 text-on-surface-variant">{r.role}</td>
                  <td className="py-1.5 text-right text-on-surface">
                    {r.priceLots.toString()}
                  </td>
                  <td className="py-1.5 text-right text-on-surface">
                    {r.qty.toString()}
                  </td>
                  <td className="py-1.5 text-right text-on-surface-variant">
                    {(r.priceLots * r.qty).toString()}
                  </td>
                  <td className="py-1.5 text-right text-on-surface-variant">
                    {ageMs > 0 ? fmtAge(ageMs) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
