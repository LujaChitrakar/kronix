import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { Address, ReadonlyUint8Array } from "@solana/kit";

type KitAccount = {
  address: Address | string;
  role: number;
};

type KitInstruction = {
  programAddress: Address | string;
  accounts: readonly KitAccount[];
  data: ReadonlyUint8Array | Uint8Array;
};

// kit AccountRole: READONLY=0, WRITABLE=1, READONLY_SIGNER=2, WRITABLE_SIGNER=3
export function toLegacyIx(ix: KitInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress as string),
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(a.address as string),
      isSigner: (a.role & 2) !== 0,
      isWritable: (a.role & 1) !== 0,
    })),
    data: Buffer.from(ix.data as Uint8Array),
  });
}

export function fakeSigner<T extends string = string>(pubkey: PublicKey) {
  // The kit instruction encoders only read `.address` from the signer field.
  // Real signing happens later via wallet-adapter's sendTransaction.
  return { address: pubkey.toBase58() as Address<T> } as never;
}
