import Link from "next/link";

export default function Hero() {
  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center pt-20 pb-16 overflow-hidden">
      {/* Heartbeat glow */}
      <div className="heartbeat-glow" />

      {/* Hero content */}
      <div className="relative z-10 text-center px-4 max-w-5xl">

        {/* Wordmark */}
        <h1 className="font-headline text-[3.5rem] sm:text-[6rem] md:text-[9rem] font-extrabold tracking-tighter text-white leading-[0.85] mb-6 select-none">
          KRONIX
        </h1>

        {/* Tagline */}
        <p className="font-mono text-xs sm:text-sm tracking-[0.3em] uppercase text-[#4DFFB4] mb-8">
          PERPETUAL · STRATEGY · ONCHAIN
        </p>


        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
          <Link
            href="/waitlist"
            className="group relative px-8 py-3.5 bg-[#4DFFB4] text-[#0B0F0D] font-mono text-sm font-bold tracking-widest uppercase transition-all active:scale-[0.98] flex items-center gap-2 hover:bg-[#17e29a] hover:shadow-[0_0_24px_rgba(77,255,180,0.35)]"
          >
            <span>GET EARLY ACCESS</span>
            <span className="transition-transform group-hover:translate-x-1">→</span>
          </Link>
          <a
            href="#primitives"
            className="group px-8 py-3.5 border kx-border-strong bg-[#14181A]/60 backdrop-blur-sm text-white/70 font-mono text-sm font-bold tracking-widest uppercase hover:bg-[#181D1F] hover:text-white transition-all flex items-center gap-2"
          >
            <span>EXPLORE PROTOCOL</span>
            <span className="opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0 text-[#4DFFB4]">↓</span>
          </a>
        </div>
      </div>
    </main>
  );
}
