import { TradeNav } from "@/components/trade/TradeNav";
import { Orderbook } from "@/components/trade/Orderbook";
import { OrderForm } from "@/components/trade/OrderForm";
import { TriggerForm } from "@/components/trade/TriggerForm";
import { TriggerOrders } from "@/components/trade/TriggerOrders";
import { StrategyForm } from "@/components/trade/StrategyForm";
import { Strategies } from "@/components/trade/Strategies";
import { AccountPanel } from "@/components/trade/AccountPanel";
import { PositionPanel } from "@/components/trade/PositionPanel";
import { OpenOrders } from "@/components/trade/OpenOrders";

export const dynamic = "force-dynamic";

export default function TradePage() {
  return (
    <div className="min-h-screen bg-[#0B0F0D] text-on-surface">
      <TradeNav />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-4">
        <section className="lg:col-span-4 flex flex-col gap-4">
          <AccountPanel />
          <PositionPanel />
        </section>

        <section className="lg:col-span-5 flex flex-col gap-4">
          <Orderbook />
          <OpenOrders />
          <TriggerOrders />
          <Strategies />
        </section>

        <section className="lg:col-span-3 flex flex-col gap-4">
          <OrderForm />
          <TriggerForm />
          <StrategyForm />
        </section>
      </main>
    </div>
  );
}
