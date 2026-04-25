THE FLOW OF ALL THE IX

---- SETUP IX (RAN BY ADMIN ONCE) ----

risk_program::initialize_insurance_fund

```
Called by:   Admin (one time)
CPI:         None

What it does:
  Creates InsuranceFund PDA on-chain
  Sets balance = 0, total_collected = 0, total_paid_out = 0
  This account absorbs bad debt during liquidations

Flow:
  Admin TX
    → risk_program::initialize_insurance_fund
      → CreateAccount (InsuranceFund PDA)
      → init InsuranceFund { balance: 0 }

Accounts:
  payer (admin, signer, writable)
  insurance_fund PDA (writable)
  system_program
```

---

risk_program::initialize_vault

```
Called by:   Admin (one time)
CPI:         system_program::create_account
             token_program::initialize_account3

What it does:
  Creates SPL token account PDA for holding user USDC
  Creates vault_authority PDA that signs for withdrawals
  All user deposits flow into this vault

Flow:
  Admin TX
    → risk_program::initialize_vault
      → CreateAccount (vault PDA, 165 bytes, owned by token_program)
      → InitializeAccount3 (vault, mint=USDC, authority=vault_authority PDA)

Accounts:
  payer (admin, signer, writable)
  vault PDA (writable)
  vault_authority PDA
  usdc_mint
  token_program
  system_program
```

---

risk_program::create_risk_market

```
Called by:   Admin (once per market)
CPI:         None

What it does:
  Creates MarketConfig PDA — stores risk parameters for a market
  Creates FundingState PDA — stores cumulative funding index
  Sets max_leverage, initial_margin_bps, maintenance_margin_bps,
  liquidation_fee_bps, oracle pubkey, lot sizes

Flow:
  Admin TX
    → risk_program::create_risk_market
      → CreateAccount (MarketConfig PDA)
      → CreateAccount (FundingState PDA)
      → init MarketConfig { max_leverage, margin params, oracle }
      → init FundingState { cumulative_index: 0, last_updated: now }

Accounts:
  payer (admin, signer, writable)
  market_config PDA (writable)
  funding_state PDA (writable)
  system_program
```

---

orderbook_program::create_orderbook_market

```
Called by:   Admin (once per market)
CPI:         None

What it does:
  Creates MarketState PDA — stores market metadata, lot sizes, seq_num
  Creates BookSide (bids) PDA — critbit tree for bid orders
  Creates BookSide (asks) PDA — critbit tree for ask orders
  Initializes both BookSides with correct OrderTreeType

Flow:
  Admin TX
    → orderbook_program::create_orderbook_market
      → CreateAccount (MarketState PDA)
      → CreateAccount (bids BookSide PDA)
      → CreateAccount (asks BookSide PDA)
      → init MarketState { base_lot_size, quote_lot_size, seq_num: 0 }
      → bids.init(OrderTreeType::Bids)
      → asks.init(OrderTreeType::Asks)

Accounts:
  payer (admin, signer, writable)
  market_state PDA (writable)
  bids PDA (writable)
  asks PDA (writable)
  system_program

Note:
  run AFTER risk_program::create_risk_market for same market_index
  both markets must use same market_index to stay in sync
```

---

--- USER ONBOARDING ---
risk_program::deposit

```
Called by:   User
CPI:         token_program::transfer

What it does:
  Transfers USDC from user's ATA to program vault
  Creates UserAccount PDA on first deposit
  Increases UserAccount.collateral by deposit amount
  Collateral is cross-margin — covers all positions

Flow:
  User TX
    → risk_program::deposit
      → if UserAccount empty:
          CreateAccount (UserAccount PDA)
          init UserAccount { collateral: 0, margin_used: 0 }
      → token_program::transfer (user ATA → vault)
      → ua.collateral += amount

Accounts:
  signer (user, writable)
  user_account PDA (writable)
  user_token_account (user USDC ATA, writable)
  vault PDA (writable)
  token_program
  system_program
```

---

orderbook_program::create_open_orders_account

```
Called by:   User (once per market)
CPI:         None

What it does:
  Creates OpenOrdersAccount PDA for user on a specific market
  Tracks user's resting orders on the book (up to 24 slots)
  Also tracks pending maker fills waiting to be claimed
  Required before placing any orders

Flow:
  User TX
    → orderbook_program::create_open_orders_account
      → verify market PDA is valid
      → CreateAccount (OpenOrdersAccount PDA)
      → init { owner, market, open_orders: [default; 24] }

Accounts:
  payer (signer, writable)
  open_orders_account PDA (writable)
  market_state PDA
  system_program

PDA seeds:
  ["open_orders", owner, market_key, bump]
```

---

--- CORE TRADING FLOW ---

orderbook_program::initialize_fills_logs

