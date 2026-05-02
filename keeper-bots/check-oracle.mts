import * as sb from "@switchboard-xyz/on-demand";
import { PublicKey, Connection, Keypair } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import fs from "fs";

const conn = new Connection(process.env.NEXT_PUBLIC_RPC_URL!, "confirmed");
const secret = JSON.parse(fs.readFileSync("keypairs/id.json", "utf8"));
const keeper = Keypair.fromSecretKey(Uint8Array.from(secret));
const provider = new AnchorProvider(conn, new Wallet(keeper), {});
const program = await sb.AnchorUtils.loadProgramFromProvider(provider);

const feedConfig = new PublicKey("GgGVgSLWAyL9Xf4fGaAQQCkmWetBjX7PCNz8kTK97DKB");
const pullFeed = new sb.PullFeed(program, feedConfig);
const [oraclePda] = pullFeed.oraclePubkeys();
console.log("oracle PDA from PullFeed:", oraclePda.toBase58());

const [canonical] = sb.OracleQuote.getCanonicalPubkey(
  new PublicKey("EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7"),
  ["762ca1132d9071c754becd314da6bd4e91ac1ed681a136d7a0c06afa5ab86127"]
);
console.log("canonical from getCanonicalPubkey:", canonical.toBase58());
