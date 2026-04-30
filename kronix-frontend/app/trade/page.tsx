import { TradeNav } from "@/components/trade/TradeNav";
import { Orderbook } from "@/components/trade/Orderbook";
import { TradeForms } from "@/components/trade/TradeForms";
import { BottomPanel } from "@/components/trade/BottomPanel";
import ChartWrapper from "@/components/ChartWrapper";

export const dynamic = "force-dynamic";

export default function TradePage() {
  return (
    <div className="min-h-screen bg-[#0B0F0D] text-on-surface">
      <TradeNav />

      <main className="w-full px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        <section className="lg:col-span-10 flex flex-col gap-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-9 h-[620px] bg-kx-surface rounded-xl border kx-border overflow-hidden">
              <ChartWrapper symbol="KXI" />
            </div>
            <div className="lg:col-span-3">
              <Orderbook />
            </div>
          </div>
          <BottomPanel />
        </section>

        <section className="lg:col-span-2 lg:h-full">
          <TradeForms />
        </section>
      </main>
    </div>
  );
}