```
Creates a FillsLog PDA account for a specific taker and client order ID. This account acts as the bridge between place_order (matching) and settle_fills (settlement). Must be called in the same transaction as place_order.
place_order needs a writable FillsLog account to write fill data into after matching. Creating it in the same transaction as place_order guarantees it exists and is in the correct ready state before matching runs.

Caller
User (taker) — called before every place_order.

Account:
signer,
fill_logs,
market,
system_program

```

---

orderbook_program::place_order

```
Called by:   User
CPI:         risk_program::settle_fill (per fill, taker side only)

What it does:
  Runs on-chain matching engine (critbit tree traversal)
  Matches taker order against resting maker orders
  For each fill:
    → records fill on maker's OpenOrdersAccount (is_filled=1)
    → CPIs risk_program::settle_fill for taker immediately
  Remainder (unfilled quantity) posted to BookSide if limit order
  Increments market.seq_num for order ID generation

Order types supported:
  Limit         — rest on book, fill what crosses, post remainder
  PostOnly      — rest on book only, cancel if would match
  PostOnlySlide — adjust price to just outside spread, rest on book
  ImmediateOrCancel — fill what crosses, cancel remainder
  FillOrKill    — fill entire order or cancel entirely
  Market        — fill at best available price, never post

Flow:
  User TX
    → orderbook_program::place_order
      → validate market is_active()
      → validate OO account (owner, market match)
      → book.new_order() — matching loop runs on-chain:
          iterate opposing BookSide (critbit tree)
          for each crossing order:
            if expired: mark for deletion, continue
            if self-trade: abort
            compute match_base_lots, match_quote_lots
            record fill in MatchResults.fills[]
            mark maker OO slot: is_filled=1, filled_qty, fill_price
        apply matched_order_changes (partial fills)
        apply matched_order_deletes (full fills)
      → for each fill in result.fills[]:
          maker_oo.record_fill(slot, qty, price, maker_out)
          CPI → risk_program::settle_fill(fill, is_taker=true)
      → if limit order and remainder > 0:
          try remove_one_expired() to make room
          if book full: evict worst order if ours is better
          insert LeafNode into BookSide (critbit insert)
          OO account.add_order(slot, order_id, price)

Accounts:
  signer (user, signer, writable)
  open_orders_account PDA (writable)
  market_state PDA (writable)  ← seq_num incremented
  bids PDA (writable)
  asks PDA (writable)
  fills_log(writtable)
  system_program

CPI depth: orderbook(1) → risk_program(2) → system_program(3)
```

---

orderbook_program::settle_fills

Reads confirmed fill data from FillsLog and settles both taker and maker positions by CPIing into risk_program::settle_fill for each fill. Updates maker OO account slots. Marks each fill as settled. When all fills are settled, resets FillsLog to the ready state.

Caller
Permissionless — called by the taker immediately after place_order confirms, or by a settlement keeper as a fallback.

What It Does
For each fill in the range [start, end):
Skips fills already marked settled = 1
Verifies all passed remaining accounts match the fill data in FillsLog — prevents malicious callers from passing wrong accounts

Each fill requires 5 remaining accounts (taker UA, taker pos, maker OO, maker UA, maker pos) = 160 bytes per fill. Combined with fixed accounts and instruction data, a maximum of 4 fills fit within Solana's 1232-byte transaction size limit. For orders with 5-8 fills, two settle_fills transactions are sent.

Accounts:
caller
fills_log
market
market_config
funding_state
system_program

remainings:
taker_user_acount
taker_position
maker_open_orders
maker_user_acount
maker_position

---

TX 1 — Matching
ix[0]: initialize_fills_log
→ Creates FillsLog PDA
→ all_settled = 1 (ready)

ix[1]: place_order
→ Verifies FillsLog is ready
→ Runs matching engine
→ Writes N fills to FillsLog
→ all_settled = 0 (pending)
→ No CPIs to risk_program
→ No remaining accounts

After TX 1 confirms:
Read FillsLog from chain — exact fill data available
Derive all maker + taker accounts deterministically from fill data
No race condition — fills already confirmed

TX 2 — Settlement (fills 0..4)
ix[0]: settle_fills(start=0, end=4)
→ Verify all 5 accounts per fill match FillsLog data
→ CPI settle_fill taker (fill 0)
→ CPI settle_fill maker (fill 0)
→ Update maker OO slot (fill 0)
→ fill[0].settled = 1
→ ... repeat for fills 1, 2, 3

TX 3 — Settlement (fills 4..8, only if fill_count > 4)
ix[0]: settle_fills(start=4, end=8)
→ Same pattern for remaining fills
→ all_settled = 1 after last fill settled
→ FillsLog ready for next order

    ---

risk_program::settle_fill

