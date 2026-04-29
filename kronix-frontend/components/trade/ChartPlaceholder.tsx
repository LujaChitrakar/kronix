export function ChartPlaceholder() {
  return (
    <div
      className="bg-kx-surface rounded-xl border kx-border h-[620px] flex items-center justify-center relative overflow-hidden"
      style={{
        backgroundImage:
          "linear-gradient(rgba(77,255,180,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(77,255,180,0.04) 1px, transparent 1px)",
        backgroundSize: "32px 32px",
      }}
    >
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0B0F0D]/40 pointer-events-none" />
      <div className="text-center relative z-10">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mx-auto mb-3 text-[#4dffb4]/60"
        >
          <path d="M3 3v18h18" />
          <path d="M7 14l3-3 4 4 5-5" />
          <circle cx="7" cy="14" r="1" />
          <circle cx="10" cy="11" r="1" />
          <circle cx="14" cy="15" r="1" />
          <circle cx="19" cy="10" r="1" />
        </svg>
        <div className="font-headline text-sm text-on-surface uppercase tracking-wider mb-1">
          Chart
        </div>
        <div className="text-[10px] font-mono text-on-surface-variant/60">
          Coming soon
        </div>
      </div>
    </div>
  );
}
