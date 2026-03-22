use bytemuck::{Pod, Zeroable};
use pinocchio::{AccountView, Address, error::ProgramError, sysvars::clock::Clock};
use pyth_solana_receiver_sdk::PYTH_PUSH_ORACLE_ID;

use crate::{
    constants::{MAX_CONF_RATIO_BPS, MAX_ORACLE_AGE_SECS},
    errors::OrderBookError,
    states::{Side, new_node_key, orderbook},
    utils::impl_load,
};

const OFFSET_FEED_ID: usize = 42;
const OFFSET_PRICE: usize = 74;
const OFFSET_CONF: usize = 82;
const OFFSET_EXPONENT: usize = 90;
const OFFSET_PUBLISH_TIME: usize = 94;
const MIN_DATA_LEN: usize = 102;

#[derive(Clone, Copy, Pod, Zeroable)]
#[repr(C)]
pub struct MarketState {
    // Identity
    pub market_index: u16,
    pub bump: u8,
    pub padding: [u8; 5],
    pub name: [u8; 16],

    // Account refs — pubkeys of associated accounts
    pub bids: [u8; 32],
    pub asks: [u8; 32],

    // Lot sizes — set at market creation, never change
    pub base_lot_size: i64,  // base native per lot e.g. 100 = 0.0001 SOL
    pub quote_lot_size: i64, // quote native per lot e.g. 1 = 0.000001 USDC

    // Order ID generation — monotonically increasing
    pub seq_num: u64,

    // Market status
    pub registration_ts: i64,
    pub time_expiry: i64, // 0 = never expires

    pub reserved: [u8; 64],
}

const _: () =
    assert!(size_of::<MarketState>() == 2 + 1 + 5 + 16 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 64);
const _: () = assert!(size_of::<MarketState>() % 8 == 0);

impl MarketState {
    pub fn name(&self) -> &str {
        std::str::from_utf8(&self.name)
            .unwrap()
            .trim_matches(char::from(0))
    }

    pub fn is_expired(&self, time_stamp: i64) -> bool {
        self.time_expiry != 0 && self.time_expiry < time_stamp
    }

    pub fn generate_order_id(&mut self, side: Side, price_data: u64) -> u128 {
        self.seq_num += 1;
        new_node_key(side, price_data, self.seq_num)
    }

    pub fn max_base_lots(&self) -> i64 {
        i64::MAX / self.base_lot_size
    }

    pub fn max_quote_lots(&self) -> i64 {
        i64::MAX / self.quote_lot_size
    }

    //inverse conversion, useful for UI/logging
    pub fn lot_to_native_price(&self, price_lots: i64) -> Option<i64> {
        price_lots
            .checked_mul(self.quote_lot_size)
            .map(|x| x / self.base_lot_size)
    }

    /// Convert base lots to native units
    pub fn base_lots_to_native(&self, lots: i64) -> i64 {
        lots.checked_mul(self.base_lot_size)
            .expect("base lots overflow")
    }

    /// Convert quote lots to native units
    pub fn quote_lots_to_native(&self, lots: i64) -> i64 {
        lots.checked_mul(self.quote_lot_size)
            .expect("quote lots overflow")
    }

    /// Convert native base to lots — floors
    pub fn native_to_base_lots(&self, native: i64) -> i64 {
        native / self.base_lot_size
    }

    /// Convert native quote to lots — floors
    pub fn native_to_quote_lots(&self, native: i64) -> i64 {
        native / self.quote_lot_size
    }
}
