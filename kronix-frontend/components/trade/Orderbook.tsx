"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { findMarketPda } from "@/lib/kronix/pdas";
import { MARKET_INDEX } from "@/lib/kronix/config";
import { scanBook, type BookSnapshot, type BookOrder } from "@/lib/kronix/book-scan";

function shortPk(pk: string): string {
  return `${pk.slice(0, 4)}…${pk.slice(-4)}`;
}

export function Orderbook() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [snap, setSnap] = useState<BookSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [market] = findMarketPda(MARKET_INDEX);
      const s = await scanBook(connection, market);
      setSnap(s);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [connection]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  // Aggregate same-price levels for cleaner display.
  const levels = (orders: BookOrder[]) => {
    const m = new Map<
      string,
      { priceLots: bigint; qty: bigint; mine: bigint; owners: Set<string> }
    >();
    const ownerMine = wallet.publicKey?.toBase58();
    for (const o of orders) {
      const k = o.priceLots.toString();
      const cur =
        m.get(k) ?? {
          priceLots: o.priceLots,
          qty: 0n,
          mine: 0n,
          owners: new Set<string>(),
        };
      cur.qty += o.quantity;
      cur.owners.add(o.owner.toBase58());
      if (ownerMine && o.owner.toBase58() === ownerMine)
        cur.mine += o.quantity;
      m.set(k, cur);
    }
    return Array.from(m.values());
  };

  const askLevels = snap ? levels(snap.asks).slice(0, 12).reverse() : [];
  const bidLevels = snap ? levels(snap.bids).slice(0, 12) : [];

  const bestBid = snap?.bids[0]?.priceLots;
  const bestAsk = snap?.asks[0]?.priceLots;
  const spread =
    bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : null;

  return (
    <div className="bg-kx-surface rounded-xl border kx-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-headline text-sm text-on-surface uppercase tracking-wider">
          Order Book
        </div>
        <div className="text-[10px] font-mono text-on-surface-variant/70">
          {snap ? `bids+asks tree` : "…"}
        </div>
      </div>

      {err && (
        <div className="text-[11px] font-mono text-[#ff6b6b] mb-2 break-all">
          {err}
        </div>
      )}

      <table className="w-full font-mono text-xs">
        <thead>
          <tr className="text-[10px] text-on-surface-variant/70 uppercase">
            <th className="text-left pb-1">Price</th>
            <th className="text-right pb-1">Qty</th>
            <th className="text-right pb-1">Mine</th>
            <th className="text-right pb-1">Owners</th>
          </tr>
        </thead>
        <tbody>
          {askLevels.map((l) => (
            <tr key={`a${l.priceLots}`} className="text-[#ff6b6b]">
              <td>{String(l.priceLots)}</td>
              <td className="text-right">{String(l.qty)}</td>
              <td className="text-right">{l.mine === 0n ? "" : String(l.mine)}</td>
              <td className="text-right text-[10px] text-on-surface-variant">
                {Array.from(l.owners).map(shortPk).join(", ")}
              </td>
            </tr>
          ))}
          <tr className="border-y kx-border">
            <td colSpan={4} className="py-1 text-[10px] text-on-surface-variant text-center">
              spread: {spread !== null ? String(spread) : "—"}
            </td>
          </tr>
          {bidLevels.map((l) => (
            <tr key={`b${l.priceLots}`} className="text-[#4dffb4]">
              <td>{String(l.priceLots)}</td>
              <td className="text-right">{String(l.qty)}</td>
              <td className="text-right">{l.mine === 0n ? "" : String(l.mine)}</td>
              <td className="text-right text-[10px] text-on-surface-variant">
                {Array.from(l.owners).map(shortPk).join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {snap && snap.bids.length === 0 && snap.asks.length === 0 && (
        <div className="text-[11px] font-mono text-on-surface-variant/70 mt-2 text-center">
          Empty book.
        </div>
      )}
      <div className="mt-2 text-[9px] text-on-surface-variant/50">
        Decoded directly from BookSide critbit accounts. Qty = sum of leaf
        quantities at price level.
      </div>
    </div>
  );
}
