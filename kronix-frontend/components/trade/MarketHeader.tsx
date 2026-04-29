"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { findMarketConfigPda, findFundingStatePda } from "@/lib/kronix/pdas";
import { fetchMarketConfig, bytesToPubkey } from "@/lib/kronix/state";
import { MARKET_INDEX, MARKET_NAME } from "@/lib/kronix/config";

function fmtPrice(n: bigint, decimals = 6): string {
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const div = 10n ** BigInt(decimals);
  const whole = abs / div;
  const frac = (abs % div).toString().padStart(decimals, "0").slice(0, 2);
  return `${sign}${whole}.${frac}`;
}

const PRICE_HISTORY_KEY = "kronix:priceHistory";
type PricePoint = { t: number; p: string };

export function MarketHeader() {
  const { connection } = useConnection();
  const [markPrice, setMarkPrice] = useState<bigint | null>(null);
  const [oraclePrice, setOraclePrice] = useState<bigint | null>(null);
  const [change24h, setChange24h] = useState<number | null>(null);
  const [funding, setFunding] = useState<{
    cumulativeIndex: bigint;
    lastUpdate: bigint;
  } | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const historyRef = useRef<PricePoint[]>([]);

  // Load 24h price ring buffer from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRICE_HISTORY_KEY);
      if (raw) historyRef.current = JSON.parse(raw) as PricePoint[];
    } catch {}
  }, []);

  const refresh = useCallback(async () => {
    const [cfgPda] = findMarketConfigPda(MARKET_INDEX);
    const [fundingPda] = findFundingStatePda(MARKET_INDEX);
    const cfg = await fetchMarketConfig(connection, cfgPda);
    if (!cfg) return;
    const oraclePk = bytesToPubkey(cfg.oracle);
    const oracleAcc = await connection.getAccountInfo(oraclePk, "confirmed");
    if (oracleAcc && oracleAcc.data.length >= 134) {
      const buf = oracleAcc.data;
      const rawPrice = buf.readBigInt64LE(73);
      const exponent = buf.readInt32LE(89);
      const scaleExp = 6 + exponent;
      const normalized =
        scaleExp >= 0
          ? rawPrice * 10n ** BigInt(scaleExp)
          : rawPrice / 10n ** BigInt(-scaleExp);
      setOraclePrice(normalized);
      setMarkPrice(normalized);

      // Append to ring buffer + compute 24h change.
      const t = Math.floor(Date.now() / 1000);
      const cutoff = t - 86400;
      const arr = historyRef.current.filter((x) => x.t >= cutoff);
      arr.push({ t, p: normalized.toString() });
      historyRef.current = arr;
      try {
        localStorage.setItem(PRICE_HISTORY_KEY, JSON.stringify(arr));
      } catch {}
      const oldest = arr[0];
      if (oldest && t - oldest.t > 1800) {
        const a = Number(BigInt(oldest.p));
        const b = Number(normalized);
        if (a > 0) setChange24h(((b - a) / a) * 100);
      }
    }
    const fundingAcc = await connection.getAccountInfo(fundingPda, "confirmed");
    if (fundingAcc && fundingAcc.data.length >= 32) {
      const buf = fundingAcc.data;
      setFunding({
        cumulativeIndex: buf.readBigInt64LE(0),
        lastUpdate: buf.readBigInt64LE(8),
      });
    }
  }, [connection]);

  useEffect(() => {
    refresh().catch(() => null);
    const t = setInterval(() => refresh().catch(() => null), 4000);
    const c = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [refresh]);

  const countdown = (() => {
    if (!funding) return "—";
    const last = Number(funding.lastUpdate);
    const remaining = Math.max(0, 3600 - (now - last));
    const h = Math.floor(remaining / 3600);
    const m = Math.floor((remaining % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const s = (remaining % 60).toString().padStart(2, "0");
    return `${h.toString().padStart(2, "0")}:${m}:${s}`;
  })();

  const fundingRateBps = (() => {
    if (!funding) return null;
    return Number(funding.cumulativeIndex) / 1e6;
  })();

  return (
    <div className="bg-hl-panel border border-hl rounded-md px-3 py-2 flex items-stretch gap-0 overflow-x-auto kx-scroll">
      <button className="flex items-center gap-2 px-3 mr-2 rounded hover:bg-white/[0.04] transition whitespace-nowrap">
        <span className="w-2 h-2 rounded-full bg-[#4dffb4] animate-pulse" />
        <div className="flex flex-col items-start leading-tight">
          <span className="text-hl-fg font-headline text-sm font-bold">
            {MARKET_NAME}
          </span>
          <span className="text-hl-muted text-[9px] uppercase tracking-wider">
            Perpetual
          </span>
        </div>
        <svg
          width="10"
          height="10"
          viewBox="0 0 12 12"
          className="ml-1 text-hl-muted"
        >
          <path
            d="M2.5 4.5L6 8L9.5 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
      </button>
      <div className="flex items-center gap-6 px-2 border-l border-hl">
        <Cell
          label="Mark"
          v={markPrice !== null ? `$${fmtPrice(markPrice)}` : "—"}
          accent
        />
        <Cell
          label="Oracle"
          v={oraclePrice !== null ? `$${fmtPrice(oraclePrice)}` : "—"}
        />
        <Cell
          label="24h Change"
          v={
            change24h !== null
              ? `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`
              : "—"
          }
          tone={
            change24h === null ? "neutral" : change24h >= 0 ? "buy" : "sell"
          }
        />
        <Cell label="24h Volume" v="—" />
        <Cell label="Open Interest" v="—" />
        <Cell
          label="Funding / Countdown"
          v={
            fundingRateBps !== null
              ? `${fundingRateBps.toFixed(4)}% · ${countdown}`
              : countdown
          }
        />
      </div>
    </div>
  );
}

function Cell({
  label,
  v,
  tone = "neutral",
  accent = false,
}: {
  label: string;
  v: string;
  tone?: "buy" | "sell" | "neutral";
  accent?: boolean;
}) {
  const color =
    tone === "buy"
      ? "text-hl-buy"
      : tone === "sell"
        ? "text-hl-sell"
        : accent
          ? "text-hl-fg"
          : "text-hl-fg";
  return (
    <div className="flex flex-col leading-tight whitespace-nowrap">
      <span className="text-[10px] uppercase text-hl-muted tracking-wider">
        {label}
      </span>
      <span className={`text-sm font-mono ${color}`}>{v}</span>
    </div>
  );
}
