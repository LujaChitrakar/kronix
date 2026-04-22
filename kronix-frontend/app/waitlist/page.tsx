"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function WaitlistForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [telegram, setTelegram] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(6);
  const router = useRouter();

  useEffect(() => {
    if (!submitted) return;
    if (countdown === 0) {
      router.push("/");
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [submitted, countdown, router]);

  const handleSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!name || !email) return;
    setLoading(true);
    setError(null);
    setSubmitted(true);
    
    const { error: sbError } = await supabase.from("waitlist").insert({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      telegram: telegram.trim() || null,
    });
    
    if (sbError) {
      setError(
        sbError.code === "23505"
        ? "This email is already on the waitlist."
        : "Something went wrong. Please try again."
      );
      setLoading(false);
      return;
    }

    setLoading(false);
  };

  const REDIRECT_SECONDS = 6;
  const circumference = 2 * Math.PI * 13;
  const dashOffset = circumference - circumference * (countdown / REDIRECT_SECONDS);

  return (
    <main className="relative min-h-screen flex items-center justify-center px-4 py-20 bg-kx-base overflow-hidden">
      {/* Heartbeat glow */}
      <div className="heartbeat-glow opacity-60" />

      {/* Back link */}
      <Link
        href="/"
        className="absolute top-6 left-6 font-mono text-[11px] tracking-[0.2em] uppercase text-white/40 hover:text-[#4DFFB4] transition-colors flex items-center gap-2 z-20"
      >
        <span>←</span>
        <span>BACK</span>
      </Link>

      <div className="relative z-10 w-full max-w-md">
        {/* Corner marks */}
        <div className="relative bg-kx-surface border kx-border-strong">
          <span className="absolute -top-px -left-px w-2.5 h-2.5 border-t border-l border-[#4DFFB4]" />
          <span className="absolute -top-px -right-px w-2.5 h-2.5 border-t border-r border-[#4DFFB4]" />
          <span className="absolute -bottom-px -left-px w-2.5 h-2.5 border-b border-l border-[#4DFFB4]" />
          <span className="absolute -bottom-px -right-px w-2.5 h-2.5 border-b border-r border-[#4DFFB4]" />

          {/* Status bar */}
          <div className="flex items-center justify-between px-6 py-3 hairline-b">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-[#4DFFB4] pulse-dot rounded-full" />
              <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-[#4DFFB4]">
                {submitted ? "CONFIRMED" : "EARLY ACCESS"}
              </span>
            </div>
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-white/30">
              KRONIX / v1
            </span>
          </div>

          <div className="px-6 sm:px-8 py-8">
            {submitted ? (
              <SuccessView
                email={email}
                name={name}
                countdown={countdown}
                totalSeconds={REDIRECT_SECONDS}
                circumference={circumference}
                dashOffset={dashOffset}
              />
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col">
                <h1 className="font-headline text-4xl sm:text-5xl font-extrabold tracking-tighter text-white leading-[0.9] mb-3">
                  JOIN THE<br />
                  <span className="text-[#4DFFB4]">WAITLIST</span>
                </h1>
                <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-white/40 mb-8">
                  BE FIRST TO TRADE on KRONIX
                </p>

                <Field
                  id="wl-name"
                  label="NAME"
                  type="text"
                  placeholder="your name"
                  value={name}
                  onChange={setName}
                />
                <Field
                  id="wl-email"
                  label="EMAIL"
                  type="email"
                  placeholder="you@domain.com"
                  value={email}
                  onChange={setEmail}
                />
                <Field
                  id="wl-telegram"
                  label="TELEGRAM"
                  optional
                  type="text"
                  placeholder="username"
                  prefix="@"
                  value={telegram}
                  onChange={(v) => setTelegram(v.replace(/^@/, ""))}
                />

                {error && (
                  <div className="mt-2 mb-3 px-3 py-2 border border-red-400/30 bg-red-400/5">
                    <p className="font-mono text-[11px] tracking-wide text-red-300">
                      {error}
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !name || !email}
                  className="group relative mt-4 px-6 py-3.5 bg-[#4DFFB4] text-[#0B0F0D] font-mono text-sm font-bold tracking-widest uppercase transition-all active:scale-[0.99] flex items-center justify-center gap-2 hover:bg-[#17e29a] hover:shadow-[0_0_24px_rgba(77,255,180,0.35)] disabled:bg-white/10 disabled:text-white/30 disabled:cursor-not-allowed disabled:shadow-none overflow-hidden"
                >
                  {loading && (
                    <span className="absolute inset-y-0 left-0 w-1/3 scan-line opacity-70 animate-[ticker-scroll_1.2s_linear_infinite]" />
                  )}
                  <span className="relative">
                    {loading ? "TRANSMITTING" : "REQUEST ACCESS"}
                  </span>
                  {!loading && (
                    <span className="relative transition-transform group-hover:translate-x-1">
                      →
                    </span>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* Footer row */}
        <div className="mt-4 flex items-center justify-between px-1 font-mono text-[10px] tracking-[0.2em] uppercase text-white/25">
          <span>KRONIX</span>
          <span>SOLANA</span>
        </div>
      </div>
    </main>
  );
}

function Field({
  id,
  label,
  type,
  placeholder,
  value,
  onChange,
  optional,
  prefix,
}: {
  id: string;
  label: string;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  optional?: boolean;
  prefix?: string;
}) {
  return (
    <div className="mb-4">
      <label
        htmlFor={id}
        className="flex items-center justify-between mb-1.5 font-mono text-[10px] tracking-[0.2em] uppercase text-white/40"
      >
        <span>{label}</span>
        {optional && <span className="text-white/20">OPTIONAL</span>}
      </label>
      <div className="relative">
        {prefix && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-white/30 pointer-events-none">
            {prefix}
          </span>
        )}
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full bg-kx-surface-lo border border-white/10 text-white font-mono text-sm py-3 ${
            prefix ? "pl-7 pr-3" : "px-3"
          } outline-none transition-colors placeholder:text-white/20 focus:border-[#4DFFB4]/60 focus:bg-[#0B0F0D]`}
          autoComplete="off"
        />
      </div>
    </div>
  );
}

function SuccessView({
  countdown,
  totalSeconds,
  circumference,
  dashOffset,
}: {
  email: string;
  name: string;
  countdown: number;
  totalSeconds: number;
  circumference: number;
  dashOffset: number;
}) {
  return (
    <div className="flex flex-col">
      {/* Check */}
      <div className="relative w-20 h-20 mx-auto mb-7">
        <span className="absolute inset-0 rounded-full border border-[#4DFFB4]/20 expand-ring" />
        <span
          className="absolute inset-0 rounded-full border border-[#4DFFB4]/40 expand-ring"
          style={{ animationDelay: "0.15s" }}
        />
        <span
          className="absolute -inset-3 rounded-full bg-[#4DFFB4]/5 blur-xl expand-ring"
          style={{ animationDelay: "0.05s" }}
        />
        <div
          className="absolute inset-2 rounded-full border border-[#4DFFB4]/60 bg-[#4DFFB4]/5 flex items-center justify-center expand-ring"
          style={{ animationDelay: "0.1s" }}
        >
          <svg width="30" height="30" viewBox="0 0 22 22" fill="none">
            <path
              d="M5 11.5l4.5 4.5 7.5-8.5"
              stroke="#4DFFB4"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="draw-check"
            />
          </svg>
        </div>
      </div>

      <h2
        className="font-headline text-4xl sm:text-5xl font-extrabold tracking-tighter text-white leading-[0.9] text-center mb-3 fade-up-in"
        style={{ animationDelay: "0.2s" }}
      >
        YOU&apos;RE ON<br />
        <span className="text-[#4DFFB4]">THE LIST </span>
      </h2>

      <p
        className="font-mono text-[11px] tracking-[0.2em] uppercase text-[#4DFFB4]/80 text-center mb-4 fade-up-in"
        style={{ animationDelay: "0.3s" }}
      >
        BETA TESTER · CONFIRMED
      </p>

      <p
        className="text-sm text-white/55 text-center leading-relaxed max-w-xs mx-auto mb-8 fade-up-in"
        style={{ animationDelay: "0.4s" }}
      >
        Check your email or Telegram for updates when we release the beta.
      </p>

      {/* Auto-redirect bar */}
      <div
        className="w-full hairline-t pt-4 flex items-center gap-3 fade-up-in"
        style={{ animationDelay: "0.5s" }}
      >
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-white/30 whitespace-nowrap">
          REDIRECTING
        </span>
        <div className="flex-1 h-px bg-white/10 relative overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-[#4DFFB4]"
            style={{
              width: `${(countdown / totalSeconds) * 100}%`,
              transition: "width 0.9s linear",
            }}
          />
        </div>
        <div className="relative w-8 h-8 flex items-center justify-center">
          <svg
            width="32"
            height="32"
            viewBox="0 0 32 32"
            className="absolute inset-0"
          >
            <circle
              cx="16"
              cy="16"
              r="13"
              fill="none"
              stroke="rgba(77,255,180,0.15)"
              strokeWidth="1.5"
            />
            <circle
              cx="16"
              cy="16"
              r="13"
              fill="none"
              stroke="#4DFFB4"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{
                transform: "rotate(-90deg)",
                transformOrigin: "50% 50%",
                transition: "stroke-dashoffset 0.9s linear",
              }}
            />
          </svg>
          <span className="relative font-mono text-[11px] text-[#4DFFB4] font-bold tabular-nums">
            {countdown}
          </span>
        </div>
      </div>
    </div>
  );
}
