import SectionLabel from "./SectionLabel";

const strategies = [
  {
    id: "RSI",
    slug: "REVERSAL",
    name: "RSI Reversal",
    body: "Entries and exits based on momentum thresholds. Configurable period, oversold and overbought bands, any timeframe.",
    params: ["PERIOD", "OVERSOLD", "OVERBOUGHT"],
  },
  {
    id: "EMA",
    slug: "CROSS",
    name: "EMA Cross",
    body: "Long or short entries triggered when fast and slow moving averages cross in a given direction.",
    params: ["FAST", "SLOW", "DIRECTION"],
  },
  {
    id: "DCA",
    slug: "RANGE",
    name: "Range DCA",
    body: "Recurring buys and sells within user-defined price bands. Grid count and schedule set at activation.",
    params: ["LOWER", "UPPER", "GRID"],
  },
  {
    id: "S/R",
    slug: "ZONES",
    name: "Liquidity Zones",
    body: "Limit orders anchored to user-defined support and resistance levels, with automatic exits if those levels break.",
    params: ["LEVELS", "TOLERANCE", "EXIT"],
  },
];

export default function Strategies() {
  return (
    <section className="relative w-full px-4 sm:px-8 py-24 sm:py-32 max-w-7xl mx-auto">
      <SectionLabel index="03" label="KRONIX ENGINE" />

      <div className="max-w-3xl mb-16">
        <h2 className="font-headline text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tighter text-white leading-[0.95] mb-6">
          Self-executing strategies.<br />
          Not price alerts.
        </h2>
        <p className="font-body text-base sm:text-lg text-[#BACBBE] leading-relaxed">
          Encode logic onchain. Engine evaluates price data and user thresholds.
          Execution happens automatically — no bot, no keeper outside the Jito
          validator network.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 border-t border-l kx-border">
        {strategies.map((s, i) => (
          <div
            key={s.id}
            className="group relative bg-[#14181A] hover:bg-[#181D1F] border-r border-b kx-border p-6 sm:p-8 flex flex-col gap-5 transition-colors duration-200"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <span className="font-mono text-[0.625rem] tracking-widest text-[#4DFFB4]">
                  [{s.id}]
                </span>
                <span className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/40">
                  {`// ${s.slug}`}
                </span>
              </div>
              <span className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/40 tabular-nums">
                {String(i + 1).padStart(2, "0")} / 04
              </span>
            </div>

            <h3 className="font-headline text-2xl sm:text-3xl font-bold text-white tracking-tight">
              {s.name}
            </h3>

            <p className="font-body text-sm text-[#BACBBE] leading-relaxed flex-1">
              {s.body}
            </p>

            <div className="flex flex-wrap gap-1.5 hairline-t pt-4">
              {s.params.map((p) => (
                <span
                  key={p}
                  className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/70 px-2 py-1 border kx-border bg-[#0B0F0D]"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
