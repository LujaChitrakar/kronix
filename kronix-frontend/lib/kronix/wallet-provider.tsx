"use client";

import { ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";

import "@solana/wallet-adapter-react-ui/styles.css";

function getBrowserRpcEndpoint(): string {
  const configured = process.env.NEXT_PUBLIC_RPC_PROXY_URL?.trim();
  if (configured) return configured;

  if (typeof window !== "undefined") {
    return new URL("/api/rpc", window.location.origin).toString();
  }

  return "http://localhost:3000/api/rpc";
}

export function KronixWalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );
  const endpoint = useMemo(() => getBrowserRpcEndpoint(), []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
