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
    <nav className="sticky top-0 z-30 bg-kx-base/90 backdrop-blur-xl border-b border-hl">
      <div className="px-3 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-headline font-bold uppercase tracking-tight text-on-surface"
          >
            <Image src="/logo.png" alt="Kronix" width={28} height={28} />
            KRONIX
          </Link>
          <span className="hidden sm:inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] border border-hl text-on-surface-variant">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4dffb4] animate-pulse" />
            {cluster}
          </span>
          <span className="hidden md:inline-flex items-center px-2 py-1 rounded text-[10px] font-mono uppercase tracking-wider bg-white/[0.04] border border-hl text-on-surface-variant">
            {MARKET_NAME}
          </span>
        </div>
        <WalletMultiButton
          style={{
            background: "rgba(77, 255, 180, 0.10)",
            color: "#4DFFB4",
            fontFamily: "Manrope, sans-serif",
            fontWeight: 700,
            fontSize: 12,
            height: 34,
            borderRadius: 6,
            border: "1px solid rgba(77, 255, 180, 0.25)",
          }}
        />
      </div>
    </nav>
  );
}
