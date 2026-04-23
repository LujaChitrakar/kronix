Introducing Kronix
Kronix introduces two primitives missing from onchain markets. The first tradeable onchain crypto index perpetual on Solana and the first fully onchain, non-custodial strategy automation layer on Solana.
The Kronix Index Perpetual (KXI)
We start with a new kind of instrument. 
The KXI is a synthetic perpetual contract backed by a square-root market-cap weighted basket of SOL, BTC, ETH, LTC and BNB. The result is a single onchain instrument that tracks directional crypto market exposure with structurally less single-asset volatility and reduces single-asset liquidation risk.
Mark price is computed using a 30-tick TWAP sourced from the index itself, protecting traders from manipulation and flash crashes that would otherwise cause mass liquidations. 
Beyond the index, Kronix supports standard single-token perpetuals for major assets.
Single-token Perps
Beyond the synthetic index, Kronix supports standard single-token perpetuals for major assets.
The core Primitive: The Kronix Engine
Every trader has a strategy. The question is where and whether they can run it.
The Kronix Engine is the first non-custodial, fully onchain strategy automation layer on Solana. A trader encodes their trading logic/strategy and from that point on it executes continuously onchain without requiring the trader to trust a counterparty or run bots.
The Kronix Engine supports:

    Range DCA: Recurring buys and sells within defined price bands on a user-set schedule.
    EMA Cross: Long or Short entries triggered when a moving average crosses in a given direction.
    RSI Reversal: Entries and exits based on momentum thresholds across any timeframe.
    Liquidity Zone Execution: Limit orders anchored to user-defined support and resistance levels, with automatic exits if those levels break.

These are not price alerts. These are self-executing, non-custodial strategies that are always active on Solana and do not require a keeper outside the Jito validator network.
Strategy execution and trust model
Most automation tools that exist today are either custodial or fragile. A bot running off-chain can be front-run, go offline, or require you to hand over keys. There is no on-chain primitive that simply says: run this strategy, with my collateral.
On Kronix, strategies are non-custodial but bound to specific logic at activation time. Users define their strategy parameters onchain. The engine evaluates onchain price data, technical indicators computed from the historical price feed and user-defined thresholds and execution happens automatically when conditions are met.
There are no hidden counterparties. The logic is onchain, the execution is verifiable, and user's funds never leave their control.
Kronix integrates with BAM to enforce this at the sequencing layer. The strategy transactions are encrypted until execution, which means they cannot be observed, reordered or front-run before they land.
The future of Perpetuals on Solana
We believe that as Solana grows into a hub for internet-native capital markets, the missing primitive is not faster execution, it is programmable execution. 
The infrastructure now exists on Solana to build this. Jito BAM for sequencing, Alpenglow for finality, and a matching engine that treats order flow by intent rather than arrival time. Kronix is the exchange layer built to take advantage of all of it.