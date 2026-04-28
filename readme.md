# Kronix

## Programmable Perpetual Markets on Solana

Kronix is an Perpetual trading protocol that enables **strategy-based execution** directly on-chain. Traders can define rules (strategies) that automatically execute trades based on market conditions. Kronix is also introducing Index Trading, KXI(Kronix Index) which is a sq root market cap of weighted basket of top 5 crypto assets trading today.
All the solana programs is created using Pinocchio for most optimal CU usage.

## Overview

Traditional perpetual exchanges require constant monitoring and manual execution. Kronix abstracts this by allowing users to:

- Define trading strategies (RSI, DCA, TP/SL and more)
- Execute trades automatically when conditions are met
- Trade manually and via strategies in the same market

Kronix introduces a **programmable trading layer** on top of perpetuals.

---

## Core Features

### Strategy-Based Trading

- On-chain strategies:
  - Open when RSI < 30
  - Close when RSI > 60
  - DCA entries/exits
  - Stop-loss / Take-profit
- Fully automated execution

### Perpetual Markets

- Long/short trading
- Collateralized positions
- Funding rate mechanism

### Index Trading (Planned)

- Trade baskets of assets (e.g., top 5 crypto assets)

### Automation Layer

- Keepers monitor conditions
- Trigger execution on-chain

---

## Architecture

Frontend (Next.js)  
↓  
Client SDK (Codama)  
↓  
Solana Programs (Pinocchio)  
├── Orderbook Program  
├── Risk Program  
├── Strategy Program  
└── Trigger Program  
↓  
Bot / Keepers  
├── liquidation bot  
├── settle_funding bot  
├── cover_bad_debt bot  
├── prune_bids bot  
├── funding_rate bot  
├── update_funding_rate bot  
├── execute_trigger bot  
├── execute_strategy bot  
└── prune_expired_orders bot

---

## Project Structure

kronix/

├── crates/                 ← CPI crates for orderbook_program, risk_program, trigger_program  
├── kronix-frontend/        ← Frontend (landing page, trade UI, admin panel, bots)  
├── orderbook_program/      ← Solana orderbook program  
├── risk_program/           ← Solana risk engine program  
├── strategy_program/       ← Solana strategy program  
├── trigger_program/        ← Solana trigger execution program  
├── article.md              ← Kronix article / overview  
└── ix_desc.md              ← Instruction descriptions and program flow  

---

## Solana Program Instructions
All the instructions of all 4 solana programs and their desriptions can be found in /ix_desc.md

