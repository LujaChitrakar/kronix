"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { STRATEGY_PROGRAM_ID, StrategyStatus, StrategyType } from "@/lib/kronix/config";
import {
  sendCloseStrategy,
  sendEditStrategy,
  sendPauseStrategy,
  sendResumeStrategy,
} from "@/lib/kronix/client";
import { findMarketConfigPda } from "@/lib/kronix/pdas";
import { fetchMarketConfig } from "@/lib/kronix/state";
import { useStore } from "@/lib/store";
import { notifyError, notifyTxSuccess } from "@/lib/notifications";
import { sendTx, formatTxError } from "./tx";
import { getStrategyAccountDecoder, STRATEGY_ACCOUNT_LEN } from "@/lib/strategy-sdk";
import {
  formatPriceLots,
  formatSizeLots,
  parsePriceInput,
  parseSizeInput,
  type LotConfig,
} from "@/lib/kronix/lot-math";

const OWNER_OFFSET_IN_STRATEGY = 248;

type Row = {
  pubkey: PublicKey;
  strategyType: number;
  status: number;
  side: number;
  marketIndex: number;
  sizeLots: bigint;
  limitPriceLots: bigint;
  leverage: number;
  takeProfitPrice: bigint;
  stopLossPrice: bigint;
  cooldownSecs: bigint;
  maxExecutionsPerDay: bigint;
  executionsToday: bigint;
};

type EditDraft = {
  newSizeLots: string;
  newLimitPriceLots: string;
  newLeverage: string;
  newTakeProfitPrice: string;
  newStopLossPrice: string;
  newCooldownSecs: string;
  newMaxExecutionsPerDay: string;
};

function statusLabel(s: number): string {
  if (s === StrategyStatus.Active) return "ACTIVE";
  if (s === StrategyStatus.Paused) return "PAUSED";
  if (s === StrategyStatus.Completed) return "COMPLETED";
  return `?${s}`;
}

function typeLabel(t: number): string {
  if (t === StrategyType.RSI) return "RSI";
  if (t === StrategyType.EMA) return "EMA";
  if (t === StrategyType.RangeDCA) return "DCA";
  if (t === StrategyType.SR) return "S/R";
  if (t === StrategyType.SmartMoney) return "SMART";
  return `?${t}`;
}

