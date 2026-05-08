# Kronix keeper bots

Permissionless cranks for the Kronix risk, orderbook, trigger and strategy
programs. Single Node process runs every job at a fixed cadence.

| Job                     | Interval | Program            | What it does                                                                |
| ----------------------- | -------- | ------------------ | --------------------------------------------------------------------------- |
| update_funding_rate     | 1h       | risk_program       | Reads Switchboard, calls `update_funding_rate` so `cumulative_index` advances |
| liquidate               | 30s      | risk_program       | Scans all positions, liquidates only when equity minus maintenance is below buffer |
| cover_bad_debt          | 60s      | risk_program       | Drains InsuranceFund into accounts with `collateral < 0`                    |
| prune_orders            | 60s      | orderbook_program  | Drops expired TIF orders on bids and asks                                   |
| settle_funding          | 8h       | risk_program       | Sweeps every open position, applies pending funding                         |
| execute_triggers        | 10s      | trigger_program    | Reads mark, fires `execute_trigger` on any active trigger that crossed     |
| prune_expired_triggers  | 60s      | trigger_program    | Closes expired trigger orders in batches                                   |
| record_price            | 5s       | (none)             | Samples mark price into in-memory + on-disk history (RSI/EMA window feed)  |
| execute_strategies      | 30s      | strategy_program   | Computes per-strategy signal and fires `execute_strategy` if non-Hold      |

## Layout

This package lives outside `kronix-frontend/`. It imports SDK files (codama
output + helpers) from `../kronix-frontend/lib/` to avoid duplication.

```
crypto-exchange/
├── kronix-frontend/        # Next.js app (single source of truth for SDKs)
│   └── lib/
│       ├── kronix/         # config, PDA helpers, ix-bridge
│       ├── orderbook-sdk/
│       ├── risk-sdk/
│       ├── trigger-sdk/
│       └── strategy-sdk/
└── keeper-bots/            # this package
    ├── main.ts
    ├── package.json
    └── tsconfig.json
```

## Setup

```sh
cd keeper-bots
cp .env.example .env.local
# edit .env.local — set KEEPER_KEYPAIR_PATH to a funded devnet keypair JSON array
pnpm install
pnpm keeper
```

Required env vars (read from `.env.local`):

| Var                              | Default                              | Purpose                                          |
| -------------------------------- | ------------------------------------ | ------------------------------------------------ |
| `KEEPER_KEYPAIR_PATH`            | `~/.config/solana/id.json`           | 64-byte JSON keypair array; file paths still work |
| `NEXT_PUBLIC_RPC_URL`            | `https://api.devnet.solana.com`      | Solana RPC endpoint                              |
| `NEXT_PUBLIC_USDC_MINT`          | devnet test mint                     | USDC mint for vault / liquidator ATA            |
| `NEXT_PUBLIC_MARKET_INDEX`       | `1`                                  | SOL market index                                |
| `NEXT_PUBLIC_KXI_MARKET_INDEX`   | `2`                                  | KXI market index                                |
| `NEXT_PUBLIC_MARKET_INDEXES`     | `1,2`                                | Markets keeper scans                            |
| `NEXT_PUBLIC_TRIGGER_PROGRAM_ID` | hardcoded                            | Override deployed trigger program               |
| `NEXT_PUBLIC_STRATEGY_PROGRAM_ID`| hardcoded                            | Override deployed strategy program              |
| `KEEPER_PRICE_HISTORY_PATH`      | `keeper-bots/kronix-price-history.json` | JSON file persisting mark-price samples      |
| `KEEPER_DEV_SKIP_CORRUPTED_ACCOUNTS` | unset                            | Dev-only: set `1` to skip legacy corrupted accounts |
| `KEEPER_DEV_CORRUPTED_COLLATERAL_FLOOR` | `-100000000000`               | Dev-only collateral floor used by skip mode     |
| `KEEPER_DEV_CORRUPTED_ACCOUNTS`  | unset                                | Dev-only comma list of owner/user/position pubkeys to skip |

The frontend's browser connection uses `/api/rpc`; set `NEXT_PUBLIC_RPC_URL`
in `kronix-frontend/.env.local` or Vercel for the upstream RPC provider, but
do not read it from client components.
Faucet API routes also accept `KEEPER_KEYPAIR_PATH` from
`kronix-frontend/.env.local` when `MINT_AUTHORITY` is unset.

## Strategy signal computation

Mirrors logic from the off-chain `strategy_engine` reference (see
`/strategy_engine/*.md`):

- **RSI** — Wilder-smoothed RSI over `params.rsiPeriod` closes.
- **EMA** — SMA-seeded EMA, fires on fast/slow crossover.
- **RangeDCA** — equally-spaced grid levels with 0.1% step tolerance.
- **SR** — multi-level support/resistance, fires within `params.toleranceBps`.
- **SmartMoney** — synthetic OHLC bars from mark-price samples (12 ticks per
  bar, ~1 minute), structure detection (HH/HL vs LH/LL via pivots) plus
  order-block reversal detection. `params.orderBlockSensitivity` is in
  basis points (1 = 0.01%) — same convention as `toleranceBps`.

`record_price` keeps the last 200 samples per market in memory and
serializes them to disk (`KEEPER_PRICE_HISTORY_PATH`) so a keeper restart
does not throw away the warmup window.

## Notes

- Multi-market via `NEXT_PUBLIC_MARKET_INDEXES`; defaults to SOL/KXI.
- Liquidator USDC ATA is created on first run (covers the liquidation fee
  payout).
- All jobs are skipped on a tick if the previous run hasn't finished, so
  slow RPC won't pile up overlapping txs.
- `execute_strategy` lazy-inits the strategy fills_log via CPI when needed
  (after `client_order_id` rolls forward by 3) — keeper does not need to
  pre-init.
