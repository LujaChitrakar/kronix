pub const NODE_SIZE: usize = 88;
pub const MAX_ORDERTREE_NODES: usize = 1024;
pub const MAX_NUM_EVENTS: u16 = 600;
pub const EVENT_SIZE: usize = 144;
pub const NO_NODE: u16 = u16::MAX;

// book
pub const DROP_EXPIRED_ORDER_LIMIT: usize = 5;
pub const FILL_EVENT_REMAINING_LIMIT: usize = 15;
pub const MAX_FILLS_PER_ORDER: usize = 6;

// market
//
pub const FEES_SCALE_FACTOR: i128 = 1_000_000;
pub const PENALTY_EVENT_HEAP: u64 = 500;
