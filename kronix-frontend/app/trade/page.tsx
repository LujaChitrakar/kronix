import { TradeNav } from "@/components/trade/TradeNav";
import { MarketHeader } from "@/components/trade/MarketHeader";
import CryptoChart from "@/components/CryptoChart/CryptoChart";
import { CenterTabs } from "@/components/trade/CenterTabs";
import { RightTabs } from "@/components/trade/RightTabs";
import { BottomTabs } from "@/components/trade/BottomTabs";

export const dynamic = "force-dynamic";

export default function TradePage() {
  return (
    <div className="min-h-screen bg-kx-base text-on-surface">
      <TradeNav />

      <main className="px-3 py-3 flex flex-col gap-2">
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_340px_300px]">
          <section className="flex flex-col gap-2 min-w-0">
            <MarketHeader />
            <div className="bg-hl-panel border border-hl rounded-md overflow-hidden h-[600px]">
              <div className="kx-chart-host">
                <CryptoChart />
              </div>
            </div>
          </section>

          <section className="bg-hl-panel border border-hl rounded-md min-h-[640px] flex flex-col">
            <CenterTabs />
          </section>

          <section className="bg-hl-panel border border-hl rounded-md min-h-[640px] flex flex-col">
            <RightTabs />
          </section>
        </div>

        <section className="bg-hl-panel border border-hl rounded-md">
          <BottomTabs />
        </section>
      </main>
    </div>
  );
}
