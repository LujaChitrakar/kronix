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
      <div className="w-full px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-headline font-bold uppercase tracking-tight text-on-surface">
          <Image src="/logo.png" alt="Kronix" width={32} height={32} />
          KRONIX
        </Link>
        <div className="hidden sm:flex items-center gap-2 font-mono text-xs text-on-surface-variant">
          <span className="px-2.5 py-1 rounded-md bg-kx-surface-hi border kx-border font-bold text-on-surface">
            {MARKET_NAME}
          </span>
          <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-kx-surface-hi border kx-border text-[#4dffb4]">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-[#4dffb4] opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#4dffb4]" />
            </span>
            {cluster}
          </span>
        </div>
        <WalletMultiButton style={{
          background: "#222F2B",
          color: "#4DFFB4",
          fontFamily: "Manrope, sans-serif",
          fontWeight: 700,
          fontSize: 12,
          height: 36,
          borderRadius: 8,
          border: "1px solid rgba(77, 255, 180, 0.25)",
        }} />
      </div>
    </nav>
  );
}
