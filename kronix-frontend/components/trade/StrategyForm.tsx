"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { sendCreateStrategy } from "@/lib/kronix/client";
import { Side, StrategyType } from "@/lib/kronix/config";
import { emptyStrategyParamsArgs } from "@/lib/strategy-sdk";
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

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const submit = async () => {
    if (!owner) return;
    const sz = BigInt(parseInt(sizeLots || "0", 10));
    if (sz <= 0n) {
      setMsg("Size must be > 0");
      return;
    }
    setBusy(true);
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
          limitPriceLots: BigInt(parseInt(limitPriceLots || "0", 10)),
          takeProfitPrice: BigInt(parseInt(takeProfit || "0", 10)),
          stopLossPrice: BigInt(parseInt(stopLoss || "0", 10)),
          cooldownSecs: BigInt(parseInt(cooldownSecs || "0", 10)),
          maxExecutionsPerDay: BigInt(parseInt(maxPerDay || "0", 10)),
          params,
        },
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
      );
      setMsg(`Strategy created → ${sig.slice(0, 8)}…`);
    } catch (e) {
      setMsg(`Failed:\n${formatTxError(e)}`);
    } finally {
      setBusy(false);
    }
  };

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
        <Field label="Size (base lots)" value={sizeLots} onChange={setSizeLots} />
        <Field
          label="Limit Price (lots, 0 = market)"
          value={limitPriceLots}
          onChange={setLimitPriceLots}
        />
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Take Profit"
            value={takeProfit}
            onChange={setTakeProfit}
          />
          <Field
            label="Stop Loss"
            value={stopLoss}
            onChange={setStopLoss}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Cooldown (s)"
            value={cooldownSecs}
            onChange={setCooldownSecs}
          />
          <Field label="Max / Day" value={maxPerDay} onChange={setMaxPerDay} />
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
            label="Lower (lots)"
            value={dca.lowerPrice}
            onChange={(v) => setDca({ ...dca, lowerPrice: v })}
          />
          <Field
            label="Upper (lots)"
            value={dca.upperPrice}
            onChange={(v) => setDca({ ...dca, upperPrice: v })}
          />
          <Field
            label="Grid Count"
            value={dca.gridCount}
            onChange={(v) => setDca({ ...dca, gridCount: v })}
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

      <button
        disabled={busy || !owner}
        onClick={submit}
        className="w-full py-3 text-sm font-headline font-bold uppercase tracking-wider rounded-lg bg-[#4dffb4] text-on-primary-fixed shadow-lg shadow-[#4dffb4]/20 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? "Creating…" : owner ? "Create Strategy" : "Connect Wallet"}
      </button>

      {msg && (
        <pre className="text-[10px] font-mono text-on-surface-variant break-all whitespace-pre-wrap max-h-48 overflow-auto bg-kx-surface-lo p-2 rounded-md border kx-border">
          {msg}
        </pre>
      )}
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
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mb-2">
      <div className="text-[9px] text-on-surface-variant/60 uppercase tracking-wider mb-1">
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        className="w-full bg-kx-surface-lo border kx-border rounded-md px-3 py-2 text-sm font-mono text-on-surface focus:outline-none focus:border-[#4dffb4]/50 transition-colors"
      />
    </div>
  );
}
