# Kronix keeper bots

Permissionless cranks for the Kronix risk and orderbook programs. Single
process runs five jobs at fixed cadences.

| Job                 | Interval | Program                  | What it does                                                     |
| ------------------- | -------- | ------------------------ | ---------------------------------------------------------------- |
| update_funding_rate | 10s      | risk_program             | Reads Pyth, calls `update_funding_rate` so `cumulative_index` advances |
| liquidate           | 30s      | risk_program             | Scans all positions, liquidates any with health factor < 100     |
| cover_bad_debt      | 60s      | risk_program             | Drains InsuranceFund into accounts with `collateral < 0`         |
| prune_orders        | 60s      | orderbook_program        | Drops expired TIF orders on bids and asks                        |
| settle_funding      | 8h       | risk_program             | Sweeps every open position, applies pending funding              |

`settle_funding` was patched to be permissionless (no signer-owns-position
check) so a single keeper can sweep all positions. See
`risk_program/src/instructions/settle_funding.rs`.

## Setup

```sh
cd kronix-frontend
cp keeper-bots/.env.example .env.local
# edit .env.local — point KEEPER_KEYPAIR_PATH at a funded devnet keypair
pnpm install
pnpm keeper
```

The keeper logs each job tick:

```
keeper pubkey: <pk>
[init] market 0 oracle=… quote_lot=100 maint_bps=500
[funding-rate] ✓ 5MBPaNoV…
[liquidate] AbCdEf health=42 coll=… maint=…
[liquidate] ✓ …
[settle-funding] scanning 14 positions
…
```

## Notes

- Single-market for now (`MARKET_INDEX` env). To support multiple markets,
  loop over a `MarketConfig` PDA scan in `loadMarkets()`.
- Liquidator USDC ATA is created on first run (covers the liquidation fee
  payout).
- `update_funding_rate` is fired regardless of whether the rate would
  actually move — the program decides if anything changed. Cheap call.
- All jobs are skipped on a tick if the previous run hasn't finished, so
  slow RPC won't pile up overlapping txs.
