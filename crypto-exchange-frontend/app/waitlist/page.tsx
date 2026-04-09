"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function WaitlistForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [telegram, setTelegram] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);
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

  const handleSubmit = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!name || !email) return;
    setLoading(true);
    setError(null);

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

    setSubmitted(true);
    setLoading(false);
  };

  const circumference = 2 * Math.PI * 13;
  const dashOffset = circumference - circumference * (countdown / 3);

  return (
    <div className="wl-wrap">
      <div className="wl-card">

        {submitted ? (
          <div className="wl-success">

            <div className="wl-check-ring">
              <div className="wl-check-inner">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <path
                    d="M5 11.5l4.5 4.5 7.5-8.5"
                    stroke="#7aad8f"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>

            <h2 className="wl-success-title">
              You&apos;re on the list.<br />
              <em>We&apos;ll be in touch.</em>
            </h2>

            <p className="wl-success-sub">
              We&apos;ll reach out as soon as early access opens.
              <br />
              Keep an eye on your inbox.
            </p>

            <hr className="wl-divider" />

            <div className="wl-redirect-row">
              <span className="wl-redirect-label">Redirecting to home</span>
              <div className="wl-progress-track">
                <div className="wl-progress-bar" />
              </div>
              <div className="wl-ring-wrap">
                <svg width="30" height="30" viewBox="0 0 32 32">
                  <circle
                    cx="16" cy="16" r="13"
                    fill="none"
                    stroke="rgba(122,173,143,0.15)"
                    strokeWidth="2"
                  />
                  <circle
                    cx="16" cy="16" r="13"
                    fill="none"
                    stroke="#7aad8f"
                    strokeWidth="2"
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
                <span className="wl-countdown">{countdown}</span>
              </div>
            </div>

          </div>
        ) : (
          <>
            <p className="wl-eyebrow">Early access</p>
            <h1 className="wl-title">
              Join the<br />
              <em>waitlist.</em>
            </h1>
            <p className="wl-sub">
              Be one of the first to trade with Kronix
            </p>

            <div className="wl-field">
              <label className="wl-label" htmlFor="wl-name">Name</label>
              <input
                id="wl-name"
                className="wl-input"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="wl-field">
              <label className="wl-label" htmlFor="wl-email">Email</label>
              <input
                id="wl-email"
                className="wl-input"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="wl-field">
              <label className="wl-label" htmlFor="wl-telegram">
                Telegram <span className="wl-optional">optional</span>
              </label>
              <div className="wl-input-prefix-wrap">
                <span className="wl-prefix">@</span>
                <input
                  id="wl-telegram"
                  className="wl-input wl-input-prefixed"
                  type="text"
                  placeholder="username"
                  value={telegram}
                  onChange={(e) => setTelegram(e.target.value.replace(/^@/, ""))}
                />
              </div>
            </div>

            {error && <p className="wl-error">{error}</p>}

            <button
              className="wl-btn"
              onClick={handleSubmit}
              disabled={loading || !name || !email}
            >
              {loading ? "Submitting…" : "Request access"}
            </button>

            <hr className="wl-divider" />
            <p className="wl-count">
              KRONIX
            </p>
          </>
        )}
      </div>

      <style jsx>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&display=swap');

        .wl-wrap {
          font-family: 'DM Sans', sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          padding: 2rem 1rem;
          background: rgb(18, 23, 21);
        }

        .wl-card {
          background: rgb(26, 35, 32);
          border: 0.5px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 2.5rem 2rem;
          max-width: 420px;
          width: 100%;
        }

        /* ── Success state ── */

        .wl-success {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0.5rem 0 0.25rem;
        }

        .wl-check-ring {
          width: 68px;
          height: 68px;
          border-radius: 50%;
          border: 1.5px solid rgba(122, 173, 143, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 1.5rem;
          animation: pulse-ring 2.5s ease-out infinite;
        }

        .wl-check-inner {
          width: 46px;
          height: 46px;
          border-radius: 50%;
          background: rgba(122, 173, 143, 0.1);
          display: flex;
          align-items: center;
          justify-content: center;
          animation: pop-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) both;
        }

        @keyframes pulse-ring {
          0%   { box-shadow: 0 0 0 0 rgba(122, 173, 143, 0.2); }
          70%  { box-shadow: 0 0 0 12px rgba(122, 173, 143, 0); }
          100% { box-shadow: 0 0 0 0 rgba(122, 173, 143, 0); }
        }

        @keyframes pop-in {
          from { transform: scale(0.6); opacity: 0; }
          to   { transform: scale(1);   opacity: 1; }
        }

        .wl-success-title {
          font-family: 'DM Serif Display', serif;
          font-size: 26px;
          line-height: 1.25;
          color: #e8ede9;
          text-align: center;
          font-weight: 400;
          margin: 0 0 0.6rem;
          animation: fade-up 0.5s 0.1s ease both;
        }

        .wl-success-title em {
          font-style: italic;
          color: #a5c9b0;
        }

        .wl-success-sub {
          font-size: 13px;
          color: rgba(232, 237, 233, 0.45);
          text-align: center;
          font-weight: 300;
          line-height: 1.7;
          margin: 0 0 1.75rem;
          animation: fade-up 0.5s 0.2s ease both;
        }

        @keyframes fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Redirect row ── */

        .wl-redirect-row {
          width: 100%;
          display: flex;
          align-items: center;
          gap: 10px;
          animation: fade-up 0.5s 0.3s ease both;
        }

        .wl-redirect-label {
          font-size: 11px;
          color: rgba(232, 237, 233, 0.3);
          font-weight: 300;
          letter-spacing: 0.03em;
          white-space: nowrap;
        }

        .wl-progress-track {
          flex: 1;
          height: 1.5px;
          background: rgba(255, 255, 255, 0.07);
          border-radius: 2px;
          overflow: hidden;
        }

        .wl-progress-bar {
          height: 100%;
          width: 100%;
          background: #7aad8f;
          border-radius: 2px;
          animation: drain 3s linear forwards;
          transform-origin: left;
        }

        @keyframes drain {
          from { width: 100%; }
          to   { width: 0%; }
        }

        .wl-ring-wrap {
          position: relative;
          width: 30px;
          height: 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .wl-ring-wrap svg {
          position: absolute;
          top: 0;
          left: 0;
        }

        .wl-countdown {
          position: relative;
          font-size: 11px;
          color: #7aad8f;
          font-weight: 500;
          z-index: 1;
        }

        /* ── Form state ── */

        .wl-eyebrow {
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: #7aad8f;
          font-weight: 500;
          margin: 0 0 1rem;
        }

        .wl-title {
          font-family: 'DM Serif Display', serif;
          font-size: 30px;
          line-height: 1.2;
          color: #e8ede9;
          margin: 0 0 0.4rem;
          font-weight: 400;
        }

        .wl-title em {
          font-style: italic;
          color: #a5c9b0;
        }

        .wl-sub {
          font-size: 14px;
          color: rgba(232, 237, 233, 0.5);
          margin: 0 0 1.75rem;
          font-weight: 300;
          line-height: 1.65;
        }

        .wl-field {
          margin-bottom: 12px;
        }

        .wl-label {
          display: block;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: rgba(232, 237, 233, 0.4);
          margin-bottom: 6px;
          font-weight: 500;
        }

        .wl-optional {
          font-size: 10px;
          letter-spacing: 0.04em;
          color: rgba(232, 237, 233, 0.25);
          text-transform: none;
          margin-left: 4px;
        }

        .wl-input {
          width: 100%;
          box-sizing: border-box;
          border: 0.5px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 14px;
          font-family: 'DM Sans', sans-serif;
          background: rgba(255, 255, 255, 0.05);
          color: #e8ede9;
          outline: none;
          transition: border-color 0.15s;
        }

        .wl-input:focus {
          border-color: #7aad8f;
        }

        .wl-input::placeholder {
          color: rgba(232, 237, 233, 0.25);
        }

        .wl-input-prefix-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .wl-prefix {
          position: absolute;
          left: 14px;
          font-size: 14px;
          color: rgba(232, 237, 233, 0.35);
          pointer-events: none;
          font-family: 'DM Sans', sans-serif;
        }

        .wl-input-prefixed {
          padding-left: 26px;
        }

        .wl-error {
          font-size: 13px;
          color: #e07070;
          margin: 0 0 10px;
          font-weight: 300;
        }

        .wl-btn {
          width: 100%;
          margin-top: 8px;
          background: #e8ede9;
          color: #1a2320;
          border: none;
          border-radius: 8px;
          padding: 12px;
          font-size: 14px;
          font-family: 'DM Sans', sans-serif;
          font-weight: 500;
          letter-spacing: 0.03em;
          cursor: pointer;
          transition: opacity 0.15s, transform 0.1s;
        }

        .wl-btn:hover:not(:disabled) { opacity: 0.85; }
        .wl-btn:active:not(:disabled) { transform: scale(0.99); }
        .wl-btn:disabled { opacity: 0.35; cursor: not-allowed; }

        .wl-divider {
          width: 100%;
          border: none;
          border-top: 0.5px solid rgba(255, 255, 255, 0.07);
          margin: 1.5rem 0;
        }

        .wl-count {
          font-size: 12px;
          color: rgba(232, 237, 233, 0.35);
          text-align: center;
          font-weight: 300;
          margin: 0;
        }

        .wl-dot {
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #7aad8f;
          margin-right: 6px;
          vertical-align: middle;
        }
      `}</style>
    </div>
  );
}