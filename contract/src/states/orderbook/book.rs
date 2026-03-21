use std::cell::RefMut;

use pinocchio::error::ProgramError;

use crate::{
    constants::{DROP_EXPIRED_ORDER_LIMIT, MAX_FILLS_PER_ORDER},
    errors::OrderBookError,
    states::{
        BookSide, FillEvent, LeafNode, MarketState, OpenOrdersAccount, Order, OrderTreeType, Side,
    },
};

pub struct Orderbook<'a> {
    pub bids: &'a mut BookSide,
    pub asks: &'a mut BookSide,
}

pub struct MatchResults {
    pub order_id: Option<[u8; 16]>,
    pub fill_count: u8,
    pub filled_base_lots: i64,
    pub posted_price: i64,
    pub fills: [FillEvent; MAX_FILLS_PER_ORDER],
}

impl Default for MatchResults {
    fn default() -> Self {
        Self {
            order_id: None,
            fill_count: 0,
            filled_base_lots: 0,
            posted_price: 0,
            fills: [FillEvent::default(); MAX_FILLS_PER_ORDER],
        }
    }
}

impl<'a> Orderbook<'a> {
    pub fn init(&mut self) {
        self.bids.nodes.order_tree_type = OrderTreeType::Bids.into();
        self.asks.nodes.order_tree_type = OrderTreeType::Asks.into();
    }

    pub fn is_empty(&self) -> bool {
        self.bids.is_empty() && self.asks.is_empty()
    }

    pub fn bookside(&self, side: Side) -> &BookSide {
        match side {
            Side::Bid => &self.bids,
            Side::Ask => &self.asks,
        }
    }

    pub fn bookside_mut(&mut self, side: Side) -> &mut BookSide {
        match side {
            Side::Bid => &mut self.bids,
            Side::Ask => &mut self.asks,
        }
    }
    pub fn new_order(
        &mut self,
        order: &Order,
        market: &mut MarketState,
        open_orders: &mut OpenOrdersAccount,
        now_ts: u64,
        mut limit: u8,
    ) -> Result<MatchResults, ProgramError> {
        let side = order.side;
        let other_side = side.invert_side();
        let post_only = order.is_post_only();
        let fill_or_kill = order.is_fill_or_kill();
        let mut post_target = order.post_target();

        // Compute price
        let (price_lots, price_data) = order.price(now_ts, self)?;

        // Generate order ID
        let order_id = market.generate_order_id(side, price_data);

        // Validate lot sizes
        if order.max_base_lots > market.max_base_lots() {
            return Err(OrderBookError::InvalidInputLotsSize.into());
        }

        let mut remaining_base_lots = order.max_base_lots;
        let mut remaining_quote_lots = order.max_quote_lots;

        // Fixed-size stack arrays — no heap allocation
        let mut matched_changes: [(u128, i64); MAX_FILLS_PER_ORDER] = [(0, 0); MAX_FILLS_PER_ORDER];
        let mut matched_changes_count: usize = 0;

        let mut matched_deletes: [u128; MAX_FILLS_PER_ORDER] = [0; MAX_FILLS_PER_ORDER];
        let mut matched_deletes_count: usize = 0;

        let mut result = MatchResults::default();
        let mut dropped_expired: usize = 0;

        // ── Matching Loop ─────────────────────────────────────────────
        {
            let opposing = self.bookside_mut(other_side);

            for best_opposing in opposing.iter_all_including_invalid(now_ts) {
                if remaining_base_lots == 0 || remaining_quote_lots == 0 {
                    break;
                }

                // Handle expired orders
                if !best_opposing.is_valid() {
                    if dropped_expired < DROP_EXPIRED_ORDER_LIMIT {
                        dropped_expired += 1;
                        if matched_deletes_count < MAX_FILLS_PER_ORDER {
                            matched_deletes[matched_deletes_count] =
                                u128::from_le_bytes(best_opposing.node.key);
                            matched_deletes_count += 1;
                        }
                    }
                    continue;
                }

                let best_opposing_price = best_opposing.price_lots;

                // Price no longer crosses
                if !side.is_price_within_limit(best_opposing_price, price_lots) {
                    break;
                }

                // PostOnly — cancel silently
                if post_only {
                    post_target = None;
                    break;
                }

                // Fill limit reached
                if limit == 0 {
                    post_target = None;
                    break;
                }

                // Self-trade — abort
                if best_opposing.node.owner == open_orders.owner {
                    return Err(OrderBookError::WouldSelfTrade.into());
                }

                let max_match_by_quote = remaining_quote_lots / best_opposing_price;
                if max_match_by_quote == 0 {
                    post_target = None;
                    break;
                }

                let match_base_lots = remaining_base_lots
                    .min(best_opposing.node.quantity)
                    .min(max_match_by_quote);
                let match_quote_lots = match_base_lots * best_opposing_price;

                remaining_base_lots = remaining_base_lots
                    .checked_sub(match_base_lots)
                    .ok_or(ProgramError::ArithmeticOverflow)?;
                remaining_quote_lots = remaining_quote_lots
                    .checked_sub(match_quote_lots)
                    .ok_or(ProgramError::ArithmeticOverflow)?;

                let new_opposing_qty = best_opposing.node.quantity - match_base_lots;
                let maker_out = new_opposing_qty == 0;

                if maker_out {
                    if matched_deletes_count < MAX_FILLS_PER_ORDER {
                        matched_deletes[matched_deletes_count] =
                            u128::from_le_bytes(best_opposing.node.key);
                        matched_deletes_count += 1;
                    }
                } else {
                    if matched_changes_count < MAX_FILLS_PER_ORDER {
                        matched_changes[matched_changes_count] = (
                            u128::from_le_bytes(best_opposing.node.key),
                            new_opposing_qty,
                        );
                        matched_changes_count += 1;
                    }
                }

                // Record fill in result
                if (result.fill_count as usize) < MAX_FILLS_PER_ORDER {
                    let idx = result.fill_count as usize;
                    result.fills[idx] = FillEvent::new(
                        side,                               // taker_side: Side
                        maker_out,                          // maker_out: bool
                        best_opposing.node.owner_slot,      // maker_slot: u8
                        now_ts,                             // timestamp: u64
                        market.seq_num,                     // seq_num: u64
                        best_opposing.node.timestamp,       // maker_timestamp: u64
                        best_opposing.node.client_order_id, // maker_client_order_id: u64
                        order.client_order_id,              // taker_client_order_id: u64
                        best_opposing_price,                // price: i64
                        match_base_lots,                    // quantity: i64
                        best_opposing.node.owner,           // maker_pubkey: [u8;32]
                        open_orders.owner,                  // taker_pubkey: [u8;32]
                    );
                    result.fill_count += 1;
                }

                limit -= 1;
            }
        } // opposing borrow dropped here

        result.filled_base_lots = order
            .max_base_lots
            .checked_sub(remaining_base_lots)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        // FillOrKill check
        if fill_or_kill && result.filled_base_lots < order.max_base_lots {
            return Err(OrderBookError::WouldExecutePartially.into());
        }

        // Apply changes — safe now, loop is done
        {
            let opposing = self.bookside_mut(other_side);

            for i in 0..matched_changes_count {
                let (key, new_qty) = matched_changes[i];
                if let Some(leaf) = opposing.node_mut_by_key(key) {
                    leaf.quantity = new_qty;
                }
            }

            for i in 0..matched_deletes_count {
                opposing.remove_by_key(matched_deletes[i]);
            }
        }

        // ── Post Remainder ────────────────────────────────────────────
        let book_base_quantity_lots = if price_lots > 0 {
            remaining_base_lots.min(remaining_quote_lots / price_lots)
        } else {
            0
        };

        if book_base_quantity_lots <= 0 {
            post_target = None;
        }

        let mut posted_price = 0_i64;

        if post_target.is_some() {
            if book_base_quantity_lots
                .checked_mul(price_lots)
                .ok_or(ProgramError::ArithmeticOverflow)?
                > market.max_quote_lots()
            {
                return Err(OrderBookError::InvalidPostAmount.into());
            }

            let bookside = self.bookside_mut(side);

            // Make room — drop one expired order
            bookside.remove_one_expired(now_ts);

            // Book full — evict worst if our price is better
            if bookside.is_full() {
                let (worst_order, worst_price) = bookside
                    .remove_worst(now_ts)
                    .ok_or(OrderBookError::BookFull)?;

                if !side.is_price_better(price_lots, worst_price) {
                    return Err(OrderBookError::BookFull.into());
                }
            }

            let owner_slot = open_orders.next_order_slot()?;

            let new_leaf = LeafNode::new(
                owner_slot as u8,
                0,
                order.client_order_id,
                book_base_quantity_lots,
                now_ts,
                order_id,
                open_orders.owner,
            );

            bookside.insert_leaf(&new_leaf)?;

            open_orders.add_order(
                side,
                &new_leaf,
                order.client_order_id,
                price_lots,
                owner_slot,
            );

            posted_price = price_lots;
            result.order_id = Some(order_id.to_le_bytes());
        }

        result.posted_price = posted_price;

        Ok(result)
    }

