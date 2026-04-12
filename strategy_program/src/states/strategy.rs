use bytemuck::{Pod, Zeroable};
use core::mem::size_of;

pub const MAX_SR_LEVELS: usize = 8; // support/resistance price levels

#[derive(Pod, Zeroable, Copy, Clone)]
#[repr(C)]
pub struct StrategyAccount {
    pub client_order_id: u64,
    // SL/TP — stored on-chain so keeper can register triggers
    pub take_profit_price: i64, // 0 = none
    pub stop_loss_price: i64,   // 0 = none

    // Position sizing
    pub size_lots: i64,        // base lots per signal
    pub limit_price_lots: i64, // 0 = market order
    pub created_at: i64,
    pub day_start_ts: i64,
    pub last_executed_ts: i64,

    pub strategy_type: u8, // 0=RSI, 1=EMA, 2=RangeDCA, 3=SR, 4=SmartMoney
    pub status: u8,        // 0=Active, 1=Paused, 2=Completed
    pub bump: u8,
    pub side: u8, // 0=Buy, 1=Sell (for directional strategies)

    // Execution limits
    pub max_executions_per_day: u32,
    pub cooldown_secs: u32,
    pub executions_today: u32,
    pub market_index: u16,
    pub padding: [u8; 6],

    // Strategy-specific params — union over all strategy types
    pub params: StrategyParams,
    pub owner: [u8; 32],
    pub reserved: [u8; 32],
}
impl StrategyAccount {
    pub const LEN: usize = size_of::<StrategyAccount>();
}

/// Fixed-size params union — all strategy types must fit
/// Uses the largest required size, smaller ones pad with zeros
#[derive(Pod, Zeroable, Copy, Clone)]
#[repr(C)]
pub struct StrategyParams {
    pub levels: [i64; MAX_SR_LEVELS], // price lots
    // RangeDCA params
    pub lower_price: i64, // price lots
    pub upper_price: i64, // price lots
    pub level_count: u8,
    pub padding: [u8; 3],
    pub grid_count: u32,
    // RSI params
    pub rsi_period: u32,
    pub rsi_oversold: i32,   // * 100, e.g. 3000 = 30.00
    pub rsi_overbought: i32, // * 100
    // EMA params
    pub ema_fast: u32,
    pub ema_slow: u32,
    // SmartMoney params
    pub structure_lookback: u32,
    pub order_block_sensitivity: i32, // * 10000
    // SupportResistance params
    pub tolerance_bps: u32,
    pub reserved: [u8; 32],
}

const _: () = assert!(size_of::<StrategyAccount>() % 8 == 0);
const _: () = assert!(size_of::<StrategyParams>() % 8 == 0);
