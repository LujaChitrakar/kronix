import StatItem from "./StatItem";

const stats = [
  { value: "400ms", label: "Avg Latency" },
  { value: "0%", label: "Protocol Fee" },
];

export default function InfrastructureStats() {
  return (
    <section className="py-32 px-8 max-w-7xl mx-auto">
      <div className="bg-[#1a1b21] p-1 rounded-lg">
        <div className="p-12 flex flex-col md:flex-row justify-between items-end md:items-center gap-8 bg-[#222F2B]">
          {/* Heading Block */}
          <div>
            <div className="font-label text-[#4dffb4] text-[0.6875rem] uppercase tracking-[0.2em] mb-4">
              Infrastructure Status
            </div>
            <h2 className="font-headline text-4xl text-white font-bold tracking-tight">
              Optimized for high-frequency execution.
            </h2>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-12 border-l border-[#3b4a41]/30 pl-12">
            {stats.map((stat) => (
              <StatItem key={stat.label} {...stat} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}