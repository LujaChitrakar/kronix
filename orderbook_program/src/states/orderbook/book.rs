use crate::{
    constants::{DROP_EXPIRED_ORDER_LIMIT, MAX_FILLS_PER_ORDER},
    errors::OrderBookError,
    states::{
        BookSide, FillEvent, LeafNode, MarketState, OpenOrdersAccount, Order, OrderTreeType, Side,
    },
};
use pinocchio::error::ProgramError;

pub struct Orderbook<'a> {
    pub bids: &'a mut BookSide,
    pub asks: &'a mut BookSide,
}

pub struct MatchResults {
    pub order_id: Option<[u8; 16]>,
    pub fill_count: u8,
    pub filled_base_lots: i64,
    pub posted_base_lots: i64,
    pub posted_price: i64,
    pub fills: [FillEvent; MAX_FILLS_PER_ORDER],
}

impl Default for MatchResults {
    fn default() -> Self {
        Self {
            order_id: None,
            fill_count: 0,
            filled_base_lots: 0,
            posted_base_lots: 0,
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

        let (price_lots, price_data) = order.price(now_ts, self)?;

        let order_id = market.generate_order_id(side, price_data);

        if order.max_base_lots > market.max_base_lots() {
            return Err(OrderBookError::InvalidInputLotsSize.into());
        }

        let mut remaining_base_lots = order.max_base_lots;
        let mut remaining_quote_lots = order.max_quote_lots;

        let mut matched_changes: [(u128, i64); MAX_FILLS_PER_ORDER] = [(0, 0); MAX_FILLS_PER_ORDER];
        let mut matched_changes_count: usize = 0;

        let mut matched_deletes: [u128; MAX_FILLS_PER_ORDER] = [0; MAX_FILLS_PER_ORDER];
        let mut matched_deletes_count: usize = 0;

        let mut result = MatchResults::default();
        let mut dropped_expired: usize = 0;
        {
            let opposing = self.bookside_mut(other_side);

            for best_opposing in opposing.iter_all_including_invalid(now_ts) {
                if remaining_base_lots == 0 || remaining_quote_lots == 0 {
                    break;
                }

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
        }

        result.filled_base_lots = order
            .max_base_lots
            .checked_sub(remaining_base_lots)
            .ok_or(ProgramError::ArithmeticOverflow)?;

        if fill_or_kill && result.filled_base_lots < order.max_base_lots {
            return Err(OrderBookError::WouldExecutePartially.into());
        }

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

            bookside.remove_one_expired(now_ts);

            // Book full — evict worst if our price is better
            if bookside.is_full() {
                let (_worst_order, worst_price) =
                    bookside.remove_worst().ok_or(OrderBookError::BookFull)?;

                if !side.is_price_better(price_lots, worst_price) {
                    return Err(OrderBookError::BookFull.into());
                }
            }

            let owner_slot = open_orders.next_order_slot()?;

            let new_leaf = LeafNode::new(
                owner_slot as u8,
                order.time_in_force,
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
            result.posted_base_lots = book_base_quantity_lots;
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
                if oo.client_id != client_id {
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

#[cfg(test)]
mod tests {
    use bytemuck::Zeroable;

    use crate::states::{OrderParams, PostOrderType};

    use super::*;

    fn make_market() -> MarketState {
        let mut m = MarketState::zeroed();
        m.base_lot_size = 1;
        m.quote_lot_size = 1;
        m.seq_num = 0;
        m
    }

    fn make_open_orders(owner: [u8; 32]) -> OpenOrdersAccount {
        let mut oo = OpenOrdersAccount::zeroed();
        oo.owner = owner;
        for slot in oo.open_orders.iter_mut() {
            slot.is_free = 1;
        }
        oo
    }

    fn make_orderbook<'a>(bids: &'a mut BookSide, asks: &'a mut BookSide) -> Orderbook<'a> {
        bids.nodes.order_tree_type = OrderTreeType::Bids.into();
        asks.nodes.order_tree_type = OrderTreeType::Asks.into();
        Orderbook { bids, asks }
    }

    fn limit_order(
        side: Side,
        price: i64,
        base_lots: i64,
        quote_lots: i64,
        client_id: u64,
    ) -> Order {
        Order {
            side,
            max_base_lots: base_lots,
            max_quote_lots: quote_lots,
            client_order_id: client_id,
            time_in_force: 0,
            params: OrderParams::Fixed {
                price_lots: price,
                order_type: PostOrderType::Limit,
            },
        }
    }

    fn market_order(side: Side, base_lots: i64, quote_lots: i64) -> Order {
        Order {
            side,
            max_base_lots: base_lots,
            max_quote_lots: quote_lots,
            client_order_id: 0,
            time_in_force: 0,
            params: OrderParams::Market,
        }
    }

    #[test]
    fn limit_order_posts_when_no_match() {
        let mut bids = BookSide::zeroed();
        let mut asks = BookSide::zeroed();
        let mut ob = make_orderbook(&mut bids, &mut asks);
        let mut mkt = make_market();
        let mut oo = make_open_orders([1u8; 32]);

        let order = limit_order(Side::Bid, 100, 10, 1000, 1);
        let result = ob.new_order(&order, &mut mkt, &mut oo, 1000, 8).unwrap();

        assert!(result.order_id.is_some());
        assert_eq!(result.fill_count, 0);
        assert_eq!(result.filled_base_lots, 0);
        assert_eq!(result.posted_price, 100);
        assert_eq!(ob.bids.roots.leaf_count, 1);
    }

    #[test]
    fn taker_fully_matches_resting_maker() {
        let mut bids = BookSide::zeroed();
        let mut asks = BookSide::zeroed();
        let mut mkt = make_market();

        // Place a resting ask at 100 for 10 lots
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut maker_oo = make_open_orders([1u8; 32]);
            let ask = limit_order(Side::Ask, 100, 10, 10000, 1);
            ob.new_order(&ask, &mut mkt, &mut maker_oo, 1000, 8)
                .unwrap();
        }
        assert_eq!(asks.roots.leaf_count, 1);

        // Taker bid matches against resting ask
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut taker_oo = make_open_orders([2u8; 32]);
            let bid = limit_order(Side::Bid, 100, 10, 10000, 2);
            let result = ob
                .new_order(&bid, &mut mkt, &mut taker_oo, 1000, 8)
                .unwrap();

            assert_eq!(result.fill_count, 1);
            assert_eq!(result.filled_base_lots, 10);
            assert_eq!(result.fills[0].price, 100);
            assert_eq!(result.fills[0].quantity, 10);
            assert!(result.fills[0].maker_out());
        }

        // Ask fully consumed
        assert_eq!(asks.roots.leaf_count, 0);
    }

    #[test]
    fn partial_match_remainder_posted() {
        let mut bids = BookSide::zeroed();
        let mut asks = BookSide::zeroed();
        let mut mkt = make_market();

        // Resting ask for 5 lots at 100
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut maker_oo = make_open_orders([1u8; 32]);
            let ask = limit_order(Side::Ask, 100, 5, 10000, 1);
            ob.new_order(&ask, &mut mkt, &mut maker_oo, 1000, 8)
                .unwrap();
        }

        // Taker bids for 10 lots — 5 filled, 5 posted
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut taker_oo = make_open_orders([2u8; 32]);
            let bid = limit_order(Side::Bid, 100, 10, 10000, 2);
            let result = ob
                .new_order(&bid, &mut mkt, &mut taker_oo, 1000, 8)
                .unwrap();

            assert_eq!(result.fill_count, 1);
            assert_eq!(result.filled_base_lots, 5);
            assert!(result.order_id.is_some()); // remainder posted
        }

        assert_eq!(asks.roots.leaf_count, 0); // ask consumed
        assert_eq!(bids.roots.leaf_count, 1); // remainder posted
    }

    #[test]
    fn no_match_when_price_does_not_cross() {
        let mut bids = BookSide::zeroed();
        let mut asks = BookSide::zeroed();
        let mut mkt = make_market();

        // Ask at 200
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut maker_oo = make_open_orders([1u8; 32]);
            let ask = limit_order(Side::Ask, 200, 10, 10000, 1);
            ob.new_order(&ask, &mut mkt, &mut maker_oo, 1000, 8)
                .unwrap();
        }

        // Bid at 100 — does not cross
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut taker_oo = make_open_orders([2u8; 32]);
            let bid = limit_order(Side::Bid, 100, 10, 10000, 2);
            let result = ob
                .new_order(&bid, &mut mkt, &mut taker_oo, 1000, 8)
                .unwrap();

            assert_eq!(result.fill_count, 0);
            assert_eq!(result.filled_base_lots, 0);
            assert!(result.order_id.is_some()); // posted at 100
        }

        assert_eq!(asks.roots.leaf_count, 1); // ask untouched
        assert_eq!(bids.roots.leaf_count, 1); // bid posted
    }

