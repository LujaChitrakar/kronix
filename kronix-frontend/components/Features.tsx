const features = [
  {
    tag: "01 / Index Perp",
    title: "KXI",
    body: "First tradeable onchain crypto index perpetual. √mcap-weighted basket of SOL, BTC, ETH, LTC, BNB. Directional crypto exposure with structurally less single-asset volatility.",
    stat: "30-tick TWAP mark",
  },
  {
    tag: "02 / Single-token",
    title: "Perps",
    body: "Standard perpetuals on major assets. Crankless settlement — fills settle immediately via CPI. No EventQueue, no keeper dependency.",
    stat: "Zero-overhead matching",
  },
  {
    tag: "03 / Automation",
    title: "The Engine",
    body: "First non-custodial, fully onchain strategy automation layer on Solana. Encode trading logic once — executes continuously without bots or counterparties.",
    stat: "Always-on execution",
  },
];

export default function Features() {
  return (
    <section className="relative w-full px-4 sm:px-8 py-24 sm:py-32 max-w-7xl mx-auto">
      <div className="mb-12 sm:mb-16">
        <p className="font-['Inter'] text-[0.6875rem] uppercase tracking-widest text-[#BACBBE]/60 mb-3">
          Primitives
        </p>
        <h2 className="font-headline text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tighter text-white leading-[0.95] max-w-4xl">
          Two primitives missing<br />
          from onchain markets.
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {features.map((f) => (
          <div
            key={f.title}
            className="group relative bg-[#1a1b21] border border-[#3B4A41]/30 rounded-xl p-6 sm:p-8 flex flex-col gap-6 hover:border-[#4DFFB4]/30 transition-colors duration-300"
          >
            <p className="font-['Inter'] text-[0.6875rem] uppercase tracking-widest text-[#4DFFB4]/70">
              {f.tag}
            </p>
            <h3 className="font-headline text-3xl sm:text-4xl font-extrabold tracking-tighter text-white">
              {f.title}
            </h3>
            <p className="font-body text-sm text-[#BACBBE] leading-relaxed flex-1">
              {f.body}
            </p>
            <div className="pt-4 border-t border-[#3B4A41]/30">
              <p className="font-['Inter'] text-xs uppercase tracking-wider text-[#4DFFB4]">
                {f.stat}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
