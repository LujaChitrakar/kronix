interface StatItemProps {
  value: string;
  label: string;
}

export default function StatItem({ value, label }: StatItemProps) {
  return (
    <div className="bg-[#0D0E14]/50 backdrop-blur-sm p-12 group transition-colors duration-300 hover:bg-[#222F2B]/40">
      <div className="text-3xl font-headline font-bold text-white">{value}</div>
      <div className="font-label text-[#a7bdb3] text-[0.6875rem] uppercase tracking-widest mt-1">
        {label}
      </div>
    </div>
  );
}