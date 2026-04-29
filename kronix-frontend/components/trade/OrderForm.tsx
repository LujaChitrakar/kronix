"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  sendPlaceOrderAndSettle,
  sendCancelOrderByClientId,
} from "@/lib/kronix/client";
import { Side, PlaceOrderType } from "@/lib/kronix/config";
import {
  findOpenOrdersPda,
  findMarketPda,
  findMarketConfigPda,
} from "@/lib/kronix/pdas";
import { fetchOpenOrders, fetchMarketConfig } from "@/lib/kronix/state";
import { MARKET_INDEX } from "@/lib/kronix/config";
import { sendTx, formatTxError } from "./tx";

type OwnOrder = { clientId: bigint; priceLots: bigint; side: number };

function crossesOwn(
  myOrders: OwnOrder[],
  takerSide: number,
  takerPrice: bigint,
): OwnOrder[] {
  // Taker is bid (0): crosses any of my asks priced <= takerPrice.
  // Taker is ask (1): crosses any of my bids priced >= takerPrice.
  if (takerSide === 0) {
    return myOrders.filter((o) => o.side === 1 && o.priceLots <= takerPrice);
  }
  return myOrders.filter((o) => o.side === 0 && o.priceLots >= takerPrice);
}

const ORDER_TYPES: [string, number][] = [
  ["Limit", PlaceOrderType.Limit],
  ["Market", PlaceOrderType.Market],
  ["IOC", PlaceOrderType.ImmediateOrCancel],
  ["PostOnly", PlaceOrderType.PostOnly],
];

