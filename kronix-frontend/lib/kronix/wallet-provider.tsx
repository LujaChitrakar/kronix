"use client";

import { ReactNode, useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import type { ConnectionConfig } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

const DEFAULT_RPC_WS_URL = "wss://api.devnet.solana.com";

function getBrowserRpcEndpoint(): string {
  const configured = process.env.NEXT_PUBLIC_RPC_PROXY_URL?.trim();
  if (configured) return configured;

  if (typeof window !== "undefined") {
    return new URL("/api/rpc", window.location.origin).toString();
  }

  return "http://localhost:3000/api/rpc";
}

function getBrowserRpcWsEndpoint(endpoint: string): string {
  const configured = process.env.NEXT_PUBLIC_RPC_WS_URL?.trim();
  if (configured) return configured;

  if (endpoint.includes("/api/rpc")) return DEFAULT_RPC_WS_URL;
  if (endpoint.startsWith("https://")) return endpoint.replace(/^https:\/\//, "wss://");
  if (endpoint.startsWith("http://")) return endpoint.replace(/^http:\/\//, "ws://");
  return DEFAULT_RPC_WS_URL;
}

export function KronixWalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );
  const endpoint = useMemo(() => getBrowserRpcEndpoint(), []);
  const config = useMemo<ConnectionConfig>(
    () => ({
      commitment: "confirmed",
      wsEndpoint: getBrowserRpcWsEndpoint(endpoint),
    }),
    [endpoint],
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
