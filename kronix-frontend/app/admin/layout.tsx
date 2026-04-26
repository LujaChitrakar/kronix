import { ReactNode } from "react";
import { KronixWalletProvider } from "@/lib/kronix/wallet-provider";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <KronixWalletProvider>{children}</KronixWalletProvider>;
}
