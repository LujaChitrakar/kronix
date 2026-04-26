"use client";

import Link from "next/link";
import Image from "next/image";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { MARKET_NAME, RPC_URL } from "@/lib/kronix/config";

export function TradeNav() {
  const cluster = RPC_URL.includes("devnet")
    ? "Devnet"
    : RPC_URL.includes("mainnet")
      ? "Mainnet"
      : "Custom";
  return (
    <nav className="sticky top-0 z-30 bg-[#0B0F0D]/85 backdrop-blur-xl border-b kx-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center text-sm font-headline font-bold uppercase tracking-tight text-on-surface">
          <Image src="/logo.png" alt="Kronix" width={36} height={36} />
          KRONIX
        </Link>
        <div className="hidden sm:flex items-center gap-3 font-mono text-xs text-on-surface-variant">
          <span className="px-2 py-1 rounded-md bg-kx-surface-hi border kx-border">
            {MARKET_NAME}
          </span>
          <span className="px-2 py-1 rounded-md bg-kx-surface-hi border kx-border text-[#4dffb4]">
            {cluster}
          </span>
        </div>
        <WalletMultiButton style={{
          background: "#222F2B",
          color: "#4DFFB4",
          fontFamily: "Manrope, sans-serif",
          fontWeight: 700,
          fontSize: 13,
          height: 38,
          borderRadius: 8,
          border: "1px solid rgba(77, 255, 180, 0.2)",
        }} />
      </div>
    </nav>
  );
}
