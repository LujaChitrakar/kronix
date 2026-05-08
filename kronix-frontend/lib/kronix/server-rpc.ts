import { Connection, type Commitment } from "@solana/web3.js";

const DEFAULT_RPC_URL = "https://api.devnet.solana.com";

export function getServerRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL?.trim() || DEFAULT_RPC_URL;
}

export function createServerConnection(
  commitment: Commitment = "confirmed",
): Connection {
  return new Connection(getServerRpcUrl(), commitment);
}
