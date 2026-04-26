"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  sendInitInsuranceFund,
  sendInitVault,
  sendCreateRiskMarket,
  sendCreateOrderbookMarket,
} from "@/lib/kronix/client";
import {
  findInsuranceFundPda,
  findVaultPda,
  findVaultAuthorityPda,
  findMarketConfigPda,
  findFundingStatePda,
  findMarketPda,
  findBidsPda,
  findAsksPda,
} from "@/lib/kronix/pdas";
import {
  USDC_MINT,
  MARKET_INDEX,
  MARKET_NAME,
} from "@/lib/kronix/config";
import { sendTx, formatTxError } from "./tx";

type Status = Record<string, boolean | null>;

function shortPk(pk: PublicKey): string {
  const s = pk.toBase58();
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

export function AdminPanel() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const owner = wallet.publicKey;

  const [marketIdx, setMarketIdx] = useState(String(MARKET_INDEX));
  const [name, setName] = useState(MARKET_NAME);
  const [oracle, setOracle] = useState("");
  const [baseLot, setBaseLot] = useState("1000000"); // 0.001 SOL (lamports)
  const [quoteLot, setQuoteLot] = useState("100"); // $0.0001 (USDC base units)
  const [initialMarginBps, setInitialMarginBps] = useState("1000"); // 10%
  const [maintMarginBps, setMaintMarginBps] = useState("500"); // 5%
  const [liqFeeBps, setLiqFeeBps] = useState("100"); // 1%
  const [maxLeverage, setMaxLeverage] = useState("10");
  const [timeExpiry, setTimeExpiry] = useState("0");

  const [status, setStatus] = useState<Status>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    const idx = parseInt(marketIdx, 10) || 0;
    const [insurance] = findInsuranceFundPda();
    const [vault] = findVaultPda();
    const [marketCfg] = findMarketConfigPda(idx);
    const [fund] = findFundingStatePda(idx);
    const [market] = findMarketPda(idx);
    const [bids] = findBidsPda(idx);
    const [asks] = findAsksPda(idx);

    const [a, b, c, d, e, f, g] = await Promise.all([
      connection.getAccountInfo(insurance, "confirmed"),
      connection.getAccountInfo(vault, "confirmed"),
      connection.getAccountInfo(marketCfg, "confirmed"),
      connection.getAccountInfo(fund, "confirmed"),
      connection.getAccountInfo(market, "confirmed"),
      connection.getAccountInfo(bids, "confirmed"),
      connection.getAccountInfo(asks, "confirmed"),
    ]);
    setStatus({
      insurance: !!a,
      vault: !!b,
      market_config: !!c,
      funding: !!d,
      ob_market: !!e,
      bids: !!f,
      asks: !!g,
    });
  }, [connection, marketIdx]);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(label);
    setMsg("");
    try {
      const sig = await fn();
      setMsg(`${label} → ${sig.slice(0, 12)}…`);
      await refresh();
    } catch (e) {
      setMsg(`${label} failed:\n${formatTxError(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const idxNum = parseInt(marketIdx, 10) || 0;
  const oraclePk = (() => {
    try {
      return oracle ? new PublicKey(oracle) : null;
    } catch {
      return null;
    }
  })();

  return (
    <div className="bg-kx-surface rounded-xl border kx-border p-5">
      <div className="font-headline text-sm text-on-surface mb-4 uppercase tracking-wider">
        Admin Setup
      </div>

      <div className="mb-4 text-xs font-mono text-on-surface-variant break-all">
        <div>USDC mint: {USDC_MINT.toBase58()}</div>
        <div>Payer: {owner ? shortPk(owner) : "(connect wallet)"}</div>
      </div>

      {/* Step 1 */}
      <Step
        n={1}
        title="initialize_insurance_fund"
        ok={status.insurance ?? null}
      >
        <button
          disabled={!owner || !!busy}
          onClick={() =>
            run("InitInsuranceFund", () =>
              sendInitInsuranceFund(owner!, connection, (ixs, c) =>
                sendTx(wallet, c, ixs),
              ),
            )
          }
          className="bg-primary-container text-on-primary-fixed px-3 py-2 text-xs font-headline font-bold rounded-md disabled:opacity-50"
        >
          Run
        </button>
      </Step>

      {/* Step 2 */}
      <Step n={2} title="initialize_vault (USDC)" ok={status.vault ?? null}>
        <button
          disabled={!owner || !!busy}
          onClick={() =>
            run("InitVault", () =>
              sendInitVault(owner!, connection, (ixs, c) =>
                sendTx(wallet, c, ixs),
              ),
            )
          }
          className="bg-primary-container text-on-primary-fixed px-3 py-2 text-xs font-headline font-bold rounded-md disabled:opacity-50"
        >
          Run
        </button>
      </Step>

      {/* Market params */}
      <div className="mt-4 mb-2 text-[11px] uppercase tracking-wider text-on-surface-variant/70">
        Market Params
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <Field label="Market Index (u16)" v={marketIdx} setV={setMarketIdx} />
        <Field label="Name (≤16 chars)" v={name} setV={setName} />
        <Field label="Base Lot Size" v={baseLot} setV={setBaseLot} />
        <Field label="Quote Lot Size" v={quoteLot} setV={setQuoteLot} />
        <Field label="Initial Margin (bps)" v={initialMarginBps} setV={setInitialMarginBps} />
        <Field label="Maint Margin (bps)" v={maintMarginBps} setV={setMaintMarginBps} />
        <Field label="Liq Fee (bps)" v={liqFeeBps} setV={setLiqFeeBps} />
        <Field label="Max Leverage" v={maxLeverage} setV={setMaxLeverage} />
        <Field label="Time Expiry (0=none)" v={timeExpiry} setV={setTimeExpiry} />
      </div>
      <div className="mb-3">
        <div className="text-[10px] text-on-surface-variant/70 uppercase mb-1">
          Pyth Oracle (PriceUpdateV2 pubkey)
        </div>
        <input
          value={oracle}
          onChange={(e) => setOracle(e.target.value)}
          placeholder="paste base58 pubkey"
          className="w-full bg-kx-surface-lo border kx-border rounded-md px-3 py-2 text-xs font-mono text-on-surface"
        />
      </div>

      {/* Step 3 */}
      <Step
        n={3}
        title={`create_risk_market (idx=${idxNum})`}
        ok={status.market_config ?? null}
      >
        <button
          disabled={!owner || !!busy || !oraclePk}
          onClick={() =>
            run("CreateRiskMarket", () =>
              sendCreateRiskMarket(
                owner!,
                {
                  marketIndex: idxNum,
                  baseLotSize: BigInt(baseLot || "0"),
                  quoteLotSize: BigInt(quoteLot || "0"),
                  initialMarginBps: parseInt(initialMarginBps, 10) || 0,
                  maintenanceMarginBps: parseInt(maintMarginBps, 10) || 0,
                  liquidationFeeBps: parseInt(liqFeeBps, 10) || 0,
                  maxLeverage: parseInt(maxLeverage, 10) || 0,
                  oracle: oraclePk!,
                },
                connection,
                (ixs, c) => sendTx(wallet, c, ixs),
              ),
            )
          }
          className="bg-primary-container text-on-primary-fixed px-3 py-2 text-xs font-headline font-bold rounded-md disabled:opacity-50"
        >
          Run
        </button>
      </Step>

      {/* Step 4 */}
      <Step
        n={4}
        title={`create_orderbook_market (idx=${idxNum})`}
        ok={status.ob_market ?? null}
      >
        <button
          disabled={!owner || !!busy}
          onClick={() =>
            run("CreateOrderbookMarket", () =>
              sendCreateOrderbookMarket(
                owner!,
                {
                  marketIndex: idxNum,
                  baseLotSize: BigInt(baseLot || "0"),
                  quoteLotSize: BigInt(quoteLot || "0"),
                  timeExpiry: BigInt(timeExpiry || "0"),
                  name,
                },
                connection,
                (ixs, c) => sendTx(wallet, c, ixs),
              ),
            )
          }
          className="bg-primary-container text-on-primary-fixed px-3 py-2 text-xs font-headline font-bold rounded-md disabled:opacity-50"
        >
          Run
        </button>
      </Step>

      <div className="mt-4 text-[10px] font-mono text-on-surface-variant/70 leading-relaxed">
        Order matters: insurance → vault → risk market → orderbook market
        (same market_index for both). Risk market must exist before orderbook
        market for the same index.
      </div>

      {msg && (
        <pre className="mt-3 text-[10px] font-mono text-on-surface-variant break-all whitespace-pre-wrap max-h-64 overflow-auto bg-kx-surface-lo p-2 rounded-md border kx-border">
          {busy ? `${busy}…` : msg}
        </pre>
      )}
    </div>
  );
}

function Step({
  n,
  title,
  ok,
  children,
}: {
  n: number;
  title: string;
  ok: boolean | null;
  children: React.ReactNode;
}) {
  const badge =
    ok === null ? "—" : ok ? "INITIALIZED" : "MISSING";
  const color =
    ok === null
      ? "text-on-surface-variant"
      : ok
        ? "text-[#4dffb4]"
        : "text-[#ff6b6b]";
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-t kx-border">
      <div>
        <div className="text-[10px] text-on-surface-variant/70 uppercase">
          Step {n}
        </div>
        <div className="text-sm font-mono text-on-surface">{title}</div>
        <div className={`text-[10px] font-mono ${color}`}>{badge}</div>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  v,
  setV,
}: {
  label: string;
  v: string;
  setV: (s: string) => void;
}) {
  return (
    <div>
      <div className="text-[10px] text-on-surface-variant/70 uppercase mb-1">
        {label}
      </div>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        className="w-full bg-kx-surface-lo border kx-border rounded-md px-2 py-1.5 text-xs font-mono text-on-surface"
      />
    </div>
  );
}