```
Called by:   orderbook_program via CPI (never called directly by user)
CPI:         system_program::create_account (if new user/position)

What it does:
  Updates position state for taker (called during place_order)
  Updates position state for maker (called during claim_fill)
  Handles four position scenarios:
    1. New position — create Position PDA, set entry_price, lock margin
    2. Add to position — weighted average entry price, add margin
    3. Reduce position — realize PnL, release proportional margin
    4. Flip position — close existing, open opposite side
  Always calls settle_funding_internal before any position change

Flow (taker path, called from place_order):
  CPI from orderbook_program
    → risk_program::settle_fill(is_taker=true)
      → verify caller is orderbook_program
      → load MarketConfig (oracle, lot sizes, margin params)
      → determine position_side from taker_side
      → create/load UserAccount
      → verify position PDA
      → settle_funding_internal() ← ALWAYS first
      → if new position:
          CreateAccount (Position PDA)
          init Position { size, entry_price, entry_funding_index }
          ua.margin_used += required_initial_margin
          ua.position_count += 1
      → if adding to existing:
          new_entry = weighted_average(old, new)
          ua.margin_used += additional_margin
      → if reducing:
          realized_pnl = size * price_diff * quote_lot_size
          ua.collateral += realized_pnl
          ua.margin_used -= proportional_margin
      → if flipping:
          close old side, realize PnL
          open new side at fill price

Accounts:
  user_account PDA (writable)
  position PDA (writable)
  market_config PDA
  funding_state PDA (writable)
  orderbook_program (signer — CPI caller)
  system_program
```

---

orderbook_program::claim_fill

```
Called by:   Maker (after being filled)
CPI:         risk_program::settle_fill (maker side)

What it does:
  Maker was filled during someone else's place_order
  Their OO slot has is_filled=1, filled_qty, fill_price recorded
  Maker calls claim_fill to settle their position with risk_program
  After claiming, OO slot is cleared (freed if maker_out, reset if partial)

Flow:
  Maker TX
    → orderbook_program::claim_fill
      → load OO account — verify owner
      → validate slot — is_filled must be 1
      → reconstruct FillEvent from OO slot data
      → CPI → risk_program::settle_fill(fill, is_taker=false)
      → clear fill state:
          if maker_out (fully consumed): OO slot = default (freed)
          if partial fill: filled_qty=0, fill_price=0, is_filled=0

Accounts:
  signer (maker, signer)
  open_orders_account PDA (writable)
  market_state PDA
  maker_user_account PDA (writable)
  maker_position PDA (writable)
  market_config PDA
  funding_state PDA (writable)
  orderbook_program_self
  risk_program
  system_program
```

---

orderbook_program::place_take_order

```
Called by:   User (or strategy_program/trigger_program via CPI)
CPI:         risk_program::settle_fill (per fill)

What it does:
  Identical to place_order but NEVER posts remainder to book
  For Market, IOC, FillOrKill order types only
  Resting order types (Limit, PostOnly) rejected
  time_in_force hardcoded to 0 (taker never rests)
  Simpler than place_order — no post_target logic

Flow:
  TX
    → orderbook_program::place_take_order
      → validate order_type is taker-only (Market/IOC/FOK)
      → book.new_order() — matching loop
      → for each fill:
          maker_oo.record_fill(...)
          CPI → risk_program::settle_fill(is_taker=true)
      → assert result.order_id is None (never posted)

Accounts:
  same as place_order
  no prune/evict/insert steps
```

---

orderbook_program::cancel_order

```
Called by:   User
CPI:         None

What it does:
  Removes a specific resting limit order from the BookSide
  Frees the OO account slot
  No position change — cancelling order releases no margin
  (margin is locked at position open, not at order placement)
  Validates order exists in OO account before touching critbit tree

Flow:
  User TX
    → orderbook_program::cancel_order
      → verify OO account (owner, market)
      → find order_id in OO account → fail early if not found
      → bookside.remove_by_key(order_id) ← critbit deletion
      → OO account.remove_order(slot) ← free the slot

Accounts:
  signer (user, signer)
  open_orders_account PDA (writable)
  market_state PDA  ← read only (bids/asks verification)
  bids PDA (writable)
  asks PDA (writable)
```

---

orderbook_program::cancel_order_by_client_id

```
Called by:   User
CPI:         None

What it does:
  Same as cancel_order but user passes client_order_id (u64) instead of order_id (u128)
  Looks up order_id from OO account using client_id
  More user-friendly — client_id is user-defined and easier to track
  Two-step: scan OO (O(24)) then critbit remove (O(log n))

Flow:
  User TX
    → orderbook_program::cancel_order_by_client_id
      → find_order_with_client_id(client_id) → get slot
      → read order_id and side from OO slot
      → bookside.remove_by_key(order_id)
      → OO account.remove_order(slot)

Accounts:
  signer (user, signer)
  open_orders_account PDA (writable)
  market_state PDA
  bids PDA (writable)
  asks PDA (writable)
```

