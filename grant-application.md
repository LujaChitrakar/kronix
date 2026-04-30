# Kronix — Agentic Engineering Grant Application

**Submit at:** https://superteam.fun/earn/grants/agentic-engineering
**Grant amount:** 200 USDG
**Prepared:** 2026-04-30

---

## Step 1: Basics

**Project Title**
> Kronix

**One Line Description**
> Programmable perpetuals exchange on Solana — non-custodial on-chain strategy automation (RSI, EMA, DCA, SR) plus KXI, the first sqrt-mcap-weighted crypto index perpetual.

**TG username**
> t.me/Lujachitrakar

**Wallet Address**
> 2B82xx9y6ejDG39h5ER3ZHegdKfGyrozUVM6yn49vnw5

---

## Step 2: Details

**Project Details**
> Kronix is an on-chain perpetuals exchange on Solana built on four raw Pinocchio programs (no Anchor) for zero-overhead CPI and minimal compute usage. It introduces two primitives missing from on-chain markets: **KXI**, the first tradeable sqrt-market-cap-weighted crypto index perpetual (SOL, BTC, ETH, XRP, BNB) with a 30-tick TWAP mark price, and **the Kronix Engine**, the first non-custodial, fully on-chain strategy automation layer on Solana.
>
> Traditional perp DEXs require constant manual monitoring or trust in custodial bots. Kronix lets traders encode strategies — Range DCA, EMA Cross, RSI Reversal, Liquidity-Zone Execution — directly on-chain. Strategy parameters live in a `StrategyAccount` PDA; keepers evaluate signals and execute via CPI through the orderbook. Crankless settlement: taker fills settle immediately during `place_order` via CPI to the risk program — no EventQueue, no consume_events crank.
>
> Architecture: `orderbook_program` (critbit matching engine, no heap allocations), `risk_program` (margin, positions, funding, liquidation, oracle-driven via Pyth), `strategy_program` (on-chain strategy primitives), `trigger_program` (SL/TP). All state is `#[repr(C)] + bytemuck::Pod` with compile-time size assertions. CPI crates expose only Pod param structs and discriminants.
>
> The full development cycle — program design, matching engine, risk engine, strategy primitives, trigger engine, keeper bots, Next.js frontend with KXI chart, and SDK generation via Codama — was executed in tight collaboration with Claude Code. The attached session transcript documents agent-driven design, debugging, and shipping.

**Deadline**
> 2026-07-31 (Asia/Calcutta) — mainnet beta with KXI live and audit complete.

**Proof of Work**
> - **GitHub repo:** https://github.com/LujaChitrakar/crypto-exchange
> - **Four deployed Solana programs** (devnet, see `deployed.txt`):
>   - `orderbook_program` — `j8VeDggFuwtiCjM8uo7am8i1bWWH2sj7mBRxqTaZniU`
>   - `risk_program` — `C8kAYt7vpmFxhguEJxbg6hMZY3LLNYACrU8mKveZ8eMu`
>   - `strategy_program` — `5uPoD26g3gKYFhYR4poXe4oxHATBnWb3CUoGue9vaCpa`
>   - `trigger_program` — `H4CnxfeSWvWqhBz2apY8JBdJxkn6qJf7crLiYqBz74fD`
> - **Recent shipped work** (last 20 commits):
>   - KXI index calculation backend + chart integration in frontend (`f016ca8`, `c4fc214`)
>   - Deposit insurance fund (`b4826d1`)
>   - Strategy program full integration + UI (`5a701a7`, `20079e5`, `e3a1080`)
>   - Keeper bot suite: liquidation, funding rate, bad-debt cover, prune-orders, execute-trigger, execute-strategy
>   - Codama-generated TypeScript SDKs for orderbook + risk
> - **Reference docs:** `ix_desc.md` (full instruction flow per program), `article.md` (architecture overview), `CLAUDE.md` (agent-readable spec).
> - **AI-assisted development log:** attached `claude-session.jsonl` shows live agent-driven debugging + shipping.
> - **Competitive landscape (Colosseum Copilot, 2026-04-30):** cluster `v1-c9` Solana DEX & Trading Infrastructure — 323 projects, 23 winners. KXI sqrt-mcap-weighted index perpetual is unique on Solana per Copilot corpus. Full landscape analysis in section below.

