export default function Navbar() {
  return (
    <nav className="fixed top-6 left-1/2 -translate-x-1/2 w-[95%] max-w-6xl z-50 bg-[#222F2B]/20 backdrop-blur-3xl flex justify-between items-center px-8 h-16 rounded-full border border-[#222F2B]/30 shadow-2xl shadow-black/20 transition-all duration-300">
      {/* Logo */}
      <div className="text-xl font-bold tracking-tighter text-[#e3e1ea] font-headline uppercase flex items-center gap-2">
        <span
          className="material-symbols-outlined text-[#4dffb4]"
          style={{
            fontVariationSettings: "'FILL' 1, 'wght' 700, 'GRAD' 0, 'opsz' 48",
          }}
        >
          bubble_chart
        </span>
        KRONIX
      </div>

      {/* Nav Links */}
      <div className="hidden md:flex items-center gap-8">
        <a
          href="#"
          className="text-[#e3e1ea] hover:text-[#4dffb4] font-headline font-semibold tracking-tight transition-colors duration-150"
        >
          GitHub
        </a>
        <a
          href="#"
          className="text-[#e3e1ea]/60 hover:text-[#e3e1ea] font-headline font-semibold tracking-tight transition-colors duration-150"
        >
          Docs
        </a>
        <a
          href="#"
          className="text-[#e3e1ea]/60 hover:text-[#e3e1ea] font-headline font-semibold tracking-tight transition-colors duration-150"
        >
          App
        </a>
      </div>

      {/* CTA Button */}
      <button className="bg-[#222F2B] text-[#4DFFB4] px-6 py-2.5 text-sm font-headline font-bold rounded-full border border-[#4DFFB4]/20 hover:shadow-lg hover:shadow-[#222F2B]/40 transition-all duration-150 active:scale-95">
        Launch App
      </button>
    </nav>
  );
}