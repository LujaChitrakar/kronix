# Kronix — Idea Context

## Idea

On-chain perpetuals exchange on Solana. Three primitives:
1. **KXI** — synthetic index perpetual, sqrt-mcap basket (SOL, BTC, ETH, LTC, BNB).
2. **Kronix Engine** — non-custodial strategy automation (RSI, EMA, Range DCA, SR).
3. Single-asset perps.
Uses Jito BAM for encrypted sequencing.

## Status

- 4 Solana programs shipped (orderbook, risk, strategy, trigger).
- Raw Pinocchio, no Anchor. Crankless settlement.
- Next.js frontend + waitlist.
- Not yet mainnet.

## Validation (Round 2 — deeper)

```yaml
demand_signals:
  strong:
    - Jupiter DCA usage proves some on-chain auto demand (DCA only, not RSI/EMA)
    - Drift Vaults TVL shows "delegate/automate" appetite (but custodial-ish)
    - Hyperliquid growth proves systematic traders shop non-CEX venues
    - No crypto index perp on Solana (defensible gap but niche historically)
  weak_or_missing:
    - No waitlist numbers cited
    - No user interviews
    - No prop-MM soft commits
    - No direct evidence of demand for Solana crypto-basket perp
    - Toly quote is narrative, not demand
  anti_signals:
    - Clockwork shut down 2024 = non-custodial automation standalone insufficient
    - Binance BTCDOM = index perps historically low volume
    - Synthetix iAssets deprecated = index basket perps don't scale
    - Drift and Jupiter can replicate strategy module in weeks
    - No identified customer persona survives scrutiny (retail wants leverage not RSI;
      prosumer won't leave CEX liquidity; firms have own tools; non-custodial DeFi = small)

risks:
  - category: customer
    description: No persona at scale who clearly prefers this bundle over existing options
    severity: high
  - category: market
    description: Cold-start liquidity death spiral without MM subsidies
    severity: high
  - category: moat
    description: Zero moat — orderbook, automation, index all replicable by incumbents
    severity: high
  - category: narrative
    description: Article claims on-chain indicator compute; code takes keeper signal
    severity: high
  - category: product
    description: Index perps historically niche (Synthetix, BTCDOM)
    severity: medium
  - category: regulatory
    description: BNB + synthetic + US access = CFTC/SEC vector
    severity: medium
  - category: security
    description: 4 programs raw Pinocchio = $150-400k audit, 6-10 wks
    severity: medium
  - category: basket
    description: LTC inclusion stale; no rebalance governance
    severity: medium

go_no_go: pivot
confidence: 0.40

recommended_pivot: stack
pivot_detail: |
  Rip out orderbook_program + risk_program. Keep strategy_program + trigger_program.
  Route orders via CPI to Drift (and/or Jupiter) — use their liquidity, their risk engine.
  Reposition as "non-custodial onchain strategy automation on Solana's deepest perp liquidity".
  Smaller audit surface (2 programs), no cold-start, testable wedge.

alternative_pivots:
  - wedge: spot automation only, drop perps entirely
  - thematic: AI-5 / RWA / L1 basket perps instead of generic crypto
  - b2b: license strategy engine to Drift/Jupiter as module
  - chain: port to Monad/Sui/MegaETH where perp landscape less contested

next_steps:
  - Run one-week demand test: 200-response survey in Solana trader Discords
  - 5 paid user interviews ($50 each) with systematic traders
  - Post mock product tour on X, measure waitlist conversion (target 1000+ signups)
  - If <20% interest and <200 signups → harden to no-go, pick pivot
  - If >40% and >1000 signups → proceed but reposition article + fix trust model
  - Before mainnet: secure 2-3 prop MM soft commits OR execute stack pivot
  - Rewrite article trust-model and keeper claims to match code
  - Drop LTC from basket; publish rebalance governance
  - Regulatory counsel scan on BNB + US geo

scorecard:
  founder_fit: 3/3
  mvp_speed: 3/3
  distribution: 0/3
  market_pull: 1/3
  moat: 0/3
  total: 7/15  # below GO threshold of 8
```

Reports:
- Round 2 (current): [.superstack/kronix-validation.html](./kronix-validation.html)
