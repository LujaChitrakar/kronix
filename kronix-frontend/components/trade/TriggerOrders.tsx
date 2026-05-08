"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  TRIGGER_PROGRAM_ID,
  TriggerStatus,
  TriggerType,
} from "@/lib/kronix/config";
import {
  sendCancelTriggerOrder,
  sendPauseTrigger,
  sendResumeTrigger,
  sendEditTrigger,
} from "@/lib/kronix/client";
import {
  findMarketConfigPda,
  findMarketPda,
  findOpenOrdersPda,
} from "@/lib/kronix/pdas";
import { fetchMarketConfig, fetchOpenOrders } from "@/lib/kronix/state";
import { useStore } from "@/lib/store";
import { sendTx, formatTxError } from "./tx";
import { notifyError, notifyTxSuccess } from "@/lib/notifications";
import { getTriggerOrderDecoder } from "@/lib/trigger-sdk";
import {
  formatPriceLots,
  formatSizeLots,
  parsePriceInput,
  parseSizeInput,
  type LotConfig,
} from "@/lib/kronix/lot-math";

const TRIGGER_ORDER_SIZE = 144;

type Row = {
  pubkey: PublicKey;
  clientId: bigint;
  triggerPrice: bigint;
  sizeLots: bigint;
  expiry: bigint;
  triggerType: number;
  side: number;
  status: number;
};

type EditDraft = {
  newTriggerPrice: string;
  newSizeLots: string;
  newExpiry: string; // -1 = no change, 0 = clear, >0 = set
};

function statusLabel(s: number): string {
  if (s === TriggerStatus.Active) return "ACTIVE";
  if (s === TriggerStatus.Triggered) return "TRIGGERED";
  if (s === TriggerStatus.Canceled) return "CANCELED";
  if (s === TriggerStatus.Paused) return "PAUSED";
  return `?${s}`;
}

