const footerLinks = [
  { label: "Terms", href: "#" },
  { label: "Privacy", href: "#" },
  { label: "Docs", href: "#" },
];

export default function Footer() {
  return (
    <footer className="relative w-full hairline-t bg-[#0B0F0D]">
      {/* Top band */}
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-16 sm:py-24">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-1.5 h-1.5 rounded-full bg-[#4DFFB4] pulse-dot" />
          <span className="font-mono text-[0.6875rem] font-bold tracking-widest text-[#4DFFB4]">
            STATUS · PRE-LAUNCH
          </span>
        </div>

        <h2 className="font-headline text-4xl sm:text-6xl md:text-8xl font-extrabold tracking-tighter text-white leading-[0.9] mb-6">
          COMING SOON
        </h2>
        <p className="font-body text-base sm:text-lg text-[#BACBBE] max-w-xl leading-relaxed">
          Kronix mainnet launch is coming. Join the waitlist for early access,
          allocations, and launch updates.
        </p>
      </div>

      {/* Bottom bar */}
      <div className="hairline-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <span className="font-headline text-sm font-extrabold tracking-tighter text-[#4DFFB4]">
              KRONIX
            </span>
            <span className="font-mono text-[0.625rem] tracking-widest text-[#BACBBE]/40">
              © 2026 · ALL RIGHTS RESERVED
            </span>
          </div>
          <div className="flex gap-6">
            {footerLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="font-mono text-[0.625rem] uppercase tracking-widest text-[#BACBBE]/60 hover:text-[#4DFFB4] transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