**Personal X Profile**
> x.com/lujadev

**Personal GitHub Profile**
> github.com/LujaChitrakar

**Colosseum Crowdedness Score**
> **323** — cluster `v1-c9` Solana DEX & Trading Infrastructure (23 winners). Confirmed via Colosseum Copilot API (`GET /clusters/v1-c9`) on 2026-04-30.
>
> Score card image: `./kronix-crowdedness.png` (1200x800 PNG). Upload to public Google Drive and paste shareable link in form.
>
> Optional: also visit https://colosseum.com/copilot for live UI screenshot if reviewer prefers canonical UI render.

**AI Session Transcript**
> Attach `./claude-session.jsonl` (auto-exported to project root via apply-grant skill).

---

## Step 3: Milestones

**Goals and Milestones**

**M1 — Audit prep + devnet hardening (by 2026-05-31)**
- Freeze instruction surface across all 4 programs.
- 90%+ litesvm test coverage on orderbook + risk critical paths.
- Submit programs for security audit (target: Ottersec or Neodyme).
- Publish public bug-bounty scope.

**M2 — KXI mainnet beta (by 2026-06-30)**
- Deploy all 4 programs to mainnet.
- Launch KXI index perpetual with 30-tick TWAP mark price.
- Single-asset perps live for SOL, BTC, ETH.
- Pyth price feeds in production; funding rate keeper hourly cadence verified.

**M3 — Strategy Engine GA + frontend launch (by 2026-07-15)**
- Range DCA, EMA Cross, RSI Reversal, SR (Liquidity Zone) strategies live.
- Frontend trade UI + strategy builder UI live at production domain.
- Keeper bot infra horizontally scaled (liquidation, funding, trigger, strategy).

**M4 — Public launch + KPI window (by 2026-07-31)**
- Public announce + Solana ecosystem launch tweet.
- Begin 30-day KPI tracking window.
- **Primary KPI:** 500 unique funded traders within 30 days of public launch.

**M5 — Final tranche reporting (by 2026-08-31)**
- Submit Colosseum project link, GitHub repo, AI subscription receipt for final tranche.
- Publish post-launch report: traders, volume, strategies executed, audit findings remediated.

**Primary KPI**
> 500 unique funded traders in 30 days post-launch.

**Final tranche checkbox**
> Acknowledged. Will submit Colosseum project link, GitHub repo, and AI subscription receipt to receive final tranche.

---

## Competitive Landscape — Colosseum Copilot Research

**Generated:** 2026-04-30 via Colosseum Copilot API.

### Cluster Crowdedness

| Metric | Value |
|--------|-------|
| Cluster | Solana DEX & Trading Infrastructure (`v1-c9`) |
| Cluster crowdedness | **323 projects** |
| Cluster winners | 23 |
| Top primitives | amm (99), dex (70), oracle (34), bridge (31) |
| Top problems | fragmented liquidity (53), liquidity fragmentation (13), impermanent loss (10), front-running (9) |

Cluster summary: *"Decentralized exchange solutions and advanced trading tools on Solana, including liquidity aggregation, automated strategy execution, and perpetual markets."*

### Direct Competitors — Perp DEX

