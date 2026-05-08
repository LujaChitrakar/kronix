"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { sendCreateOpenOrders, sendCreateStrategy } from "@/lib/kronix/client";
import { Side, StrategyType } from "@/lib/kronix/config";
import {
  findMarketPda,
  findOpenOrdersPda,
  findUserAccountPda,
} from "@/lib/kronix/pdas";
import { fetchUser } from "@/lib/kronix/state";
import { emptyStrategyParamsArgs } from "@/lib/strategy-sdk";
import { useStore } from "@/lib/store";
import {
  notifyError,
  notifyInfo,
  notifyTxSuccess,
  notifyWarning,
} from "@/lib/notifications";
import { sendTx, formatTxError } from "./tx";

const STRATEGY_TYPES: [string, number][] = [
  ["RSI", StrategyType.RSI],
  ["EMA", StrategyType.EMA],
  ["DCA", StrategyType.RangeDCA],
  ["S/R", StrategyType.SR],
  ["Smart $", StrategyType.SmartMoney],
];

type RsiCfg = { rsiPeriod: string; rsiOversold: string; rsiOverbought: string };
type EmaCfg = { emaFast: string; emaSlow: string };
type DcaCfg = { lowerPrice: string; upperPrice: string; gridCount: string };
type SrCfg = { toleranceBps: string; levelCount: string };
type SmartCfg = { structureLookback: string; orderBlockSensitivity: string };

