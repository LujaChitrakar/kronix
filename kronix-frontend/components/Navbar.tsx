"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";

export default function Navbar() {
  const [open, setOpen] = useState(false);

  // Lock body scroll when menu is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <nav className="fixed top-4 sm:top-6 left-1/2 -translate-x-1/2 w-[92%] sm:w-[95%] max-w-7xl z-50 bg-[#222F2B]/20 backdrop-blur-3xl flex justify-between items-center px-4 sm:px-8 h-14 sm:h-16 rounded-full border border-[#222F2B]/30 shadow-2xl shadow-black/20 transition-all duration-300">
        {/* Logo */}
        <div className="text-lg sm:text-xl font-bold tracking-tighter text-[#e3e1ea] font-headline uppercase flex items-center">
          <Image
            src="/logo.png"
            alt="Logo"
            width={80}
            height={80}
            className="w-14 h-14 sm:w-20 sm:h-20"
          />
          KRONIX
        </div>

        {/* Desktop Nav Links */}
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
            href="/"
            className="bg-[#222F2B] text-[#4DFFB4] px-6 py-2.5 text-sm font-headline font-bold rounded-full border border-[#4DFFB4]/20 hover:shadow-lg hover:shadow-[#222F2B]/40 transition-all duration-150 active:scale-95"
          >
            Launch App
          </Link>
        </div>

        {/* Mobile hamburger button */}
        <button
          id="mobile-menu-toggle"
          className="md:hidden relative w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/5 transition-colors"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          <div className="flex flex-col justify-center items-center w-5 gap-[5px]">
            <span
              className={`block h-[1.5px] w-5 bg-[#e3e1ea] rounded-full transition-all duration-300 origin-center ${
                open ? "rotate-45 translate-y-[3.25px]" : ""
              }`}
            />
            <span
              className={`block h-[1.5px] w-5 bg-[#e3e1ea] rounded-full transition-all duration-300 origin-center ${
                open ? "-rotate-45 -translate-y-[3.25px]" : ""
              }`}
            />
          </div>
        </button>
      </nav>

      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 z-40 bg-[#0D0E14]/90 backdrop-blur-2xl transition-all duration-300 md:hidden ${
          open
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setOpen(false)}
      >
        <div
          className={`flex flex-col items-center justify-center h-full gap-8 transition-all duration-500 ${
            open ? "translate-y-0 opacity-100" : "-translate-y-8 opacity-0"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          <a
            href="https://x.com/KronixTrade"
            className="flex items-center gap-3 text-[#e3e1ea] text-lg font-body transition-colors duration-150"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.261 5.632 5.903-5.632Zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Follow on X
          </a>

          <Link
            href="/"
            onClick={() => setOpen(false)}
            className="bg-[#222F2B] text-[#4DFFB4] px-10 py-3.5 text-base font-headline font-bold rounded-full border border-[#4DFFB4]/20 hover:shadow-lg hover:shadow-[#222F2B]/40 transition-all duration-150 active:scale-95"
          >
            Launch App
          </Link>
        </div>
      </div>
    </>
  );
}
