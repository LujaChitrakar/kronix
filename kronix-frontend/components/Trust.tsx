import SectionLabel from "./SectionLabel";

const pillars = [
  {
    tag: "01",
    label: "NON-CUSTODIAL",
    title: "Funds never leave your wallet.",
    body: "Strategy logic is bound onchain at activation. No hidden counterparties, no custody transfer, no key handover.",
  },
  {
    tag: "02",
    label: "BAM-SEQUENCED",
    title: "Encrypted until execution.",
    body: "Strategy transactions integrate with Jito BAM. They cannot be observed, reordered or front-run before they land.",
  },
  {
    tag: "03",
    label: "VERIFIABLE",
    title: "Logic onchain. Execution onchain.",
    body: "Every signal evaluation and fill is reconstructible from chain state. No off-chain black box, no privileged operator.",
  },
];

export default function Trust() {
  return (
    <section className="relative w-full px-4 sm:px-8 py-24 sm:py-32 max-w-7xl mx-auto">
      <SectionLabel index="04" label="TRUST MODEL" />

      <div className="max-w-3xl mb-16">
        <h2 className="font-headline text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tighter text-white leading-[0.95]">
          Programmable execution,<br />
          <span className="text-[#4DFFB4]">without the tradeoff.</span>
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 border-t border-l kx-border">
        {pillars.map((p) => (
          <div
            key={p.label}
            className="relative bg-[#14181A] hover:bg-[#181D1F] border-r border-b kx-border p-6 sm:p-8 flex flex-col gap-5 transition-colors duration-200"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-[#4DFFB4] pulse-dot" />
                <span className="font-mono text-[0.625rem] tracking-widest text-[#4DFFB4]">
                  {p.label}
                </span>
              </div>
              <span className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/40">
                {p.tag}
              </span>
            </div>

            <h3 className="font-headline text-xl sm:text-2xl font-bold tracking-tight text-white leading-snug min-h-[3.5rem]">
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