    pub fn cancel_order(
        &mut self,
        open_orders: &mut OpenOrdersAccount,
        order_id: u128,
        side: Side,
        expected_owner: Option<[u8; 32]>,
    ) -> Result<LeafNode, ProgramError> {
        let leaf = self
            .bookside_mut(side)
            .remove_by_key(order_id)
            .ok_or(OrderBookError::OrderIdNotFound)?;

        if let Some(owner) = expected_owner {
            if leaf.owner != owner {
                return Err(OrderBookError::InvalidOwner.into());
            }
        }

        open_orders.remove_order(leaf.owner_slot as usize);
        Ok(leaf)
    }

    pub fn cancel_all_orders(
        &mut self,
        open_orders: &mut OpenOrdersAccount,
        side_filter: Option<Side>,
        client_id_filter: Option<u64>,
        mut limit: u8,
    ) -> Result<i64, ProgramError> {
        let mut total_quantity = 0_i64;

        for i in 0..open_orders.open_orders.len() {
            let oo = open_orders.open_orders[i];

            if oo.is_free() || limit == 0 {
                continue;
            }

            if let Some(side) = side_filter {
                if oo.side() != side {
                    continue;
                }
            }

            if let Some(client_id) = client_id_filter {
                if u64::from_le_bytes(oo.client_id) != client_id {
                    continue;
                }
            }

            let order_id = oo.id;
            let side = oo.side();

            match self.cancel_order(open_orders, u128::from_le_bytes(order_id), side, None) {
                Ok(leaf) => {
                    total_quantity = total_quantity
                        .checked_add(leaf.quantity)
                        .ok_or(ProgramError::ArithmeticOverflow)?;
                    limit -= 1;
                }
                Err(_) => continue,
            }
        }

        Ok(total_quantity)
    }
}
