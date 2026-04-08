import Image from "next/image";
import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="fixed top-6 left-1/2 -translate-x-1/2 w-[95%] max-w-7xl z-50 bg-[#222F2B]/20 backdrop-blur-3xl flex justify-between items-center px-8 h-16 rounded-full border border-[#222F2B]/30 shadow-2xl shadow-black/20 transition-all duration-300">
      {/* Logo */}
      <div className="text-xl font-bold tracking-tighter text-[#e3e1ea] font-headline uppercase flex items-center">
        <Image
          src="/logo.png"
          alt="Logo"
          width={80}
          height={80}
        />
        KRONIX
      </div>

      {/* Nav Links */}
      <div className="hidden md:flex items-center gap-8">
        <a
          href="https://x.com/KronixTrade"
          className="transition-colors duration-150"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="25"
            height="25"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-label="X (Twitter)"
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.261 5.632 5.903-5.632Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          <span className="sr-only">X (Twitter)</span>
        </a>

        <Link
          href="/waitlist"
          className="bg-[#222F2B] text-[#4DFFB4] px-6 py-2.5 text-sm font-headline font-bold rounded-full border border-[#4DFFB4]/20 hover:shadow-lg hover:shadow-[#222F2B]/40 transition-all duration-150 active:scale-95"
        >
          Join Waitlist
        </Link>
      </div>
    </nav>
  );
}