export function OrderForm() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;

  const [side, setSide] = useState<number>(Side.Bid);
  const [orderType, setOrderType] = useState<number>(PlaceOrderType.Limit);
  const [price, setPrice] = useState("");
  const [size, setSize] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [myOrders, setMyOrders] = useState<OwnOrder[]>([]);
  const [cfg, setCfg] = useState<{
    quoteLotSize: bigint;
    initialMarginBps: number;
  } | null>(null);

  useEffect(() => {
    const [cfgPda] = findMarketConfigPda(MARKET_INDEX);
    fetchMarketConfig(connection, cfgPda)
      .then((c) => {
        if (c)
          setCfg({
            quoteLotSize: c.quoteLotSize,
            initialMarginBps: c.initialMarginBps,
          });
      })
      .catch(() => null);
  }, [connection]);

  // Live refresh of own resting orders so we can warn before submit.
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    const refresh = async () => {
      const [market] = findMarketPda(MARKET_INDEX);
      const [oo] = findOpenOrdersPda(owner, market);
      const acct = await fetchOpenOrders(connection, oo);
      if (!alive) return;
      if (!acct) {
        setMyOrders([]);
        return;
      }
      const list: OwnOrder[] = [];
      acct.openOrders.forEach((o) => {
        if (o.isFree === 1) return;
        list.push({
          clientId: o.clientId,
          priceLots: o.lockedPrice,
          side: o.side,
        });
      });
      setMyOrders(list);
    };
    refresh().catch(() => null);
    const t = setInterval(() => refresh().catch(() => null), 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [connection, owner]);

  const priceLotsParsed = (() => {
    try {
      return BigInt(parseInt(price || "0", 10));
    } catch {
      return 0n;
    }
  })();

  const conflicts =
    orderType === PlaceOrderType.Market
      ? myOrders.filter(
          (o) => (side === 0 && o.side === 1) || (side === 1 && o.side === 0),
        )
      : priceLotsParsed > 0n
        ? crossesOwn(myOrders, side, priceLotsParsed)
        : [];

  const cancelConflicts = async () => {
    if (!owner || conflicts.length === 0) return;
    setBusy(true);
    setMsg(`Cancelling ${conflicts.length} own order(s)…`);
    try {
      for (const o of conflicts) {
        await sendCancelOrderByClientId(owner, o.clientId, connection, (ixs, c) =>
          sendTx(wallet, c, ixs),
        );
      }
      setMsg(`Cancelled ${conflicts.length}. Retry place order.`);
    } catch (e) {
      setMsg(`Cancel failed:\n${formatTxError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!owner) return;
    const isMarket = orderType === PlaceOrderType.Market;
    const priceLots = isMarket
      ? 1n
      : BigInt(parseInt(price || "0", 10));
    const maxBaseLots = BigInt(parseInt(size || "0", 10));
    if (maxBaseLots <= 0n) {
      setMsg("Enter size in lots");
      return;
    }
    if (!isMarket && priceLots <= 0n) {
      setMsg("Enter price in lots");
      return;
    }
    // Market orders have no caller price; cap quote at i64-safe max so
    // matching loop's `remaining_quote_lots / best_opposing_price` always
    // yields a usable bound. Program ignores params.price_lots for Market.
    const MARKET_MAX_QUOTE = 1n << 62n;
    const maxQuoteLots = isMarket
      ? MARKET_MAX_QUOTE
      : priceLots * maxBaseLots;
    setBusy(true);
    setMsg("Placing…");
    try {
      const clientOrderId = BigInt(Date.now());
      const res = await sendPlaceOrderAndSettle(
        owner,
        {
          side,
          orderType,
          priceLots,
          maxBaseLots,
          maxQuoteLots,
          clientOrderId,
          expiryTimestamp: 0n,
          limit: 16,
        },
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
      );
      const settled = res.settleSigs.length;
      setMsg(
        `Placed ${res.placeSig.slice(0, 8)}…  fills=${res.fillCount}  ` +
          `settle TXs=${settled}` +
          (settled ? ` [${res.settleSigs.map((s) => s.slice(0, 6)).join(", ")}]` : ""),
      );
    } catch (e) {
      setMsg(`Failed:\n${formatTxError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4">
      <div className="mb-3 px-2 py-1.5 rounded-md bg-kx-surface-lo border kx-border text-[10px] font-mono text-on-surface-variant break-all">
        Signer:{" "}
        <span className="text-[#4dffb4]">
          {owner ? owner.toBase58() : "(not connected)"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          onClick={() => setSide(Side.Bid)}
          className={`py-2 text-sm font-headline font-bold rounded-md border ${
            side === Side.Bid
              ? "bg-[#4dffb4]/20 text-[#4dffb4] border-[#4dffb4]/40"
              : "bg-kx-surface-lo text-on-surface-variant kx-border"
          }`}
        >
          BUY / LONG
        </button>
        <button
          onClick={() => setSide(Side.Ask)}
          className={`py-2 text-sm font-headline font-bold rounded-md border ${
            side === Side.Ask
              ? "bg-[#ff6b6b]/20 text-[#ff6b6b] border-[#ff6b6b]/40"
              : "bg-kx-surface-lo text-on-surface-variant kx-border"
          }`}
        >
          SELL / SHORT
        </button>
      </div>

      <div className="mb-3">
        <div className="grid grid-cols-4 gap-1">
          {ORDER_TYPES.map(([label, val]) => (
            <button
              key={val}
              onClick={() => setOrderType(val)}
              className={`py-1.5 text-[11px] font-mono rounded-md border ${
                orderType === val
                  ? "bg-primary-container/30 text-[#4dffb4] border-[#4dffb4]/40"
                  : "bg-kx-surface-lo text-on-surface-variant kx-border"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Field
        label="Price (lots)"
        value={price}
        onChange={setPrice}
        disabled={orderType === PlaceOrderType.Market}
      />
      <Field label="Size (base lots)" value={size} onChange={setSize} />

      {cfg && (() => {
        let sz = 0n;
        let pr = 0n;
        try {
          sz = BigInt(parseInt(size || "0", 10));
          pr = BigInt(parseInt(price || "0", 10));
        } catch {}
        if (sz <= 0n || pr <= 0n) return null;
        const notional = sz * pr * cfg.quoteLotSize;
        const margin = (notional * BigInt(cfg.initialMarginBps)) / 10_000n;
        const fmt = (n: bigint) => {
          const w = n / 1_000_000n;
          const f = (n % 1_000_000n).toString().padStart(6, "0").slice(0, 4);
          return `$${w}.${f}`;
        };
        const tooSmall = margin < 10_000n; // < $0.01
        return (
          <div
            className={`mb-2 px-2 py-1.5 rounded-md border text-[10px] font-mono ${
              tooSmall
                ? "border-[#ffb86b]/40 bg-[#ffb86b]/10 text-[#ffb86b]"
                : "kx-border bg-kx-surface-lo text-on-surface-variant"
            }`}
          >
            notional {fmt(notional)} ({String(notional)} native) · margin{" "}
            {fmt(margin)} ({String(margin)} native)
            {tooSmall && (
              <div className="mt-1">
                Too small — margin under $0.01 will round to 0 in UI and may
                trip InsufficientCollateral on close/−margin. Increase price or
                size.
              </div>
            )}
          </div>
        );
      })()}

      {conflicts.length > 0 && (
        <div className="my-2 p-2 rounded-md border border-[#ffb86b]/40 bg-[#ffb86b]/10 text-[10px] font-mono text-[#ffb86b]">
          <div className="font-bold mb-1">
            Self-trade: {conflicts.length} of your own resting order(s) will be
            hit first → entire order aborts.
          </div>
          <ul className="mb-2">
            {conflicts.slice(0, 4).map((c) => (
              <li key={String(c.clientId)}>
                {c.side === 0 ? "BID" : "ASK"} @ {String(c.priceLots)}{" "}
                (clientId {String(c.clientId)})
              </li>
            ))}
          </ul>
          <button
            disabled={busy}
            onClick={cancelConflicts}
            className="px-2 py-1 rounded-md bg-[#ffb86b]/20 border border-[#ffb86b]/40 text-[#ffb86b] disabled:opacity-50"
          >
            Cancel conflicting orders
          </button>
        </div>
      )}

      <button
        disabled={busy || !owner}
        onClick={submit}
        className={`w-full mt-2 py-2.5 text-sm font-headline font-bold rounded-md disabled:opacity-50 ${
          side === Side.Bid
            ? "bg-[#4dffb4] text-on-primary-fixed"
            : "bg-[#ff6b6b] text-white"
        }`}
      >
        {busy ? "Placing…" : owner ? "Place Order" : "Connect Wallet"}
      </button>

      {msg && (
        <pre className="mt-3 text-[10px] font-mono text-on-surface-variant break-all whitespace-pre-wrap max-h-64 overflow-auto bg-kx-surface-lo p-2 rounded-md border kx-border">
          {msg}
        </pre>
      )}

      <div className="mt-3 text-[10px] text-on-surface-variant/60 leading-relaxed">
        Self-trade rule: matching iterates from best opposing price. If any
        of your own orders sits at the crossing price, traversal hits yours
        first and the whole order aborts. Cancel them or use a second wallet
        as taker.
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-2">
      <div className="text-[10px] text-on-surface-variant/70 uppercase mb-1">
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        inputMode="numeric"
        className="w-full bg-kx-surface-lo border kx-border rounded-md px-3 py-2 text-sm font-mono text-on-surface disabled:opacity-40"
      />
    </div>
  );
}
