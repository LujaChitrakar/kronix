"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  sendPlaceOrderAndSettle,
  sendCancelOrderByClientId,
} from "@/lib/kronix/client";
import { Side, PlaceOrderType, TriggerType } from "@/lib/kronix/config";
import {
  findOpenOrdersPda,
  findMarketPda,
  findMarketConfigPda,
  findUserAccountPda,
} from "@/lib/kronix/pdas";
import { fetchOpenOrders, fetchMarketConfig, fetchUser } from "@/lib/kronix/state";
import { useStore } from "@/lib/store";
import {
  notifyError,
  notifyInfo,
  notifyTxSuccess,
  notifyWarning,
} from "@/lib/notifications";
import { sendTx, formatTxError } from "./tx";

type OwnOrder = { clientId: bigint; priceLots: bigint; side: number };

function priceFromOrderId(id: Uint8Array | ArrayLike<number>): bigint {
  const bytes = Uint8Array.from(id);
  let out = 0n;
  for (let i = 15; i >= 8; i--) out = (out << 8n) + BigInt(bytes[i] ?? 0);
  return out;
}

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
  const [leverage, setLeverage] = useState(1);
  const [price, setPrice] = useState("");
  const [size, setSize] = useState("");
  const [tpslOpen, setTpslOpen] = useState(false);
  const [takeProfitPrice, setTakeProfitPrice] = useState("");
  const [stopLossPrice, setStopLossPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [myOrders, setMyOrders] = useState<OwnOrder[]>([]);
  const [cfg, setCfg] = useState<{
    quoteLotSize: bigint;
    initialMarginBps: number;
  } | null>(null);

  const [mounted, setMounted] = useState(false);
  const selectedPrice = useStore(s => s.selectedPrice);
  const marketIndex = useStore(s => s.selectedMarketIndex);
  const lastFocusedInputId = useStore(s => s.lastFocusedInputId);
  const setLastFocusedInputId = useStore(s => s.setLastFocusedInputId);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (selectedPrice !== null && lastFocusedInputId) {
      const p = Math.round(selectedPrice).toString();
      if (lastFocusedInputId === "order-price") setPrice(p);
      if (lastFocusedInputId === "order-tp") setTakeProfitPrice(p);
      if (lastFocusedInputId === "order-sl") setStopLossPrice(p);
    }
  }, [selectedPrice, lastFocusedInputId]);

  useEffect(() => {
    const [cfgPda] = findMarketConfigPda(marketIndex);
    fetchMarketConfig(connection, cfgPda)
      .then((c) => {
        if (c)
          setCfg({
            quoteLotSize: c.quoteLotSize,
            initialMarginBps: c.initialMarginBps,
          });
      })
      .catch(() => null);
  }, [connection, marketIndex]);

  // Live refresh of own resting orders so we can warn before submit.
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    const refresh = async () => {
      const [market] = findMarketPda(marketIndex);
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
          priceLots: priceFromOrderId(o.id),
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
  }, [connection, owner, marketIndex]);

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
    notifyInfo("Cancelling conflicting orders", `${conflicts.length} order(s)`);
    try {
      const sigs: string[] = [];
      for (const o of conflicts) {
        const sig = await sendCancelOrderByClientId(
          owner,
          o.clientId,
          connection,
          (ixs, c) => sendTx(wallet, c, ixs),
          marketIndex,
        );
        sigs.push(sig);
      }
      setMsg(`Cancelled ${conflicts.length}. Retry place order.`);
      for (const sig of sigs) notifyTxSuccess("Conflicting order cancelled", sig);
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Cancel failed:\n${err}`);
      notifyError("Cancel failed", err);
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
    const tpLots = tpslOpen ? BigInt(parseInt(takeProfitPrice || "0", 10)) : 0n;
    const slLots = tpslOpen ? BigInt(parseInt(stopLossPrice || "0", 10)) : 0n;
    if (maxBaseLots <= 0n) {
      setMsg("Enter size in lots");
      notifyWarning("Order blocked", "Enter size in lots");
      return;
    }
    if (!isMarket && priceLots <= 0n) {
      setMsg("Enter price in lots");
      notifyWarning("Order blocked", "Enter price in lots");
      return;
    }
    if (tpslOpen && tpLots <= 0n && slLots <= 0n) {
      setMsg("Enter TP or SL trigger price in lots");
      notifyWarning("Order blocked", "Enter TP or SL trigger price in lots");
      return;
    }
    const triggerReferencePrice = isMarket
      ? BigInt(Math.round(selectedPrice ?? 0))
      : priceLots;
    if (tpslOpen && triggerReferencePrice > 0n) {
      const invalidTp =
        tpLots > 0n &&
        (side === Side.Bid
          ? tpLots <= triggerReferencePrice
          : tpLots >= triggerReferencePrice);
      const invalidSl =
        slLots > 0n &&
        (side === Side.Bid
          ? slLots >= triggerReferencePrice
          : slLots <= triggerReferencePrice);
      if (invalidTp || invalidSl) {
        const msg =
          side === Side.Bid
            ? "For a buy/long order, TP must be above entry and SL below entry"
            : "For a sell/short order, TP must be below entry and SL above entry";
        setMsg(msg);
        notifyWarning("Invalid TP/SL", msg);
        return;
      }
    }
    setBusy(true);
    setMsg("Placing…");
    try {
      const maxQuoteLots = isMarket
        ? await (async () => {
            const [userPda] = findUserAccountPda(owner);
            const user = await fetchUser(connection, userPda);
            if (!user) return 0n;
            const freeNative = user.collateral - user.marginUsed;
            return freeNative > 0n ? (freeNative / 1_000_000n) * BigInt(leverage) : 0n;
          })()
        : priceLots * maxBaseLots;

      if (maxQuoteLots <= 0n) {
        setMsg("No free collateral");
        notifyWarning("Order blocked", "No free collateral");
        setBusy(false);
        return;
      }

      const clientOrderId = BigInt(Date.now());
      const triggerSide = side === Side.Bid ? Side.Ask : Side.Bid;
      const triggerBaseId = clientOrderId * 10n;
      const attachedTriggers = [
        ...(tpLots > 0n
          ? [
              {
                clientOrderId: triggerBaseId + 1n,
                triggerPrice: tpLots,
                sizeLots: maxBaseLots,
                expiry: 0n,
                triggerType: TriggerType.TakeProfit,
                side: triggerSide,
                marketIndex,
              },
            ]
          : []),
        ...(slLots > 0n
          ? [
              {
                clientOrderId: triggerBaseId + 2n,
                triggerPrice: slLots,
                sizeLots: maxBaseLots,
                expiry: 0n,
                triggerType: TriggerType.StopLoss,
                side: triggerSide,
                marketIndex,
              },
            ]
          : []),
      ];
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
          leverage,
          marketIndex,
          attachedTriggers,
        },
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
      );
      const settled = res.settleSigs.length;
      const triggerCount = attachedTriggers.length;
      setMsg(
        `Placed ${res.placeSig.slice(0, 8)}…  fills=${res.fillCount}  ` +
          `settle TXs=${settled}  triggers=${triggerCount}` +
          (settled ? ` [${res.settleSigs.map((s) => s.slice(0, 6)).join(", ")}]` : ""),
      );
      notifyTxSuccess(
        "Order placed",
        res.placeSig,
        `fills=${res.fillCount} settle TXs=${settled} triggers=${triggerCount}`,
      );
      for (const sig of res.settleSigs) {
        notifyTxSuccess("Fill settled", sig);
      }
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Failed:\n${err}`);
      notifyError("Order failed", err);
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return <div className="p-3 animate-pulse bg-kx-surface-lo rounded-xl h-full" />;

  return (
    <div className="p-3 space-y-3">
      {/*<SignerBadge owner={owner} />*/}

      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-kx-surface-lo border kx-border">
        <button
          onClick={() => setSide(Side.Bid)}
          className={`py-2 text-xs font-headline font-bold rounded-md transition-all ${
            side === Side.Bid
              ? "bg-[#4dffb4] text-on-primary-fixed shadow-md shadow-[#4dffb4]/20"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          BUY / LONG
        </button>
        <button
          onClick={() => setSide(Side.Ask)}
          className={`py-2 text-xs font-headline font-bold rounded-md transition-all ${
            side === Side.Ask
              ? "bg-[#ff6b6b] text-white shadow-md shadow-[#ff6b6b]/20"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          SELL / SHORT
        </button>
      </div>

      <SectionLabel>Order Type</SectionLabel>
      <div className="grid grid-cols-4 gap-1">
        {ORDER_TYPES.map(([label, val]) => (
          <button
            key={val}
            onClick={() => setOrderType(val)}
            className={`py-1.5 text-[10px] font-mono uppercase rounded-md border transition-colors ${
              orderType === val
                ? "bg-[#4dffb4]/15 text-[#4dffb4] border-[#4dffb4]/40"
                : "bg-kx-surface-lo text-on-surface-variant kx-border hover:text-on-surface"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <Field
          id="order-price"
          label="Price (lots)"
          value={price}
          onChange={setPrice}
          onFocus={() => setLastFocusedInputId("order-price")}
          disabled={orderType === PlaceOrderType.Market}
        />
        <Field 
          id="order-size"
          label="Size (base lots)" 
          value={size} 
          onChange={setSize} 
          onFocus={() => setLastFocusedInputId("order-size")}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-[10px] font-mono uppercase text-on-surface-variant">
          <span>Leverage</span>
          <span className="text-[#4dffb4] font-bold">{leverage}x</span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="w-full accent-[#4dffb4]"
        />
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setTpslOpen((v) => !v)}
          className={`w-full py-2 text-[10px] font-mono uppercase rounded-md border transition-colors ${
            tpslOpen
              ? "bg-[#4dffb4]/15 text-[#4dffb4] border-[#4dffb4]/40"
              : "bg-kx-surface-lo text-on-surface-variant kx-border hover:text-on-surface"
          }`}
        >
          TP/SL
        </button>
        {tpslOpen && (
          <div className="grid grid-cols-2 gap-2 p-2 rounded-lg bg-kx-surface-lo border kx-border">
            <Field
              id="order-tp"
              label="TP (lots)"
              value={takeProfitPrice}
              onChange={setTakeProfitPrice}
              onFocus={() => setLastFocusedInputId("order-tp")}
            />
            <Field
              id="order-sl"
              label="SL (lots)"
              value={stopLossPrice}
              onChange={setStopLossPrice}
              onFocus={() => setLastFocusedInputId("order-sl")}
            />
          </div>
        )}
      </div>

      {cfg && (() => {
        let sz = 0n;
        let pr = 0n;
        try {
          sz = BigInt(parseInt(size || "0", 10));
          pr = BigInt(parseInt(price || "0", 10));
        } catch {}
        if (sz <= 0n || pr <= 0n) return null;
        const notional = sz * pr * 1_000_000n;
        const margin = (notional + BigInt(leverage - 1)) / BigInt(leverage);
        const fmt = (n: bigint) => {
          const w = n / 1_000_000n;
          const f = (n % 1_000_000n).toString().padStart(6, "0").slice(0, 4);
          return `$${w}.${f}`;
        };
        const tooSmall = margin < 10_000n;
        return (
          <div
            className={`px-3 py-2 rounded-lg border text-[10px] font-mono ${
              tooSmall
                ? "border-[#ffb86b]/40 bg-[#ffb86b]/10 text-[#ffb86b]"
                : "kx-border bg-kx-surface-lo"
            }`}
          >
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[9px] uppercase tracking-wider opacity-60 mb-0.5">
                  Notional
                </div>
                <div className="text-on-surface font-bold">{fmt(notional)}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider opacity-60 mb-0.5">
                  Margin
                </div>
                <div className="text-on-surface font-bold">{fmt(margin)}</div>
              </div>
            </div>
            {tooSmall && (
              <div className="mt-2 pt-2 border-t border-[#ffb86b]/30">
                Margin &lt; $0.01 — UI rounds to 0 and may trip InsufficientCollateral.
              </div>
            )}
          </div>
        );
      })()}

      {conflicts.length > 0 && (
        <div className="p-2.5 rounded-lg border border-[#ffb86b]/40 bg-[#ffb86b]/10 text-[10px] font-mono text-[#ffb86b]">
          <div className="font-bold mb-1.5">
            ⚠ Self-trade: {conflicts.length} of your order(s) will be hit first
          </div>
          <ul className="mb-2 space-y-0.5 opacity-90">
            {conflicts.slice(0, 4).map((c) => (
              <li key={String(c.clientId)}>
                {c.side === 0 ? "BID" : "ASK"} @ {String(c.priceLots)}
              </li>
            ))}
          </ul>
          <button
            disabled={busy}
            onClick={cancelConflicts}
            className="w-full px-2 py-1.5 rounded-md bg-[#ffb86b]/20 border border-[#ffb86b]/40 text-[#ffb86b] hover:bg-[#ffb86b]/30 transition-colors disabled:opacity-50"
          >
            Cancel conflicting orders
          </button>
        </div>
      )}

      <button
        disabled={busy || !owner}
        onClick={submit}
        className={`w-full py-3 text-sm font-headline font-bold uppercase tracking-wider rounded-lg transition-all disabled:opacity-50 hover:brightness-110 active:scale-[0.99] shadow-lg ${
          side === Side.Bid
            ? "bg-[#4dffb4] text-on-primary-fixed shadow-[#4dffb4]/20"
            : "bg-[#ff6b6b] text-white shadow-[#ff6b6b]/20"
        }`}
      >
        {busy ? "Placing…" : owner ? `Place ${side === Side.Bid ? "Buy" : "Sell"} Order` : "Connect Wallet"}
      </button>

    </div>
  );
}

function SignerBadge({ owner }: { owner: PublicKey | null }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-kx-surface-lo border kx-border">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          owner ? "bg-[#4dffb4]" : "bg-on-surface-variant/40"
        }`}
      />
      <span className="text-[9px] font-mono uppercase tracking-wider text-on-surface-variant/60">
        Signer
      </span>
      <span className="text-[10px] font-mono text-on-surface truncate flex-1 text-right">
        {owner ? `${owner.toBase58().slice(0, 4)}…${owner.toBase58().slice(-4)}` : "Not connected"}
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-headline uppercase tracking-wider text-on-surface-variant/60">
      {children}
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  onFocus,
  disabled,
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-2">
      <div className="text-[9px] text-on-surface-variant/60 uppercase tracking-wider mb-1">
        {label}
      </div>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        disabled={disabled}
        inputMode="numeric"
        className="w-full bg-kx-surface-lo border kx-border rounded-md px-3 py-2 text-sm font-mono text-on-surface focus:outline-none focus:border-[#4dffb4]/50 focus:bg-kx-surface-lo/80 disabled:opacity-40 transition-colors"
      />
    </div>
  );
}
