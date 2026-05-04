import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const FAUCET_LAMPORTS = LAMPORTS_PER_SOL / 100;

function loadMintAuthority(): Keypair {
  const raw = process.env.MINT_AUTHORITY;
  if (!raw) throw new Error("MINT_AUTHORITY missing");

  const parsed = JSON.parse(raw) as number[];
  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new Error("MINT_AUTHORITY must be a 64-byte JSON array");
  }

  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { wallet?: string };
    if (!body.wallet) {
      return NextResponse.json({ error: "wallet missing" }, { status: 400 });
    }

    const recipient = new PublicKey(body.wallet);
    const authority = loadMintAuthority();
    const conn = new Connection(
      process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com",
      "confirmed",
    );

    const balance = await conn.getBalance(authority.publicKey, "confirmed");
    if (balance < FAUCET_LAMPORTS + 5_000) {
      throw new Error("MINT_AUTHORITY has insufficient SOL balance");
    }

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: recipient,
        lamports: FAUCET_LAMPORTS,
      }),
    );

    const sig = await sendAndConfirmTransaction(conn, tx, [authority], {
      commitment: "confirmed",
      skipPreflight: false,
    });

    return NextResponse.json({
      signature: sig,
      amount: "0.01",
      recipient: recipient.toBase58(),
    });
  } catch (e) {
    console.error("[faucet-sol]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
