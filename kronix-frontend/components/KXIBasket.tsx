import SectionLabel from "./SectionLabel";

const basket = [
  { symbol: "BTC", name: "BITCOIN",  weight: 47.6, plain: 71.4, color: "#F7931A" },
  { symbol: "ETH", name: "ETHEREUM", weight: 24.6, plain: 19.0, color: "#8E76FF" },
  { symbol: "SOL", name: "SOLANA",   weight: 12.3, plain:  4.8, color: "#9945FF" },
  { symbol: "BNB", name: "BNB",      weight: 12.2, plain:  4.5, color: "#F0B90B" },
  { symbol: "LTC", name: "LITECOIN", weight:  3.3, plain:  0.3, color: "#A6A9AA" },
];

export default function KXIBasket() {
  return (
    <section className="relative w-full px-4 sm:px-8 py-24 sm:py-32 max-w-7xl mx-auto">
      <SectionLabel index="02" label="KXI COMPOSITION" />

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-16 items-start">
        {/* Left: copy */}
        <div className="lg:col-span-2">
          <h2 className="font-headline text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tighter text-white leading-[0.95] mb-8">
            One instrument.<br />
            Five assets.<br />
            <span className="text-[#4DFFB4]">√mcap weighted.</span>
          </h2>
          <p className="font-body text-base text-[#BACBBE] leading-relaxed mb-8">
            Square-root of market cap dampens dominance of mega-caps and lifts
            mid-caps. Result — a smoother, directional proxy for the crypto
            market, not a BTC shadow.
          </p>

          {/* Formula callout */}
          <div className="border kx-border bg-[#14181A] p-4 sm:p-5 mb-8 overflow-hidden">
            <p className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/50 mb-3">
              WEIGHTING FUNCTION
            </p>
            <p className="font-mono text-xs sm:text-sm md:text-base text-white leading-relaxed break-words">
              <span className="text-[#4DFFB4]">w</span>
              <span className="text-[#BACBBE]/70">ᵢ</span>
              {" = "}
              <span className="text-[#4DFFB4]">√</span>
              {"("}
              <span className="text-[#4DFFB4]">mcap</span>
              <span className="text-[#BACBBE]/70">ᵢ</span>
              {") / Σ "}
              <span className="text-[#4DFFB4]">√</span>
              {"("}
              <span className="text-[#4DFFB4]">mcap</span>
              <span className="text-[#BACBBE]/70">ⱼ</span>
              {")"}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-0 border-t border-b kx-border">
            <div className="p-4 border-r kx-border">
              <p className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/50 mb-1">
                MARK
              </p>
              <p className="font-mono text-sm text-white tabular-nums">
                30-TICK TWAP
              </p>
            </div>
            <div className="p-4">
              <p className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/50 mb-1">
                ORACLE
              </p>
              <p className="font-mono text-sm text-white tabular-nums">
                PYTH V2
              </p>
            </div>
            <div className="p-4 border-r border-t kx-border">
              <p className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/50 mb-1">
                BASKET
              </p>
              <p className="font-mono text-sm text-white tabular-nums">
                5 ASSETS
              </p>
            </div>
            <div className="p-4 border-t kx-border">
              <p className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/50 mb-1">
                BASIS
              </p>
              <p className="font-mono text-sm text-[#4DFFB4] tabular-nums">
                √MCAP
              </p>
            </div>
          </div>
        </div>

        {/* Right: basket terminal */}
        <div className="lg:col-span-3 bg-[#14181A] border kx-border">
          {/* Terminal header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 hairline-b bg-[#10141D]">
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#4DFFB4] pulse-dot" />
                <span className="font-mono text-[0.625rem] sm:text-[0.6875rem] font-bold tracking-widest text-[#4DFFB4]">
                  KXI-PERP
                </span>
              </div>
              <span className="hidden sm:inline font-mono text-[0.6875rem] tracking-widest text-[#BACBBE]/50">
                INDEX BASKET
              </span>
            </div>
            <span className="font-mono text-[0.625rem] sm:text-[0.6875rem] tracking-widest text-[#BACBBE]/40">
              n = {basket.length}
            </span>
          </div>

          {/* Mcap vs √Mcap comparison */}
          <div className="px-4 sm:px-6 py-5 sm:py-6 hairline-b">
            <div className="flex items-center justify-between mb-4 sm:mb-5 gap-2">
              <span className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/50">
                DOMINANCE DAMPENING
              </span>
              <span className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/40 shrink-0">
                MCAP → √MCAP
              </span>
            </div>

            {/* Row 1: plain mcap */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/60">
                  PLAIN MCAP
                </span>
                <span className="font-mono text-[0.625rem] tabular-nums text-[#BACBBE]/40">
                  BTC {basket[0].plain.toFixed(1)}%
                </span>
              </div>
              <div className="flex w-full h-5 gap-0.5 opacity-50">
                {basket.map((asset) => (
                  <div
                    key={`plain-${asset.symbol}`}
                    style={{
                      width: `${asset.plain}%`,
                      backgroundColor: asset.color,
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Row 2: sqrt mcap */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-[0.625rem] font-bold tracking-widest text-[#4DFFB4]">
                  √MCAP
                </span>
                <span className="font-mono text-[0.625rem] tabular-nums text-[#4DFFB4]">
                  BTC {basket[0].weight.toFixed(1)}%
                </span>
              </div>
              <div className="flex w-full h-5 gap-0.5">
                {basket.map((asset) => (
                  <div
                    key={`sqrt-${asset.symbol}`}
                    className="flex items-center justify-center"
                    style={{
                      width: `${asset.weight}%`,
                      backgroundColor: asset.color,
                    }}
                  >
                    {asset.weight >= 10 && (
                      <span className="font-mono text-[0.5625rem] font-bold tracking-widest text-[#0B0F0D]">
                        {asset.symbol}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <p className="font-mono text-[0.625rem] tracking-wider text-[#BACBBE]/50 mt-4 leading-relaxed">
              {"// SQUARE-ROOT FLATTENS MEGA-CAP DOMINANCE. BTC ALLOCATION DROPS"}<br />
              {"// ~24PP. MID-CAPS GAIN WEIGHT WITHOUT BEING NOISE."}
            </p>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-12 gap-2 px-4 sm:px-6 py-3 hairline-b bg-[#10141D]/50">
            <span className="hidden sm:inline col-span-1 font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/50">
              #
            </span>
            <span className="col-span-3 sm:col-span-2 font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/50">
              SYMBOL
            </span>
            <span className="hidden sm:inline col-span-3 font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/50">
              NAME
            </span>
            <span className="col-span-6 sm:col-span-4 font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/50">
              ALLOCATION
            </span>
            <span className="col-span-3 sm:col-span-2 font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/50 text-right">
              WEIGHT
            </span>
          </div>

          {/* Rows */}
          <div className="divide-y divide-[rgba(77,255,180,0.06)]">
            {basket.map((asset, i) => (
              <div
                key={asset.symbol}
                className="grid grid-cols-12 gap-2 px-4 sm:px-6 py-3 sm:py-4 items-center hover:bg-[#181D1F] transition-colors"
              >
                <span className="hidden sm:inline col-span-1 font-mono text-xs tabular-nums text-[#BACBBE]/40">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="col-span-3 sm:col-span-2 flex items-center gap-2">
                  <div
                    className="w-1 h-5 shrink-0"
                    style={{ backgroundColor: asset.color }}
                  />
                  <span className="font-headline text-sm sm:text-base font-bold text-white tracking-tight">
                    {asset.symbol}
                  </span>
                </div>
                <span className="hidden sm:inline col-span-3 font-mono text-[0.6875rem] tracking-widest text-[#BACBBE]/60 truncate">
                  {asset.name}
                </span>
                <div className="col-span-6 sm:col-span-4 h-1.5 bg-[#0B0F0D] overflow-hidden">
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${asset.weight}%`,
                      backgroundColor: asset.color,
                    }}
                  />
                </div>
                <span
                  className="col-span-3 sm:col-span-2 font-mono text-xs sm:text-sm font-bold tabular-nums text-right"
                  style={{ color: asset.color }}
                >
                  {asset.weight.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 hairline-t bg-[#10141D]">
            <span className="font-mono text-[0.5625rem] sm:text-[0.625rem] tracking-widest text-[#BACBBE]/40 truncate">
              <span className="sm:hidden">{"// ILLUSTRATIVE"}</span>
              <span className="hidden sm:inline">{"// ILLUSTRATIVE · REBALANCE WITH MARKET STATE"}</span>
            </span>
            <span className="font-mono text-[0.625rem] tracking-widest text-[#4DFFB4]/70 tabular-nums shrink-0">
              Σ 100.00%
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
