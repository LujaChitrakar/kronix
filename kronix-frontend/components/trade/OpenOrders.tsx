"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { findOpenOrdersPda, findMarketPda, findTriggerOrderPda } from "@/lib/kronix/pdas";
import { fetchOpenOrders } from "@/lib/kronix/state";
import {
  sendCancelOrderByClientId,
  sendCancelAllOrders,
  sendEditOrder,
} from "@/lib/kronix/client";
import { PlaceOrderType, TriggerStatus, TriggerType } from "@/lib/kronix/config";
import { useStore } from "@/lib/store";
import { notifyError, notifyTxSuccess, notifyWarning } from "@/lib/notifications";
import { sendTx, formatTxError } from "./tx";
import { getTriggerOrderDecoder } from "@/lib/trigger-sdk";

type Row = {
  slot: number;
  clientId: bigint;
  lockedPrice: bigint;
  reservedMargin: bigint;
  side: number;
  isFilled: boolean;
  id: Uint8Array;
  takeProfit?: AttachedTrigger;
  stopLoss?: AttachedTrigger;
};

type EditDraft = { price: string; size: string; leverage: string };
type AttachedTrigger = { price: bigint; status: number };

const headCellClass = "py-1 pr-5 whitespace-nowrap";
const bodyCellClass = "py-1.5 pr-5 whitespace-nowrap";

function priceFromOrderId(id: Uint8Array | ArrayLike<number>): bigint {
  const bytes = Uint8Array.from(id);
  let out = 0n;
  for (let i = 15; i >= 8; i--) out = (out << 8n) + BigInt(bytes[i] ?? 0);
  return out;
}

function statusLabel(s: number): string {
  if (s === TriggerStatus.Active) return "ACTIVE";
  if (s === TriggerStatus.Triggered) return "TRIGGERED";
  if (s === TriggerStatus.Canceled) return "CANCELED";
  if (s === TriggerStatus.Paused) return "PAUSED";
  return `?${s}`;
}

function TriggerCell({
  trigger,
  kind,
}: {
  trigger?: AttachedTrigger;
  kind: "tp" | "sl";
}) {
  if (!trigger) return <span className="text-on-surface-variant/50">—</span>;
  const color = kind === "tp" ? "text-[#4dffb4]" : "text-[#ffb86b]";
  return (
    <div className="leading-tight">
      <div className={color}>{String(trigger.price)}</div>
      {/*<div className="text-[9px] text-on-surface-variant/60">
        {statusLabel(trigger.status)}
      </div>*/}
    </div>
  );
}

