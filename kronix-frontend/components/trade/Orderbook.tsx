"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { findMarketPda, findFillsLogPda } from "@/lib/kronix/pdas";
import { MARKET_INDEX } from "@/lib/kronix/config";
import {
  scanBook,
  type BookSnapshot,
  type BookOrder,
} from "@/lib/kronix/book-scan";
import {
  fetchRecentTrades,
  type RecentTrade,
} from "@/lib/kronix/recent-trades";

type Tab = "book" | "trades";

type Level = {
  priceLots: bigint;
  qty: bigint;
  mine: bigint;
};

const SLOT_MS = 400;

const EXPLORER_CLUSTER =
  process.env.NEXT_PUBLIC_EXPLORER_CLUSTER ?? "devnet";

function explorerAddrUrl(addr: string): string {
  const q =
    EXPLORER_CLUSTER === "mainnet" || EXPLORER_CLUSTER === "mainnet-beta"
      ? ""
      : `?cluster=${EXPLORER_CLUSTER}`;
  return `https://explorer.solana.com/address/${addr}${q}`;
}

function aggregate(orders: BookOrder[], myKey: string | undefined): Level[] {
  const m = new Map<string, Level>();
  for (const o of orders) {
    const k = o.priceLots.toString();
    const cur = m.get(k) ?? { priceLots: o.priceLots, qty: 0n, mine: 0n };
    cur.qty += o.quantity;
    if (myKey && o.owner.toBase58() === myKey) cur.mine += o.quantity;
    m.set(k, cur);
  }
  return Array.from(m.values());
}

function fmtBigInt(n: bigint): string {
  return n.toString();
}

