export default function Hero() {
  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center pt-16 overflow-hidden">
      {/* Animated Glow Background */}
      <div className="heartbeat-glow" />

      {/* Hero Content */}
      <div className="relative z-10 text-center px-4">
        <h1 className="font-headline text-[5rem] md:text-[8rem] font-extrabold tracking-tighter text-white leading-none mb-4 select-none">
          KRONIX
        </h1>
        <p className="font-headline text-xl md:text-2xl text-[#bacbbe] font-semibold tracking-tight uppercase opacity-80">
          Perpetual. Strategy. Onchain.
        </p>
        {/*<p className="font-body text-sm md:text-base text-[#E8F4F0] font-medium tracking-[0.3em] uppercase mt-4 opacity-90 select-none transition-all duration-700">
          Coming Soon
        </p>*/}
      </div>
    </main>
  );
}