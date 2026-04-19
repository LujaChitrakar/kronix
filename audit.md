Kronix Audit — Bug Report

CRITICAL (breaks core flow — must fix before launch)

1. settle_fill_cpi account order vs process_settle_fill destructure — mismatch(DONE)

orderbook_program/src/cpi.rs:40-47 passes metas as [orderbook_program, user_account, position, market_config, funding_state, system_program] — matches Shank IDL
(risk_program/src/instructions/mod.rs:100-106).
risk_program/src/instructions/settle_fill.rs:35-46 destructures in WRONG order: [user_account, position, market_config, funding_state, orderbook_program, system_program].
Result: every settle_fill CPI reads wrong accounts. verify_signer(orderbook_program) runs on slot 4 which is actually funding_state. Entire taker-fill + claim-fill path broken. Fix by
reordering destructure to match CPI / Shank order.

2. settle_fill uses orderbook_program as system-CreateAccount from
   (DONE)
   risk_program/src/instructions/settle_fill.rs:103, 153:
   CreateAccount { from: orderbook_program, to: user_account, ... }
   orderbook_program is BPF executable (owned by loader), not system-owned, not signer in CPI. System CreateAccount requires from to be system-owned signer with lamports. Will fail every time a
   new UserAccount/Position must be created during a fill. Fix: pass a fee-payer (signer) account through orderbook → risk CPI, or change flow so user creates these PDAs upfront (e.g. during
   open_orders creation or first deposit).

3. Liquidation never realizes loss
(DONE)
risk_program/src/instructions/liquidate.rs:112-186: computes unrealised_pnl for health check (equity = collateral + pnl) then zeroes position without ever subtracting loss from collateral.
User keeps pre-liquidation collateral minus only the liquidation fee. Protocol grants free money on every liquidation. Fix: before zeroing, collateral += unrealised_pnl (pnl negative → loss
applied).

4. Funding formula missing price and bps conversion
(NOT NEEDED)
risk_program/src/state/funding_state.rs:29-36:
funding_owed = size _ index_diff _ quote_lot_size
Missing entry_price (or mark_price) and / 10_000 bps conversion. index_diff is raw accumulated bps. Correct magnitude: size _ price _ quote_lot_size \* index_diff / 10_000. Current code off
by a factor of price_lots × 10_000 — meaningless funding transfers of massive magnitude.

5. Oracle validation disabled
(LATER)
risk_program/src/oracle.rs:30-32, 52-60 and trigger_program/src/oracle.rs same:

- feed_id check commented out → any Pyth-like account accepted.
- publish_time staleness check commented out → stale/manipulated prices accepted.
- conf read but never validated vs MAX_CONF_RATIO_BPS.
- market_config.oracle field stored but never compared against the oracle AccountView passed in any ix (liquidate, open_position, close_position, update_funding_rate, cover_bad_debt).
  Consequence: attacker substitutes any account with a valid-shaped price field and sets mark_price freely → forced liquidations, phantom profits. Fix: uncomment validations AND enforce
  oracle.address() == market_config.oracle.

6. Insurance fund token accounting phantom
(NO NEED)
risk_program/src/instructions/liquidate.rs:153-165: on solvent liquidation, insurance_state.collect(insurance_fee) increments a counter only — no token movement to an insurance vault.
liquidator_reward is transferred out of main vault. User collateral debited by total_fee (reward + insurance). Vault loses only liquidator_reward. On cover_bad_debt,
insurance_state.cover_bad_debt(shortfall) decrements counter but again no real token transfer to user to cover loss. Vault tokens never flow against insurance bookkeeping.
Result: solvency drift. Insurance balance grows as bookkeeping but isn't backed by segregated tokens. Bad-debt "cover" zeros user collateral without actually reimbursing counterparty.
Fix: separate insurance vault OR transfer insurance_fee from main vault to an insurance escrow; cover_bad_debt must move tokens to offset real losses.

HIGH

