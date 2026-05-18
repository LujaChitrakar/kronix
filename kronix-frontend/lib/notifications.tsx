"use client";

import { toast } from "sonner";

type ToastLevel = "success" | "error" | "warning" | "info";

const levelStyles: Record<
  ToastLevel,
  { accent: string; bg: string; border: string; icon: string }
> = {
  success: {
    accent: "text-[#4dffb4]",
    bg: "bg-[#4dffb4]/7",
    border: "border-white/10",
    icon: "check_circle",
  },
  error: {
    accent: "text-[#ff6b6b]",
    bg: "bg-[#ff6b6b]/7",
    border: "border-white/10",
    icon: "error",
  },
  warning: {
    accent: "text-[#ffb86b]",
    bg: "bg-[#ffb86b]/7",
    border: "border-white/10",
    icon: "warning",
  },
  info: {
    accent: "text-[#77c8ff]",
    bg: "bg-[#77c8ff]/7",
    border: "border-white/10",
    icon: "info",
  },
};

type SolanaExplorerCluster = "devnet" | "mainnet-beta";

function explorerUrl(
  signature: string,
  cluster: SolanaExplorerCluster = "devnet",
): string {
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

function shortSig(signature: string): string {
  return `${signature.slice(0, 6)}...${signature.slice(-6)}`;
}

function notify(level: ToastLevel, title: string, description?: string) {
  const style = levelStyles[level];
  toast.custom(
    () => (
      <div
        className={`relative flex w-[336px] max-w-[calc(100vw-1.5rem)] items-start gap-2.5 overflow-hidden rounded-md border ${style.border} bg-[#101416]/95 px-3.5 py-3 text-on-surface shadow-lg shadow-black/25 backdrop-blur-sm`}
      >
        <span className={`absolute inset-y-0 left-0 w-px ${style.bg}`} />
        {/*<span
          className={`material-symbols-outlined mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.03] text-[13px] leading-none ${style.accent}`}
        >
          {style.icon}
        </span>*/}
        <div className="min-w-0 flex-1">
          <div className="truncate font-headline text-sm font-bold leading-4">
            {title}
          </div>
          {description && (
            <div className="mt-1 line-clamp-2 whitespace-pre-wrap break-words font-mono text-xs leading-4 text-on-surface-variant/85">
              {description}
            </div>
          )}
        </div>
      </div>
    ),
    { duration: level === "error" ? 8000 : 4500 },
  );
}

export function notifyTxSuccess(
  title: string,
  signature: string,
  description?: string,
  cluster: SolanaExplorerCluster = "devnet",
) {
  toast.custom(
    () => (
      <div className="relative flex w-[372px] max-w-[calc(100vw-1.5rem)] items-center gap-2.5 overflow-hidden rounded-md border border-white/10 bg-[#101416]/95 px-3.5 py-3 text-on-surface shadow-lg shadow-black/25 backdrop-blur-sm">
        <span className="absolute inset-y-0 left-0 w-px bg-[#4dffb4]/25" />
        {/*<span
          className={`material-symbols-outlined grid h-5 w-5 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.03] text-[13px] leading-none ${style.accent}`}
        >
          check_circle
        </span>*/}
        <div className="min-w-0 flex-1">
          <div className="truncate font-headline text-sm font-bold leading-4">
            {title}
          </div>
          {description && (
            <div className="mt-1 truncate font-mono text-xs leading-4 text-on-surface-variant/85">
              {description}
            </div>
          )}
        </div>
        <a
          href={explorerUrl(signature, cluster)}
          target="_blank"
          rel="noreferrer"
          title={`Open ${cluster === "devnet" ? "devnet" : "mainnet"} explorer`}
          className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded border border-white/10 bg-white/[0.03] px-2 font-mono text-[11px] font-bold leading-none text-[#4dffb4] transition-colors hover:border-[#4dffb4]/30 hover:bg-[#4dffb4]/8"
        >
          <span className="leading-none">{shortSig(signature)}</span>
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="h-4 w-4 shrink-0 self-center"
            fill="none"
          >
            <path
              d="M6 4h6v6M12 4 5 11M4 5v7h7"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </a>
      </div>
    ),
    { duration: 7000 },
  );
}

export const notifyError = (title: string, description?: string) =>
  notify("error", title, description);
export const notifySuccess = (title: string, description?: string) =>
  notify("success", title, description);
export const notifyWarning = (title: string, description?: string) =>
  notify("warning", title, description);
export const notifyInfo = (title: string, description?: string) =>
  notify("info", title, description);