export function OpenOrders() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<bigint | null>(null);
  const [draft, setDraft] = useState<EditDraft>({ price: "", size: "", leverage: "1" });
  const marketIndex = useStore((s) => s.selectedMarketIndex);

  const refresh = useCallback(async () => {
    if (!owner) {
      setRows([]);
      return;
    }
    const [market] = findMarketPda(marketIndex);
    const [oo] = findOpenOrdersPda(owner, market);
    const acct = await fetchOpenOrders(connection, oo);
    if (!acct) {
      setRows([]);
      return;
    }
    const list: Row[] = [];
    acct.openOrders.forEach((o, i) => {
      if (o.isFree === 1) return;
      list.push({
        slot: i,
        clientId: o.clientId,
        lockedPrice: priceFromOrderId(o.id),
        reservedMargin: o.lockedPrice,
        side: o.side,
        isFilled: o.makerOut === 1,
        id: Uint8Array.from(o.id),
      });
    });

    const triggerPdas = list.flatMap((r) => {
      const base = r.clientId * 10n;
      return [
        findTriggerOrderPda(owner, base + 1n)[0],
        findTriggerOrderPda(owner, base + 2n)[0],
      ];
    });
    if (triggerPdas.length > 0) {
      const accounts = await connection.getMultipleAccountsInfo(
        triggerPdas,
        "confirmed",
      );
      const decoder = getTriggerOrderDecoder();
      accounts.forEach((account, i) => {
        if (!account) return;
        const row = list[Math.floor(i / 2)];
        if (!row) return;
        try {
          const trigger = decoder.decode(new Uint8Array(account.data));
          const value = {
            price: trigger.triggerPrice,
            status: trigger.status,
          };
          if (trigger.triggerType === TriggerType.TakeProfit) {
            row.takeProfit = value;
          } else if (trigger.triggerType === TriggerType.StopLoss) {
            row.stopLoss = value;
          }
        } catch {
          return;
        }
      });
    }
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
      const sig = await sendCancelOrderByClientId(
        owner,
        clientId,
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
        marketIndex,
      );
      setMsg(`Cancel → ${sig.slice(0, 8)}…`);
      notifyTxSuccess("Order cancelled", sig);
      await refresh();
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Cancel failed:\n${err}`);
      notifyError("Cancel failed", err);
    } finally {
      setBusy(null);
    }
  };

  const cancelAll = async (sideFilter: number) => {
    if (!owner) return;
    setBusy(`cancel-all ${sideFilter}`);
    setMsg("");
    try {
      const sig = await sendCancelAllOrders(
        owner,
        {
          sideFilter,
          limit: 24,
          triggerClientIds: rows
            .filter(
              (r) =>
                sideFilter === 255 ||
                (sideFilter === 0 && r.side === 0) ||
                (sideFilter === 1 && r.side === 1),
            )
            .map((r) => r.clientId),
        },
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
        marketIndex,
      );
      setMsg(`Cancel-all → ${sig.slice(0, 8)}…`);
      notifyTxSuccess("Orders cancelled", sig);
      await refresh();
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Cancel-all failed:\n${err}`);
      notifyError("Cancel-all failed", err);
    } finally {
      setBusy(null);
    }
  };

  const submitEdit = async (r: Row) => {
    if (!owner) return;
    const newPrice = BigInt(parseInt(draft.price || "0", 10));
    const newBase = BigInt(parseInt(draft.size || "0", 10));
    if (newPrice <= 0n || newBase <= 0n) {
      setMsg("Edit: price + size required");
      notifyWarning("Edit blocked", "Price + size required");
      return;
    }
    setBusy(`edit ${r.clientId}`);
    setMsg("");
    try {
      const newClientId = BigInt(Date.now());
      const sig = await sendEditOrder(
        owner,
        {
          orderId: r.id,
          newPriceLots: newPrice,
          newBaseLots: newBase,
          newQuoteLots: newPrice * newBase,
          clientOrderId: newClientId,
          expiryTimestamp: 0n,
          side: r.side,
          orderType: PlaceOrderType.Limit,
          limit: 16,
          leverage: Math.max(1, Math.min(10, parseInt(draft.leverage || "1", 10) || 1)),
          marketIndex,
        },
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
      );
      setMsg(`Edit → ${sig.slice(0, 8)}…`);
      notifyTxSuccess("Order edited", sig);
      setEditing(null);
      setDraft({ price: "", size: "", leverage: "1" });
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
      <div className="flex items-center justify-end mb-3">
        {owner && rows.length > 0 && (
          <div className="flex gap-1.5">
            <button
              disabled={!!busy}
              onClick={() => cancelAll(0)}
              className="text-[10px] font-headline font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-md bg-[#4dffb4]/10 border border-[#4dffb4]/30 text-[#4dffb4] hover:bg-[#4dffb4]/20 transition-colors disabled:opacity-50"
            >
              Cancel Bids
            </button>
            <button
              disabled={!!busy}
              onClick={() => cancelAll(1)}
              className="text-[10px] font-headline font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-md bg-[#ff6b6b]/10 border border-[#ff6b6b]/30 text-[#ff6b6b] hover:bg-[#ff6b6b]/20 transition-colors disabled:opacity-50"
            >
              Cancel Asks
            </button>
            <button
              disabled={!!busy}
              onClick={() => cancelAll(255)}
              className="text-[10px] font-headline font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-md bg-kx-surface-hi border kx-border text-on-surface-variant hover:text-on-surface hover:bg-kx-surface-hi/80 transition-colors disabled:opacity-50"
            >
              Cancel All
            </button>
          </div>
        )}
      </div>
      {!owner && (
        <div className="text-on-surface-variant text-sm">Connect wallet.</div>
      )}
      {owner && rows.length === 0 && (
        <div className="text-on-surface-variant text-sm">No open orders.</div>
      )}
      {rows.length > 0 && (
        <table className="w-full font-mono text-xs">
          <thead>
            <tr className="text-on-surface-variant/70 text-left">
              <th className={headCellClass}>Slot</th>
              <th className={headCellClass}>Side</th>
              <th className={headCellClass}>Price (lots)</th>
              <th className={headCellClass}>TP</th>
              <th className={headCellClass}>SL</th>
              <th className={headCellClass}>ClientId</th>
              <th className={headCellClass}>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.slot}>
                <tr className="border-t kx-border">
                  <td className={bodyCellClass}>{r.slot}</td>
                  <td className={`${bodyCellClass} ${r.side === 0 ? "text-[#4dffb4]" : "text-[#ff6b6b]"}`}>
                    {r.side === 0 ? "BID" : "ASK"}
                  </td>
                  <td className={bodyCellClass}>{String(r.lockedPrice)}</td>
                  <td className={bodyCellClass}>
                    <TriggerCell trigger={r.takeProfit} kind="tp" />
                  </td>
                  <td className={bodyCellClass}>
                    <TriggerCell trigger={r.stopLoss} kind="sl" />
                  </td>
                  <td className={bodyCellClass}>{String(r.clientId)}</td>
                  <td className={bodyCellClass}>{r.isFilled ? "FILLED" : "OPEN"}</td>
                  <td className="text-right">
                    <div className="inline-flex gap-1">
                      <button
                        disabled={!!busy || r.isFilled}
                        onClick={() => {
                          if (editing === r.clientId) {
                            setEditing(null);
                          } else {
                            setEditing(r.clientId);
                            setDraft({
                              price: String(r.lockedPrice),
                              size: "",
                              leverage: "1",
                            });
                          }
                        }}
                        className="text-[10px] font-headline font-bold uppercase tracking-wider min-w-[64px] px-2.5 py-1 rounded-md bg-kx-surface-hi border kx-border text-on-surface-variant hover:text-on-surface hover:bg-kx-surface-hi/80 transition-colors disabled:opacity-50"
                      >
                        {editing === r.clientId ? "Close" : "Edit"}
                      </button>
                      <button
                        disabled={!!busy}
                        onClick={() => cancel(r.clientId)}
                        className="text-[10px] font-headline font-bold uppercase tracking-wider min-w-[64px] px-2.5 py-1 rounded-md bg-[#ff6b6b]/10 border border-[#ff6b6b]/30 text-[#ff6b6b] hover:bg-[#ff6b6b]/20 transition-colors disabled:opacity-50"
                      >
                        {busy === `cancel ${r.clientId}` ? "…" : "Cancel"}
                      </button>
                    </div>
                  </td>
                </tr>
                {editing === r.clientId && (
                  <tr className="border-t kx-border bg-kx-surface-lo">
                    <td colSpan={8} className="p-3">
                      <div className="flex gap-3 items-end">
                        <div className="flex-1">
                          <div className="text-[11px] uppercase tracking-wider text-on-surface-variant/70 mb-1">
                            new price (lots)
                          </div>
                          <input
                            value={draft.price}
                            onChange={(e) =>
                              setDraft({ ...draft, price: e.target.value })
                            }
                            inputMode="numeric"
                            className="w-full bg-kx-surface border kx-border rounded-md px-3 py-2 text-sm font-mono text-on-surface"
                          />
                        </div>
                        <div className="flex-1">
                          <div className="text-[11px] uppercase tracking-wider text-on-surface-variant/70 mb-1">
                            new size (base lots)
                          </div>
                          <input
                            value={draft.size}
                            onChange={(e) =>
                              setDraft({ ...draft, size: e.target.value })
                            }
                            inputMode="numeric"
                            className="w-full bg-kx-surface border kx-border rounded-md px-3 py-2 text-sm font-mono text-on-surface"
                          />
                        </div>
                        <div className="w-24">
                          <div className="text-[11px] uppercase tracking-wider text-on-surface-variant/70 mb-1">
                            lev
                          </div>
                          <input
                            value={draft.leverage}
                            onChange={(e) =>
                              setDraft({ ...draft, leverage: e.target.value })
                            }
                            inputMode="numeric"
                            className="w-full bg-kx-surface border kx-border rounded-md px-3 py-2 text-sm font-mono text-on-surface"
                          />
                        </div>
                        <button
                          disabled={!!busy}
                          onClick={() => submitEdit(r)}
                          className="text-[11px] font-headline font-bold uppercase tracking-wider px-4 py-2 rounded-md bg-[#4dffb4] text-on-primary-fixed shadow-md shadow-[#4dffb4]/20 hover:brightness-110 active:scale-[0.99] transition-all disabled:opacity-50"
                        >
                          {busy === `edit ${r.clientId}` ? "…" : "Submit"}
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
