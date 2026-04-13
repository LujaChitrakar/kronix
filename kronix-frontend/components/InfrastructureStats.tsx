import StatItem from "./StatItem";

const stats = [
  { value: "400ms", label: "Avg Latency" },
  { value: "0%", label: "Protocol Fee" },
];

export default function InfrastructureStats() {
  return (
    <section className="py-16 sm:py-32 px-4 sm:px-8 max-w-7xl mx-auto">
      <div className="bg-[#1a1b21] p-1 rounded-lg">
        <div className="p-6 sm:p-12 flex flex-col md:flex-row justify-between items-start md:items-center gap-8 bg-[#222F2B]">
          {/* Heading Block */}
          <div>
            <div className="font-label text-[#4dffb4] text-[0.6875rem] uppercase tracking-[0.2em] mb-4">
              Infrastructure Status
            </div>
            <h2 className="font-headline text-2xl sm:text-4xl text-white font-bold tracking-tight">
              Optimized for high-frequency execution.
            </h2>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-8 sm:gap-12 md:border-l border-t md:border-t-0 border-[#3b4a41]/30 pt-6 md:pt-0 md:pl-12 w-full md:w-auto">
            {stats.map((stat) => (
              <StatItem key={stat.label} {...stat} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}