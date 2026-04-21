const basket = [
  { symbol: "BTC", name: "Bitcoin", weight: 47.6 },
  { symbol: "ETH", name: "Ethereum", weight: 24.6 },
  { symbol: "SOL", name: "Solana", weight: 12.3 },
  { symbol: "BNB", name: "BNB", weight: 12.2 },
  { symbol: "LTC", name: "Litecoin", weight: 3.3 },
];

export default function KXIBasket() {
  return (
    <section className="relative w-full px-4 sm:px-8 py-24 sm:py-32 max-w-7xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        {/* Left: copy */}
        <div>
          <p className="font-['Inter'] text-[0.6875rem] uppercase tracking-widest text-[#BACBBE]/60 mb-3">
            KXI Composition
          </p>
          <h2 className="font-headline text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tighter text-white leading-[0.95] mb-6">
            One instrument.<br />
            Five assets.<br />
            <span className="text-[#4DFFB4]">√mcap weighted.</span>
          </h2>
          <p className="font-body text-base text-[#BACBBE] leading-relaxed mb-4">
            Square-root of market cap dampens dominance of mega-caps and lifts
            mid-caps. The result is a smoother, directional proxy for the crypto
            market — not a BTC shadow.
          </p>
          <p className="font-['Inter'] text-xs uppercase tracking-widest text-[#BACBBE]/40">
            Illustrative weights · rebalance with market state
          </p>
        </div>

        {/* Right: basket visual */}
        <div className="bg-[#1a1b21] border border-[#3B4A41]/30 rounded-xl p-6 sm:p-8">
          <div className="flex items-baseline justify-between mb-6 pb-4 border-b border-[#3B4A41]/30">
            <div>
              <p className="font-headline text-2xl sm:text-3xl font-extrabold tracking-tighter text-white">
                KXI
              </p>
              <p className="font-['Inter'] text-[0.6875rem] uppercase tracking-widest text-[#BACBBE]/50 mt-1">
                Kronix Index Perpetual
              </p>
            </div>
            <div className="text-right">
              <p className="font-['Inter'] text-[0.6875rem] uppercase tracking-widest text-[#BACBBE]/50">
                Basis
              </p>
              <p className="font-headline text-sm font-bold text-[#4DFFB4] mt-1">
                √mcap
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {basket.map((asset) => (
              <div key={asset.symbol} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between">
                  <div className="flex items-baseline gap-3">
                    <span className="font-headline text-base font-bold text-white tracking-tight w-12">
                      {asset.symbol}
                    </span>
                    <span className="font-['Inter'] text-xs text-[#BACBBE]/60">
                      {asset.name}
                    </span>
                  </div>
                  <span className="font-['Inter'] text-sm font-bold text-[#4DFFB4] tabular-nums">
                    {asset.weight.toFixed(1)}%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-[#0d0e14] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#17e29a] to-[#4DFFB4] rounded-full transition-all duration-500"
                    style={{ width: `${asset.weight}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-[#3B4A41]/30 grid grid-cols-2 gap-4">
            <div>
              <p className="font-['Inter'] text-[0.625rem] uppercase tracking-widest text-[#BACBBE]/50 mb-1">
                Mark price
              </p>
              <p className="font-headline text-xs font-bold text-white">
                30-tick TWAP
              </p>
            </div>
            <div>
              <p className="font-['Inter'] text-[0.625rem] uppercase tracking-widest text-[#BACBBE]/50 mb-1">
                Oracle
              </p>
              <p className="font-headline text-xs font-bold text-white">
                Pyth PriceUpdateV2
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
