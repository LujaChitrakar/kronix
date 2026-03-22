use pinocchio::{
    error::ProgramError,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    errors::OrderBookError,
    states::{BookSideOrderTree, Orderbook, PostOrderType, Side, fixed_price_data},
};

pub struct Order {
    pub side: Side,
    // max base lots the order is willing to buy/sell
    pub max_base_lots: i64,
    // max quote lots the order is willing to pay/receive including fees
    pub max_quote_lots: i64,
    // arbitrary client order id
    pub client_order_id: u64,
    /// Number of seconds the order shall live, 0 meaning forever
    pub time_in_force: u16,
    // Order type specific params
    pub params: OrderParams,
}

pub enum OrderParams {
    Market,
    ImmediateOrCancel {
        price_lots: i64,
    },
    Fixed {
        price_lots: i64,
        order_type: PostOrderType,
    },
    FillOrKill {
        price_lots: i64,
    },
}

impl Order {
    // Convert an input expiry timestamp to a time_in_force value
    pub fn tif_from_expiry(expiry_timestamp: u64) -> Option<u16> {
        let now_ts: u64 = Clock::get().unwrap().unix_timestamp.try_into().unwrap();
        if expiry_timestamp != 0 {
            // If expiry is far in the future, clamp to u16::MAX seconds
            let tif = expiry_timestamp.saturating_sub(now_ts).min(u16::MAX.into());
            if tif == 0 {
                // If expiry is in the past, ignore the order
                return None;
            }
            Some(tif as u16)
        } else {
            // Never expire
            Some(0)
        }
    }

    // is to be posted to the orderbook?
    pub fn is_post_only(&self) -> bool {
        let order_type = match self.params {
            OrderParams::Fixed { order_type, .. } => order_type,
            _ => return false,
        };
        order_type == PostOrderType::PostOnly || order_type == PostOrderType::PostOnlySlide
    }

    // is this to be executed completely?
    pub fn is_fill_or_kill(&self) -> bool {
        matches!(self.params, OrderParams::FillOrKill { .. })
    }

    // order tree that this order should be inserted into
    pub fn post_target(&self) -> Option<BookSideOrderTree> {
        match self.params {
            OrderParams::Fixed { .. } => Some(BookSideOrderTree::Fixed),
            _ => None,
        }
    }

    /// Compute (price_lots, price_data) for this order
    /// price_data is what gets stored in the critbit key
    pub fn price(&self, now_ts: u64, order_book: &Orderbook) -> Result<(i64, u64), ProgramError> {
        let price_lots = match self.params {
            OrderParams::Market => market_order_limit_for_side(self.side),
            OrderParams::ImmediateOrCancel { price_lots } => price_lots,
            OrderParams::FillOrKill { price_lots } => price_lots,
            OrderParams::Fixed {
                price_lots,
                order_type,
            } => self.price_for_order_type(now_ts, price_lots, order_type, order_book),
        };

        if price_lots < 1 {
            return Err(OrderBookError::InvalidPriceLots.into());
        }

        let price_data = fixed_price_data(price_lots)?;

        Ok((price_lots, price_data))
    }

    /// For PostOnlySlide — adjust price to just outside spread
    /// For all other types — return price unchanged
    fn price_for_order_type(
        &self,
        now_ts: u64,
        price_lots: i64,
        order_type: PostOrderType,
        order_book: &Orderbook,
    ) -> i64 {
        if order_type == PostOrderType::PostOnlySlide {
            if let Some(best_other_price) = order_book
                .bookside(self.side.invert_side())
                .best_price(now_ts)
            {
                post_only_slide_limit(self.side, best_other_price, price_lots)
            } else {
                // No opposing orders — any price is fine
                price_lots
            }
        } else {
            price_lots
        }
    }
}

// the implicit limit price for a market order on a given side
fn market_order_limit_for_side(side: Side) -> i64 {
    match side {
        Side::Bid => i64::MAX,
        Side::Ask => 1,
    }
}

// The limit to use for PostOnlySlide orders:
// The tinyest bit better than the best opposing order
fn post_only_slide_limit(side: Side, best_other_side: i64, limit: i64) -> i64 {
    match side {
        Side::Bid => limit.min(best_other_side - 1),
        Side::Ask => limit.max(best_other_side + 1),
    }
}
