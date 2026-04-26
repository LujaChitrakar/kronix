import { TradeNav } from "@/components/trade/TradeNav";
import { AdminPanel } from "@/components/trade/AdminPanel";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return (
    <div className="min-h-screen bg-[#0B0F0D] text-on-surface">
      <TradeNav />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <AdminPanel />
      </main>
    </div>
  );
}
