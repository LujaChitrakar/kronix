"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  findPositionPda,
  findMarketConfigPda,
} from "@/lib/kronix/pdas";
import { fetchPosition, fetchMarketConfig, bytesToPubkey } from "@/lib/kronix/state";
import { MARKET_INDEX, MARKET_NAME } from "@/lib/kronix/config";
import {
  sendClosePosition,
  sendAddMargin,
  sendRemoveMargin,
  sendSettleFunding,
} from "@/lib/kronix/client";
import { sendTx, formatTxError } from "./tx";

function fmtUsdc(n: bigint): string {
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${sign}${whole}.${frac}`;
}

export function PositionPanel() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;

  const [pos, setPos] = useState<{
    size: bigint;
    side: number;
    entryPrice: bigint;
    initialMargin: bigint;
  } | null>(null);
  const [oracle, setOracle] = useState<PublicKey | null>(null);
  const [cfg, setCfg] = useState<{
    quoteLotSize: bigint;
    maintenanceMarginBps: number;
  } | null>(null);
  const [markPriceNative, setMarkPriceNative] = useState<bigint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [marginAmt, setMarginAmt] = useState("");

  const refresh = useCallback(async () => {
    if (!owner) return;
    const [posPda] = findPositionPda(owner, MARKET_INDEX);
    const [cfgPda] = findMarketConfigPda(MARKET_INDEX);
    const [p, cfg] = await Promise.all([
      fetchPosition(connection, posPda),
      fetchMarketConfig(connection, cfgPda),
    ]);
    if (p && p.size !== 0n) {
      setPos({
        size: p.size,
        side: p.side,
        entryPrice: p.entryPrice,
        initialMargin: p.initialMargin,
      });
    } else {
      setPos(null);
    }
    if (cfg) {
      const oraclePk = bytesToPubkey(cfg.oracle);
      setOracle(oraclePk);
      setCfg({
        quoteLotSize: cfg.quoteLotSize,
        maintenanceMarginBps: cfg.maintenanceMarginBps,
      });
      const oraclePriceAcc = await connection.getAccountInfo(
        oraclePk,
        "confirmed",
      );
      if (oraclePriceAcc && oraclePriceAcc.data.length >= 134) {
        const buf = oraclePriceAcc.data;
        const rawPrice = buf.readBigInt64LE(73);
        const exponent = buf.readInt32LE(89);
        const scaleExp = 6 + exponent;
        let normalized: bigint;
        if (scaleExp >= 0) {
          normalized = rawPrice * 10n ** BigInt(scaleExp);
        } else {
          normalized = rawPrice / 10n ** BigInt(-scaleExp);
        }
        setMarkPriceNative(normalized);
      }
    }
  }, [connection, owner]);

  useEffect(() => {
    refresh().catch(console.error);
    const t = setInterval(() => refresh().catch(() => null), 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setMsg("");
    try {
      const sig = await fn();
      setMsg(`${label} → ${sig.slice(0, 8)}…`);
      await refresh();
    } catch (e) {
      setMsg(`${label} failed:\n${formatTxError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const baseUnits = (() => {
    const f = parseFloat(marginAmt);
    if (!isFinite(f) || f <= 0) return 0n;
    return BigInt(Math.floor(f * 1_000_000));
  })();

  // Maintenance margin requirement in native USDC.
  // Mirrors risk_program required_maintenance_margin after mark_price → price_lots conversion:
  //   mark_price_lots = mark_price_native / quote_lot_size
  //   notional = size × mark_price_lots × quote_lot_size
  //   maint    = notional × maint_bps / 10000
  // (size × mark_price_lots × quote_lot_size simplifies but keep explicit for parity.)
  const maintenanceMargin: bigint | null = (() => {
    if (!pos || !cfg || markPriceNative === null) return null;
    if (cfg.quoteLotSize === 0n) return null;
    const markLots = markPriceNative / cfg.quoteLotSize;
    const notional = pos.size * markLots * cfg.quoteLotSize;
    return (notional * BigInt(cfg.maintenanceMarginBps)) / 10_000n;
  })();

  const maxRemovable: bigint = (() => {
    if (!pos) return 0n;
    if (maintenanceMargin === null) return pos.initialMargin;
    if (pos.initialMargin <= maintenanceMargin) return 0n;
    return pos.initialMargin - maintenanceMargin;
  })();

  const removeExceeds =
    pos !== null && baseUnits > 0n && baseUnits > maxRemovable;

  return (
    <div className="bg-kx-surface rounded-xl border kx-border p-4">
      <div className="font-headline text-sm text-on-surface mb-3 uppercase tracking-wider">
        {MARKET_NAME} Position
      </div>

      {!owner && (
        <div className="text-on-surface-variant text-sm">Connect wallet.</div>
      )}

      {owner && !pos && (
        <div className="text-on-surface-variant text-sm">No open position.</div>
      )}

      {owner && pos && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4 text-sm font-mono">
            <Stat label="Side" v={pos.side === 0 ? "LONG" : "SHORT"} accent={pos.side === 0} />
            <Stat label="Size (lots)" v={String(pos.size)} />
            <Stat label="Entry (lots)" v={String(pos.entryPrice)} />
            <Stat
              label="Margin"
              v={`$${fmtUsdc(pos.initialMargin)} (${pos.initialMargin} native)`}
            />
            {markPriceNative !== null && (
              <Stat
                label="Mark"
                v={`$${fmtUsdc(markPriceNative)} (${markPriceNative} native)`}
              />
            )}
            {maintenanceMargin !== null && (
              <Stat
                label="Maint Req"
                v={`$${fmtUsdc(maintenanceMargin)} (${maintenanceMargin} native)`}
              />
            )}
            <Stat
              label="Removable"
              v={`$${fmtUsdc(maxRemovable)} (${maxRemovable} native)`}
            />
          </div>
          {maintenanceMargin !== null &&
            pos.initialMargin < maintenanceMargin && (
              <div className="mb-2 px-2 py-1.5 rounded-md border border-[#ff6b6b]/40 bg-[#ff6b6b]/10 text-[10px] font-mono text-[#ff6b6b]">
                Position UNDER maintenance ({fmtUsdc(pos.initialMargin)} &lt;{" "}
                {fmtUsdc(maintenanceMargin)}). Liquidatable. Add margin or
                close position. Removal blocked.
              </div>
            )}

          <div className="flex gap-2 mb-2">
            <input
              value={marginAmt}
              onChange={(e) => setMarginAmt(e.target.value)}
              placeholder="USDC"
              inputMode="decimal"
              className="flex-1 bg-kx-surface-lo border kx-border rounded-md px-3 py-2 text-sm font-mono text-on-surface"
            />
            <button
              type="button"
              onClick={() =>
                setMarginAmt((Number(maxRemovable) / 1_000_000).toString())
              }
              className="px-3 py-2 text-[10px] font-mono rounded-md border kx-border bg-kx-surface-lo text-on-surface-variant hover:text-on-surface"
            >
              MAX
            </button>
          </div>
          {removeExceeds && (
            <div className="mb-2 text-[10px] font-mono text-[#ffb86b]">
              − Margin: {String(baseUnits)} &gt; removable {String(maxRemovable)}{" "}
              native (initial {String(pos.initialMargin)} − maintenance{" "}
              {maintenanceMargin === null ? "?" : String(maintenanceMargin)}).
              Reduce or use MAX.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <button
              disabled={!!busy || baseUnits === 0n}
              onClick={() =>
                run("Add margin", () =>
                  sendAddMargin(owner, baseUnits, connection, (ixs, c) =>
                    sendTx(wallet, c, ixs),
                  ),
                )
              }
              className="bg-kx-surface-hi text-on-surface px-3 py-2 text-xs font-headline font-bold rounded-md border kx-border disabled:opacity-50"
            >
              + Margin
            </button>
            <button
              disabled={!!busy || baseUnits === 0n || !oracle || removeExceeds}
              onClick={() =>
                run("Remove margin", () =>
                  sendRemoveMargin(owner, oracle!, baseUnits, connection, (ixs, c) =>
                    sendTx(wallet, c, ixs),
                  ),
                )
              }
              className="bg-kx-surface-hi text-on-surface px-3 py-2 text-xs font-headline font-bold rounded-md border kx-border disabled:opacity-50"
            >
              − Margin
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={!!busy || !oracle}
              onClick={() =>
                run("Close", () =>
                  sendClosePosition(owner, oracle!, pos.size, connection, (ixs, c) =>
                    sendTx(wallet, c, ixs),
                  ),
                )
              }
              className="bg-[#ff6b6b]/20 text-[#ff6b6b] px-3 py-2 text-xs font-headline font-bold rounded-md border border-[#ff6b6b]/30 disabled:opacity-50"
            >
              Close Position
            </button>
            <button
              disabled={!!busy}
              onClick={() =>
                run("Settle funding", () =>
                  sendSettleFunding(owner, connection, (ixs, c) =>
                    sendTx(wallet, c, ixs),
                  ),
                )
              }
              className="bg-kx-surface-hi text-on-surface px-3 py-2 text-xs font-headline font-bold rounded-md border kx-border disabled:opacity-50"
            >
              Settle Funding
            </button>
          </div>
        </>
      )}

      {msg && (
        <pre className="mt-3 text-[10px] font-mono text-on-surface-variant break-all whitespace-pre-wrap max-h-64 overflow-auto bg-kx-surface-lo p-2 rounded-md border kx-border">
          {busy ? `${busy}…` : msg}
        </pre>
      )}
    </div>
  );
}

function Stat({ label, v, accent }: { label: string; v: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-on-surface-variant/70 uppercase">{label}</div>
      <div className={accent ? "text-[#4dffb4]" : "text-on-surface"}>{v}</div>
    </div>
  );
}
