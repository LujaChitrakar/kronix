"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  sendPlaceTriggerOrder,
} from "@/lib/kronix/client";
import {
  Side,
  TriggerType,
  MARKET_NAME,
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
    <div className="px-1">
      <div className="grid grid-cols-2 gap-1 mb-3 p-1 rounded-md bg-kx-surface-lo border kx-border">
        <button
          onClick={() => setSide(Side.Bid)}
          className={`py-2 text-[11px] font-headline font-bold rounded transition ${
            side === Side.Bid
              ? "kx-buy-pill"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          BUY ON TRIGGER
        </button>
        <button
          onClick={() => setSide(Side.Ask)}
          className={`py-2 text-[11px] font-headline font-bold rounded transition ${
            side === Side.Ask
              ? "kx-sell-pill"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          SELL ON TRIGGER
        </button>
      </div>

      <div className="grid grid-cols-2 gap-1 mb-3">
        {TRIGGER_TYPES.map(([label, val]) => (
          <button
            key={val}
            onClick={() => setTriggerType(val)}
            className={`py-1.5 text-[10px] font-mono uppercase tracking-wider rounded border transition ${
              triggerType === val
                ? "border-[#4dffb4]/40 text-[#4dffb4] bg-[#4dffb4]/10"
                : "border-white/5 text-on-surface-variant hover:text-on-surface"
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

      <div className="mb-3 px-2 py-1.5 rounded-md bg-kx-surface-lo border kx-border text-[10px] font-mono text-on-surface-variant/80 leading-relaxed">
        {triggerType === TriggerType.StopLoss
          ? "Stop Loss — keeper fires when mark crosses trigger against you."
          : "Take Profit — keeper fires when mark crosses trigger in your favor."}
      </div>

      <button
        disabled={busy || !owner}
        onClick={submit}
        className={`w-full py-3 text-sm font-headline font-bold rounded-md disabled:opacity-50 transition ${
          triggerType === TriggerType.StopLoss
            ? "bg-[#ffb86b] text-[#101417] hover:bg-[#f0a85a]"
            : "bg-[#4dffb4] text-[#002113] hover:bg-[#3ce5a0]"
        }`}
      >
        {busy ? "Placing…" : owner ? "Place Trigger" : "Connect Wallet"}
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