    #[test]
    fn post_only_cancels_if_would_match() {
        let mut bids = BookSide::zeroed();
        let mut asks = BookSide::zeroed();
        let mut mkt = make_market();

        // Resting ask at 100
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut maker_oo = make_open_orders([1u8; 32]);
            let ask = limit_order(Side::Ask, 100, 10, 10000, 1);
            ob.new_order(&ask, &mut mkt, &mut maker_oo, 1000, 8)
                .unwrap();
        }

        // PostOnly bid at 100 — would match, so cancelled silently
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut taker_oo = make_open_orders([2u8; 32]);
            let order = Order {
                side: Side::Bid,
                max_base_lots: 10,
                max_quote_lots: 10000,
                client_order_id: 2,
                time_in_force: 0,
                params: OrderParams::Fixed {
                    price_lots: 100,
                    order_type: PostOrderType::PostOnly,
                },
            };
            let result = ob
                .new_order(&order, &mut mkt, &mut taker_oo, 1000, 8)
                .unwrap();

            assert_eq!(result.fill_count, 0);
            assert!(result.order_id.is_none()); // not posted
        }

        assert_eq!(asks.roots.leaf_count, 1); // ask untouched
        assert_eq!(bids.roots.leaf_count, 0); // nothing posted
    }

    #[test]
    fn fok_fails_on_partial_fill() {
        let mut bids = BookSide::zeroed();
        let mut asks = BookSide::zeroed();
        let mut mkt = make_market();

        // Resting ask for 5 lots
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut maker_oo = make_open_orders([1u8; 32]);
            let ask = limit_order(Side::Ask, 100, 5, 10000, 1);
            ob.new_order(&ask, &mut mkt, &mut maker_oo, 1000, 8)
                .unwrap();
        }

        // FOK for 10 lots — only 5 available, should fail
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut taker_oo = make_open_orders([2u8; 32]);
            let order = Order {
                side: Side::Bid,
                max_base_lots: 10,
                max_quote_lots: 10000,
                client_order_id: 2,
                time_in_force: 0,
                params: OrderParams::FillOrKill { price_lots: 100 },
            };
            let result = ob.new_order(&order, &mut mkt, &mut taker_oo, 1000, 8);
            assert!(result.is_err());
        }
    }

    #[test]
    fn fok_succeeds_on_full_fill() {
        let mut bids = BookSide::zeroed();
        let mut asks = BookSide::zeroed();
        let mut mkt = make_market();

        // Resting ask for 10 lots
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut maker_oo = make_open_orders([1u8; 32]);
            let ask = limit_order(Side::Ask, 100, 10, 10000, 1);
            ob.new_order(&ask, &mut mkt, &mut maker_oo, 1000, 8)
                .unwrap();
        }

        // FOK for 10 lots — exactly available
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut taker_oo = make_open_orders([2u8; 32]);
            let order = Order {
                side: Side::Bid,
                max_base_lots: 10,
                max_quote_lots: 10000,
                client_order_id: 2,
                time_in_force: 0,
                params: OrderParams::FillOrKill { price_lots: 100 },
            };
            let result = ob
                .new_order(&order, &mut mkt, &mut taker_oo, 1000, 8)
                .unwrap();
            assert_eq!(result.filled_base_lots, 10);
            assert_eq!(result.fill_count, 1);
        }
    }

    #[test]
    fn self_trade_aborts() {
        let mut bids = BookSide::zeroed();
        let mut asks = BookSide::zeroed();
        let mut mkt = make_market();
        let owner = [1u8; 32];

        // Same owner posts ask then bid
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut oo = make_open_orders(owner);
            let ask = limit_order(Side::Ask, 100, 10, 10000, 1);
            ob.new_order(&ask, &mut mkt, &mut oo, 1000, 8).unwrap();
        }
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut oo = make_open_orders(owner); // same owner
            let bid = limit_order(Side::Bid, 100, 10, 10000, 2);
            let result = ob.new_order(&bid, &mut mkt, &mut oo, 1000, 8);
            assert!(result.is_err());
        }
    }

    #[test]
    fn cancel_order_removes_from_book() {
        let mut bids = BookSide::zeroed();
        let mut asks = BookSide::zeroed();
        let mut mkt = make_market();
        let mut oo = make_open_orders([1u8; 32]);

        let mut ob = make_orderbook(&mut bids, &mut asks);
        let order = limit_order(Side::Bid, 100, 10, 1000, 1);
        let result = ob.new_order(&order, &mut mkt, &mut oo, 1000, 8).unwrap();

        let order_id = result.order_id.unwrap();
        assert_eq!(ob.bids.roots.leaf_count, 1);
        let order_id_u128 = u128::from_le_bytes(order_id);
        ob.cancel_order(&mut oo, order_id_u128, Side::Bid, None)
            .unwrap();
        assert_eq!(ob.bids.roots.leaf_count, 0);
    }

    #[test]
    fn market_order_fills_multiple_levels() {
        let mut bids = BookSide::zeroed();
        let mut asks = BookSide::zeroed();
        let mut mkt = make_market();

        // Three resting asks at different prices
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            for (price, seq) in [(100, 1), (110, 2), (120, 3)] {
                let mut maker_oo = make_open_orders([seq as u8; 32]);
                let ask = limit_order(Side::Ask, price, 5, 10000, seq);
                ob.new_order(&ask, &mut mkt, &mut maker_oo, 1000, 8)
                    .unwrap();
            }
        }
        assert_eq!(asks.roots.leaf_count, 3);

        // Market bid for 12 lots — sweeps first two levels
        {
            let mut ob = make_orderbook(&mut bids, &mut asks);
            let mut taker_oo = make_open_orders([10u8; 32]);
            let bid = market_order(Side::Bid, 12, 100000);
            let result = ob
                .new_order(&bid, &mut mkt, &mut taker_oo, 1000, 8)
                .unwrap();

            assert_eq!(result.fill_count, 3);
            assert_eq!(result.filled_base_lots, 12); // 5 + 5 + 2
            assert_eq!(result.fills[0].price, 100);
            assert_eq!(result.fills[1].price, 110);
            assert_eq!(result.fills[2].price, 120);
        }
    }

    #[test]
    fn market_seq_num_increments_per_order() {
        let mut bids = BookSide::zeroed();
        let mut asks = BookSide::zeroed();
        let mut ob = make_orderbook(&mut bids, &mut asks);
        let mut mkt = make_market();

        assert_eq!(mkt.seq_num, 0);

        let mut oo1 = make_open_orders([1u8; 32]);
        ob.new_order(
            &limit_order(Side::Bid, 100, 5, 1000, 1),
            &mut mkt,
            &mut oo1,
            1000,
            8,
        )
        .unwrap();
        assert_eq!(mkt.seq_num, 1);

        let mut oo2 = make_open_orders([2u8; 32]);
        ob.new_order(
            &limit_order(Side::Ask, 200, 5, 1000, 2),
            &mut mkt,
            &mut oo2,
            1000,
            8,
        )
        .unwrap();
        assert_eq!(mkt.seq_num, 2);
    }
}
