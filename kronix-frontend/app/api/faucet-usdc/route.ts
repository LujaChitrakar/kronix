import { NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";

const FAUCET_UI_AMOUNT = 1_000n;

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
    const mint = new PublicKey(
      process.env.NEXT_PUBLIC_USDC_MINT ??
        "4VwXppbTdzQvzt7SsMYUpXdrZcytrQeixJFXUcgsEetF",
    );
    const authority = loadMintAuthority();
    const conn = new Connection(
      process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com",
      "confirmed",
    );

    const mintState = await getMint(conn, mint, "confirmed", TOKEN_PROGRAM_ID);
    const amount = FAUCET_UI_AMOUNT * 10n ** BigInt(mintState.decimals);
    const sourceAta = getAssociatedTokenAddressSync(mint, authority.publicKey);
    const recipientAta = getAssociatedTokenAddressSync(mint, recipient);
    const tx = new Transaction();

    let sourceTokenAccount = sourceAta;
    let sourceAmount = 0n;
    const sourceAtaInfo = await conn.getAccountInfo(sourceAta, "confirmed");
    if (sourceAtaInfo) {
      const sourceBalance = await conn.getTokenAccountBalance(
        sourceAta,
        "confirmed",
      );
      sourceAmount = BigInt(sourceBalance.value.amount);
    }

    if (sourceAmount < amount) {
      const ownedAccounts = await conn.getParsedTokenAccountsByOwner(
        authority.publicKey,
        { mint },
        "confirmed",
      );
      const fundedAccount = ownedAccounts.value.find((account) => {
        const tokenAmount = account.account.data.parsed.info.tokenAmount
          .amount as string;
        return BigInt(tokenAmount) >= amount;
      });
      if (!fundedAccount) {
        throw new Error(
          "MINT_AUTHORITY has no USDC token account with enough balance",
        );
      }
      sourceTokenAccount = fundedAccount.pubkey;
    }

    const recipientAtaInfo = await conn.getAccountInfo(
      recipientAta,
      "confirmed",
    );
    if (!recipientAtaInfo) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          authority.publicKey,
          recipientAta,
          recipient,
          mint,
        ),
      );
    }

    tx.add(
      createTransferCheckedInstruction(
        sourceTokenAccount,
        mint,
        recipientAta,
        authority.publicKey,
        amount,
        mintState.decimals,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );

    const sig = await sendAndConfirmTransaction(conn, tx, [authority], {
      commitment: "confirmed",
      skipPreflight: false,
    });

    return NextResponse.json({
      signature: sig,
      amount: "1000",
      mint: mint.toBase58(),
      sourceTokenAccount: sourceTokenAccount.toBase58(),
      tokenAccount: recipientAta.toBase58(),
    });
  } catch (e) {
    console.error("[faucet-usdc]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
