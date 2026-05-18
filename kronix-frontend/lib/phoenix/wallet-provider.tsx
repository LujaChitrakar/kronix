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

const DEFAULT_MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com";

function phoenixRpcEndpoint(): string {
  return (
    process.env.NEXT_PUBLIC_PHOENIX_RPC_URL?.trim() ||
    process.env.NEXT_PUBLIC_MAINNET_RPC_URL?.trim() ||
    DEFAULT_MAINNET_RPC_URL
  );
}

function phoenixWsEndpoint(endpoint: string): string | undefined {
  const configured = process.env.NEXT_PUBLIC_PHOENIX_RPC_WS_URL?.trim();
  if (configured) return configured;
  if (endpoint.startsWith("https://")) return endpoint.replace(/^https:\/\//, "wss://");
  if (endpoint.startsWith("http://")) return endpoint.replace(/^http:\/\//, "ws://");
  return undefined;
}

export function PhoenixWalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );
  const endpoint = useMemo(() => phoenixRpcEndpoint(), []);
  const config = useMemo<ConnectionConfig>(
    () => ({
      commitment: "confirmed",
      wsEndpoint: phoenixWsEndpoint(endpoint),
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
