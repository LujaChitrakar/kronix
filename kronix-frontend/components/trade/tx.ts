import {
  Connection,
  SendTransactionError,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { annotateOrderbookError } from "@/lib/kronix/errors";

export class TxError extends Error {
  constructor(
    message: string,
    public stage: "build" | "simulate" | "send" | "confirm",
    public logs?: string[],
    public cause?: unknown,
  ) {
    super(message);
    this.name = "TxError";
  }
}

function extractLogs(err: unknown): string[] | undefined {
  const e = err as { logs?: string[] };
  if (Array.isArray(e?.logs) && e.logs.length) return e.logs;
  return undefined;
}

function extractMessage(err: unknown): string {
  if (!err) return "unknown error";
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function formatTxError(err: unknown): string {
  if (err instanceof TxError) {
    const lines: string[] = [
      `[${err.stage}] ${annotateOrderbookError(err.message)}`,
    ];
    if (err.logs?.length) {
      lines.push("--- program logs ---");
      lines.push(...err.logs.slice(-12).map(annotateOrderbookError));
    }
    return lines.join("\n");
  }
  return annotateOrderbookError(extractMessage(err));
}

function summarizeLogs(logs: string[]): string {
  // Return the first program error / panic line, fallback to last 3 lines.
  const interesting = logs.find(
    (l) =>
      /Program log: Error|failed:|InsufficientFunds|InvalidArgument|0x[0-9a-f]+/i.test(
        l,
      ) || /Program .* failed/.test(l),
  );
  if (interesting) return interesting;
  return logs.slice(-3).join(" | ");
}

export async function sendTx(
  wallet: WalletContextState,
  conn: Connection,
  ixs: TransactionInstruction[],
): Promise<string> {
  if (!wallet.publicKey || !wallet.sendTransaction) {
    throw new TxError("wallet not connected", "build");
  }

  let tx: Transaction;
  let blockhash: string;
  let lastValidBlockHeight: number;
  try {
    const latest = await conn.getLatestBlockhash("confirmed");
    blockhash = latest.blockhash;
    lastValidBlockHeight = latest.lastValidBlockHeight;
    tx = new Transaction().add(...ixs);
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = blockhash;
  } catch (e) {
    throw new TxError(`build failed: ${extractMessage(e)}`, "build", undefined, e);
  }

  // Pre-flight simulate to surface program errors before wallet popup.
  try {
    const sim = await conn.simulateTransaction(tx);
    if (sim.value.err) {
      const logs = sim.value.logs ?? undefined;
      throw new TxError(
        `simulation failed: ${JSON.stringify(sim.value.err)}` +
          (logs ? ` — ${summarizeLogs(logs)}` : ""),
        "simulate",
        logs,
        sim.value.err,
      );
    }
  } catch (e) {
    if (e instanceof TxError) throw e;
    // simulate RPC errors: don't block — fall through to send
    console.warn("simulate RPC error", e);
  }

  let sig: string;
  try {
    sig = await wallet.sendTransaction(tx, conn);
  } catch (e) {
    let logs = extractLogs(e);
    if (!logs && e instanceof SendTransactionError) {
      try {
        // SendTransactionError exposes logs via getLogs(connection)
        logs = await e.getLogs(conn);
      } catch {
        // ignore
      }
    }
    const base = extractMessage(e);
    const detail = logs ? ` — ${summarizeLogs(logs)}` : "";
    throw new TxError(`send failed: ${base}${detail}`, "send", logs, e);
  }

  try {
    const conf = await conn.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (conf.value.err) {
      // Pull on-chain logs via getTransaction for the failure context.
      const tr = await conn.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      const logs = tr?.meta?.logMessages ?? undefined;
      throw new TxError(
        `tx ${sig.slice(0, 8)} on-chain error: ${JSON.stringify(conf.value.err)}` +
          (logs ? ` — ${summarizeLogs(logs)}` : ""),
        "confirm",
        logs,
        conf.value.err,
      );
    }
  } catch (e) {
    if (e instanceof TxError) throw e;
    throw new TxError(
      `confirm failed: ${extractMessage(e)}`,
      "confirm",
      undefined,
      e,
    );
  }

  return sig;
}