---

orderbook_program::cancel_all_orders

```
Called by:   User (or strategy_program via CPI for emergency exit)
CPI:         None

What it does:
  Cancels all resting orders for a user on a market
  Optional filters: side (bids only, asks only, both)
  Optional filter: client_id (cancel only orders with this tag)
  limit param: max cancels per TX (default = all 24 slots)
  Critical for market makers — emergency cancel all in one TX

Flow:
  User TX
    → orderbook_program::cancel_all_orders
      → iterate all 24 OO slots
      → for each occupied slot:
          apply side_filter if set
          apply client_id_filter if set
          if limit reached: stop
          bookside.remove_by_key(order_id)
          OO account.remove_order(slot)

Accounts:
  signer (user, signer)
  open_orders_account PDA (writable)
  market_state PDA
  bids PDA (writable)
  asks PDA (writable)
```

---

orderbook_program::edit_order

```
Called by:   User
CPI:         risk_program::settle_fill (if new order crosses)

What it does:
  Atomic cancel + replace in a single transaction
  No gap in liquidity — critical for market makers repricing
  If original order already filled: still tries to place new order
  New order can be different price, size, or type
  Only resting order types allowed (Limit, PostOnly, PostOnlySlide)

Flow:
  User TX
    → orderbook_program::edit_order
      → validate new params (price > 0, size > 0)
      → cancel_order(order_id, side)
          handle OrderIdNotFound gracefully (already filled)
      → book.new_order(new_order) ← may cross and fill
      → for each fill: settle same as place_order
      → post remainder to book if limit type

Accounts:
  signer (user, signer, writable)
  open_orders_account PDA (writable)
  market_state PDA (writable)
  bids PDA (writable)
  asks PDA (writable)
  taker_user_account PDA (writable)
  taker_position PDA (writable)
  market_config PDA
  funding_state PDA (writable)
  orderbook_program_self
  risk_program
  system_program
  remaining[]: maker OO accounts per fill
```

---

--- POSITION MANAGEMENT ---

risk_program::open_position

```
Called by:   User (direct position open, bypasses orderbook)
CPI:         None

What it does:
  Opens a long or short position at current oracle price
  Validates leverage within market limits
  Calculates required initial margin
  Checks free_collateral >= required_margin
  Creates Position PDA
  Locks margin in UserAccount

Flow:
  User TX
    → risk_program::open_position
      → load MarketConfig
      → validate_pyth_price(oracle) ← staleness + confidence
      → compute required_margin = notional * initial_margin_bps / 10_000
      → check ua.free_collateral >= required_margin
      → CreateAccount (Position PDA)
      → init Position { size, entry_price, entry_funding_index }
      → ua.margin_used += required_margin
      → ua.position_count += 1

Accounts:
signer,
user_account,
position,
market_config,
funding_state,
oracle,
system_program

Note:
  Most positions opened via place_order → settle_fill (CPI path)
  open_position is for direct OTC-style opens or testing
```

---

risk_program::close_position

```
Called by:   User
CPI:         None

What it does:
  Closes all or part of an open position at oracle mark price
  Realizes PnL into collateral (positive or negative)
  Releases proportional margin back to free collateral
  Always settles funding before closing

Flow:
  User TX
    → risk_program::close_position
      → load MarketConfig + validate oracle
      → load Position — verify owner + market + size > 0
      → settle_funding_internal() ← ALWAYS first
      → compute realized_pnl:
          long: size * (mark_price - entry_price) * quote_lot_size
          short: size * (entry_price - mark_price) * quote_lot_size
      → compute margin_to_release (proportional to close_size)
      → ua.collateral += realized_pnl  ← may be negative
      → ua.margin_used -= margin_to_release
      → if full close: pos.size=0, ua.position_count -= 1
      → if partial: pos.size -= close_size, pos.initial_margin -= released

Accounts:
signer,
user_account,
position,
market_config,
funding_state,
oracle
```

---

risk_program::add_margin

```
Called by:   User
CPI:         None

What it does:
  Moves free collateral into a specific position's margin
  Makes position safer — increases buffer before liquidation
  No token transfer — pure internal accounting
  ua.margin_used increases, free_collateral decreases

Flow:
  User TX
    → risk_program::add_margin
      → verify ua.free_collateral >= amount
      → ua.margin_used += amount
      → pos.initial_margin += amount

Accounts:
signer,
user_account,
position,
market_config

```

---

risk_program::remove_margin

