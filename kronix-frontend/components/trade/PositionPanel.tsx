"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  findPositionPda,
  findMarketConfigPda,
} from "@/lib/kronix/pdas";
import { fetchPosition, fetchMarketConfig, bytesToPubkey } from "@/lib/kronix/state";
import {
  sendClosePosition,
  sendAddMargin,
  sendRemoveMargin,
  sendSettleFunding,
  sendCancelTriggerOrders,
} from "@/lib/kronix/client";
import {
  getMarketInfoByIndex,
  TRIGGER_PROGRAM_ID,
  TriggerStatus,
  TriggerType,
} from "@/lib/kronix/config";
import { useStore } from "@/lib/store";
import { notifyError, notifyTxSuccess } from "@/lib/notifications";
import { sendTx, formatTxError } from "./tx";
import { getTriggerOrderDecoder } from "@/lib/trigger-sdk";

const TRIGGER_ORDER_SIZE = 144;

type PositionTrigger = {
  clientOrderId: bigint;
  createdAt: bigint;
  price: bigint;
  sizeLots: bigint;
  status: number;
};

function fmtUsdc(n: bigint): string {
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${sign}${whole}.${frac}`;
}

const SWITCHBOARD_DISC = Buffer.from([196, 27, 108, 196, 10, 215, 219, 40]);
const SWITCHBOARD_VALUE_OFFSET = 2264;
const SWITCHBOARD_SLOT_OFFSET = 2368;
const SWITCHBOARD_SCALE = 1_000_000_000_000n;

function readI128LE(data: Buffer, offset: number): bigint {
  let value = 0n;
  for (let i = 0; i < 16; i++) value |= BigInt(data[offset + i]) << (8n * BigInt(i));
  return value & (1n << 127n) ? value - (1n << 128n) : value;
}

function isAttachedTriggerClientId(clientOrderId: bigint): boolean {
  const suffix = clientOrderId % 10n;
  return suffix === 1n || suffix === 2n;
}

function parseSwitchboardPriceNative(data: Buffer): bigint | null {
  if (data.length < SWITCHBOARD_SLOT_OFFSET + 8) return null;
  if (!data.subarray(0, 8).equals(SWITCHBOARD_DISC)) return null;
  if (data.readBigUInt64LE(SWITCHBOARD_SLOT_OFFSET) === 0n) return null;
  return readI128LE(data, SWITCHBOARD_VALUE_OFFSET) / SWITCHBOARD_SCALE;
}

function formatTriggers(
  triggers: PositionTrigger[],
  positionSizeLots?: bigint,
): string {
  const visible =
    positionSizeLots === undefined
      ? triggers
      : positionSizedTriggers(triggers, positionSizeLots);
  if (visible.length === 0) return "-";
  return visible
    .map((t) => `${t.price} (${t.sizeLots})${t.status === TriggerStatus.Paused ? " P" : ""}`)
    .join(", ");
}

function positionSizedTriggers(
  triggers: PositionTrigger[],
  positionSizeLots: bigint,
): PositionTrigger[] {
  let remaining = positionSizeLots;
  const byPrice = new Map<string, PositionTrigger>();

  for (const trigger of [...triggers].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? -1 : 1;
    if (a.clientOrderId !== b.clientOrderId) {
      return a.clientOrderId > b.clientOrderId ? -1 : 1;
    }
    return 0;
  })) {
    if (remaining <= 0n) break;
    if (trigger.sizeLots <= 0n) continue;

    const sizeLots = trigger.sizeLots > remaining ? remaining : trigger.sizeLots;
    remaining -= sizeLots;
    const key = `${trigger.price}:${trigger.status}`;
    const prev = byPrice.get(key);
    if (prev) {
      prev.sizeLots += sizeLots;
      continue;
    }
    byPrice.set(key, { ...trigger, sizeLots });
  }

  return Array.from(byPrice.values()).sort((a, b) =>
    a.price > b.price ? 1 : a.price < b.price ? -1 : 0,
  );
}

export function PositionPanel() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;
  const marketIndex = useStore((s) => s.selectedMarketIndex);

  const [pos, setPos] = useState<{
    size: bigint;
    side: number;
    entryPrice: bigint;
    initialMargin: bigint;
  } | null>(null);
  const [positionTriggers, setPositionTriggers] = useState<{
    takeProfit: PositionTrigger[];
    stopLoss: PositionTrigger[];
  }>({ takeProfit: [], stopLoss: [] });
  const [staleTriggerIds, setStaleTriggerIds] = useState<bigint[]>([]);
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
    const [posPda] = findPositionPda(owner, marketIndex);
    const [cfgPda] = findMarketConfigPda(marketIndex);
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
      const closeSide = p.side === 0 ? 1 : 0;
      const accs = await connection.getProgramAccounts(TRIGGER_PROGRAM_ID, {
        commitment: "confirmed",
        filters: [
          { dataSize: TRIGGER_ORDER_SIZE },
          { memcmp: { offset: 48, bytes: owner.toBase58() } },
        ],
      });
      const decoder = getTriggerOrderDecoder();
      const nextTriggers = {
        takeProfit: [] as PositionTrigger[],
        stopLoss: [] as PositionTrigger[],
      };
      for (const { account } of accs) {
        try {
          const t = decoder.decode(new Uint8Array(account.data));
          if (t.marketIndex !== marketIndex) continue;
          if (t.side !== closeSide) continue;
          if (!isAttachedTriggerClientId(t.clientOrderId)) continue;
          if (
            t.status !== TriggerStatus.Active &&
            t.status !== TriggerStatus.Paused
          ) {
            continue;
          }
          const value = {
            clientOrderId: t.clientOrderId,
            createdAt: t.createdAt,
            price: t.triggerPrice,
            sizeLots: t.sizeLots,
            status: t.status,
          };
          if (t.triggerType === TriggerType.TakeProfit) {
            nextTriggers.takeProfit.push(value);
          } else if (t.triggerType === TriggerType.StopLoss) {
            nextTriggers.stopLoss.push(value);
          }
        } catch {
          continue;
        }
      }
      const visibleTakeProfit = positionSizedTriggers(nextTriggers.takeProfit, p.size);
      const visibleStopLoss = positionSizedTriggers(nextTriggers.stopLoss, p.size);
      const visibleIds = new Set(
        [...visibleTakeProfit, ...visibleStopLoss].map((trigger) =>
          trigger.clientOrderId.toString(),
        ),
      );
      setPositionTriggers({
        takeProfit: visibleTakeProfit,
        stopLoss: visibleStopLoss,
      });
      setStaleTriggerIds(
        [...nextTriggers.takeProfit, ...nextTriggers.stopLoss]
          .filter(
            (trigger) =>
              trigger.status === TriggerStatus.Active &&
              !visibleIds.has(trigger.clientOrderId.toString()),
          )
          .map((trigger) => trigger.clientOrderId),
      );
    } else {
      setPos(null);
      setPositionTriggers({ takeProfit: [], stopLoss: [] });
      setStaleTriggerIds([]);
    }
    if (cfg) {
      const configuredOracle = getMarketInfoByIndex(marketIndex)?.oracle;
      const oraclePk = configuredOracle ?? bytesToPubkey(cfg.oracle);
      setOracle(oraclePk);
      setCfg({
        quoteLotSize: cfg.quoteLotSize,
        maintenanceMarginBps: cfg.maintenanceMarginBps,
      });
      const oraclePriceAcc = await connection.getAccountInfo(
        oraclePk,
        "confirmed",
      );
      if (oraclePriceAcc) {
        const px = parseSwitchboardPriceNative(oraclePriceAcc.data);
        if (px !== null) setMarkPriceNative(px);
      }
    }
  }, [connection, owner, marketIndex]);

  useEffect(() => {
    refresh().catch(console.error);
    const t = setInterval(() => refresh().catch(() => null), 8000);
    return () => clearInterval(t);
  }, [refresh]);

  // Poll through the HTTP RPC proxy so provider keys never need a browser WebSocket endpoint.
  // Dep on base58 string (stable) instead of PublicKey instance (re-created each refresh).
  const oracleKey = oracle?.toBase58() ?? null;
  useEffect(() => {
    if (!oracleKey) return;
    const pk = new PublicKey(oracleKey);
    let canceled = false;
    const poll = async () => {
      try {
        const acc = await connection.getAccountInfo(pk, "confirmed");
        if (!canceled && acc) {
          const px = parseSwitchboardPriceNative(acc.data);
          if (px !== null) setMarkPriceNative(px);
        }
      } catch {
        // ignore — next tick retries
      }
    };
    poll();
    const t = setInterval(poll, 1000);
    return () => {
      canceled = true;
      clearInterval(t);
    };
  }, [connection, oracleKey]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setMsg("");
    try {
      const sig = await fn();
      setMsg(`${label} → ${sig.slice(0, 8)}…`);
      notifyTxSuccess(label, sig);
      await refresh();
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`${label} failed:\n${err}`);
      notifyError(`${label} failed`, err);
    } finally {
      setBusy(null);
    }
  };

  const cleanStaleTriggers = async () => {
    if (!owner || staleTriggerIds.length === 0) return;
    await run("Clean TP/SL", () =>
      sendCancelTriggerOrders(
        owner,
        staleTriggerIds,
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
      ),
    );
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
  const oracleReady = markPriceNative !== null;

  return (
    <div className="p-4">
      {!owner && (
        <div className="text-on-surface-variant text-sm">Connect wallet.</div>
      )}

      {owner && !pos && (
        <div className="text-on-surface-variant text-sm">No open net position.</div>
      )}

      {owner && pos && (
        <>
          <div className="grid grid-cols-2 gap-3 mb-4 text-sm font-mono">
            <Stat label="Net Side" v={pos.side === 0 ? "LONG" : "SHORT"} accent={pos.side === 0} />
            <Stat label="Net Size (lots)" v={String(pos.size)} />
            <Stat label="Avg Entry (lots)" v={String(pos.entryPrice)} />
            <Stat
              label="TP (price/size)"
              v={formatTriggers(positionTriggers.takeProfit, pos.size)}
              accent={positionTriggers.takeProfit.length > 0}
            />
            <Stat
              label="SL (price/size)"
              v={formatTriggers(positionTriggers.stopLoss, pos.size)}
            />
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
                Net position UNDER maintenance ({fmtUsdc(pos.initialMargin)} &lt;{" "}
                {fmtUsdc(maintenanceMargin)}). Liquidatable. Add margin or
                close net position. Removal blocked.
              </div>
            )}

          <div className="grid grid-cols-2 gap-3 mb-2 items-center">
            <input
              value={marginAmt}
              onChange={(e) => setMarginAmt(e.target.value)}
              placeholder="USDC"
              inputMode="decimal"
              className="bg-kx-surface-lo border kx-border rounded-lg px-3 py-3 text-sm font-mono text-on-surface"
            />
            <div className="grid grid-cols-8 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setMarginAmt((Number(maxRemovable) / 1_000_000).toString())
                }
                className="py-2 text-[11px] font-headline font-bold uppercase tracking-wider rounded-md border kx-border bg-kx-surface-lo text-on-surface-variant hover:text-on-surface hover:bg-kx-surface-hi/60 transition-colors"
              >
                MAX
              </button>
            </div>
          </div>
          {removeExceeds && (
            <div className="mb-2 text-[10px] font-mono text-[#ffb86b]">
              − Margin: {String(baseUnits)} &gt; removable {String(maxRemovable)}{" "}
              native (initial {String(pos.initialMargin)} − maintenance{" "}
              {maintenanceMargin === null ? "?" : String(maintenanceMargin)}).
              Reduce or use MAX.
            </div>
          )}
          {!oracleReady && (
            <div className="mb-2 text-[10px] font-mono text-[#ffb86b]">
              Oracle has no current Switchboard result. Update feed before
              closing/removing margin.
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button
              disabled={!!busy || baseUnits === 0n}
              onClick={() =>
                run("Add margin", () =>
                  sendAddMargin(
                    owner,
                    baseUnits,
                    connection,
                    (ixs, c) => sendTx(wallet, c, ixs),
                    marketIndex,
                  ),
                )
              }
              className="text-[11px] font-headline font-bold uppercase tracking-wider min-w-[88px] px-3 py-1.5 rounded-md bg-[#4dffb4]/10 border border-[#4dffb4]/30 text-[#4dffb4] hover:bg-[#4dffb4]/20 transition-colors disabled:opacity-50"
            >
              + Margin
            </button>
            <button
              disabled={!!busy || baseUnits === 0n || !oracle || !oracleReady || removeExceeds}
              onClick={() =>
                run("Remove margin", () =>
                  sendRemoveMargin(
                    owner,
                    oracle!,
                    baseUnits,
                    connection,
                    (ixs, c) => sendTx(wallet, c, ixs),
                    marketIndex,
                  ),
                )
              }
              className="text-[11px] font-headline font-bold uppercase tracking-wider min-w-[88px] px-3 py-1.5 rounded-md bg-[#ffb86b]/10 border border-[#ffb86b]/30 text-[#ffb86b] hover:bg-[#ffb86b]/20 transition-colors disabled:opacity-50"
            >
              − Margin
            </button>
            <button
              disabled={!!busy || !oracle || !oracleReady}
              onClick={() =>
                run("Close", () =>
                  sendClosePosition(
                    owner,
                    oracle!,
                    pos.size,
                    connection,
                    (ixs, c) => sendTx(wallet, c, ixs),
                    marketIndex,
                  ),
                )
              }
              className="text-[11px] font-headline font-bold uppercase tracking-wider min-w-[88px] px-3 py-1.5 rounded-md bg-[#ff6b6b]/10 border border-[#ff6b6b]/30 text-[#ff6b6b] hover:bg-[#ff6b6b]/20 transition-colors disabled:opacity-50"
            >
              Close Net Position
            </button>
            <button
              disabled={!!busy}
              onClick={() =>
                run("Settle funding", () =>
                  sendSettleFunding(
                    owner,
                    connection,
                    (ixs, c) => sendTx(wallet, c, ixs),
                    marketIndex,
                  ),
                )
              }
              className="text-[11px] font-headline font-bold uppercase tracking-wider min-w-[88px] px-3 py-1.5 rounded-md bg-kx-surface-hi border kx-border text-on-surface-variant hover:text-on-surface hover:bg-kx-surface-hi/80 transition-colors disabled:opacity-50"
            >
              Settle Funding
            </button>
            {staleTriggerIds.length > 0 && (
              <button
                disabled={!!busy}
                onClick={cleanStaleTriggers}
                className="text-[11px] font-headline font-bold uppercase tracking-wider min-w-[88px] px-3 py-1.5 rounded-md bg-[#4dffb4]/10 border border-[#4dffb4]/30 text-[#4dffb4] hover:bg-[#4dffb4]/20 transition-colors disabled:opacity-50"
              >
                Clean TP/SL
              </button>
            )}
          </div>
        </>
      )}

    </div>
  );
}

function Stat({ label, v, accent }: { label: string; v: string; accent?: boolean }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-kx-surface-lo border kx-border">
      <div className="text-[9px] text-on-surface-variant/60 uppercase tracking-wider mb-0.5">
        {label}
      </div>
      <div
        className={`font-bold text-sm font-mono ${
          accent ? "text-[#4dffb4]" : "text-on-surface"
        }`}
      >
        {v}
      </div>
    </div>
  );
}
