"use client";

import { useCallback, useEffect, useState } from "react";
import { Connection, PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  findUserAccountPda,
  findOpenOrdersPda,
  findMarketPda,
} from "@/lib/kronix/pdas";
import { fetchUser, fetchOpenOrders } from "@/lib/kronix/state";
import { USDC_MINT, USDC_DECIMALS } from "@/lib/kronix/config";
import {
  sendDeposit,
  sendWithdraw,
  sendCreateOpenOrders,
  sendSetDelegate,
} from "@/lib/kronix/client";
import { useStore } from "@/lib/store";
import { notifyError, notifyInfo, notifyTxSuccess } from "@/lib/notifications";
import { sendTx, formatTxError } from "./tx";

function fmtUsdc(n: bigint): string {
  const sign = n < 0n ? "-" : "";
  const abs = n < 0n ? -n : n;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${sign}${whole}.${frac}`;
}

export function AccountPanel() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;

  const [collateral, setCollateral] = useState<bigint | null>(null);
  const [marginUsed, setMarginUsed] = useState<bigint | null>(null);
  const [posCount, setPosCount] = useState<number | null>(null);
  const [walletUsdc, setWalletUsdc] = useState<bigint | null>(null);
  const [hasOO, setHasOO] = useState<boolean>(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [delegate, setDelegate] = useState("");
  const [msg, setMsg] = useState("");
  const marketIndex = useStore((s) => s.selectedMarketIndex);

  const refresh = useCallback(async () => {
    if (!owner) return;
    const [userPda] = findUserAccountPda(owner);
    const [market] = findMarketPda(marketIndex);
    const [oo] = findOpenOrdersPda(owner, market);
    const ata = getAssociatedTokenAddressSync(USDC_MINT, owner);

    const [u, ooInfo, ataInfo] = await Promise.all([
      fetchUser(connection, userPda),
      connection.getAccountInfo(oo, "confirmed"),
      connection.getParsedAccountInfo(ata, "confirmed"),
    ]);
    setCollateral(u?.collateral ?? null);
    setMarginUsed(u?.marginUsed ?? null);
    setPosCount(u?.positionCount ?? null);
    setHasOO(!!ooInfo);
    const parsed = ataInfo.value?.data as
      | { parsed?: { info?: { tokenAmount?: { amount?: string } } } }
      | undefined;
    const raw = parsed?.parsed?.info?.tokenAmount?.amount;
    setWalletUsdc(raw ? BigInt(raw) : 0n);
  }, [connection, owner, marketIndex]);

  useEffect(() => {
    refresh().catch(console.error);
    const t = setInterval(() => refresh().catch(() => null), 8000);
    return () => clearInterval(t);
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<string | null>) => {
    setBusy(label);
    setMsg("");
    try {
      const sig = await fn();
      setMsg(
        sig ? `${label} → ${sig.slice(0, 8)}…` : `${label}: nothing to do`,
      );
      if (sig) notifyTxSuccess(label, sig);
      else notifyInfo(label, "Nothing to do");
      await refresh();
    } catch (e) {
      const err = formatTxError(e);
      setMsg(`${label} failed:\n${err}`);
      notifyError(`${label} failed`, err);
    } finally {
      setBusy(null);
    }
  };

  if (!owner) {
    return (
      <div className="p-4 text-on-surface-variant text-sm">
        Connect wallet to view account.
      </div>
    );
  }

  const free =
    collateral !== null && marginUsed !== null ? collateral - marginUsed : null;

  const baseUnits = (() => {
    const f = parseFloat(amount);
    if (!isFinite(f) || f <= 0) return 0n;
    return BigInt(Math.floor(f * 10 ** USDC_DECIMALS));
  })();

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        <Stat
          label="Collateral"
          v={collateral !== null ? `$${fmtUsdc(collateral)}` : "—"}
        />
        <Stat
          label="Margin Used"
          v={marginUsed !== null ? `$${fmtUsdc(marginUsed)}` : "—"}
        />
        <Stat label="Free" v={free !== null ? `$${fmtUsdc(free)}` : "—"} />
        <Stat
          label="Positions"
          v={posCount !== null ? String(posCount) : "—"}
        />
        <Stat
          label="Wallet USDC"
          v={walletUsdc !== null ? `$${fmtUsdc(walletUsdc)}` : "—"}
        />
        <Stat label="Open Orders" v={hasOO ? "Initialized" : "Missing"} />
      </div>

      {!hasOO && (
        <button
          disabled={!!busy}
          onClick={() =>
            run("Init OO", () =>
              sendCreateOpenOrders(
                owner,
                connection,
                (ixs, c) => sendTx(wallet, c, ixs),
                marketIndex,
              ),
            )
          }
          className="w-full mb-3 px-3 py-2 text-xs font-headline font-bold uppercase tracking-wider rounded-md bg-[#4dffb4]/10 border border-[#4dffb4]/30 text-[#4dffb4] hover:bg-[#4dffb4]/20 transition-colors disabled:opacity-50"
        >
          Initialize Open Orders Account
        </button>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div className="space-y-2">
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="USDC amount"
            inputMode="decimal"
            className="w-full bg-kx-surface-lo border kx-border rounded-lg px-3 py-3 text-sm font-mono text-on-surface"
          />
          <div className="grid grid-cols-2 gap-1.5">
            <button
              disabled={!!busy || baseUnits === 0n}
              onClick={() =>
                run("Deposit", () =>
                  sendDeposit(owner, baseUnits, connection, (ixs, c) =>
                    sendTx(wallet, c, ixs),
                  ),
                )
              }
              className="py-2 text-[11px] font-headline font-bold uppercase tracking-wider rounded-md bg-[#4dffb4] text-on-primary-fixed shadow-md shadow-[#4dffb4]/20 hover:brightness-110 active:scale-[0.99] transition-all disabled:opacity-50"
            >
              Deposit
            </button>
            <button
              disabled={!!busy || baseUnits === 0n}
              onClick={() =>
                run("Withdraw", () =>
                  sendWithdraw(owner, baseUnits, connection, (ixs, c) =>
                    sendTx(wallet, c, ixs),
                  ),
                )
              }
              className="py-2 text-[11px] font-headline font-bold uppercase tracking-wider rounded-md bg-[#ff6b6b] text-white shadow-md shadow-[#ff6b6b]/20 hover:brightness-110 active:scale-[0.99] transition-all disabled:opacity-50"
            >
              Withdraw
            </button>
          </div>
        </div>
      </div>

      {/*{hasOO && (
        <div className="mt-4 pt-3 border-t kx-border">
          <div className="text-[10px] uppercase tracking-wider text-on-surface-variant/70 mb-2">
            Delegate (signs orders on behalf of OO)
          </div>
          <div className="flex gap-2">
            <input
              value={delegate}
              onChange={(e) => setDelegate(e.target.value)}
              placeholder="delegate base58 (empty = clear)"
              className="flex-1 bg-kx-surface-lo border kx-border rounded-md px-3 py-2 text-xs font-mono text-on-surface"
            />
            <button
              disabled={!!busy}
              onClick={() =>
                run("Set delegate", async () => {
                  let pk: PublicKey;
                  try {
                    pk = delegate.trim()
                      ? new PublicKey(delegate.trim())
                      : PublicKey.default;
                  } catch {
                    throw new Error("invalid pubkey");
                  }
                  return sendSetDelegate(
                    owner,
                    pk,
                    connection,
                    (ixs, c) => sendTx(wallet, c, ixs),
                    marketIndex,
                  );
                })
              }
              className="px-3 py-2 text-[11px] font-headline font-bold uppercase tracking-wider rounded-md bg-kx-surface-hi border kx-border text-on-surface-variant hover:text-on-surface hover:bg-kx-surface-hi/80 transition-colors disabled:opacity-50"
            >
              Set
            </button>
          </div>
          <div className="mt-1 text-[9px] text-on-surface-variant/60">
            Empty input + Set → clears delegate (zero pubkey).
          </div>
        </div>
      )}*/}

    </div>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-kx-surface-lo border kx-border">
      <div className="text-[9px] text-on-surface-variant/60 uppercase tracking-wider mb-0.5">
        {label}
      </div>
      <div className="text-on-surface font-bold text-sm font-mono">{v}</div>
    </div>
  );
}