```
Called by:   User
CPI:         None

What it does:
  Moves margin from position back to free collateral
  Must verify position stays above maintenance_margin after removal
  Oracle price validated — ensures not removing during extreme move
  ua.margin_used decreases, free_collateral increases

Flow:
  User TX
    → risk_program::remove_margin
      → validate_pyth_price(oracle)
      → verify new_margin = pos.initial_margin - amount >= maintenance_margin
      → ua.margin_used -= amount
      → pos.initial_margin -= amount

Accounts:
signer,
user_account,
position,
market_config,
oracle
```

---

risk_program::withdraw

```
Called by:   User
CPI:         token_program::transfer

What it does:
  Transfers USDC from vault back to user's ATA
  Can only withdraw free_collateral (collateral - margin_used)
  Vault authority PDA signs the transfer
  No oracle needed — withdrawable is based on locked margin only

Flow:
  User TX
    → risk_program::withdraw
      → verify amount <= ua.free_collateral()
      → ua.collateral -= amount
      → token_program::transfer (vault → user ATA)
          signed by vault_authority PDA

Accounts:
signer,
user_account,
user_token_account,
vault,
vault_authority,
token_program
```

---

--- FUNDING SYSTEM ---

risk_program::update_funding_rate

```
Called by:   Funding crank keeper (permissionless, hourly)
CPI:         None

What it does:
  Reads oracle index price and off-chain mark price
  Computes funding rate = (mark - index) / index (clamped to ±5%)
  Scales rate by elapsed time since last update
  Increments FundingState.cumulative_index
  Fails if called too soon (FUNDING_INTERVAL_SECS not elapsed)

Flow:
  Keeper TX (every FUNDING_INTERVAL_SECS, e.g. 3600s)
    → risk_program::update_funding_rate
      → verify elapsed >= FUNDING_INTERVAL_SECS
      → validate_pyth_price(oracle) ← index price
      → validate mark_price within 5% of oracle
      → rate_bps = funding_rate_bps(mark_price, index_price)
      → scaled_rate = rate_bps * elapsed / FUNDING_PERIOD_SECS
      → funding.apply_funding_rate(scaled_rate, now_ts)
      → funding.cumulative_index += scaled_rate
      → funding.last_updated = now_ts

Accounts:
  cranker (signer)
  market_config PDA
  funding_state PDA (writable)
  oracle (Pyth)
```

---

risk_program::settle_funding

```
Called by:   User (explicit) or internally before any position change
CPI:         None

What it does:
  Settles accrued funding from FundingState into UserAccount.collateral
  funding_owed = position.size * (cumulative_index - entry_funding_index) * quote_lot_size
  Positive = long pays, short receives
  Negative = short pays, long receives
  Updates position.entry_funding_index = current cumulative_index

Flow:
  User TX (or internal call)
    → risk_program::settle_funding
      → load Position + FundingState
      → settle_funding_internal():
          funding_owed = size * index_diff * quote_lot_size
          ua.collateral -= funding_owed
          pos.entry_funding_index = funding.cumulative_index

Accounts:
signer,
user_account,
position,
market_config,
funding_state,

Note:
  Called automatically before every position change:
    open_position, close_position, settle_fill, liquidate, cover_bad_debt
```

---

--- LIQUIDATION SYSTEM ---

risk_program::liquidate

```
Called by:   Liquidation bot keeper/Liquidator (permissionless)
CPI:         Token Transfer from vault to liquidator

What it does:
  Liquidates an undercollateralized position
  Checks equity < maintenance_margin at current oracle price
  Distributes liquidation fee: 75% liquidator, 25% insurance fund
  Solvent liquidation: fee deducted from user collateral
  Insolvent liquidation: insurance fund covers shortfall
  Zeroes out position and releases margin

Flow:
  Liquidator bot TX (when health_factor < 1.0)
    → risk_program::liquidate
      → validate_pyth_price(oracle)
      → load Position + UserAccount
      → settle_funding_internal() ← ALWAYS first
      → compute maintenance_margin at mark_price
      → compute equity = collateral + unrealized_pnl
      → verify equity < maintenance_margin ← revert if healthy
      → compute total_fee = notional * liquidation_fee_bps / 10_000
      → liquidator_reward = fee * 75%
      → insurance_fee = fee * 25%
      → if solvent (collateral >= total_fee):
          ua.collateral -= total_fee
          insurance_fund.collect(insurance_fee)
      → if insolvent:
          shortfall = total_fee - collateral
          uncovered = insurance_fund.cover_bad_debt(shortfall)
          ua.collateral = 0
          if uncovered > 0: return Err(InsuranceFundDepleted) ← triggers ADL
      → pos.size = 0, pos.initial_margin = 0
      → ua.margin_used -= initial_margin
      → ua.position_count -= 1

Accounts:
  liquidator (signer)
  user_account PDA (writable)
  position PDA (writable)
  market_config PDA
  funding_state PDA (writable)
  insurance_fund PDA (writable)
  vault,
  vault_authority,
  liquidator_token_account,
  oracle,
  token_program,
```

