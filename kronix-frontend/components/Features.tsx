import FeatureCard from "./FeatureCard";

const features = [
  {
    icon: "account_tree",
    title: "On-Chain Matching",
    description:
      "Fully on-chain central limit order book (CLOB). Deterministic execution with zero reliance on off-chain components or sequencers.",
    linkLabel: "Technical Specs",
  },
  {
    icon: "bolt",
    title: "Crankless Settlement",
    description:
      "Engineered for autonomy. Positions settle atomically within the program logic, eliminating the latency and risk of external crank networks.",
    linkLabel: "Program Logic",
  },
  {
    icon: "database",
    title: "Built on Solana",
    description:
      "Sub-second finality paired with institutional-grade throughput. Leveraging Solana's parallel runtime for high-frequency trading.",
    linkLabel: "Network Status",
  },
];

export default function Features() {
  return (
    <section className="relative z-10 py-16 sm:py-32 px-4 sm:px-8 max-w-7xl mx-auto bg-transparent">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[#3B4A41]/10">
        {features.map((feature) => (
          <FeatureCard key={feature.title} {...feature} />
        ))}
      </div>
    </section>
  );
}