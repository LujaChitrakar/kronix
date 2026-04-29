import { TradeNav } from "@/components/trade/TradeNav";
import { Orderbook } from "@/components/trade/Orderbook";
import { TradeForms } from "@/components/trade/TradeForms";
import { BottomPanel } from "@/components/trade/BottomPanel";

export const dynamic = "force-dynamic";

export default function TradePage() {
  return (
    <div className="min-h-screen bg-[#0B0F0D] text-on-surface">
      <TradeNav />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <section className="lg:col-span-8">
            <Orderbook />
          </section>
          <section className="lg:col-span-4">
            <TradeForms />
          </section>
        </div>

        <BottomPanel />
      </main>
    </div>
  );
}
