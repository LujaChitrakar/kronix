const items = [
  { sym: "KXI-PERP" },
  { sym: "SOL-PERP" },
  // { sym: "BTC-PERP" },
  // { sym: "ETH-PERP" },
  // { sym: "BNB-PERP" },
  // { sym: "LTC-PERP" },
];

export default function Ticker() {
  const row = [...items, ...items, ...items];
  return (
    <div className="relative w-full hairline-t hairline-b bg-[#10141D] overflow-hidden">
      {/* Preview tag */}
      

      <div className="ticker-fade pl-24 sm:pl-32 py-4 sm:py-5">
        <div className="flex ticker-track whitespace-nowrap">
          {row.map((it, i) => (
            <div
              key={`${it.sym}-${i}`}
              className="flex items-center gap-3 sm:gap-4 px-5 sm:px-8 shrink-0"
            >
              <span className="font-mono text-xs sm:text-sm font-bold tracking-wider text-white">
                {it.sym}
              </span>
              <span className="font-mono text-[0.625rem] sm:text-xs font-bold tabular-nums tracking-widest px-1.5 sm:px-2 py-0.5 text-[#4DFFB4] bg-[#4DFFB4]/10">
                LIVE SOON
              </span>
              <span className="text-[#3B4A41]/50 font-mono">{"//"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
