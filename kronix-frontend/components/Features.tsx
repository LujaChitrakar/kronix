import SectionLabel from "./SectionLabel";

const features = [
  {
    num: "01",
    tag: "INDEX-PERP",
    title: "KXI",
    body: "First tradeable onchain crypto index perpetual. √mcap-weighted basket of SOL, BTC, ETH, LTC, BNB. Directional crypto exposure with structurally less single-asset volatility.",
    meta: [
      ["MARK", "30-tick TWAP"],
      ["BASIS", "√mcap"],
    ],
  },
  {
    num: "02",
    tag: "SINGLE-TOKEN",
    title: "PERPS",
    body: "Standard perpetuals on major assets. Crankless settlement which fills settle immediately. No EventQueue, no keeper dependency.",
    meta: [
      ["ENGINE", "Crit-bit"],
      ["SETTLE", "Instant"],
    ],
  },
  {
    num: "03",
    tag: "AUTOMATION",
    title: "ENGINE",
    body: "Non-custodial, fully onchain strategy automation layer on Solana. Encode trading logic once and it executes continuously without bots or counterparties.",
    meta: [
      ["CUSTODY", "None"],
      ["UPTIME", "Always-on"],
    ],
  },
];

export default function Features() {
  return (
    <section id="primitives" className="relative w-full px-4 sm:px-8 py-24 sm:py-32 max-w-7xl mx-auto scroll-mt-20">
      <SectionLabel index="01" label="PRIMITIVES" />

      <h2 className="font-headline text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tighter text-white leading-[0.95] max-w-4xl mb-16">
        Primitives missing<br />
        from onchain markets.
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-3 border-t border-l kx-border">
        {features.map((f) => (
          <div
            key={f.title}
            className="group relative bg-[#14181A] hover:bg-[#181D1F] border-r border-b kx-border p-6 sm:p-8 flex flex-col gap-6 transition-colors duration-200"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[0.625rem] tracking-widest text-[#4DFFB4]">
                &gt; {f.tag}
              </span>
              <span className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/40">
                {f.num}
              </span>
            </div>

            <h3 className="font-headline text-4xl sm:text-5xl font-extrabold tracking-tighter text-white">
              {f.title}
            </h3>

            <p className="font-body text-sm text-[#BACBBE] leading-relaxed flex-1">
              {f.body}
            </p>

            <div className="flex items-start justify-between hairline-t pt-4 gap-4">
              <div>
                <p className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/50 mb-1">
                  {f.meta[0][0]}
                </p>
                <p className="font-mono text-xs tracking-wide text-[#4DFFB4] tabular-nums">
                  {f.meta[0][1]}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/50 mb-1">
                  {f.meta[1][0]}
                </p>
                <p className="font-mono text-xs tracking-wide text-[#4DFFB4] tabular-nums">
                  {f.meta[1][1]}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
