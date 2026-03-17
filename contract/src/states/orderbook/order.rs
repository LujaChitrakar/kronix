use pinocchio::sysvars::{Sysvar, clock::Clock};

use crate::states::{PostOrderType, SelfTradeBehaviour, Side};

pub struct Order {
    pub side: Side,
    pub man_base_lots: i64,
    pub max_quote_lots_including_fees: i64,
    pub client_order_id: u64,
    pub time_in_force: u16,
    pub self_trade_behavior: SelfTradeBehaviour,
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
    // OraclePegged{price_offset_lots:i64,order_type:PostOrderType,peg_limit_lots:i64},
    FillOrKill {
        price_lots: i64,
    },
}

impl Order {
    // convert input expiry timestamp to a time_in_force value
    pub fn tif_from_expiry(expiry_timestamp: u64) -> Option<u16> {
        let now_ts = Clock::get().unwrap().unix_timestamp.try_into().unwrap();
        if expiry_timestamp != 0 {
            let tif = expiry_timestamp.saturating_sub(now_ts).min(u16::MAX.into());
            if tif == 0 {
                return None;
            }
            Some(tif as u16)
        } else {
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
    // pub fn post_target(&self) -> Option<BookSideOrderTree> {
    //     match self.params {
    //         OrderParams::Fixed { order_type, .. } => Some(BookSideOrderTree::Fixed),
    //         _ => None,
    //     }
    // }

    // Some order types(PostOnlySlide) may override the price that it has been passed in
    // fn price_for_order_type(&self,now_ts:u64,price_lots:i64,order_book:&Orderbook) -> i64 {}

    // pub fn price(&self) -> i64 {}
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