7. claim_fill always fully clears slot on partial fill
(DONE)
orderbook_program/src/instructions/claim_fill.rs:135, 155-162:
let maker_out = oo.has_pending_fill() && oo.filled_qty > 0; // always true after any fill
if maker_out { \*oo_mut = OpenOrder::default(); }
Any pending fill (even partial) clears the slot — maker loses the resting remainder from on-chain book vs OO bookkeeping. Should be: maker_out = fill.maker_out() (set by matching engine when
new_opposing_qty == 0) or use a dedicated is_maker_out flag on OpenOrder.

8. record_fill overwrites instead of accumulating
(DONE)
orderbook_program/src/states/open_orders_account.rs:107-115:
oo.filled_qty = filled_qty; // overwrite
oo.fill_price = fill_price; // overwrite
If maker has two partial fills before claim_fill, second overwrites first → first fill's quantity + PnL lost permanently. Fix: accumulate filled_qty += filled_qty, store VWAP for price. Also
if maker_out { oo.is_free = 0 } dead — slot already occupied.

9. FillEvent.maker_out populated with inverted logic in claim_fill
(DONE)
claim_fill.rs:120: maker_out: if oo.filled_qty == 0 { 1 } else { 0 }. Filled_qty==0 is rejected above by has_pending_fill check, so maker_out always set to 0. Field currently unused in risk
settle_fill but still wrong.

10. Delegate not honored in cancel / edit paths
(DONE)
cancel_order.rs:74, cancel_order_by_client_id.rs, cancel_all_orders.rs:65, claim_fill.rs:84:
if signer.address().as_array() != &open_orders_account_owner {
return Err(ProgramError::InvalidAccountOwner);
}
Only owner may cancel/claim, contradicting place_order which allows delegate. Use is_owner_or_delegate for consistency.

11. edit_order swallows cancellation error broadly
(DONE)
orderbook*program/src/instructions/edit_order.rs:203: matches!(e, ProgramError::Custom(*)) treats ALL custom errors (including InvalidOwner) as "not found" and places new order anyway. Fix:
match specifically on OrderIdNotFound.

12. place_trigger_order has no signer↔OO relationship check
(DONE)
trigger_program/src/instructions/place_trigger_order.rs:103: stores open_orders_account without verifying signer == oo.owner nor oo.delegate == trigger_authority. Attackers can register
triggers on any OO. Benign on its own (execute rejected if delegate absent) but wastes rent and opens griefing on users who delegate to trigger_authority.

13. Global trigger_authority PDA = global delegate
(DONE)
trigger_program/src/constants.rs → TRIGGER_AUTHORITY_SEED = b"trigger_authority" (only one PDA for entire program). Any user who sets this as oo.delegate effectively lets anyone who creates
a trigger order act on their OO. Same problem applies to strategy_authority. Design should use per-user authority PDA ([b"trigger_authority", owner]) so delegation is scoped.

14. cancel_trigger_order / edit_trigger don't refund rent

cancel_trigger_order.rs, also execute_trigger.rs (expired path): status flipped to 2 but account not closed → user's trigger rent locked forever. Close and return lamports to owner.

15. Position.unrealised_pnl unchecked arithmetic

risk_program/src/state/position.rs:35-43: self.size \* price_diff unchecked → overflow wraps. Outer checked_mul(quote_lot_size).unwrap_or(i64::MIN) returns i64::MIN for any overflow, which
flows into equity check → false liquidation or bad-debt. Use i128 intermediates, checked math.

MEDIUM

16. VAULT_SEED missing mint

risk_program/src/constants.rs:6: VAULT_SEED = b"vault" — CLAUDE.md states [b"vault", mint, bump]. Only one vault per program; mint not enforced. If you ever add non-USDC collateral,
collision.

17. strategy_program::execute_strategy client_order_id collision

execute_strategy.rs:182: SL trigger uses strategy.client_order_id + 1 — but client_order_id.wrapping_add(1) is the NEXT strategy execution's main OID. Two consecutive executions: first SL =
N+1, next main = N+1 → duplicate client_order_id across trigger PDAs (same seed → collision) and duplicate order IDs in orderbook.

18. execute_strategy \_remaining[offset..] slicing wrong when only SL set

