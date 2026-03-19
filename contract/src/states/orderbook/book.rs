use std::cell::RefMut;

use crate::{
    constants::MAX_FILLS_PER_ORDER,
    states::{BookSide, FillEvent, Order, OrderTreeType, Side},
};

pub struct Orderbook<'a> {
    pub bids: &'a mut BookSide,
    pub asks: &'a mut BookSide,
}

pub struct MatchResults {
    pub order_id: Option<[u8; 16]>,
    pub fill_count: u8,
    pub filled_base: i64,
    pub posted_price: i64,
    pub fills: [FillEvent; MAX_FILLS_PER_ORDER],
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

    // pub fn new_order(&mut self,order:&Order,)
}