| Project | Hackathon | Angle |
|---------|-----------|-------|
| [`kaigan`](https://arena.colosseum.org/projects/explore/kaigan) | Cypherpunk 2025 | CLOB DEX — closest on orderbook architecture |
| [`perc-o-dex`](https://arena.colosseum.org/projects/explore/perc-o-dex) | Cypherpunk 2025 | Sharded perpetual exchange |
| [`omniliquid`](https://arena.colosseum.org/projects/explore/omniliquid) | Breakout 2025 | On-chain CLOB perps + spot + RWA |
| [`derp.trade`](https://arena.colosseum.org/projects/explore/derp.trade) | Breakout 2025 | AMM-based perps for low-liq tokens |
| [`perfx`](https://arena.colosseum.org/projects/explore/perfx) | Breakout 2025 | Forex perp DEX, hybrid orderbook |
| `punk` (cluster rep) | — | Concentrated-liquidity perp AMM |

### Direct Competitors — Strategy Automation

| Project | Hackathon | Angle |
|---------|-----------|-------|
| [`momentum`](https://arena.colosseum.org/projects/explore/momentum) | Cypherpunk 2025 | Automated execution for user-defined strategies — **most direct overlap with Kronix Engine** |
| [`reka`](https://arena.colosseum.org/projects/explore/reka) | Breakout 2025 | DCA + yield automation |
| [`horizon`](https://arena.colosseum.org/projects/explore/horizon) | Cypherpunk 2025 | AI strategy bot |
| [`saffron-trade`](https://arena.colosseum.org/projects/explore/saffron-trade) | Cypherpunk 2025 | AI strategy automation |
| [`butter-trade`](https://arena.colosseum.org/projects/explore/butter-trade) | Radar 2024 | Automated signal-driven trading |

### Index Basket Angle (KXI gap)

| Project | Hackathon | Type |
|---------|-----------|------|
| [`indexone`](https://arena.colosseum.org/projects/explore/indexone) | Cypherpunk 2025 | Spot basket |
| [`pie.fun`](https://arena.colosseum.org/projects/explore/pie.fun) | Breakout 2025 | Programmable spot ETF |
| [`bit10`](https://arena.colosseum.org/projects/explore/bit10) | Breakout 2025 | Spot index fund top-10 mcap |
| [`sol-index`](https://arena.colosseum.org/projects/explore/sol-index) | Renaissance 2024 | Spot Solana ecosystem index |

> **No direct competitor found for a sqrt-mcap-weighted crypto index *perpetual* (KXI).** Based on Colosseum Copilot corpus as of 2026-04-30, KXI is a defensible gap on Solana.

### Accelerator-cohort Reference Points

- [`reflect-protocol`](https://arena.colosseum.org/projects/explore/reflect-protocol) — Grand Prize Radar 2024 ($50k) — delta-neutral hedging + perpetuals (adjacent angle).
- [`rekt`](https://arena.colosseum.org/projects/explore/rekt) — 3rd DeFi Cypherpunk 2025 ($15k) — gamified retail perps (consumer-side reference).

### Archive Citation

[Drift Protocol — Trading Automation docs](https://docs.drift.trade/developers/trading-automation): Drift exposes SDK-first programmatic trading + bot flows but **strategy logic runs off-chain in keepers**. Kronix's on-chain strategy primitives in `strategy_program` are structural differentiation against Solana's deepest perp incumbent.

### Landscape Headline

> Kronix sits in cluster `v1-c9` (Solana DEX & Trading Infrastructure) — 323 projects, 23 winners. Direct overlap on perp DEX angle (`kaigan`, `perc-o-dex`, `omniliquid`, `derp.trade`) and strategy automation angle (`momentum`, `reka`). KXI sqrt-mcap-weighted index perpetual unique on Solana per Copilot corpus as of 2026-04-30. Differentiation: on-chain strategy execution (vs Drift off-chain keepers), index perp instrument (vs spot baskets only), Pinocchio CU optimization (vs Anchor incumbents).

---

## Submission Checklist

- [ ] Fill TODO: Colosseum Crowdedness Score screenshot → Google Drive public link.
- [ ] Attach `./claude-session.jsonl` to AI Session Transcript field.
- [ ] Copy each `> blockquote` value into matching form field.
- [ ] Submit at https://superteam.fun/earn/grants/agentic-engineering.
- [ ] After approval: prep AI subscription receipt for final-tranche submission.