export function TriggerOrders() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [editId, setEditId] = useState<bigint | null>(null);
  const [draft, setDraft] = useState<EditDraft>({
    newTriggerPrice: "",
    newSizeLots: "",
    newExpiry: "-1",
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
    const accs = await connection.getProgramAccounts(TRIGGER_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { dataSize: TRIGGER_ORDER_SIZE },
        { memcmp: { offset: 48, bytes: owner.toBase58() } },
      ],
    });
    const attachedIds = new Set<string>();
    const [market] = findMarketPda(marketIndex);
    const [oo] = findOpenOrdersPda(owner, market);
    const openOrders = await fetchOpenOrders(connection, oo);
    openOrders?.openOrders.forEach((o) => {
      if (o.isFree === 1) return;
      const base = o.clientId * 10n;
      attachedIds.add(String(base + 1n));
      attachedIds.add(String(base + 2n));
    });
    const decoder = getTriggerOrderDecoder();
    const list: Row[] = [];
    for (const { pubkey, account } of accs) {
      try {
        const t = decoder.decode(new Uint8Array(account.data));
        if (attachedIds.has(String(t.clientOrderId))) continue;
        list.push({
          pubkey,
          clientId: t.clientOrderId,
          triggerPrice: t.triggerPrice,
          sizeLots: t.sizeLots,
          expiry: t.expiry,
          triggerType: t.triggerType,
          side: t.side,
          status: t.status,
        });
      } catch {
        continue;
      }
    }
    list.sort((a, b) =>
      a.clientId > b.clientId ? -1 : a.clientId < b.clientId ? 1 : 0,
    );
    setRows(list);
  }, [connection, owner, marketIndex]);

  useEffect(() => {
    refresh().catch(console.error);
    const t = setInterval(() => refresh().catch(() => null), 6000);
    return () => clearInterval(t);
  }, [refresh]);

  const cancel = async (clientId: bigint) => {
    if (!owner) return;
    setBusy(`cancel ${clientId}`);
    setMsg("");
    try {
      const sig = await sendCancelTriggerOrder(
        owner,
        clientId,
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
      );
      setMsg(`Cancel → ${sig.slice(0, 8)}…`);
      notifyTxSuccess("Trigger cancelled", sig);
      await refresh();
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Cancel failed:\n${err}`);
      notifyError("Cancel failed", err);
    } finally {
      setBusy(null);
    }
  };

  const pause = async (clientId: bigint) => {
    if (!owner) return;
    setBusy(`pause ${clientId}`);
    setMsg("");
    try {
      const sig = await sendPauseTrigger(owner, clientId, connection, (ixs, c) =>
        sendTx(wallet, c, ixs),
      );
      setMsg(`Pause → ${sig.slice(0, 8)}…`);
      notifyTxSuccess("Trigger paused", sig);
      await refresh();
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Pause failed:\n${err}`);
      notifyError("Pause failed", err);
    } finally {
      setBusy(null);
    }
  };

  const resume = async (clientId: bigint) => {
    if (!owner) return;
    setBusy(`resume ${clientId}`);
    setMsg("");
    try {
      const sig = await sendResumeTrigger(
        owner,
        clientId,
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
      );
      setMsg(`Resume → ${sig.slice(0, 8)}…`);
      notifyTxSuccess("Trigger resumed", sig);
      await refresh();
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Resume failed:\n${err}`);
      notifyError("Resume failed", err);
    } finally {
      setBusy(null);
    }
  };

  const startEdit = (r: Row) => {
    setEditId(r.clientId);
    setDraft({
      newTriggerPrice: cfg ? formatPriceLots(r.triggerPrice, cfg) : String(r.triggerPrice),
      newSizeLots: cfg ? formatSizeLots(r.sizeLots, cfg) : String(r.sizeLots),
      newExpiry: String(r.expiry),
    });
  };

  const submitEdit = async (clientId: bigint) => {
    if (!owner) return;
    if (!cfg) {
      setMsg("Edit failed:\nMarket config still loading");
      notifyError("Edit failed", "Market config still loading");
      return;
    }
    setBusy(`edit ${clientId}`);
    setMsg("");
    try {
      const newTriggerPrice = parsePriceInput(draft.newTriggerPrice || "0", cfg);
      const newSizeLots = parseSizeInput(draft.newSizeLots || "0", cfg);
      if (newTriggerPrice === null || newSizeLots === null) {
        throw new Error("Invalid trigger price or size");
      }
      const newExpiry = BigInt(draft.newExpiry || "-1");
      const sig = await sendEditTrigger(
        owner,
        { clientOrderId: clientId, newTriggerPrice, newSizeLots, newExpiry },
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
      );
      setMsg(`Edit → ${sig.slice(0, 8)}…`);
      notifyTxSuccess("Trigger edited", sig);
      setEditId(null);
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
        <div className="text-on-surface-variant text-sm">No trigger orders.</div>
      )}
      {rows.length > 0 && (
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="text-on-surface-variant/70 text-left">
              <th className="py-1">Type</th>
              <th>Side</th>
              <th>Trigger</th>
              <th>Size</th>
              <th>Expiry</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isActive = r.status === TriggerStatus.Active;
              const isPaused = r.status === TriggerStatus.Paused;
              const editable = isActive; // edit only on active per Rust check
              return (
                <Fragment key={String(r.clientId)}>
                  <tr className="border-t kx-border align-top">
                    <td className="py-1.5">
                      {r.triggerType === TriggerType.StopLoss ? "SL" : "TP"}
                    </td>
                    <td
                      className={
                        r.side === 0 ? "text-[#4dffb4]" : "text-[#ff6b6b]"
                      }
                    >
                      {r.side === 0 ? "BUY" : "SELL"}
                    </td>
                    <td>{cfg ? formatPriceLots(r.triggerPrice, cfg) : String(r.triggerPrice)}</td>
                    <td>{cfg ? formatSizeLots(r.sizeLots, cfg) : String(r.sizeLots)}</td>
                    <td>{r.expiry === 0n ? "—" : String(r.expiry)}</td>
                    <td>{statusLabel(r.status)}</td>
                    <td className="text-right">
                      <div className="inline-flex gap-1">
                        {editable && (
                          <button
                            disabled={!!busy}
                            onClick={() =>
                              editId === r.clientId
                                ? setEditId(null)
                                : startEdit(r)
                            }
                            className="text-[10px] font-headline font-bold uppercase tracking-wider min-w-[64px] px-2.5 py-1 rounded-md bg-kx-surface-hi border kx-border text-on-surface-variant hover:text-on-surface hover:bg-kx-surface-hi/80 transition-colors disabled:opacity-50"
                          >
                            {editId === r.clientId ? "Close" : "Edit"}
                          </button>
                        )}
                        {isActive && (
                          <button
                            disabled={!!busy}
                            onClick={() => pause(r.clientId)}
                            className="text-[10px] font-headline font-bold uppercase tracking-wider min-w-[64px] px-2.5 py-1 rounded-md bg-[#ffb86b]/10 border border-[#ffb86b]/30 text-[#ffb86b] hover:bg-[#ffb86b]/20 transition-colors disabled:opacity-50"
                          >
                            {busy === `pause ${r.clientId}` ? "…" : "Pause"}
                          </button>
                        )}
                        {isPaused && (
                          <button
                            disabled={!!busy}
                            onClick={() => resume(r.clientId)}
                            className="text-[10px] font-headline font-bold uppercase tracking-wider min-w-[64px] px-2.5 py-1 rounded-md bg-[#4dffb4]/10 border border-[#4dffb4]/30 text-[#4dffb4] hover:bg-[#4dffb4]/20 transition-colors disabled:opacity-50"
                          >
                            {busy === `resume ${r.clientId}` ? "…" : "Resume"}
                          </button>
                        )}
                        {(isActive || isPaused) && (
                          <button
                            disabled={!!busy}
                            onClick={() => cancel(r.clientId)}
                            className="text-[10px] font-headline font-bold uppercase tracking-wider min-w-[64px] px-2.5 py-1 rounded-md bg-[#ff6b6b]/10 border border-[#ff6b6b]/30 text-[#ff6b6b] hover:bg-[#ff6b6b]/20 transition-colors disabled:opacity-50"
                          >
                            {busy === `cancel ${r.clientId}` ? "…" : "Cancel"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {editId === r.clientId && (
                    <tr className="border-t kx-border bg-kx-surface-lo">
                      <td colSpan={7} className="py-3 px-3">
                        <div className="grid grid-cols-4 gap-3 items-end">
                          <EditField
                            label="Trigger (0=keep)"
                            value={draft.newTriggerPrice}
                            onChange={(v) =>
                              setDraft({ ...draft, newTriggerPrice: v })
                            }
                          />
                          <EditField
                            label="Size (0=keep)"
                            value={draft.newSizeLots}
                            onChange={(v) =>
                              setDraft({ ...draft, newSizeLots: v })
                            }
                          />
                          <EditField
                            label="Expiry (-1=keep, 0=clear)"
                            value={draft.newExpiry}
                            onChange={(v) =>
                              setDraft({ ...draft, newExpiry: v })
                            }
                            inputMode="text"
                          />
                          <button
                            disabled={!!busy}
                            onClick={() => submitEdit(r.clientId)}
                            className="h-9 text-[11px] font-headline font-bold uppercase tracking-wider rounded-md bg-[#4dffb4] text-on-primary-fixed shadow-md shadow-[#4dffb4]/20 hover:brightness-110 active:scale-[0.99] transition-all disabled:opacity-50"
                          >
                            {busy === `edit ${r.clientId}` ? "…" : "Save"}
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