---

risk_program::cover_bad_debt

```
Called by:   Anyone (permissionless, after extreme price moves)
CPI:         None

What it does:
  Called when a position's equity is ALREADY NEGATIVE
  (liquidate was not called in time — price moved too fast)
  Insurance fund absorbs the shortfall
  If fund depleted: returns error to signal ADL needed

Flow:
  TX
    → risk_program::cover_bad_debt
      → validate_pyth_price(oracle)
      → load Position + UserAccount
      → settle_funding_internal()
      → compute equity = collateral + unrealized_pnl
      → verify equity < 0 ← must be in actual bad debt
      → shortfall = abs(equity)
      → uncovered = insurance_fund.cover_bad_debt(shortfall)
      → ua.collateral = 0
      → pos.size = 0, pos.initial_margin = 0
      → ua.margin_used -= initial_margin
      → ua.position_count -= 1
      → if uncovered > 0: Err(InsuranceFundDepleted) ← ADL signal

Accounts:
caller,       // liquidator bot or anyone — permissionless
user_account, // underwater account
position,     // underwater position
market_config,
funding_state,
insurance_fund,
oracle,

Difference from liquidate:
  liquidate:       equity < maintenance_margin (approaching danger)
  cover_bad_debt:  equity < 0 (already in the red)
```

---

--- ORDERBOOK MAINTAINANCE ---

orderbook_program::prune_orders

```
Called by:   Keeper (permissionless)
CPI:         None

What it does:
  Removes expired TIF (time-in-force) orders from the BookSide
  Uses find_earliest_expiry() in critbit tree — efficient O(log n) scan
  limit param prevents CU overflow (default 8 per call)
  Does NOT touch OpenOrdersAccount (stale slots cleaned lazily on next user tx)

Flow:
  Keeper TX (periodically)
    → orderbook_program::prune_orders
      → load bids/asks — verify belong to market
      → if side == 0 or 255: prune bids
          while pruned < limit:
            bookside.remove_one_expired(now_ts)
      → if side == 1 or 255: prune asks
          same loop

Accounts:
  keeper (signer)
  market_state PDA
  bids PDA (writable)
  asks PDA (writable)
```

---

--- TRIGGER SYSTEM ---

trigger_program::place_trigger_order

```
Called by:   User directly OR strategy_program via CPI
CPI:         None

What it does:
  Creates TriggerOrder PDA on-chain
  Stores trigger_price, trigger_type (StopLoss/TakeProfit), side, size
  Status = Active
  Keeper monitors price and calls execute_trigger when condition met

Trigger logic:
  StopLoss  + Sell (Long SL)  → fires when mark_price <= trigger_price
  TakeProfit + Sell (Long TP) → fires when mark_price >= trigger_price
  StopLoss  + Buy  (Short SL) → fires when mark_price >= trigger_price
  TakeProfit + Buy  (Short TP) → fires when mark_price <= trigger_price

Flow:
  User TX (or CPI from strategy_program)
    → trigger_program::place_trigger_order
      → validate trigger_price > 0, size > 0
      → derive + verify TriggerOrder PDA
      → CreateAccount (TriggerOrder PDA)
      → init TriggerOrder { trigger_price, trigger_type, side, size, status: Active }

Accounts:
  signer (user, signer, writable)
  trigger_order PDA (writable)
  open_orders_account
  system_program

PDA seeds:
  ["trigger_order", owner, client_order_id, bump]
```

---

trigger_program::execute_trigger

```
Called by:   Trigger keeper (permissionless, when price crosses)
CPI:         orderbook_program::place_take_order

What it does:
  Validates price condition is actually met on-chain
  Cannot be called unless trigger condition is true
  Calls place_take_order (market order) to execute the SL/TP
  Marks trigger as Executed after successful CPI
  Prevents double execution — status check at start

Flow:
  Keeper TX (when mark_price crosses trigger_price)
    → trigger_program::execute_trigger
      → load TriggerOrder — verify status == Active
      → check expiry — if expired: cancel + return
      → validate_pyth_price(oracle) ← get mark_price
      → verify order.should_trigger(mark_price) ← on-chain validation
      → CPI → orderbook_program::place_take_order (market order)
          side = trigger.side
          size = trigger.size_lots
          type = Market
      → trigger.status = Executed

Accounts:
  keeper (signer)
  trigger_order PDA (writable)
  trigger_authority
  market_state PDA (writable)
  open_orders_account PDA (writable)
  bids PDA (writable)
  asks PDA (writable)
  market_config PDA
  funding_state PDA (writable)
  user_account PDA (writable)
  position PDA (writable)
  oracle (Pyth)
  orderbook_program
  risk_program
  system_program

CPI depth: trigger(1) → orderbook(2) → risk_program(3) → system(4) ← at limit
```

