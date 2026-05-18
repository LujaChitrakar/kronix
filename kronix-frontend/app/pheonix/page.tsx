import { PhoenixTerminal } from "@/components/phoenix/PhoenixTerminal";
import { PhoenixWalletProvider } from "@/lib/phoenix/wallet-provider";

export const dynamic = "force-dynamic";

export default function PheonixPage() {
  return (
    <PhoenixWalletProvider>
      <PhoenixTerminal />
    </PhoenixWalletProvider>
  );
}