export function StrategyForm() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;

  const [strategyType, setStrategyType] = useState<number>(StrategyType.RSI);
  const [side, setSide] = useState<number>(Side.Bid);
  const [sizeLots, setSizeLots] = useState("");
  const [limitPriceLots, setLimitPriceLots] = useState("0");
  const [leverage, setLeverage] = useState(1);
  const [takeProfit, setTakeProfit] = useState("0");
  const [stopLoss, setStopLoss] = useState("0");
  const [cooldownSecs, setCooldownSecs] = useState("60");
  const [maxPerDay, setMaxPerDay] = useState("10");

  const [rsi, setRsi] = useState<RsiCfg>({
    rsiPeriod: "14",
    rsiOversold: "30",
    rsiOverbought: "70",
  });
  const [ema, setEma] = useState<EmaCfg>({ emaFast: "12", emaSlow: "26" });
  const [dca, setDca] = useState<DcaCfg>({
    lowerPrice: "",
    upperPrice: "",
    gridCount: "5",
  });
  const [sr, setSr] = useState<SrCfg>({ toleranceBps: "50", levelCount: "0" });
  const [smart, setSmart] = useState<SmartCfg>({
    structureLookback: "20",
    orderBlockSensitivity: "0",
  });

  const [busyAction, setBusyAction] = useState<"initialize" | "create" | null>(
    null,
  );
  const [msg, setMsg] = useState("");
  const [hasOpenOrders, setHasOpenOrders] = useState<boolean | null>(null);

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
      const p = Math.round(selectedPrice).toString();
      if (lastFocusedInputId === "strategy-limit") setLimitPriceLots(p);
      else if (lastFocusedInputId === "strategy-tp") setTakeProfit(p);
      else if (lastFocusedInputId === "strategy-sl") setStopLoss(p);
      else if (lastFocusedInputId === "strategy-lower") setDca({ ...dca, lowerPrice: p });
      else if (lastFocusedInputId === "strategy-upper") setDca({ ...dca, upperPrice: p });
    }
  }, [selectedPrice, lastFocusedInputId]);

  useEffect(() => {
    if (!owner) {
      setHasOpenOrders(null);
      return;
    }
    setHasOpenOrders(null);
    let alive = true;
    const refresh = async () => {
      const [market] = findMarketPda(marketIndex);
      const [oo] = findOpenOrdersPda(owner, market);
      const info = await connection.getAccountInfo(oo, "confirmed");
      if (alive) setHasOpenOrders(!!info);
    };
    refresh().catch(() => null);
    const t = setInterval(() => refresh().catch(() => null), 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [connection, owner, marketIndex]);

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

  const submit = async () => {
    if (!owner) return;
    if (hasOpenOrders !== true) {
      const msg = "Initialize account first";
      setMsg(msg);
      notifyWarning("Strategy blocked", msg);
      return;
    }
    const sz = BigInt(parseInt(sizeLots || "0", 10));
    if (sz <= 0n) {
      setMsg("Size must be > 0");
      notifyWarning("Strategy blocked", "Size must be > 0");
      return;
    }
    const limitLots = BigInt(parseInt(limitPriceLots || "0", 10));
    const tpLots = BigInt(parseInt(takeProfit || "0", 10));
    const slLots = BigInt(parseInt(stopLoss || "0", 10));
    const quotePriceLots =
      limitLots > 0n ? limitLots : [tpLots, slLots, 1n].reduce((a, b) => (a > b ? a : b));
    const requiredMargin =
      (sz * quotePriceLots * 1_000_000n + BigInt(leverage - 1)) / BigInt(leverage);
    const [userPda] = findUserAccountPda(owner);
    const user = await fetchUser(connection, userPda);
    const freeCollateral = user ? user.collateral - user.marginUsed : 0n;
    if (requiredMargin > freeCollateral) {
      const msg = "Insufficient free collateral";
      setMsg(msg);
      notifyWarning("Strategy blocked", msg);
      return;
    }
    setBusyAction("create");
    setMsg("Creating strategy…");
    try {
      const params = emptyStrategyParamsArgs();
      if (strategyType === StrategyType.RSI) {
        params.rsiPeriod = parseInt(rsi.rsiPeriod || "0", 10);
        params.rsiOversold = parseInt(rsi.rsiOversold || "0", 10);
        params.rsiOverbought = parseInt(rsi.rsiOverbought || "0", 10);
      } else if (strategyType === StrategyType.EMA) {
        params.emaFast = parseInt(ema.emaFast || "0", 10);
        params.emaSlow = parseInt(ema.emaSlow || "0", 10);
      } else if (strategyType === StrategyType.RangeDCA) {
        params.lowerPrice = BigInt(parseInt(dca.lowerPrice || "0", 10));
        params.upperPrice = BigInt(parseInt(dca.upperPrice || "0", 10));
        params.gridCount = parseInt(dca.gridCount || "0", 10);
      } else if (strategyType === StrategyType.SR) {
        params.toleranceBps = parseInt(sr.toleranceBps || "0", 10);
        params.levelCount = parseInt(sr.levelCount || "0", 10);
      } else if (strategyType === StrategyType.SmartMoney) {
        params.structureLookback = parseInt(smart.structureLookback || "0", 10);
        params.orderBlockSensitivity = parseInt(
          smart.orderBlockSensitivity || "0",
          10,
        );
      }

      const sig = await sendCreateStrategy(
        owner,
        {
          clientOrderId: BigInt(Date.now()),
          strategyType,
          side,
          sizeLots: sz,
          limitPriceLots: limitLots,
          leverage,
          takeProfitPrice: tpLots,
          stopLossPrice: slLots,
          cooldownSecs: BigInt(parseInt(cooldownSecs || "0", 10)),
          maxExecutionsPerDay: BigInt(parseInt(maxPerDay || "0", 10)),
          params,
          marketIndex,
        },
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
      );
      setMsg(`Strategy created → ${sig.slice(0, 8)}…`);
      notifyTxSuccess("Strategy created", sig);
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`Failed:\n${err}`);
      notifyError("Strategy failed", err);
    } finally {
      setBusyAction(null);
    }
  };

  if (!mounted) return <div className="p-3 animate-pulse bg-kx-surface-lo rounded-xl h-full" />;

  return (
    <div className="p-3 space-y-3">
      <SectionLabel>Strategy Type</SectionLabel>
      <div className="grid grid-cols-5 gap-1">
        {STRATEGY_TYPES.map(([label, val]) => (
          <button
            key={val}
            onClick={() => setStrategyType(val)}
            className={`py-1.5 text-[10px] font-headline font-bold rounded-md border transition-colors ${
              strategyType === val
                ? "bg-[#4dffb4]/15 text-[#4dffb4] border-[#4dffb4]/40"
                : "bg-kx-surface-lo text-on-surface-variant kx-border hover:text-on-surface"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-kx-surface-lo border kx-border">
        <button
          onClick={() => setSide(Side.Bid)}
          className={`py-2 text-xs font-headline font-bold rounded-md transition-all ${
            side === Side.Bid
              ? "bg-[#4dffb4] text-on-primary-fixed shadow-md shadow-[#4dffb4]/20"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          BUY
        </button>
        <button
          onClick={() => setSide(Side.Ask)}
          className={`py-2 text-xs font-headline font-bold rounded-md transition-all ${
            side === Side.Ask
              ? "bg-[#ff6b6b] text-white shadow-md shadow-[#ff6b6b]/20"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          SELL
        </button>
      </div>

      <SectionLabel>Order</SectionLabel>
      <div className="space-y-2">
        <Field 
          id="strategy-size"
          label="Size (base lots)" 
          value={sizeLots} 
          onChange={setSizeLots} 
          onFocus={() => setLastFocusedInputId("strategy-size")}
        />
        <Field
          id="strategy-limit"
          label="Limit Price (lots, 0 = market)"
          value={limitPriceLots}
          onChange={setLimitPriceLots}
          onFocus={() => setLastFocusedInputId("strategy-limit")}
        />
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
        <div className="grid grid-cols-2 gap-2">
          <Field
            id="strategy-tp"
            label="Take Profit"
            value={takeProfit}
            onChange={setTakeProfit}
            onFocus={() => setLastFocusedInputId("strategy-tp")}
          />
          <Field
            id="strategy-sl"
            label="Stop Loss"
            value={stopLoss}
            onChange={setStopLoss}
            onFocus={() => setLastFocusedInputId("strategy-sl")}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field
            id="strategy-cooldown"
            label="Cooldown (s)"
            value={cooldownSecs}
            onChange={setCooldownSecs}
            onFocus={() => setLastFocusedInputId("strategy-cooldown")}
          />
          <Field 
            id="strategy-maxday"
            label="Max / Day" 
            value={maxPerDay} 
            onChange={setMaxPerDay} 
            onFocus={() => setLastFocusedInputId("strategy-maxday")}
          />
        </div>
      </div>

      <SectionLabel>
        {STRATEGY_TYPES.find(([, v]) => v === strategyType)?.[0]} Params
      </SectionLabel>

      {strategyType === StrategyType.RSI && (
        <div className="grid grid-cols-3 gap-2">
          <Field
            label="Period"
            value={rsi.rsiPeriod}
            onChange={(v) => setRsi({ ...rsi, rsiPeriod: v })}
          />
          <Field
            label="Oversold"
            value={rsi.rsiOversold}
            onChange={(v) => setRsi({ ...rsi, rsiOversold: v })}
          />
          <Field
            label="Overbought"
            value={rsi.rsiOverbought}
            onChange={(v) => setRsi({ ...rsi, rsiOverbought: v })}
          />
        </div>
      )}

      {strategyType === StrategyType.EMA && (
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Fast"
            value={ema.emaFast}
            onChange={(v) => setEma({ ...ema, emaFast: v })}
          />
          <Field
            label="Slow"
            value={ema.emaSlow}
            onChange={(v) => setEma({ ...ema, emaSlow: v })}
          />
        </div>
      )}

      {strategyType === StrategyType.RangeDCA && (
        <div className="grid grid-cols-3 gap-2">
          <Field
            id="strategy-lower"
            label="Lower (lots)"
            value={dca.lowerPrice}
            onChange={(v) => setDca({ ...dca, lowerPrice: v })}
            onFocus={() => setLastFocusedInputId("strategy-lower")}
          />
          <Field
            id="strategy-upper"
            label="Upper (lots)"
            value={dca.upperPrice}
            onChange={(v) => setDca({ ...dca, upperPrice: v })}
            onFocus={() => setLastFocusedInputId("strategy-upper")}
          />
          <Field
            id="strategy-grid"
            label="Grid Count"
            value={dca.gridCount}
            onChange={(v) => setDca({ ...dca, gridCount: v })}
            onFocus={() => setLastFocusedInputId("strategy-grid")}
          />
        </div>
      )}

      {strategyType === StrategyType.SR && (
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Tolerance (bps)"
            value={sr.toleranceBps}
            onChange={(v) => setSr({ ...sr, toleranceBps: v })}
          />
          <Field
            label="Level Count"
            value={sr.levelCount}
            onChange={(v) => setSr({ ...sr, levelCount: v })}
          />
        </div>
      )}

      {strategyType === StrategyType.SmartMoney && (
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Lookback"
            value={smart.structureLookback}
            onChange={(v) => setSmart({ ...smart, structureLookback: v })}
          />
          <Field
            label="OB Sensitivity (bps)"
            value={smart.orderBlockSensitivity}
            onChange={(v) => setSmart({ ...smart, orderBlockSensitivity: v })}
          />
        </div>
      )}

      {owner && hasOpenOrders === false && (
        <button
          type="button"
          disabled={busy}
          onClick={initializeAccount}
          className="w-full py-3 text-sm font-headline font-bold uppercase tracking-wider rounded-lg bg-[#4dffb4]/10 border border-[#4dffb4]/30 text-[#4dffb4] transition-colors hover:bg-[#4dffb4]/20 disabled:opacity-50"
        >
          {busyAction === "initialize" ? "Initializing..." : "Initialize Account"}
        </button>
      )}

      <button
        disabled={busy || !owner || hasOpenOrders !== true}
        onClick={submit}
        className="w-full py-3 text-sm font-headline font-bold uppercase tracking-wider rounded-lg bg-[#4dffb4] text-on-primary-fixed shadow-lg shadow-[#4dffb4]/20 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
      >
        {busyAction === "create" ? "Creating…" : owner ? "Create Strategy" : "Connect Wallet"}
      </button>

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
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
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
        inputMode="numeric"
        className="w-full bg-kx-surface-lo border kx-border rounded-md px-3 py-2 text-sm font-mono text-on-surface focus:outline-none focus:border-[#4dffb4]/50 transition-colors"
      />
    </div>
  );
}
