"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  sendPlaceTriggerOrder,
} from "@/lib/kronix/client";
import {
  Side,
  TriggerType,
} from "@/lib/kronix/config";
import { sendTx, formatTxError } from "./tx";

const TRIGGER_TYPES: [string, number][] = [
  ["Stop Loss", TriggerType.StopLoss],
  ["Take Profit", TriggerType.TakeProfit],
];

export function TriggerForm() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;

  const [side, setSide] = useState<number>(Side.Bid);
  const [triggerType, setTriggerType] = useState<number>(TriggerType.StopLoss);
  const [triggerPrice, setTriggerPrice] = useState("");
  const [size, setSize] = useState("");
  const [expiry, setExpiry] = useState("0");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const submit = async () => {
    if (!owner) return;
    const triggerLots = BigInt(parseInt(triggerPrice || "0", 10));
    const sizeLots = BigInt(parseInt(size || "0", 10));
    if (triggerLots <= 0n || sizeLots <= 0n) {
      setMsg("Enter trigger price + size in lots");
      return;
    }
    setBusy(true);
    setMsg("Placing trigger…");
    try {
      const clientOrderId = BigInt(Date.now());
      const sig = await sendPlaceTriggerOrder(
        owner,
        {
          clientOrderId,
          triggerPrice: triggerLots,
          sizeLots,
          expiry: BigInt(parseInt(expiry || "0", 10)),
          triggerType,
          side,
        },
        connection,
        (ixs, c) => sendTx(wallet, c, ixs),
      );
      setMsg(`Trigger placed → ${sig.slice(0, 8)}…`);
    } catch (e) {
      setMsg(`Failed:\n${formatTxError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          onClick={() => setSide(Side.Bid)}
          className={`py-2 text-xs font-headline font-bold rounded-md border ${
            side === Side.Bid
              ? "bg-[#4dffb4]/20 text-[#4dffb4] border-[#4dffb4]/40"
              : "bg-kx-surface-lo text-on-surface-variant kx-border"
          }`}
        >
          BUY when triggered
        </button>
        <button
          onClick={() => setSide(Side.Ask)}
          className={`py-2 text-xs font-headline font-bold rounded-md border ${
            side === Side.Ask
              ? "bg-[#ff6b6b]/20 text-[#ff6b6b] border-[#ff6b6b]/40"
              : "bg-kx-surface-lo text-on-surface-variant kx-border"
          }`}
        >
          SELL when triggered
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1 mb-3">
        {TRIGGER_TYPES.map(([label, val]) => (
          <button
            key={val}
            onClick={() => setTriggerType(val)}
            className={`py-1.5 text-[11px] font-mono rounded-md border ${
              triggerType === val
                ? "bg-primary-container/30 text-[#4dffb4] border-[#4dffb4]/40"
                : "bg-kx-surface-lo text-on-surface-variant kx-border"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Field
        label="Trigger Price (lots)"
        value={triggerPrice}
        onChange={setTriggerPrice}
      />
      <Field label="Size (base lots)" value={size} onChange={setSize} />
      <Field
        label="Expiry (unix ts, 0 = never)"
        value={expiry}
        onChange={setExpiry}
      />

      <div className="mb-3 px-2 py-1.5 rounded-md bg-kx-surface-lo border kx-border text-[10px] font-mono text-on-surface-variant leading-relaxed">
        {triggerType === TriggerType.StopLoss
          ? "Stop Loss: keeper executes when mark crosses trigger against you."
          : "Take Profit: keeper executes when mark crosses trigger in your favor."}
        <br />
        Order routes through orderbook as a market take order at execution time.
      </div>

      <button
        disabled={busy || !owner}
        onClick={submit}
        className={`w-full py-2.5 text-sm font-headline font-bold rounded-md disabled:opacity-50 ${
          triggerType === TriggerType.StopLoss
            ? "bg-[#ffb86b] text-[#101417]"
            : "bg-primary-container text-on-primary-fixed"
        }`}
      >
        {busy ? "Placing…" : owner ? "Place Trigger" : "Connect Wallet"}
      </button>

      {msg && (
        <pre className="mt-3 text-[10px] font-mono text-on-surface-variant break-all whitespace-pre-wrap max-h-64 overflow-auto bg-kx-surface-lo p-2 rounded-md border kx-border">
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
      <div className="text-[10px] text-on-surface-variant/70 uppercase mb-1">
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="numeric"
        className="w-full bg-kx-surface-lo border kx-border rounded-md px-3 py-2 text-sm font-mono text-on-surface"
      />
    </div>
  );
}