strategy_program/src/instructions/execute_strategy.rs:169:
let offset = if strategy.take_profit_price > 0 { 2 } else { 0 };
let [trigger_program, trigger_sl_account, ..] = &\_remaining[offset..]
When only SL is set (no TP), offset=0. But then \_remaining[0] is trigger_program (ok) — looks fine. When only TP set, SL branch is skipped. Actually logic OK but the offset reasoning is
fragile — refactor to pull accounts explicitly.

19. update_funding_rate uses off-chain mark_price but no floor/cap on interval math

risk_program/src/instructions/update_funding_rate.rs:96-99: scaled_rate = rate_bps \* elapsed / 28800. If cranker sleeps for e.g. 10 hours, elapsed=36000 → scaled_rate > rate_bps; if rate
capped at 500bps then scaled_rate = 625. Over many hours one crank can accumulate large jumps. Consider clamping elapsed_time to a max window or rejecting updates too far past interval.

20. match_quote_lots doesn't include quote_lot_size

orderbook_program/src/states/orderbook/book.rs:143: match_base_lots \* best_opposing_price. Whether this is correct depends on what max_quote_lots unit represents. Code treats it as base_lots
× price_lots (not including quote_lot_size). Consumer (place_take_order.max_quote_lots) must match this convention. Document — not a bug but easy to get wrong.

21. No CU-bounded loops

Orderbook matching limited by limit.min(MAX_FILLS_PER_ORDER=6) — fine. But cancel_all_orders loops MAX_OPEN_ORDERS=24 items, each invoking tree delete → potentially expensive. Not broken,
just watch CU.

LOW / hygiene

- risk_program/src/state/funding_state.rs:29: saturating_sub/saturating_mul mask silent overflow; use checked.
- risk_program/src/instructions/liquidate.rs:130-131: 75/100 + 25/100 = 100% — code comment says 75/20/5 split with 5% protocol but protocol cut missing entirely.
- risk_program/src/math.rs:17: checked_mul/add/sub helpers unused externally.
- orderbook_program/src/instructions/place_order.rs:209-243: settle_fill_cpi gated on maker_oo_account being present in \_remaining. If caller passes no maker OO accounts, fills are silently
  NOT settled — takers get the trade with no risk-side settlement. Should settle always; maker OO recording is the optional path.
- trigger/edit_trigger: new_trigger_price == 0 means "no change" but also means "remove trigger". Ambiguous — use explicit sentinel.
- strategy/execute_strategy: no check that strategy.side == params.signal — directional strategies accept any signal from keeper. Should enforce strategy.side for RSI/EMA, free for DCA/SR.
- orderbook/close_orderbook_market ix doesn't exist — orphaned time_expiry field with no cleanup path.
- create_open_orders_account.rs:23: owner passed as param, not derived from a signer — any payer can create OO for any owner. Not exploitable (owner can still cancel) but rent is paid by
  arbitrary party.
- PlaceTakeOrder is_signer=true on trigger_authority in trigger/cpi.rs:52 — good, but orderbook place_take_order doesn't verify signer == trigger_authority — relies on OO delegate check.

Coverage gaps / recommendations

- Unit tests exist for book/tree logic; no integration tests for CPI flows (orderbook→risk, trigger→orderbook→risk, strategy→orderbook+trigger). All bug 1–6 would catch with one litesvm
  end-to-end.
- Oracle feed_id + staleness MUST be enabled before mainnet.
- Recommend: add #[cfg(feature = "devnet")] gate on commented oracle checks only if still iterating, never ship without.

Summary

Core trade flow (place_order → matching → settle_fill CPI) is broken by bug #1 (account order) + bug #2 (CreateAccount from executable). No fills have ever successfully settled with the
current code. Liquidation + funding math (bugs #3, #4) mean even if fills worked, PnL is wrong. Oracle (#5) means any price can be injected. These are the must-fix blockers.

Bugs #7–#9 corrupt maker accounting on partial fills. #10–#14 are access-control / rent-handling issues. #15 is a silent overflow that can trigger spurious liquidations.

✻ Worked for 2m 13s
