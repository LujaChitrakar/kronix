# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## What This Is

**Kronix** — on-chain perpetuals exchange on Solana.
Four Pinocchio programs + Next.js landing page.
No Anchor. Raw pinocchio for zero-overhead CPI and account management.
Crankless settlement — no EventQueue, fills settle immediately via CPI.

## Program IDs

| Program             | ID                                             |
| ------------------- | ---------------------------------------------- |
| `orderbook_program` | `j8VeDggFuwtiCjM8uo7am8i1bWWH2sj7mBRxqTaZniU`  |
| `risk_program`      | `C8kAYt7vpmFxhguEJxbg6hMZY3LLNYACrU8mKveZ8eMu` |
| `strategy_program`  | `5uPoD26g3gKYFhYR4poXe4oxHATBnWb3CUoGue9vaCpa` |
| `trigger_program`   | `H4CnxfeSWvWqhBz2apY8JBdJxkn6qJf7crLiYqBz74fD` |

## Build & Test Commands

### Rust Programs

```bash
# Build (run inside program directory)
cargo build-sbf

# Build with devnet oracle config
cargo build-sbf --features devnet

# Run all tests
cargo test

# Run single test with output
cargo test test_name -- --nocapture
```

Tests use `litesvm` (in-process SVM) — no validator needed.

### Frontend

```bash
cd kronix-frontend
pnpm dev        # localhost:3000
pnpm build
pnpm lint
```

### Client Generation

```bash
# Generate Shank IDL
shank idl --crate-root programs/orderbook_program --out-dir clients/orderbook/src/generated
shank idl --crate-root programs/risk_program      --out-dir clients/risk/src/generated

# Generate TypeScript client from IDL
node clients/orderbook/codama.mjs
node clients/risk/codama.mjs
```

Generated files in `clients/*/src/generated/` — do not edit manually.

## Repository Layout

```
crypto-exchange/
├── orderbook_program/     # Matching engine + order lifecycle
├── risk_program/          # Margin, positions, funding, liquidation
├── strategy_program/      # On-chain automated strategies (RSI, EMA, DCA, SR)
├── trigger_program/       # Stop-loss / take-profit trigger orders
├── crates/
│   ├── orderbook_program_cpi/   # CPI types for calling orderbook
│   ├── risk_program_cpi/        # CPI types for calling risk_program
│   └── trigger_program_cpi/     # CPI types for calling trigger_program
├── kronix-frontend/       # Next.js 16 landing page + waitlist
├── ix_desc.md             # Full instruction flow reference (read this first)
└── deployed.txt           # Deployed program addresses
```

## Architecture

### Crankless Settlement

No EventQueue. No consume_events instruction.
Taker fills settle immediately via CPI during `place_order`.
Maker fills recorded in `OpenOrder.is_filled` flag.
Makers call `claim_fill` to settle their own fills (no keeper needed).

### Cross-Program Call Flow

```
Admin Setup (once):
risk_program::initialize_insurance_fund
risk_program::initialize_vault
risk_program::create_risk_market
orderbook_program::create_orderbook_market
User TX:
orderbook::place_order
├── book.new_order()              (on-chain matching)
├── maker_oo.record_fill()        (mark maker slot)
└── CPI → risk::settle_fill      (taker, per fill)
orderbook::claim_fill (maker calls)
└── CPI → risk::settle_fill      (maker side)
strategy_program::execute_strategy (keeper calls)
├── CPI → orderbook::place_order / place_take_order
└── CPI → trigger::place_trigger_order  (SL/TP)
trigger_program::execute_trigger (keeper calls)
└── CPI → orderbook::place_take_order
Keepers (permissionless):
risk::update_funding_rate    (hourly)
risk::liquidate              (when health < 1.0)
risk::cover_bad_debt         (when equity < 0)
orderbook::prune_orders      (expired TIF orders)
trigger::prune_expired_triggers
trigger::execute_trigger     (when price crosses)
strategy::execute_strategy   (when signal fires)
```

### State Accounts (PDAs)

**orderbook_program**

MarketState seed: [b"market", market_index_le]
BookSide (bids) seed: [b"bids", market_index_le, bump]
BookSide (asks) seed: [b"asks", market_index_le, bump]
OpenOrdersAccount seed: [b"open_orders", owner, market_key, bump]

**risk_program**

MarketConfig seed: [b"market_config", market_index_le, bump]
FundingState seed: [b"funding", market_index_le, bump]
UserAccount seed: [b"user", owner, bump]
Position seed: [b"position", owner, market_index_le, bump]
InsuranceFund seed: [b"insurance", bump]
Vault (SPL token) seed: [b"vault", mint, bump]
VaultAuthority seed: [b"vault_authority", mint, bump]

**strategy_program**
StrategyAccount seed: [b"strategy", owner, market_index_le, strategy_type, bump]
one strategy per type per market per user

**trigger_program**

TriggerOrder seed: [b"trigger_order", owner, client_order_id_le, bump]

### Matching Engine

The critbit tree lives in `orderbook_program/src/states/orderbook/`. Key types:

nodes.rs InnerNode, LeafNode, FreeNode, AnyNode — critbit node types
ordertree.rs OrderTreeNodes — insert_leaf, remove_by_key, find operations
bookside.rs BookSide — single critbit tree wrapper (no oracle-pegged in v1)
book.rs new_order() — matching loop, returns MatchResult
order.rs Order + OrderParams — input to new_order()
order_type.rs Side, PlaceOrderType, PostOrderType enums

MatchResult is a fixed-size stack struct — no heap allocation.
Fills are [FillEvent; MAX_FILLS_PER_ORDER] — not Vec.

## Oracle

Both `risk_program` and `trigger_program` read Pyth `PriceUpdateV2` accounts.
Manual byte-offset deserialization — no Anchor deserializer dependency.

SOL/USD feed ID in `risk_program/src/constants.rs` as `FEED_ID`.

## StrategyParams Union

`StrategyAccount.params` is a fixed-size `StrategyParams` struct
covering all five strategy types. Unused fields are zeroed.
`strategy_type` field (u8) determines which params are valid:

0 = RSI → rsi_period, rsi_oversold, rsi_overbought
1 = EMA → ema_fast, ema_slow
2 = RangeDCA → lower_price, upper_price, grid_count
3 = SR → tolerance_bps, level_count, levels[8]
4 = SmartMoney → structure_lookback, order_block_sensitivity
Signal computation is off-chain (keeper evaluates RSI/EMA/etc).
On-chain validates: cooldown, daily cap, status, then executes.

### Struct Layout Rule


All on-chain state:
- `#[repr(C)]`
- `bytemuck::Pod + Zeroable`
- Compile-time size assertions in every state file:
```rust
  const _: () = assert!(size_of::<MyStruct>() == EXPECTED);
  const _: () = assert!(size_of::<MyStruct>() % 8 == 0);
```
- Pubkeys stored as `[u8; 32]` — no Pubkey type dependency
- No enums directly in state — store as `u8`, convert via `try_from`

### CPI Crates

`crates/*_cpi` contain only `Pod` param structs and instruction discriminant constants — no account validation. Callers build the `Instruction` manually and invoke via pinocchio CPI primitives.

## Frontend

Next.js 16 + React 19 + Tailwind 4. Landing page with waitlist (Supabase). Requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` env vars.

## Key Reference: `ix_desc.md`

Full instruction flow for every IX in all four programs including account lists, CPI call graph, and setup sequence. Read before adding or modifying instructions.


<claude-mem-context>
# Memory Context

# [crypto-exchange] recent context, 2026-05-08 7:57pm GMT+5:45

No previous sessions found.
</claude-mem-context>