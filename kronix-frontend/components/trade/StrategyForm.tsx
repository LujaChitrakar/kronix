"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { sendCreateStrategy } from "@/lib/kronix/client";
import { Side, StrategyType, MARKET_NAME } from "@/lib/kronix/config";
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
    <div className="px-1">
      <div className="grid grid-cols-5 gap-1 mb-3">
        {STRATEGY_TYPES.map(([label, val]) => (
          <button
            key={val}
            onClick={() => setStrategyType(val)}
            className={`py-1.5 text-[10px] font-headline font-bold rounded border transition ${
              strategyType === val
                ? "border-[#4dffb4]/40 text-[#4dffb4] bg-[#4dffb4]/10"
                : "border-white/5 text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1 mb-3 p-1 rounded-md bg-kx-surface-lo border kx-border">
        <button
          onClick={() => setSide(Side.Bid)}
          className={`py-2 text-xs font-headline font-bold rounded transition ${
            side === Side.Bid
              ? "kx-buy-pill"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          BUY
        </button>
        <button
          onClick={() => setSide(Side.Ask)}
          className={`py-2 text-xs font-headline font-bold rounded transition ${
            side === Side.Ask
              ? "kx-sell-pill"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          SELL
        </button>
      </div>

      <Field label="Size (base lots)" value={sizeLots} onChange={setSizeLots} />
      <Field
        label="Limit Price (lots, 0 = market)"
        value={limitPriceLots}
        onChange={setLimitPriceLots}
      />

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Take Profit (0 = none)"
          value={takeProfit}
          onChange={setTakeProfit}
        />
        <Field
          label="Stop Loss (0 = none)"
          value={stopLoss}
          onChange={setStopLoss}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field
          label="Cooldown (sec)"
          value={cooldownSecs}
          onChange={setCooldownSecs}
        />
        <Field label="Max / day" value={maxPerDay} onChange={setMaxPerDay} />
      </div>

      <div className="mt-1 mb-2 px-2 py-1.5 rounded-md bg-kx-surface-lo border kx-border text-[10px] font-mono text-on-surface-variant">
        {STRATEGY_TYPES.find(([, v]) => v === strategyType)?.[0]} params
      </div>

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
        className="mt-3 w-full py-3 text-sm font-headline font-bold rounded-md bg-[#4dffb4] text-[#002113] hover:bg-[#3ce5a0] transition disabled:opacity-50"
      >
        {busy ? "Creating…" : owner ? "Create Strategy" : "Connect Wallet"}
      </button>

      {msg && (
        <pre className="mt-3 text-[10px] font-mono text-on-surface-variant break-all whitespace-pre-wrap max-h-40 overflow-auto kx-scroll bg-kx-surface-lo p-2 rounded-md border kx-border">
          {msg}
        </pre>
      )}
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
      <div className="text-[10px] text-on-surface-variant/70 uppercase tracking-wider mb-1">
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        className="kx-input"
      />
    </div>
  );
}
