export default function SectionLabel({
  index,
  label,
}: {
  index: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 mb-8">
      <span className="font-mono text-[0.6875rem] tracking-widest text-[#4DFFB4]/70">
        [ {index} ]
      </span>
      <div className="flex-1 h-px bg-gradient-to-r from-[#3B4A41]/60 via-[#3B4A41]/30 to-transparent" />
      <span className="font-mono text-[0.6875rem] uppercase tracking-[0.25em] text-[#BACBBE]/70">
        {label}
      </span>
    </div>
  );
}
