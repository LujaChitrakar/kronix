interface FeatureCardProps {
  icon: string;
  title: string;
  description: string;
  linkLabel: string;
}

export default function FeatureCard({
  icon,
  title,
  description,
  linkLabel,
}: FeatureCardProps) {
  return (
    <div className="bg-[#0D0E14]/50 backdrop-blur-sm p-12 group transition-colors duration-300 hover:bg-[#222F2B]/40">
      {/* Icon */}
      <div className="mb-8">
        <span className="material-symbols-outlined text-[#4dffb4] text-3xl">
          {icon}
        </span>
      </div>

      {/* Title */}
      <h3 className="font-headline text-headline-sm text-white mb-4 font-bold">
        {title}
      </h3>

      {/* Description */}
      <p className="text-[#bacbbe] leading-relaxed font-body">
        {description}
      </p>

      {/* Hover Link */}
      <div className="mt-8 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-xs font-label uppercase tracking-widest text-[#4dffb4]">
          {linkLabel}
        </span>
        <span className="material-symbols-outlined text-sm text-[#4dffb4]">
          arrow_forward
        </span>
      </div>
    </div>
  );
}