export function Orderbook() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [tab, setTab] = useState<Tab>("book");
  const [snap, setSnap] = useState<BookSnapshot | null>(null);
  const [trades, setTrades] = useState<RecentTrade[]>([]);
  const [currentSlot, setCurrentSlot] = useState<bigint>(0n);
  const [err, setErr] = useState<string | null>(null);

  const refreshBook = useCallback(async () => {
    try {
      const [market] = findMarketPda(MARKET_INDEX);
      const s = await scanBook(connection, market);
      setSnap(s);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [connection]);

  const refreshTrades = useCallback(async () => {
    try {
      const [t, slot] = await Promise.all([
        fetchRecentTrades(connection, 40),
        connection.getSlot("confirmed"),
      ]);
      setTrades(t);
      setCurrentSlot(BigInt(slot));
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [connection]);

  useEffect(() => {
    if (tab === "book") {
      refreshBook();
      const t = setInterval(refreshBook, 4000);
      return () => clearInterval(t);
    } else {
      refreshTrades();
      const t = setInterval(refreshTrades, 5000);
      return () => clearInterval(t);
    }
  }, [tab, refreshBook, refreshTrades]);

  const myKey = wallet.publicKey?.toBase58();

  const { askLevels, bidLevels, maxSize, spread, mid } = useMemo(() => {
    if (!snap) {
      return {
        askLevels: [] as Level[],
        bidLevels: [] as Level[],
        maxSize: 1n,
        spread: null as bigint | null,
        mid: null as bigint | null,
      };
    }
    const a = aggregate(snap.asks, myKey);
    const b = aggregate(snap.bids, myKey);
    a.sort((x, y) => (x.priceLots > y.priceLots ? 1 : -1));
    b.sort((x, y) => (x.priceLots > y.priceLots ? -1 : 1));
    const aTop = a.slice(0, 12);
    const bTop = b.slice(0, 12);
    let max = 1n;
    for (const l of aTop) if (l.qty > max) max = l.qty;
    for (const l of bTop) if (l.qty > max) max = l.qty;
    const bestBid = bTop[0]?.priceLots;
    const bestAsk = aTop[0]?.priceLots;
    const sp =
      bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : null;
    const md =
      bestBid !== undefined && bestAsk !== undefined
        ? (bestAsk + bestBid) / 2n
        : null;
    return {
      askLevels: aTop.reverse(), // top of book at bottom (closest to spread)
      bidLevels: bTop,
      maxSize: max,
      spread: sp,
      mid: md,
    };
  }, [snap, myKey]);

  // Show price/total in user-space units (matches what user enters in OrderForm).
  // Total = price * size (no quoteLotSize scaling) so price=100, size=10 → 1000.
  const priceDisplay = (priceLots: bigint): string => fmtBigInt(priceLots);

  const totalUsdc = (priceLots: bigint, qty: bigint): string =>
    fmtBigInt(priceLots * qty);

  return (
    <div className="bg-kx-surface rounded-xl border kx-border overflow-hidden flex flex-col h-[620px]">
      <div className="flex items-center border-b kx-border shrink-0">
        <TabBtn active={tab === "book"} onClick={() => setTab("book")}>
          Order Book
        </TabBtn>
        <TabBtn active={tab === "trades"} onClick={() => setTab("trades")}>
          Trades
        </TabBtn>
        <div className="ml-auto pr-3 text-[10px] font-mono text-on-surface-variant/70">
          {tab === "book"
            ? snap
              ? `${snap.bids.length}b / ${snap.asks.length}a`
              : "…"
            : `${trades.length} fills`}
        </div>
      </div>

      {err && (
        <div className="text-[11px] font-mono text-[#ff6b6b] px-3 py-2 break-all border-b kx-border shrink-0">
          {err}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "book" ? (
          <BookView
            askLevels={askLevels}
            bidLevels={bidLevels}
            maxSize={maxSize}
            spread={spread}
            mid={mid}
            priceUsdc={priceDisplay}
            totalUsdc={totalUsdc}
            isEmpty={!!snap && snap.bids.length === 0 && snap.asks.length === 0}
          />
        ) : (
          <TradesView
            trades={trades}
            currentSlot={currentSlot}
            priceUsdc={priceDisplay}
          />
        )}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-xs font-headline uppercase tracking-wider transition-colors ${
        active
          ? "text-on-surface border-b-2 border-[#4dffb4] -mb-px"
          : "text-on-surface-variant/70 hover:text-on-surface"
      }`}
    >
      {children}
    </button>
  );
}

function BookView({
  askLevels,
  bidLevels,
  maxSize,
  spread,
  mid,
  priceUsdc,
  totalUsdc,
  isEmpty,
}: {
  askLevels: Level[];
  bidLevels: Level[];
  maxSize: bigint;
  spread: bigint | null;
  mid: bigint | null;
  priceUsdc: (p: bigint) => string;
  totalUsdc: (p: bigint, q: bigint) => string;
  isEmpty: boolean;
}) {
  return (
    <div className="px-2 py-2 h-full flex flex-col">
      <div className="grid grid-cols-3 px-2 pb-1 text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wide shrink-0">
        <div className="text-left">Price</div>
        <div className="text-right">Size</div>
        <div className="text-right">Total (USDC)</div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        <div className="flex flex-col flex-1 justify-end">
          {askLevels.map((l) => (
            <DepthRow
              key={`a${l.priceLots}`}
              level={l}
              maxSize={maxSize}
              side="ask"
              priceUsdc={priceUsdc}
              totalUsdc={totalUsdc}
            />
          ))}
        </div>

        <div className="flex items-center gap-2 px-2 py-1.5 my-1 border-y kx-border bg-kx-surface-lo/40 shrink-0">
          <div className="font-mono text-sm text-on-surface">
            {mid !== null ? priceUsdc(mid) : "—"}
          </div>
          <div className="text-[10px] font-mono text-on-surface-variant/70">
            mid · spread {spread !== null ? String(spread) : "—"}
          </div>
        </div>

        <div className="flex flex-col flex-1">
          {bidLevels.map((l) => (
            <DepthRow
              key={`b${l.priceLots}`}
              level={l}
              maxSize={maxSize}
              side="bid"
              priceUsdc={priceUsdc}
              totalUsdc={totalUsdc}
            />
          ))}
        </div>
      </div>

      {isEmpty && (
        <div className="text-[11px] font-mono text-on-surface-variant/70 mt-2 text-center py-4">
          Empty book.
        </div>
      )}
    </div>
  );
}

function DepthRow({
  level,
  maxSize,
  side,
  priceUsdc,
  totalUsdc,
}: {
  level: Level;
  maxSize: bigint;
  side: "bid" | "ask";
  priceUsdc: (p: bigint) => string;
  totalUsdc: (p: bigint, q: bigint) => string;
}) {
  // Width % proportional to qty / maxSize. Bigint → number for %.
  const pct = maxSize > 0n
    ? Number((level.qty * 1000n) / maxSize) / 10
    : 0;
  const fillColor = side === "bid" ? "bg-[#4dffb4]/15" : "bg-[#ff6b6b]/15";
  const textColor = side === "bid" ? "text-[#4dffb4]" : "text-[#ff6b6b]";

  return (
    <div className="relative grid grid-cols-3 items-center px-2 py-[3px] font-mono text-xs hover:bg-kx-surface-lo/50 cursor-default">
      <div
        className={`absolute inset-y-0 right-0 ${fillColor} pointer-events-none`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
      <div className={`relative text-left ${textColor}`}>
        {priceUsdc(level.priceLots)}
      </div>
      <div className="relative text-right text-on-surface">
        {level.qty.toString()}
        {level.mine > 0n && (
          <span className="ml-1 text-[9px] text-[#ffd166]">
            ({level.mine.toString()})
          </span>
        )}
      </div>
      <div className="relative text-right text-on-surface-variant">
        {totalUsdc(level.priceLots, level.qty)}
      </div>
    </div>
  );
}

function TradesView({
  trades,
  currentSlot,
  priceUsdc,
}: {
  trades: RecentTrade[];
  currentSlot: bigint;
  priceUsdc: (p: bigint) => string;
}) {
  const now = Date.now();
  return (
    <div className="px-2 py-2 h-full flex flex-col">
      <div className="grid grid-cols-3 px-2 pb-1 text-[10px] font-mono text-on-surface-variant/60 uppercase tracking-wide shrink-0">
        <div className="text-left">Price</div>
        <div className="text-right">Size</div>
        <div className="text-right">Time</div>
      </div>

      {trades.length === 0 ? (
        <div className="text-[11px] font-mono text-on-surface-variant/70 text-center py-6">
          No recent trades.
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
          {trades.map((t, i) => {
            const isBuy = t.takerSide === 0;
            const color = isBuy ? "text-[#4dffb4]" : "text-[#ff6b6b]";
            let ageMs = 0;
            if (currentSlot > 0n && t.slot > 0n) {
              const slotsAgo = currentSlot > t.slot ? currentSlot - t.slot : 0n;
              ageMs = Number(slotsAgo) * SLOT_MS;
            }
            const wallTime = now - ageMs;
            const timeStr = new Date(wallTime).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
              hour12: false,
            });
            const [logPda] = findFillsLogPda(t.taker, t.takerClientId);
            const url = explorerAddrUrl(logPda.toBase58());
            return (
              <div
                key={`${t.slot}-${t.takerClientId}-${t.makerClientId}-${i}`}
                className="grid grid-cols-3 px-2 py-[3px] font-mono text-xs hover:bg-kx-surface-lo/50 items-center"
              >
                <div className={`text-left ${color}`}>
                  {priceUsdc(t.priceLots)}
                </div>
                <div className="text-right text-on-surface">
                  {t.quantity.toString()}
                </div>
                <div className="flex items-center gap-1 justify-end text-on-surface-variant">
                  <span>{timeStr}</span>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in Solana Explorer"
                    className="text-on-surface-variant/60 hover:text-[#4dffb4] transition-colors"
                  >
                    <ExternalIcon />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}
