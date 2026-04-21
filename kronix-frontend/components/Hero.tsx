import Link from "next/link";

export default function Hero() {
  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center pt-20 pb-16 overflow-hidden">
      {/* Heartbeat glow */}
      <div className="heartbeat-glow" />

      {/* Hero content */}
      <div className="relative z-10 text-center px-4 max-w-5xl">
        {/* Status chip */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 mb-6 sm:mb-8 border kx-border-strong bg-[#14181A]/60 backdrop-blur-sm">
          <div className="w-1.5 h-1.5 rounded-full bg-[#4DFFB4] pulse-dot" />
          <span className="font-mono text-[0.5625rem] sm:text-[0.6875rem] font-bold tracking-widest text-[#4DFFB4]">
            <span className="sm:hidden">BUILT ON SOLANA</span>
            <span className="hidden sm:inline">ONCHAIN PERPS · BUILT ON SOLANA</span>
          </span>
        </div>

        {/* Wordmark */}
        <h1 className="font-headline text-[3.5rem] sm:text-[6rem] md:text-[9rem] font-extrabold tracking-tighter text-white leading-[0.85] mb-6 select-none">
          KRONIX
        </h1>

        {/* Tagline */}
        <p className="font-mono text-xs sm:text-sm tracking-[0.3em] uppercase text-[#4DFFB4] mb-8">
          PERPETUAL · STRATEGY · ONCHAIN
        </p>

        {/* Pitch */}
        <p className="font-body text-base sm:text-lg md:text-xl text-[#BACBBE] leading-relaxed max-w-2xl mx-auto mb-10">
          Tradeable onchain index perpetuals and a non-custodial strategy
          automation layer. Two primitives missing from onchain markets.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
          <Link
            href="/waitlist"
            className="group relative px-8 py-3.5 bg-[#4DFFB4] text-[#0B0F0D] font-mono text-sm font-bold tracking-widest uppercase hover:bg-[#17e29a] transition-colors active:scale-[0.98] flex items-center gap-2"
          >
            <span>JOIN WAITLIST</span>
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
          <a
            href="#primitives"
            className="px-8 py-3.5 border kx-border-strong bg-[#14181A]/60 backdrop-blur-sm text-white font-mono text-sm font-bold tracking-widest uppercase hover:bg-[#181D1F] transition-colors"
          >
            READ SPEC
          </a>
        </div>
      </div>
    </main>
  );
}
