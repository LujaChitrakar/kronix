const pillars = [
  {
    label: "Non-custodial",
    title: "Funds never leave your wallet.",
    body: "Strategy logic is bound onchain at activation. No hidden counterparties, no custody transfer, no key handover.",
  },
  {
    label: "BAM-sequenced",
    title: "Encrypted until execution.",
    body: "Strategy transactions integrate with Jito BAM. They cannot be observed, reordered or front-run before they land.",
  },
  {
    label: "Verifiable",
    title: "Logic onchain. Execution onchain.",
    body: "Every signal evaluation and fill is reconstructible from chain state. No off-chain black box, no privileged operator.",
  },
];

export default function Trust() {
  return (
    <section className="relative w-full px-4 sm:px-8 py-24 sm:py-32 max-w-7xl mx-auto">
      <div className="mb-12 sm:mb-16 max-w-3xl">
        <p className="font-['Inter'] text-[0.6875rem] uppercase tracking-widest text-[#BACBBE]/60 mb-3">
          Trust model
        </p>
        <h2 className="font-headline text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tighter text-white leading-[0.95]">
          Programmable execution,<br />
          without the tradeoff.
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 border border-[#3B4A41]/30 rounded-xl overflow-hidden">
        {pillars.map((p, i) => (
          <div
            key={p.label}
            className={`bg-[#1a1b21] p-6 sm:p-8 flex flex-col gap-4 ${
              i < pillars.length - 1 ? "md:border-r border-b md:border-b-0 border-[#3B4A41]/30" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#4DFFB4]" />
              <p className="font-['Inter'] text-[0.6875rem] uppercase tracking-widest text-[#4DFFB4]/80">
                {p.label}
              </p>
            </div>
            <h3 className="font-headline text-xl sm:text-2xl font-bold tracking-tight text-white leading-snug">
              {p.title}
            </h3>
            <p className="font-body text-sm text-[#BACBBE] leading-relaxed">
              {p.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
