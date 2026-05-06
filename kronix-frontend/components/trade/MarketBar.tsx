"use client";

import { MARKETS, RPC_URL, type MarketSymbol } from "@/lib/kronix/config";
import { useStore } from "@/lib/store";

const marketSymbols = Object.keys(MARKETS) as MarketSymbol[];

const stats = [
  { label: "Settlement", value: "Instant CPI" },
  { label: "Oracle", value: "Switchboard" },
  { label: "Orders", value: "Critbit" },
  { label: "Keeper", value: "Permissionless" },
];

function clusterName() {
  if (RPC_URL.includes("devnet")) return "Devnet";
  if (RPC_URL.includes("mainnet")) return "Mainnet";
  return "Custom RPC";
}

export function MarketBar() {
  const selectedSymbol = useStore((s) => s.selectedSymbol);
  const setSelectedMarket = useStore((s) => s.setSelectedMarket);
  const livePrice = useStore((s) => s.livePrice);
  const prevPrice = useStore((s) => s.prevPrice);
  const active = MARKETS[selectedSymbol];
  const priceUp = livePrice !== null && prevPrice !== null && livePrice >= prevPrice;
  const priceTone =
    livePrice === null
      ? "text-on-surface"
      : priceUp
        ? "text-[#4dffb4]"
        : "text-[#ff6b7a]";

  return (
    <section className="kx-panel overflow-hidden">
      <div className="flex flex-col gap-4 p-3 sm:p-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/5 bg-[#090d0b] p-1 sm:flex">
            {marketSymbols.map((symbol) => {
              const market = MARKETS[symbol];
              const isActive = symbol === selectedSymbol;
              return (
                <button
                  key={symbol}
                  type="button"
                  onClick={() => setSelectedMarket(symbol)}
                  className={`h-10 rounded-md px-3 text-left transition-colors sm:min-w-28 ${
                    isActive
                      ? "bg-[#dfffee] text-[#07100c]"
                      : "text-on-surface-variant hover:bg-white/[0.04] hover:text-on-surface"
                  }`}
                >
                  <span className="block font-headline text-sm font-extrabold leading-4">
                    {market.name}
                  </span>
                  <span className="block font-mono text-[10px] uppercase leading-4 opacity-70">
                    Market {market.marketIndex}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="font-headline text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
                {active.name}
              </h1>
              <span className="rounded-full border border-[#4dffb4]/20 bg-[#4dffb4]/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#7dffd0]">
                {clusterName()}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-on-surface-variant">
              Crankless on-chain perpetuals with maker claims, instant taker settlement, automated strategies.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:min-w-[560px]">
          <div className="rounded-lg border border-white/5 bg-white/[0.025] p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant">
              Mark
            </div>
            <div className={`mt-1 font-headline text-lg font-extrabold ${priceTone}`}>
              {livePrice ? livePrice.toFixed(2) : "--"}
            </div>
          </div>
          {stats.map((item) => (
            <div key={item.label} className="rounded-lg border border-white/5 bg-white/[0.025] p-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant">
                {item.label}
              </div>
              <div className="mt-1 truncate font-headline text-sm font-bold text-white">
                {item.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
