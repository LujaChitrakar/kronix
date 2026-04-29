"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { findMarketPda } from "@/lib/kronix/pdas";
import { MARKET_INDEX } from "@/lib/kronix/config";
import { scanBook, type BookSnapshot, type BookOrder } from "@/lib/kronix/book-scan";

type Level = {
  priceLots: bigint;
  qty: bigint;
  mine: bigint;
};

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

  const aggregate = (orders: BookOrder[]): Level[] => {
    const m = new Map<string, Level>();
    const ownerMine = wallet.publicKey?.toBase58();
    for (const o of orders) {
      const k = o.priceLots.toString();
      const cur = m.get(k) ?? { priceLots: o.priceLots, qty: 0n, mine: 0n };
      cur.qty += o.quantity;
      if (ownerMine && o.owner.toBase58() === ownerMine) cur.mine += o.quantity;
      m.set(k, cur);
    }
    return Array.from(m.values());
  };

  const askLevels = snap ? aggregate(snap.asks).slice(0, 12) : [];
  const bidLevels = snap ? aggregate(snap.bids).slice(0, 12) : [];

  // Per-row depth bars: width scales by this level's qty relative to the
  // largest single-level qty across both sides. Cumulative still shown in
  // Total column for context.
  let askCum = 0n;
  const asksRows = askLevels.map((l) => {
    askCum += l.qty;
    return { ...l, cum: askCum };
  });
  let bidCum = 0n;
  const bidsRows = bidLevels.map((l) => {
    bidCum += l.qty;
    return { ...l, cum: bidCum };
  });
  const maxQty = (() => {
    let m = 0n;
    for (const r of asksRows) if (r.qty > m) m = r.qty;
    for (const r of bidsRows) if (r.qty > m) m = r.qty;
    return m;
  })();

  const bestBid = snap?.bids[0]?.priceLots;
  const bestAsk = snap?.asks[0]?.priceLots;
  const spread =
    bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : null;
  const mid =
    bestBid !== undefined && bestAsk !== undefined
      ? (bestBid + bestAsk) / 2n
      : null;

  const pct = (qty: bigint) => {
    if (maxQty === 0n) return 0;
    return Number((qty * 1000n) / maxQty) / 10;
  };

  return (
    <div>
      {err && (
        <div className="text-[11px] font-mono text-hl-sell px-2 py-2 break-all">
          {err}
        </div>
      )}

      <div className="grid grid-cols-3 px-2 py-1.5 text-[10px] font-mono uppercase text-hl-muted tracking-wider">
        <div className="text-left">Price</div>
        <div className="text-right">Size</div>
        <div className="text-right">Total</div>
      </div>

      <div className="font-mono text-[11px]">
        {asksRows
          .slice()
          .reverse()
          .map((l) => (
            <div
              key={`a${l.priceLots}`}
              className="relative grid grid-cols-3 px-2 py-[2px] text-hl-sell hover:bg-white/[0.02]"
            >
              <div
                className="absolute right-0 top-0 bottom-0 bg-[#ff6b6b]/15 pointer-events-none"
                style={{ width: `${pct(l.qty)}%` }}
              />
              <div className="relative">{String(l.priceLots)}</div>
              <div className="relative text-right">{String(l.qty)}</div>
              <div className="relative text-right text-hl-fg/70">
                {String(l.cum)}
              </div>
            </div>
          ))}

        <div className="grid grid-cols-3 px-2 py-1.5 text-[10px] border-y border-hl bg-white/[0.02] my-0.5">
          <div className="text-hl-fg font-bold">
            {mid !== null ? String(mid) : "—"}
          </div>
          <div className="text-right text-hl-muted uppercase tracking-wider">
            spread
          </div>
          <div className="text-right text-hl-fg/70">
            {spread !== null ? String(spread) : "—"}
          </div>
        </div>

        {bidsRows.map((l) => (
          <div
            key={`b${l.priceLots}`}
            className="relative grid grid-cols-3 px-2 py-[2px] text-hl-buy hover:bg-white/[0.02]"
          >
            <div
              className="absolute right-0 top-0 bottom-0 bg-[#4dffb4]/15 pointer-events-none"
              style={{ width: `${pct(l.qty)}%` }}
            />
            <div className="relative">{String(l.priceLots)}</div>
            <div className="relative text-right">{String(l.qty)}</div>
            <div className="relative text-right text-hl-fg/70">
              {String(l.cum)}
            </div>
          </div>
        ))}
      </div>

      {snap && snap.bids.length === 0 && snap.asks.length === 0 && (
        <div className="text-[11px] font-mono text-on-surface-variant/70 py-4 text-center">
          Empty book.
        </div>
      )}
    </div>
  );
}