---

trigger_program::cancel_trigger_order

```
Called by:   User
CPI:         None

What it does:
  Sets TriggerOrder.status = Cancelled
  Keeper will skip cancelled orders
  Account remains on-chain (user can close later for rent)

Flow:
  User TX
    → trigger_program::cancel_trigger_order
      → verify owner
      → verify status == Active ← can't cancel already executed
      → trigger.status = Cancelled

Accounts:
signer,
trigger_order

```

---

trigger_program::prune_expired_triggers

```
Called by:   Keeper (permissionless)
CPI:         None

What it does:
  Iterates trigger order accounts passed as remaining_accounts
  Marks expired ones as Cancelled (status = 2)
  Keeper passes batch of trigger PDAs to check

Flow:
  Keeper TX (periodically)
    → trigger_program::prune_expired_triggers
      → for each account in remaining_accounts:
          verify owned by trigger_program
          load TriggerOrder
          if Active and expired: status = Cancelled

Accounts:
keeper

```

---

--- STRATEGY SYSTEM ---
strategy_program::create_strategy

```
Called by:   User
CPI:         None

What it does:
  Creates StrategyAccount PDA storing strategy configuration
  Stores: strategy_type (RSI/EMA/RangeDCA/SR/SmartMoney)
  Stores: size_lots, limit_price, SL/TP prices
  Stores: cooldown_secs, max_executions_per_day
  Stores: strategy-specific params (RSI period, EMA periods, etc.)
  Status = Active

Flow:
  User TX
    → strategy_program::create_strategy
      → validate params (size > 0, valid strategy_type)
      → derive + verify StrategyAccount PDA
      → CreateAccount (StrategyAccount PDA)
      → init StrategyAccount { all params, status: Active }

PDA seeds:
  ["strategy", owner, market_index, strategy_type, bump]
  — allows one strategy per type per market per user

Accounts:
signer,
strategy_account,
system_program
```

---

strategy_program::execute_strategy

```
Called by:   Strategy keeper (permissionless, when signal fires)
CPI:         orderbook_program::place_order (or place_take_order)
             trigger_program::place_trigger_order (if SL/TP set)

What it does:
  Validates cooldown elapsed since last execution
  Validates daily execution cap not reached
  Validates strategy is Active
  Places order via CPI to orderbook_program
  Registers SL/TP triggers via CPI to trigger_program
  Updates last_executed_ts and executions_today

How signal gets here:
  Off-chain keeper evaluates RSI/EMA/SMC using candle data
  If signal != Hold: submits execute_strategy TX with signal param
  On-chain program validates cooldown + cap, then executes
  Signal computation is off-chain but execution is on-chain

Flow:
  Keeper TX (when off-chain signal fires)
    → strategy_program::execute_strategy
      → load StrategyAccount — verify status == Active
      → verify cooldown: now_ts - last_executed_ts >= cooldown_secs
      → verify daily cap: executions_today < max_executions_per_day
          reset counter if new day (elapsed >= 86400s)
      → validate signal (0=Buy, 1=Sell)
      → CPI → orderbook_program::place_order OR place_take_order
          side from signal
          size from strategy.size_lots
          price from strategy.limit_price_lots
      → if strategy.take_profit_price > 0:
          CPI → trigger_program::place_trigger_order(TakeProfit)
      → if strategy.stop_loss_price > 0:
          CPI → trigger_program::place_trigger_order(StopLoss)
      → strategy.last_executed_ts = now_ts
      → strategy.executions_today += 1

Accounts:
  keeper (signer)
  strategy_authority
  strategy_account PDA (writable)
  orderbook_program
  open_orders_account PDA (writable)
  market_state PDA (writable)
  bids PDA (writable)
  asks PDA (writable)
  market_config PDA
  funding_state PDA (writable)
  user_account PDA (writable)
  position PDA (writable)
  risk_program
  orderbook_program
  system_program
  _remaining (
  trigger_program,
  trigger_tp_account, // for take profit
  trigger_sl_account, // for stop loss
  )

CPI depth:
  strategy(1) → orderbook(2) → risk_program(3) → system(4) ← at limit
  strategy(1) → trigger(2) → [no further CPI needed for place_trigger_order]
```

---

strategy_program::pause_strategy

```
Called by:   User
CPI:         None

What it does:
  Sets StrategyAccount.status = Paused (1)
  Keeper skips paused strategies
  Existing resting orders remain on book unchanged
  SL/TP triggers remain active

Flow:
  User TX
    → strategy_program::pause_strategy
      → verify owner
      → strategy.status = 1 (Paused)

Accounts:
signer,
strategy_account
```

