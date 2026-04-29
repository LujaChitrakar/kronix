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
import { sendTx, formatTxError } from "./tx";
import { getStrategyAccountDecoder, STRATEGY_ACCOUNT_LEN } from "@/lib/strategy-sdk";

const OWNER_OFFSET_IN_STRATEGY = 248;

type Row = {
  pubkey: PublicKey;
  strategyType: number;
  status: number;
  side: number;
  marketIndex: number;
  sizeLots: bigint;
  limitPriceLots: bigint;
  takeProfitPrice: bigint;
  stopLossPrice: bigint;
  cooldownSecs: bigint;
  maxExecutionsPerDay: bigint;
  executionsToday: bigint;
};

type EditDraft = {
  newSizeLots: string;
  newLimitPriceLots: string;
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
    newTakeProfitPrice: "0",
    newStopLossPrice: "0",
    newCooldownSecs: "0",
    newMaxExecutionsPerDay: "0",
  });

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
        list.push({
          pubkey,
          strategyType: s.strategyType,
          status: s.status,
          side: s.side,
          marketIndex: s.marketIndex,
          sizeLots: s.sizeLots,
          limitPriceLots: s.limitPriceLots,
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
  }, [connection, owner]);

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
      const sig = await sendPauseStrategy(owner, t, connection, (ixs, c) =>
        sendTx(wallet, c, ixs),
      );
      setMsg(`Pause → ${sig.slice(0, 8)}…`);
      await refresh();
    } catch (e) {
      setMsg(`Pause failed:\n${formatTxError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const resume = async (t: number) => {
    if (!owner) return;
    setBusy(`resume ${t}`);
    setMsg("");
    try {
      const sig = await sendResumeStrategy(owner, t, connection, (ixs, c) =>
        sendTx(wallet, c, ixs),
      );
      setMsg(`Resume → ${sig.slice(0, 8)}…`);
      await refresh();
    } catch (e) {
      setMsg(`Resume failed:\n${formatTxError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const close = async (t: number) => {
    if (!owner) return;
    setBusy(`close ${t}`);
    setMsg("");
    try {
      const sig = await sendCloseStrategy(owner, t, connection, (ixs, c) =>
        sendTx(wallet, c, ixs),
      );
      setMsg(`Close → ${sig.slice(0, 8)}…`);
      await refresh();
    } catch (e) {
      setMsg(`Close failed:\n${formatTxError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const startEdit = (r: Row) => {
    setEditType(r.strategyType);
    setDraft({
      newSizeLots: String(r.sizeLots),
      newLimitPriceLots: String(r.limitPriceLots),
      newTakeProfitPrice: String(r.takeProfitPrice),
      newStopLossPrice: String(r.stopLossPrice),
      newCooldownSecs: String(r.cooldownSecs),
      newMaxExecutionsPerDay: String(r.maxExecutionsPerDay),
    });
  };

  const submitEdit = async (t: number) => {
    if (!owner) return;
    setBusy(`edit ${t}`);
    setMsg("");
    try {
      const sig = await sendEditStrategy(
        owner,
        {
          strategyType: t,
          newSizeLots: BigInt(draft.newSizeLots || "0"),
          newLimitPriceLots: BigInt(draft.newLimitPriceLots || "0"),
          newTakeProfitPrice: BigInt(draft.newTakeProfitPrice || "0"),
          newStopLossPrice: BigInt(draft.newStopLossPrice || "0"),
          newCooldownSecs: BigInt(draft.newCooldownSecs || "0"),
          newMaxExecutionsPerDay: BigInt(draft.newMaxExecutionsPerDay || "0"),
          newStatus: 255,
        },
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
      );
      setMsg(`Edit → ${sig.slice(0, 8)}…`);
      setEditType(null);
      await refresh();
    } catch (e) {
      setMsg(`Edit failed:\n${formatTxError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-kx-surface rounded-xl border kx-border p-4">
      <div className="font-headline text-sm text-on-surface mb-3 uppercase tracking-wider">
        Strategies
      </div>
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
                    <td>{String(r.sizeLots)}</td>
                    <td>{r.limitPriceLots === 0n ? "MKT" : String(r.limitPriceLots)}</td>
                    <td>
                      {r.takeProfitPrice === 0n ? "—" : String(r.takeProfitPrice)} /{" "}
                      {r.stopLossPrice === 0n ? "—" : String(r.stopLossPrice)}
                    </td>
                    <td>{String(r.cooldownSecs)}s</td>
                    <td>
                      {String(r.executionsToday)} / {String(r.maxExecutionsPerDay)}
                    </td>
                    <td>{statusLabel(r.status)}</td>
                    <td className="text-right space-x-1">
                      {editable && (
                        <button
                          disabled={!!busy}
                          onClick={() =>
                            editType === r.strategyType
                              ? setEditType(null)
                              : startEdit(r)
                          }
                          className="text-[10px] px-2 py-1 rounded-md bg-kx-surface-hi border kx-border disabled:opacity-50"
                        >
                          {editType === r.strategyType ? "Close" : "Edit"}
                        </button>
                      )}
                      {isActive && (
                        <button
                          disabled={!!busy}
                          onClick={() => pause(r.strategyType)}
                          className="text-[10px] px-2 py-1 rounded-md bg-kx-surface-hi border kx-border disabled:opacity-50"
                        >
                          {busy === `pause ${r.strategyType}` ? "…" : "Pause"}
                        </button>
                      )}
                      {isPaused && (
                        <button
                          disabled={!!busy}
                          onClick={() => resume(r.strategyType)}
                          className="text-[10px] px-2 py-1 rounded-md bg-[#4dffb4]/20 border border-[#4dffb4]/40 text-[#4dffb4] disabled:opacity-50"
                        >
                          {busy === `resume ${r.strategyType}` ? "…" : "Resume"}
                        </button>
                      )}
                      <button
                        disabled={!!busy}
                        onClick={() => close(r.strategyType)}
                        className="text-[10px] px-2 py-1 rounded-md bg-[#ff6b6b]/20 border border-[#ff6b6b]/40 text-[#ff6b6b] disabled:opacity-50"
                      >
                        {busy === `close ${r.strategyType}` ? "…" : "Close"}
                      </button>
                    </td>
                  </tr>
                  {editType === r.strategyType && (
                    <tr className="border-t kx-border bg-kx-surface-lo">
                      <td colSpan={9} className="py-2 px-2">
                        <div className="grid grid-cols-7 gap-2 items-end">
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
                            className="h-8 text-[11px] font-bold rounded-md bg-primary-container text-on-primary-fixed disabled:opacity-50"
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
      {msg && (
        <pre className="mt-3 text-[10px] font-mono text-on-surface-variant break-all whitespace-pre-wrap max-h-64 overflow-auto bg-kx-surface-lo p-2 rounded-md border kx-border">
          {msg}
        </pre>
      )}
    </div>
  );
}

function EditField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-[10px] text-on-surface-variant/70 uppercase mb-1">
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        className="w-full bg-kx-surface border kx-border rounded-md px-2 py-1.5 text-xs font-mono text-on-surface"
      />
    </div>
  );
}
