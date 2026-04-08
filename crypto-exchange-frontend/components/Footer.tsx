const footerLinks = [
  { label: "Terms", href: "#" },
  { label: "Privacy", href: "#" },
  { label: "Status", href: "#" },
];

export default function Footer() {
  return (
    <footer className="bg-[rgb(17, 60, 30)] w-full py-12 flex flex-col md:flex-row justify-between items-center px-12 border-t border-[#3B4A41]/15">
      {/* Brand */}
      <div className="text-[#4DFFB4] font-bold font-headline tracking-tighter mb-4 md:mb-0">
        KRONIX
      </div>

      {/* Copyright */}
      <div className="font-['Inter'] text-[0.6875rem] uppercase tracking-widest text-[#BACBBE]/50 mb-4 md:mb-0">
        © 2024 KRONIX INFRASTRUCTURE. ALL RIGHTS RESERVED.
      </div>

      {/* Links */}
      <div className="flex gap-8">
        {footerLinks.map((link) => (
          <a
            key={link.label}
            href={link.href}
            className="font-['Inter'] text-[0.6875rem] uppercase tracking-widest text-[#BACBBE]/50 hover:text-[#4DFFB4] transition-opacity opacity-80 hover:opacity-100"
          >
            {link.label}
          </a>
        ))}
      </div>
    </footer>
  );
}