---

strategy_program::resume_strategy

```
Called by:   User
CPI:         None

What it does:
  Sets StrategyAccount.status = Active (0)
  Keeper will begin evaluating signals again
  Cooldown continues from last_executed_ts

Flow:
  User TX
    → strategy_program::resume_strategy
      → verify owner
      → strategy.status = 0 (Active)

Accounts:
signer,
strategy_account
```

---

strategy_program::edit_strategy

```
Called by:   User
CPI:         None

What it does:
  Updates strategy configuration in-place
  Can change: size_lots, limit_price, SL/TP prices, cooldown, params
  Cannot change: owner, market_index, strategy_type
  Strategy must be Paused before editing (safety check)

Flow:
  User TX
    → strategy_program::edit_strategy
      → verify owner
      → verify strategy.status == Paused ← must pause first
      → validate new params
      → update fields in StrategyAccount

Accounts:
signer,
strategy_account
```

---

strategy_program::close_strategy

```
Called by:   User
CPI:         None

What it does:
  Closes StrategyAccount PDA, reclaims rent to user
  Strategy must be Paused or Completed
  Does NOT cancel existing orders or triggers
  User must cancel those separately before closing

Flow:
  User TX
    → strategy_program::close_strategy
      → verify owner
      → verify status != Active ← must pause first
      → transfer lamports back to signer
      → zero account data
      → account closed on-chain

Accounts:
signer,
strategy_account
```

---

--- COMPLETE CALL GRAPH ---

```
USER CALLS:
  deposit                → risk_program (token CPI)
  withdraw               → risk_program (token CPI)
  create_open_orders_account → orderbook_program
  place_order            → orderbook_program → risk_program (CPI per fill)
  place_take_order       → orderbook_program → risk_program (CPI per fill)
  claim_fill             → orderbook_program → risk_program (CPI)
  cancel_order           → orderbook_program
  cancel_order_by_client_id → orderbook_program
  cancel_all_orders      → orderbook_program
  edit_order             → orderbook_program → risk_program (CPI if fills)
  open_position          → risk_program
  close_position         → risk_program
  add_margin             → risk_program
  remove_margin          → risk_program
  place_trigger_order    → trigger_program
  cancel_trigger_order   → trigger_program
  create_strategy        → strategy_program
  pause_strategy         → strategy_program
  resume_strategy        → strategy_program
  edit_strategy          → strategy_program
  close_strategy         → strategy_program

KEEPER CALLS:
  update_funding_rate    → risk_program (hourly crank)
  settle_funding         → risk_program (optional, users can call too)
  liquidate              → risk_program
  cover_bad_debt         → risk_program
  prune_orders           → orderbook_program
  prune_expired_triggers → trigger_program
  execute_trigger        → trigger_program → orderbook_program → risk_program
  execute_strategy       → strategy_program → orderbook_program → risk_program
                                            → trigger_program

ADMIN CALLS (one time):
  initialize_insurance_fund → risk_program
  initialize_vault          → risk_program (token CPI)
  create_risk_market        → risk_program
  create_orderbook_market   → orderbook_program

CPI ONLY (never called directly):
  settle_fill            → risk_program (called by orderbook CPI only)
```

---

--- CALLER SUMMARY TABLE ---

```
Instruction                    Caller       Program
─────────────────────────────────────────────────────────
initialize_insurance_fund      Admin        risk_program
initialize_vault               Admin        risk_program
create_risk_market             Admin        risk_program
create_orderbook_market        Admin        orderbook_program
deposit                        User         risk_program
withdraw                       User         risk_program
create_open_orders_account     User         orderbook_program
place_order                    User         orderbook_program
place_take_order               User/CPI     orderbook_program
claim_fill                     User         orderbook_program
cancel_order                   User         orderbook_program
cancel_order_by_client_id      User         orderbook_program
cancel_all_orders              User         orderbook_program
edit_order                     User         orderbook_program
open_position                  User         risk_program
close_position                 User         risk_program
add_margin                     User         risk_program
remove_margin                  User         risk_program
settle_funding                 User/Keeper  risk_program
place_trigger_order            User/CPI     trigger_program
cancel_trigger_order           User         trigger_program
create_strategy                User         strategy_program
pause_strategy                 User         strategy_program
resume_strategy                User         strategy_program
edit_strategy                  User         strategy_program
close_strategy                 User         strategy_program
update_funding_rate            Keeper       risk_program
liquidate                      Keeper       risk_program
cover_bad_debt                 Keeper       risk_program
prune_orders                   Keeper       orderbook_program
prune_expired_triggers         Keeper       trigger_program
execute_trigger                Keeper       trigger_program
execute_strategy               Keeper       strategy_program
settle_fill                    CPI only     risk_program
```
