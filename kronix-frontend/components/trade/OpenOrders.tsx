"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { findOpenOrdersPda, findMarketPda } from "@/lib/kronix/pdas";
import { fetchOpenOrders } from "@/lib/kronix/state";
import { MARKET_INDEX } from "@/lib/kronix/config";
import {
  sendCancelOrderByClientId,
  sendCancelAllOrders,
  sendEditOrder,
} from "@/lib/kronix/client";
import { PlaceOrderType } from "@/lib/kronix/config";
import { sendTx, formatTxError } from "./tx";

type Row = {
  slot: number;
  clientId: bigint;
  lockedPrice: bigint;
  side: number;
  isFilled: boolean;
  id: Uint8Array;
};

type EditDraft = { price: string; size: string };

export function OpenOrders() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<bigint | null>(null);
  const [draft, setDraft] = useState<EditDraft>({ price: "", size: "" });

  const refresh = useCallback(async () => {
    if (!owner) {
      setRows([]);
      return;
    }
    const [market] = findMarketPda(MARKET_INDEX);
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
        lockedPrice: o.lockedPrice,
        side: o.side,
        isFilled: o.makerOut === 1,
        id: Uint8Array.from(o.id),
      });
    });
    setRows(list);
  }, [connection, owner]);

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
      );
      setMsg(`Cancel → ${sig.slice(0, 8)}…`);
      await refresh();
    } catch (e) {
      setMsg(`Cancel failed:\n${formatTxError(e)}`);
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
        { sideFilter, limit: 24 },
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
      );
      setMsg(`Cancel-all → ${sig.slice(0, 8)}…`);
      await refresh();
    } catch (e) {
      setMsg(`Cancel-all failed:\n${formatTxError(e)}`);
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
        },
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
      );
      setMsg(`Edit → ${sig.slice(0, 8)}…`);
      setEditing(null);
      setDraft({ price: "", size: "" });
      await refresh();
    } catch (e) {
      setMsg(`Edit failed:\n${formatTxError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="px-1">
      <div className="flex items-center justify-end mb-3">
        {owner && rows.length > 0 && (
          <div className="flex gap-1">
            <button
              disabled={!!busy}
              onClick={() => cancelAll(0)}
              className="text-[10px] px-2 py-1 rounded-md bg-[#4dffb4]/15 border border-[#4dffb4]/30 text-[#4dffb4] disabled:opacity-50"
            >
              Cancel Bids
            </button>
            <button
              disabled={!!busy}
              onClick={() => cancelAll(1)}
              className="text-[10px] px-2 py-1 rounded-md bg-[#ff6b6b]/15 border border-[#ff6b6b]/30 text-[#ff6b6b] disabled:opacity-50"
            >
              Cancel Asks
            </button>
            <button
              disabled={!!busy}
              onClick={() => cancelAll(255)}
              className="text-[10px] px-2 py-1 rounded-md bg-kx-surface-hi border kx-border disabled:opacity-50"
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
              <th className="py-1">Slot</th>
              <th>Side</th>
              <th>Price (lots)</th>
              <th>ClientId</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.slot}>
                <tr className="border-t kx-border">
                  <td className="py-1.5">{r.slot}</td>
                  <td className={r.side === 0 ? "text-[#4dffb4]" : "text-[#ff6b6b]"}>
                    {r.side === 0 ? "BID" : "ASK"}
                  </td>
                  <td>{String(r.lockedPrice)}</td>
                  <td>{String(r.clientId)}</td>
                  <td>{r.isFilled ? "FILLED" : "OPEN"}</td>
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
                            });
                          }
                        }}
                        className="text-[10px] px-2 py-1 rounded-md bg-kx-surface-hi border kx-border disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        disabled={!!busy}
                        onClick={() => cancel(r.clientId)}
                        className="text-[10px] px-2 py-1 rounded-md bg-kx-surface-hi border kx-border disabled:opacity-50"
                      >
                        {busy === `cancel ${r.clientId}` ? "…" : "Cancel"}
                      </button>
                    </div>
                  </td>
                </tr>
                {editing === r.clientId && (
                  <tr className="border-t kx-border bg-kx-surface-lo">
                    <td colSpan={6} className="p-2">
                      <div className="flex gap-2 items-end">
                        <div className="flex-1">
                          <div className="text-[9px] uppercase text-on-surface-variant/70">
                            new price (lots)
                          </div>
                          <input
                            value={draft.price}
                            onChange={(e) =>
                              setDraft({ ...draft, price: e.target.value })
                            }
                            inputMode="numeric"
                            className="w-full bg-kx-surface border kx-border rounded-md px-2 py-1 text-xs font-mono text-on-surface"
                          />
                        </div>
                        <div className="flex-1">
                          <div className="text-[9px] uppercase text-on-surface-variant/70">
                            new size (base lots)
                          </div>
                          <input
                            value={draft.size}
                            onChange={(e) =>
                              setDraft({ ...draft, size: e.target.value })
                            }
                            inputMode="numeric"
                            className="w-full bg-kx-surface border kx-border rounded-md px-2 py-1 text-xs font-mono text-on-surface"
                          />
                        </div>
                        <button
                          disabled={!!busy}
                          onClick={() => submitEdit(r)}
                          className="text-[10px] px-3 py-1.5 rounded-md bg-primary-container text-on-primary-fixed font-bold disabled:opacity-50"
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
      {msg && (
        <pre className="mt-3 text-[10px] font-mono text-on-surface-variant break-all whitespace-pre-wrap max-h-64 overflow-auto bg-kx-surface-lo p-2 rounded-md border kx-border">
          {msg}
        </pre>
      )}
    </div>
  );
}
