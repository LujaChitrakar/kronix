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
    <div className="p-3 space-y-3">
      <SectionLabel>Trigger Type</SectionLabel>
      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-kx-surface-lo border kx-border">
        {TRIGGER_TYPES.map(([label, val]) => (
          <button
            key={val}
            onClick={() => setTriggerType(val)}
            className={`py-2 text-xs font-headline font-bold rounded-md transition-all ${
              triggerType === val
                ? val === TriggerType.StopLoss
                  ? "bg-[#ffb86b] text-[#101417] shadow-md shadow-[#ffb86b]/20"
                  : "bg-[#4dffb4] text-on-primary-fixed shadow-md shadow-[#4dffb4]/20"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <SectionLabel>Direction</SectionLabel>
      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-kx-surface-lo border kx-border">
        <button
          onClick={() => setSide(Side.Bid)}
          className={`py-2 text-[11px] font-headline font-bold rounded-md transition-all ${
            side === Side.Bid
              ? "bg-[#4dffb4]/20 text-[#4dffb4]"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          BUY when triggered
        </button>
        <button
          onClick={() => setSide(Side.Ask)}
          className={`py-2 text-[11px] font-headline font-bold rounded-md transition-all ${
            side === Side.Ask
              ? "bg-[#ff6b6b]/20 text-[#ff6b6b]"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          SELL when triggered
        </button>
      </div>

      <div className="space-y-2">
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
      </div>

      <div className="px-3 py-2 rounded-lg bg-kx-surface-lo border kx-border text-[10px] font-mono text-on-surface-variant leading-relaxed">
        <span className={triggerType === TriggerType.StopLoss ? "text-[#ffb86b]" : "text-[#4dffb4]"}>
          {triggerType === TriggerType.StopLoss ? "■ Stop Loss" : "■ Take Profit"}
        </span>{" "}
        — keeper executes when mark crosses trigger
        {triggerType === TriggerType.StopLoss ? " against you." : " in your favor."}
      </div>

      <button
        disabled={busy || !owner}
        onClick={submit}
        className={`w-full py-3 text-sm font-headline font-bold uppercase tracking-wider rounded-lg shadow-lg transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50 ${
          triggerType === TriggerType.StopLoss
            ? "bg-[#ffb86b] text-[#101417] shadow-[#ffb86b]/20"
            : "bg-[#4dffb4] text-on-primary-fixed shadow-[#4dffb4]/20"
        }`}
      >
        {busy ? "Placing…" : owner ? "Place Trigger" : "Connect Wallet"}
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
