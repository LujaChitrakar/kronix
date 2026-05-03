"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { MARKET_NAME, RPC_URL } from "@/lib/kronix/config";

export function TradeNav() {
  const wallet = useWallet();
  const [mounted, setMounted] = useState(false);
  const [usdcBusy, setUsdcBusy] = useState(false);
  const [usdcMsg, setUsdcMsg] = useState("");
  useEffect(() => {
    setMounted(true);
  }, []);

  const requestUsdc = async () => {
    if (!wallet.publicKey || usdcBusy) return;
    setUsdcBusy(true);
    setUsdcMsg("");
    try {
      const res = await fetch("/api/faucet-usdc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: wallet.publicKey.toBase58() }),
      });
      const json = (await res.json()) as { signature?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "USDC faucet failed");
      setUsdcMsg(`Sent ${json.signature?.slice(0, 8)}…`);
    } catch (e) {
      setUsdcMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setUsdcBusy(false);
    }
  };

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
        {/*<div className="hidden sm:flex items-center gap-2 font-mono text-xs text-on-surface-variant">
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
        </div>*/}
        <div className="flex items-center gap-2">
          {usdcMsg && (
            <span
              className={`hidden md:inline max-w-64 truncate font-mono text-[11px] ${
                usdcMsg.startsWith("Sent") ? "text-[#4DFFB4]" : "text-[#ff6b6b]"
              }`}
              title={usdcMsg}
            >
              {usdcMsg}
            </span>
          )}
          <button
            type="button"
            disabled={!wallet.publicKey || usdcBusy}
            onClick={requestUsdc}
            title={usdcMsg || (!wallet.publicKey ? "Connect wallet first" : "Transfer 1000 devnet USDC")}
            className="px-3 h-9 inline-flex items-center rounded-md bg-kx-surface-hi border kx-border text-xs font-bold text-on-surface hover:text-[#4DFFB4] disabled:opacity-50 disabled:hover:text-on-surface transition-colors"
          >
            {usdcBusy ? "Sending…" : "Get USDC devnet"}
          </button>
          <a
            href="https://faucet.solana.com"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 h-9 inline-flex items-center rounded-md bg-kx-surface-hi border kx-border text-xs font-bold text-on-surface hover:text-[#4DFFB4] transition-colors"
          >
            Get SOL devnet
          </a>
          {mounted && (
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
          )}
        </div>
      </div>
    </nav>
  );
}
