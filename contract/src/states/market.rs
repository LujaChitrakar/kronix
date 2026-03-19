use bytemuck::{Pod, Zeroable};

use crate::states::{Side, orderbook};

#[derive(Pod, Zeroable, Copy, Clone)]
#[repr(C)]
pub struct Market {
    // Identity
    pub market_index: u16,
    pub bump: u8,
    pub base_decimals: u8,
    pub quote_decimals: u8,
    pub padding: [u8; 3],
    pub name: [u8; 16],

    // Lot sizes
    pub base_lot_size: i64,
    pub quote_lot_size: i64,

    // Order ID generation
    pub seq_num: u64,

    // Market lifecycle
    pub registration_ts: i64,
    pub time_expiry: i64,

    // Account refs
    // address of the bookside account for bids
    pub bids: [u8; 32],
    // address of the bookside account for asks
    pub asks: [u8; 32],
    // address of the event queue account
    pub event_queue: [u8; 32],
    // address of the oracle account
    pub oracle: [u8; 32],
    pub reserved: [u8; 64],
}

const _: () = assert!(
    size_of::<Market>() == 2 + 1 + 1 + 1 + 3 + 16 + 8 + 8 + 8 + 8 + 8 + 32 + 32 + 32 + 32 + 64
);
const _: () = assert!(size_of::<Market>() % 8 == 0);

impl Market {
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
        orderbook::new_node_key(side, price_data, self.seq_num)
    }

    pub fn max_base_lots(&self) -> i64 {
        i64::MAX / self.base_lot_size
    }

    pub fn max_quote_lots(&self) -> i64 {
        i64::MAX / self.quote_lot_size
    }
}