export function Strategies() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [editType, setEditType] = useState<number | null>(null);
  const [draft, setDraft] = useState<EditDraft>({
    newSizeLots: "0",
    newLimitPriceLots: "0",
    newLeverage: "0",
    newTakeProfitPrice: "0",
    newStopLossPrice: "0",
    newCooldownSecs: "0",
    newMaxExecutionsPerDay: "0",
  });
  const [cfg, setCfg] = useState<LotConfig | null>(null);
  const marketIndex = useStore((s) => s.selectedMarketIndex);

  useEffect(() => {
    const [cfgPda] = findMarketConfigPda(marketIndex);
    fetchMarketConfig(connection, cfgPda)
      .then((c) => {
        if (c) setCfg({ baseLotSize: c.baseLotSize, quoteLotSize: c.quoteLotSize });
      })
      .catch(() => null);
  }, [connection, marketIndex]);

  const refresh = useCallback(async () => {
    if (!owner) {
      setRows([]);
      return;
    }
    const accs = await connection.getProgramAccounts(STRATEGY_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { dataSize: STRATEGY_ACCOUNT_LEN },
        { memcmp: { offset: OWNER_OFFSET_IN_STRATEGY, bytes: owner.toBase58() } },
      ],
    });
    const decoder = getStrategyAccountDecoder();
    const list: Row[] = [];
    for (const { pubkey, account } of accs) {
      try {
        const s = decoder.decode(new Uint8Array(account.data));
        if (s.marketIndex !== marketIndex) continue;
        if (s.status === StrategyStatus.Completed) continue;
        list.push({
          pubkey,
          strategyType: s.strategyType,
          status: s.status,
          side: s.side,
          marketIndex: s.marketIndex,
          sizeLots: s.sizeLots,
          limitPriceLots: s.limitPriceLots,
          leverage: s.leverage,
          takeProfitPrice: s.takeProfitPrice,
          stopLossPrice: s.stopLossPrice,
          cooldownSecs: s.cooldownSecs,
          maxExecutionsPerDay: s.maxExecutionsPerDay,
          executionsToday: s.executionsToday,
        });
      } catch {
        continue;
      }
    }
    list.sort((a, b) => a.strategyType - b.strategyType);
    setRows(list);
  }, [connection, owner, marketIndex]);

  useEffect(() => {
    refresh().catch(console.error);
    const t = setInterval(() => refresh().catch(() => null), 6000);
    return () => clearInterval(t);
  }, [refresh]);

  const pause = async (t: number) => {
    if (!owner) return;
    setBusy(`pause ${t}`);
    setMsg("");
    try {
      const sig = await sendPauseStrategy(
        owner,
        t,
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
        marketIndex,
      );
      setMsg(`Pause → ${sig.slice(0, 8)}…`);
      notifyTxSuccess("Strategy paused", sig);
      await refresh();
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Pause failed:\n${err}`);
      notifyError("Pause failed", err);
    } finally {
      setBusy(null);
    }
  };

  const resume = async (t: number) => {
    if (!owner) return;
    setBusy(`resume ${t}`);
    setMsg("");
    try {
      const sig = await sendResumeStrategy(
        owner,
        t,
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
        marketIndex,
      );
      setMsg(`Resume → ${sig.slice(0, 8)}…`);
      notifyTxSuccess("Strategy resumed", sig);
      await refresh();
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Resume failed:\n${err}`);
      notifyError("Resume failed", err);
    } finally {
      setBusy(null);
    }
  };

  const close = async (t: number) => {
    if (!owner) return;
    setBusy(`close ${t}`);
    setMsg("");
    try {
      const sig = await sendCloseStrategy(
        owner,
        t,
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
        marketIndex,
      );
      setMsg(`Close → ${sig.slice(0, 8)}…`);
      notifyTxSuccess("Strategy closed", sig);
      await refresh();
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Close failed:\n${err}`);
      notifyError("Close failed", err);
    } finally {
      setBusy(null);
    }
  };

  const startEdit = (r: Row) => {
    setEditType(r.strategyType);
    setDraft({
      newSizeLots: cfg ? formatSizeLots(r.sizeLots, cfg) : String(r.sizeLots),
      newLimitPriceLots: cfg
        ? formatPriceLots(r.limitPriceLots, cfg)
        : String(r.limitPriceLots),
      newLeverage: String(r.leverage || 1),
      newTakeProfitPrice: cfg
        ? formatPriceLots(r.takeProfitPrice, cfg)
        : String(r.takeProfitPrice),
      newStopLossPrice: cfg
        ? formatPriceLots(r.stopLossPrice, cfg)
        : String(r.stopLossPrice),
      newCooldownSecs: String(r.cooldownSecs),
      newMaxExecutionsPerDay: String(r.maxExecutionsPerDay),
    });
  };

  const submitEdit = async (t: number) => {
    if (!owner) return;
    if (!cfg) {
      setMsg("Edit failed:\nMarket config still loading");
      notifyError("Edit failed", "Market config still loading");
      return;
    }
    setBusy(`edit ${t}`);
    setMsg("");
    try {
      const newSizeLots = parseSizeInput(draft.newSizeLots || "0", cfg);
      const newLimitPriceLots = parsePriceInput(draft.newLimitPriceLots || "0", cfg);
      const newTakeProfitPrice = parsePriceInput(draft.newTakeProfitPrice || "0", cfg);
      const newStopLossPrice = parsePriceInput(draft.newStopLossPrice || "0", cfg);
      if (
        newSizeLots === null ||
        newLimitPriceLots === null ||
        newTakeProfitPrice === null ||
        newStopLossPrice === null
      ) {
        throw new Error("Invalid strategy price or size values");
      }
      const sig = await sendEditStrategy(
        owner,
        {
          strategyType: t,
          newSizeLots,
          newLimitPriceLots,
          newLeverage: Math.max(0, Math.min(10, parseInt(draft.newLeverage || "0", 10) || 0)),
          newTakeProfitPrice,
          newStopLossPrice,
          newCooldownSecs: BigInt(draft.newCooldownSecs || "0"),
          newMaxExecutionsPerDay: BigInt(draft.newMaxExecutionsPerDay || "0"),
          newStatus: 255,
        },
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
        marketIndex,
      );
      setMsg(`Edit → ${sig.slice(0, 8)}…`);
      notifyTxSuccess("Strategy edited", sig);
      setEditType(null);
      await refresh();
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Edit failed:\n${err}`);
      notifyError("Edit failed", err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4">
      {!owner && (
        <div className="text-on-surface-variant text-sm">Connect wallet.</div>
      )}
      {owner && rows.length === 0 && (
        <div className="text-on-surface-variant text-sm">No strategies.</div>
      )}
      {rows.length > 0 && (
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="text-on-surface-variant/70 text-left">
              <th className="py-1">Type</th>
              <th>Side</th>
              <th>Size</th>
              <th>Limit</th>
              <th>Lev</th>
              <th>TP / SL</th>
              <th>CD</th>
              <th>Used / Day</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isActive = r.status === StrategyStatus.Active;
              const isPaused = r.status === StrategyStatus.Paused;
              const editable = isActive || isPaused;
              return (
                <Fragment key={r.strategyType}>
                  <tr className="border-t kx-border align-top">
                    <td className="py-1.5">{typeLabel(r.strategyType)}</td>
                    <td className={r.side === 0 ? "text-[#4dffb4]" : "text-[#ff6b6b]"}>
                      {r.side === 0 ? "BUY" : "SELL"}
                    </td>
                    <td>{cfg ? formatSizeLots(r.sizeLots, cfg) : String(r.sizeLots)}</td>
                    <td>
                      {r.limitPriceLots === 0n
                        ? "MKT"
                        : cfg
                          ? formatPriceLots(r.limitPriceLots, cfg)
                          : String(r.limitPriceLots)}
                    </td>
                    <td>{r.leverage || 1}x</td>
                    <td>
                      {r.takeProfitPrice === 0n
                        ? "—"
                        : cfg
                          ? formatPriceLots(r.takeProfitPrice, cfg)
                          : String(r.takeProfitPrice)} /{" "}
                      {r.stopLossPrice === 0n
                        ? "—"
                        : cfg
                          ? formatPriceLots(r.stopLossPrice, cfg)
                          : String(r.stopLossPrice)}
                    </td>
                    <td>{String(r.cooldownSecs)}s</td>
                    <td>
                      {String(r.executionsToday)} / {String(r.maxExecutionsPerDay)}
                    </td>
                    <td>{statusLabel(r.status)}</td>
                    <td className="text-right">
                      <div className="inline-flex gap-1">
                        {editable && (
                          <button
                            disabled={!!busy}
                            onClick={() =>
                              editType === r.strategyType
                                ? setEditType(null)
                                : startEdit(r)
                            }
                            className="text-[10px] font-headline font-bold uppercase tracking-wider min-w-[64px] px-2.5 py-1 rounded-md bg-kx-surface-hi border kx-border text-on-surface-variant hover:text-on-surface hover:bg-kx-surface-hi/80 transition-colors disabled:opacity-50"
                          >
                            {editType === r.strategyType ? "Close" : "Edit"}
                          </button>
                        )}
                        {isActive && (
                          <button
                            disabled={!!busy}
                            onClick={() => pause(r.strategyType)}
                            className="text-[10px] font-headline font-bold uppercase tracking-wider min-w-[64px] px-2.5 py-1 rounded-md bg-[#ffb86b]/10 border border-[#ffb86b]/30 text-[#ffb86b] hover:bg-[#ffb86b]/20 transition-colors disabled:opacity-50"
                          >
                            {busy === `pause ${r.strategyType}` ? "…" : "Pause"}
                          </button>
                        )}
                        {isPaused && (
                          <button
                            disabled={!!busy}
                            onClick={() => resume(r.strategyType)}
                            className="text-[10px] font-headline font-bold uppercase tracking-wider min-w-[64px] px-2.5 py-1 rounded-md bg-[#4dffb4]/10 border border-[#4dffb4]/30 text-[#4dffb4] hover:bg-[#4dffb4]/20 transition-colors disabled:opacity-50"
                          >
                            {busy === `resume ${r.strategyType}` ? "…" : "Resume"}
                          </button>
                        )}
                        <button
                          disabled={!!busy}
                          onClick={() => close(r.strategyType)}
                          className="text-[10px] font-headline font-bold uppercase tracking-wider min-w-[64px] px-2.5 py-1 rounded-md bg-[#ff6b6b]/10 border border-[#ff6b6b]/30 text-[#ff6b6b] hover:bg-[#ff6b6b]/20 transition-colors disabled:opacity-50"
                        >
                          {busy === `close ${r.strategyType}` ? "…" : "Close"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {editType === r.strategyType && (
                    <tr className="border-t kx-border bg-kx-surface-lo">
                      <td colSpan={10} className="py-3 px-3">
                        <div className="grid grid-cols-8 gap-3 items-end">
                          <EditField
                            label="Size (0=keep)"
                            value={draft.newSizeLots}
                            onChange={(v) =>
                              setDraft({ ...draft, newSizeLots: v })
                            }
                          />
                          <EditField
                            label="Limit (0=keep)"
                            value={draft.newLimitPriceLots}
                            onChange={(v) =>
                              setDraft({ ...draft, newLimitPriceLots: v })
                            }
                          />
                          <EditField
                            label="Lev (0=keep)"
                            value={draft.newLeverage}
                            onChange={(v) =>
                              setDraft({ ...draft, newLeverage: v })
                            }
                          />
                          <EditField
                            label="TP (0=keep)"
                            value={draft.newTakeProfitPrice}
                            onChange={(v) =>
                              setDraft({ ...draft, newTakeProfitPrice: v })
                            }
                          />
                          <EditField
                            label="SL (0=keep)"
                            value={draft.newStopLossPrice}
                            onChange={(v) =>
                              setDraft({ ...draft, newStopLossPrice: v })
                            }
                          />
                          <EditField
                            label="CD (0=keep)"
                            value={draft.newCooldownSecs}
                            onChange={(v) =>
                              setDraft({ ...draft, newCooldownSecs: v })
                            }
                          />
                          <EditField
                            label="Max/d (0=keep)"
                            value={draft.newMaxExecutionsPerDay}
                            onChange={(v) =>
                              setDraft({ ...draft, newMaxExecutionsPerDay: v })
                            }
                          />
                          <button
                            disabled={!!busy}
                            onClick={() => submitEdit(r.strategyType)}
                            className="h-9 text-[11px] font-headline font-bold uppercase tracking-wider rounded-md bg-[#4dffb4] text-on-primary-fixed shadow-md shadow-[#4dffb4]/20 hover:brightness-110 active:scale-[0.99] transition-all disabled:opacity-50"
                          >
                            {busy === `edit ${r.strategyType}` ? "…" : "Save"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
  inputMode = "decimal",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "decimal" | "numeric" | "text";
}) {
  return (
    <div>
      <div className="text-[11px] text-on-surface-variant/70 uppercase tracking-wider mb-1">
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        className="w-full bg-kx-surface border kx-border rounded-md px-3 py-2 text-sm font-mono text-on-surface"
      />
    </div>
  );
}
