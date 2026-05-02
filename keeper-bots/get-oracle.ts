import * as sb from "@switchboard-xyz/on-demand";
import { PublicKey } from "@solana/web3.js";

const queue = new PublicKey("EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7");
const feedHash = "762ca1132d9071c754becd314da6bd4e91ac1ed681a136d7a0c06afa5ab86127";

const [quoteAccount] = sb.OracleQuote.getCanonicalPubkey(queue, [feedHash]);
console.log("canonical quote account:", quoteAccount.toBase58());

