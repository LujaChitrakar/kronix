pub const NODE_SIZE: usize = 88;
pub const MAX_ORDERTREE_NODES: usize = 100;
pub const MAX_NUM_EVENTS: u16 = 600;
pub const EVENT_SIZE: usize = 144;
pub const NO_NODE: u16 = u16::MAX;

// book
pub const DROP_EXPIRED_ORDER_LIMIT: usize = 5;
pub const FILL_EVENT_REMAINING_LIMIT: usize = 15;
pub const MAX_FILLS_PER_ORDER: usize = 6;
pub const MAX_DEPTH: usize = 40;
pub const ITER_STACK_DEPTH: usize = 40;

// market
pub const FEES_SCALE_FACTOR: i128 = 1_000_000;
pub const PENALTY_EVENT_HEAP: u64 = 500;

// open orders
pub const MAX_OPEN_ORDERS: usize = 24;

// oracle
pub const MAX_ORACLE_AGE_SECS: i64 = 10; // max 10 seconds stale
pub const MAX_CONF_RATIO_BPS: u64 = 200; // max 2% uncertainty

// SEEDS
pub const MARKET_SEED: &[u8] = b"market";
pub const BIDS_SEED: &[u8] = b"bids";
pub const ASKS_SEED: &[u8] = b"asks";
pub const OPEN_ORDERS_SEED: &[u8] = b"open_orders";
pub const USER_ACCOUNT_SEED: &[u8] = b"user";
pub const POSITION_SEED: &[u8] = b"position";
pub const MARKET_CONFIG_SEED: &[u8] = b"market_config";
pub const FUNDING_SEED: &[u8] = b"funding";