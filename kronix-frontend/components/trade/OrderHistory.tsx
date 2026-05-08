"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  fetchRecentTrades,
  type RecentTrade,
} from "@/lib/kronix/recent-trades";
import { findMarketConfigPda } from "@/lib/kronix/pdas";
import { fetchMarketConfig } from "@/lib/kronix/state";
import {
  formatPriceLots,
  formatSizeLots,
  formatUsdcNative,
  notionalNative,
  type LotConfig,
} from "@/lib/kronix/lot-math";
import { useStore } from "@/lib/store";

const SLOT_MS = 400;

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
  const marketIndex = useStore((s) => s.selectedMarketIndex);
  const [rows, setRows] = useState<Row[]>([]);
  const [currentSlot, setCurrentSlot] = useState<bigint>(0n);
  const [err, setErr] = useState<string | null>(null);
  const [cfg, setCfg] = useState<LotConfig | null>(null);

  useEffect(() => {
    const [cfgPda] = findMarketConfigPda(marketIndex);
    fetchMarketConfig(connection, cfgPda)
      .then((c) => {
        if (c) setCfg({ baseLotSize: c.baseLotSize, quoteLotSize: c.quoteLotSize });
      })
      .catch(() => null);
  }, [connection, marketIndex]);

  const refresh = useCallback(async () => {
    if (!owner) {
      setRows([]);
      return;
    }
    try {
      const [trades, slot] = await Promise.all([
        fetchRecentTrades(connection, 200, marketIndex),
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
  }, [connection, owner, marketIndex]);

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
              const now = Date.now();
              const ageMs =
                currentSlot > 0n && r.slot > 0n && currentSlot > r.slot
                  ? Number(currentSlot - r.slot) * SLOT_MS
                  : 0;
              const wallTime = now - ageMs;
              const timeStr =
                ageMs > 0
                  ? new Date(wallTime).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })
                  : "—";
              const sideColor =
                r.side === "BUY" ? "text-[#4dffb4]" : "text-[#ff6b6b]";
              return (
                <tr key={r.key} className="border-t kx-border">
                  <td className={`py-1.5 ${sideColor} font-bold`}>{r.side}</td>
                  <td className="py-1.5 text-on-surface-variant">{r.role}</td>
                  <td className="py-1.5 text-right text-on-surface">
                    {cfg ? formatPriceLots(r.priceLots, cfg) : r.priceLots.toString()}
                  </td>
                  <td className="py-1.5 text-right text-on-surface">
                    {cfg ? formatSizeLots(r.qty, cfg) : r.qty.toString()}
                  </td>
                  <td className="py-1.5 text-right text-on-surface-variant">
                    {cfg
                      ? formatUsdcNative(notionalNative(r.qty, r.priceLots, cfg))
                      : (r.priceLots * r.qty).toString()}
                  </td>
                  <td className="py-1.5 text-right text-on-surface-variant">
                    {timeStr}
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
