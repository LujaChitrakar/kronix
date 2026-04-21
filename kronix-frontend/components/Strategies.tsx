const strategies = [
  {
    id: "RSI",
    name: "RSI Reversal",
    body: "Entries and exits based on momentum thresholds. Configurable period, oversold and overbought bands, any timeframe.",
  },
  {
    id: "EMA",
    name: "EMA Cross",
    body: "Long or short entries triggered when fast and slow moving averages cross in a given direction.",
  },
  {
    id: "DCA",
    name: "Range DCA",
    body: "Recurring buys and sells within user-defined price bands. Grid count and schedule set at activation.",
  },
  {
    id: "SR",
    name: "Liquidity Zones",
    body: "Limit orders anchored to user-defined support and resistance levels, with automatic exits if those levels break.",
  },
];

export default function Strategies() {
  return (
    <section className="relative w-full px-4 sm:px-8 py-24 sm:py-32 max-w-7xl mx-auto">
      <div className="mb-12 sm:mb-16 max-w-3xl">
        <p className="font-['Inter'] text-[0.6875rem] uppercase tracking-widest text-[#BACBBE]/60 mb-3">
          The Kronix Engine
        </p>
        <h2 className="font-headline text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tighter text-white leading-[0.95] mb-6">
          Self-executing strategies.<br />
          Not price alerts.
        </h2>
        <p className="font-body text-base sm:text-lg text-[#BACBBE] leading-relaxed">
          Encode logic onchain. Engine evaluates price data and user thresholds.
          Execution happens automatically. No bot, no keeper outside the Jito validator network.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {strategies.map((s, i) => (
          <div
            key={s.id}
            className="relative bg-[#1a1b21] border border-[#3B4A41]/30 rounded-xl p-6 sm:p-8 flex items-start gap-5 hover:border-[#4DFFB4]/30 transition-colors duration-300"
          >
            <div className="shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-lg bg-[#222F2B] border border-[#4DFFB4]/20 flex items-center justify-center">
              <span className="font-['Inter'] text-[0.625rem] font-bold tracking-widest text-[#4DFFB4]">
                {s.id}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-4 mb-2">
                <h3 className="font-headline text-xl sm:text-2xl font-bold text-white tracking-tight">
                  {s.name}
                </h3>
                <span className="font-['Inter'] text-[0.625rem] uppercase tracking-widest text-[#BACBBE]/40">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <p className="font-body text-sm text-[#BACBBE] leading-relaxed">
                {s.body}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
