"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  sendPlaceOrder,
  sendCancelOrderByClientId,
  sendCreateOpenOrders,
} from "@/lib/kronix/client";
import { Side, PlaceOrderType, TriggerType } from "@/lib/kronix/config";
import {
  findOpenOrdersPda,
  findMarketPda,
  findMarketConfigPda,
  findUserAccountPda,
  findPositionPda,
} from "@/lib/kronix/pdas";
import { fetchOpenOrders, fetchMarketConfig, fetchUser, fetchPosition } from "@/lib/kronix/state";
import {
  formatNetPositionPreview,
  simulateNetPosition,
  type NetPosition,
  type NetSide,
} from "@/lib/kronix/net-position";
import { useStore } from "@/lib/store";
import {
  notifyError,
  notifyInfo,
  notifyTxSuccess,
  notifyWarning,
} from "@/lib/notifications";
import {
  formatPriceLots,
  formatSizeLots,
  formatUsdcNative,
  notionalNative,
  parsePriceInput,
  parseSizeInput,
  priceInputFromNumber,
  quoteLotsToNative,
  type LotConfig,
} from "@/lib/kronix/lot-math";
import { sendTx, formatTxError } from "./tx";

type OwnOrder = { clientId: bigint; priceLots: bigint; side: number };

function netSideFromOrderSide(side: number): NetSide {
  return side === Side.Bid ? "long" : "short";
}

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
const DEPOSIT_COLLATERAL_MESSAGE =
  "Please deposit collateral first, get USDC and SOL devnet from the navbar";

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
  const [busyAction, setBusyAction] = useState<
    "cancel-conflicts" | "initialize" | "place" | null
  >(null);
  const [msg, setMsg] = useState("");
  const [myOrders, setMyOrders] = useState<OwnOrder[]>([]);
  const [hasOpenOrders, setHasOpenOrders] = useState<boolean | null>(null);
  const [collateral, setCollateral] = useState<bigint | null>(null);
  const [netPosition, setNetPosition] = useState<NetPosition | null>(null);
  const [cfg, setCfg] = useState<{
    baseLotSize: bigint;
    quoteLotSize: bigint;
    initialMarginBps: number;
  } | null>(null);

  const [mounted, setMounted] = useState(false);
  const selectedPrice = useStore(s => s.selectedPrice);
  const marketIndex = useStore(s => s.selectedMarketIndex);
  const lastFocusedInputId = useStore(s => s.lastFocusedInputId);
  const setLastFocusedInputId = useStore(s => s.setLastFocusedInputId);
  const busy = busyAction !== null;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (selectedPrice !== null && lastFocusedInputId) {
      const p = priceInputFromNumber(selectedPrice);
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
            baseLotSize: c.baseLotSize,
            quoteLotSize: c.quoteLotSize,
            initialMarginBps: c.initialMarginBps,
          });
      })
      .catch(() => null);
  }, [connection, marketIndex]);

  useEffect(() => {
    if (!owner) {
      setNetPosition(null);
      return;
    }
    let alive = true;
    const refresh = async () => {
      const [positionPda] = findPositionPda(owner, marketIndex);
      const pos = await fetchPosition(connection, positionPda);
      if (!alive) return;
      if (!pos || pos.size === 0n) {
        setNetPosition(null);
        return;
      }
      setNetPosition({
        side: pos.side === Side.Bid ? "long" : "short",
        sizeLots: pos.size,
        entryPriceLots: pos.entryPrice,
      });
    };
    refresh().catch(() => null);
    const t = setInterval(() => refresh().catch(() => null), 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [connection, owner, marketIndex]);

  // Live refresh of own resting orders so we can warn before submit.
  useEffect(() => {
    if (!owner) {
      setHasOpenOrders(null);
      setMyOrders([]);
      return;
    }
    setHasOpenOrders(null);
    let alive = true;
    const refresh = async () => {
      const [market] = findMarketPda(marketIndex);
      const [oo] = findOpenOrdersPda(owner, market);
      const acct = await fetchOpenOrders(connection, oo);
      if (!alive) return;
      setHasOpenOrders(!!acct);
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

  useEffect(() => {
    if (!owner) {
      setCollateral(null);
      return;
    }
    let alive = true;
    const refresh = async () => {
      const [userPda] = findUserAccountPda(owner);
      const user = await fetchUser(connection, userPda);
      if (alive) setCollateral(user?.collateral ?? 0n);
    };
    refresh().catch(() => null);
    const t = setInterval(() => refresh().catch(() => null), 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [connection, owner]);

  const initializeAccount = async () => {
    if (!owner) return;
    setBusyAction("initialize");
    setMsg("Initializing account...");
    try {
      const sig = await sendCreateOpenOrders(
        owner,
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
        marketIndex,
      );
      setHasOpenOrders(true);
      setMsg(sig ? `Initialized ${sig.slice(0, 8)}...` : "Account already initialized");
      if (sig) notifyTxSuccess("Account initialized", sig);
      else notifyInfo("Account initialized", "Open orders account already exists");
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Initialize failed:\n${err}`);
      notifyError("Initialize account failed", err);
    } finally {
      setBusyAction(null);
    }
  };

  const priceLotsParsed = cfg ? (parsePriceInput(price || "0", cfg) ?? 0n) : 0n;

  const conflicts =
    orderType === PlaceOrderType.Market
      ? myOrders.filter(
          (o) => (side === 0 && o.side === 1) || (side === 1 && o.side === 0),
        )
      : priceLotsParsed > 0n
        ? crossesOwn(myOrders, side, priceLotsParsed)
        : [];

  const orderSizeLotsPreview = cfg ? (parseSizeInput(size || "0", cfg) ?? 0n) : 0n;

  const orderPriceLotsPreview = (() => {
    if (orderType !== PlaceOrderType.Market) return priceLotsParsed;
    if (!cfg || selectedPrice === null) return 0n;
    return parsePriceInput(priceInputFromNumber(selectedPrice), cfg) ?? 0n;
  })();

  const estimatedNetPosition =
    orderSizeLotsPreview > 0n && orderPriceLotsPreview > 0n
      ? simulateNetPosition(netPosition, {
          side: netSideFromOrderSide(side),
          sizeLots: orderSizeLotsPreview,
          priceLots: orderPriceLotsPreview,
        })
      : null;
  const oppositeSideNet =
    !!netPosition && netPosition.side !== netSideFromOrderSide(side);

  const cancelConflicts = async () => {
    if (!owner || conflicts.length === 0) return;
    setBusyAction("cancel-conflicts");
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
      setBusyAction(null);
    }
  };

  const submit = async () => {
    if (!owner) return;
    if (hasOpenOrders !== true) {
      const msg = "Initialize account first";
      setMsg(msg);
      notifyWarning("Order blocked", msg);
      return;
    }
    if (!cfg) {
      const msg = "Market config still loading";
      setMsg(msg);
      notifyWarning("Order blocked", msg);
      return;
    }
    const isMarket = orderType === PlaceOrderType.Market;
    const parsedPriceLots = parsePriceInput(price || "0", cfg);
    const parsedBaseLots = parseSizeInput(size || "0", cfg);
    const parsedTpLots = tpslOpen ? parsePriceInput(takeProfitPrice || "0", cfg) : 0n;
    const parsedSlLots = tpslOpen ? parsePriceInput(stopLossPrice || "0", cfg) : 0n;
    const priceLots = isMarket ? 1n : (parsedPriceLots ?? 0n);
    const maxBaseLots = parsedBaseLots ?? 0n;
    const tpLots = parsedTpLots ?? 0n;
    const slLots = parsedSlLots ?? 0n;
    if (maxBaseLots <= 0n) {
      setMsg("Enter a valid size");
      notifyWarning("Order blocked", "Enter a valid size");
      return;
    }
    if (!isMarket && (parsedPriceLots === null || priceLots <= 0n)) {
      setMsg("Enter a valid price");
      notifyWarning("Order blocked", "Enter a valid price");
      return;
    }
    if (
      tpslOpen &&
      ((takeProfitPrice.trim() && parsedTpLots === null) ||
        (stopLossPrice.trim() && parsedSlLots === null))
    ) {
      setMsg("Enter valid TP/SL prices");
      notifyWarning("Order blocked", "Enter valid TP/SL prices");
      return;
    }
    if (tpslOpen && tpLots <= 0n && slLots <= 0n) {
      setMsg("Enter TP or SL trigger price");
      notifyWarning("Order blocked", "Enter TP or SL trigger price");
      return;
    }
    const triggerReferencePrice = isMarket
      ? selectedPrice !== null
        ? (parsePriceInput(priceInputFromNumber(selectedPrice), cfg) ?? 0n)
        : 0n
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
    setBusyAction("place");
    setMsg("Placing…");
    try {
      const [userPda] = findUserAccountPda(owner);
      const user = await fetchUser(connection, userPda);
      if (!user || user.collateral <= 0n) {
        const msg = DEPOSIT_COLLATERAL_MESSAGE;
        setMsg(msg);
        notifyWarning("Order blocked", msg);
        return;
      }

      const freeNative = user.collateral - user.marginUsed;
      const maxQuoteLots = isMarket
        ? freeNative > 0n
          ? (freeNative * BigInt(leverage)) / cfg.quoteLotSize
          : 0n
        : priceLots * maxBaseLots;

      if (maxQuoteLots <= 0n) {
        setMsg("No free collateral");
        notifyWarning("Order blocked", "No free collateral");
        return;
      }

      const requiredMarginNative =
        (quoteLotsToNative(maxQuoteLots, cfg) + BigInt(leverage - 1)) / BigInt(leverage);
      if (requiredMarginNative > freeNative) {
        const shortfall = requiredMarginNative - freeNative;
        const msg = `Insufficient collateral: need about $${formatUsdcNative(shortfall)} more`;
        setMsg(msg);
        notifyWarning("Order blocked", msg);
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
      const placeSig = await sendPlaceOrder(
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
      const triggerCount = attachedTriggers.length;
      setMsg(
        `Placed ${placeSig.slice(0, 8)}…  triggers=${triggerCount}  ` +
          "matched fills settle by keeper",
      );
      notifyTxSuccess(
        "Order placed",
        placeSig,
        `triggers=${triggerCount} matched fills settle by keeper`,
      );
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Failed:\n${err}`);
      notifyError("Order failed", err);
    } finally {
      setBusyAction(null);
    }
  };

  if (!mounted) return <div className="p-3 animate-pulse bg-kx-surface-lo rounded-xl h-full" />;

  const needsOpenOrdersInit = !!owner && hasOpenOrders === false;
  const needsCollateral =
    !!owner && hasOpenOrders === true && collateral === 0n;
  const gatedClass = needsOpenOrdersInit
    ? "pointer-events-none select-none blur-[2px] opacity-35"
    : "";

  return (
    <div className="p-3 space-y-3">
      {needsOpenOrdersInit && (
        <button
          type="button"
          disabled={busy}
          onClick={initializeAccount}
          className="w-full py-3 text-sm font-headline font-bold uppercase tracking-wider rounded-lg bg-[#4dffb4] text-on-primary-fixed shadow-lg shadow-[#4dffb4]/20 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
        >
          {busyAction === "initialize" ? "Initializing..." : "Please Initialize Account"}
        </button>
      )}

      <div className={`space-y-3 ${gatedClass}`} aria-hidden={needsOpenOrdersInit}>
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
          label="Price"
          value={price}
          onChange={setPrice}
          onFocus={() => setLastFocusedInputId("order-price")}
          disabled={orderType === PlaceOrderType.Market}
        />
        <Field 
          id="order-size"
          label="Size"
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
              label="TP"
              value={takeProfitPrice}
              onChange={setTakeProfitPrice}
              onFocus={() => setLastFocusedInputId("order-tp")}
            />
            <Field
              id="order-sl"
              label="SL"
              value={stopLossPrice}
              onChange={setStopLossPrice}
              onFocus={() => setLastFocusedInputId("order-sl")}
            />
          </div>
        )}
      </div>

      {cfg && (() => {
        const lotCfg: LotConfig = cfg;
        const sz = parseSizeInput(size || "0", lotCfg) ?? 0n;
        const pr = parsePriceInput(price || "0", lotCfg) ?? 0n;
        if (sz <= 0n || pr <= 0n) return null;
        const notional = notionalNative(sz, pr, lotCfg);
        const margin = (notional + BigInt(leverage - 1)) / BigInt(leverage);
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
                <div className="text-on-surface font-bold">${formatUsdcNative(notional)}</div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-wider opacity-60 mb-0.5">
                  Margin
                </div>
                <div className="text-on-surface font-bold">${formatUsdcNative(margin)}</div>
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
                {c.side === 0 ? "BID" : "ASK"} @{" "}
                {cfg ? formatPriceLots(c.priceLots, cfg) : String(c.priceLots)}
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

      {estimatedNetPosition && (
        <div
          className={`p-2.5 rounded-lg border text-[10px] font-mono ${
            oppositeSideNet
              ? "border-[#ffb86b]/40 bg-[#ffb86b]/10 text-[#ffb86b]"
              : "kx-border bg-kx-surface-lo text-on-surface-variant"
          }`}
        >
          {oppositeSideNet && (
            <div className="mb-1 font-bold">
              This will reduce or flip your current position
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="uppercase opacity-70">Estimated position after fill</span>
            <span className="text-on-surface font-bold">
              {formatNetPositionPreview(estimatedNetPosition, cfg)}
            </span>
          </div>
          {netPosition && (
            <div className="mt-1 opacity-80">
              Current: {netPosition.side.toUpperCase()}{" "}
              {cfg ? formatSizeLots(netPosition.sizeLots, cfg) : netPosition.sizeLots} @{" "}
              {cfg ? formatPriceLots(netPosition.entryPriceLots, cfg) : netPosition.entryPriceLots}
            </div>
          )}
          <div className="mt-1 opacity-70">
            Actual result may differ due to partial fills or slippage
          </div>
        </div>
      )}

      {needsCollateral && (
        <div className="rounded-lg border border-[#ffb86b]/40 bg-[#ffb86b]/10 px-3 py-2.5 text-[11px] font-mono text-[#ffb86b]">
          {DEPOSIT_COLLATERAL_MESSAGE}
        </div>
      )}

      <button
        disabled={busy || !owner || hasOpenOrders !== true || needsCollateral}
        onClick={submit}
        className={`w-full py-3 text-sm font-headline font-bold uppercase tracking-wider rounded-lg transition-all disabled:opacity-50 hover:brightness-110 active:scale-[0.99] shadow-lg ${
          side === Side.Bid
            ? "bg-[#4dffb4] text-on-primary-fixed shadow-[#4dffb4]/20"
            : "bg-[#ff6b6b] text-white shadow-[#ff6b6b]/20"
        }`}
      >
        {busyAction === "place" ? "Placing…" : owner ? `Place ${side === Side.Bid ? "Buy" : "Sell"} Order` : "Connect Wallet"}
      </button>
      </div>

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
        inputMode="decimal"
        className="w-full bg-kx-surface-lo border kx-border rounded-md px-3 py-2 text-sm font-mono text-on-surface focus:outline-none focus:border-[#4dffb4]/50 focus:bg-kx-surface-lo/80 disabled:opacity-40 transition-colors"
      />
    </div>
  );
}
