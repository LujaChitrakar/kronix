use bytemuck::{Pod, Zeroable};

pub const SETTLE_FILL_IX: u8 = 9;

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct SettleFillParams {
    pub price_lots: i64, // fill price in price lots
    pub base_lots: i64,  // base lots filled
    pub market_index: u16,
    pub is_taker: u8,      // 1 = taker, 0 = maker
    pub taker_side: u8,    // 0=bid, 1=ask — taker's side
    pub bump_position: u8, // PDA bump for position being created
    pub bump_user: u8,     // PDA bump for user account
    pub padding: [u8; 2],
    pub maker_pubkey: [u8; 32],
    pub taker_pubkey: [u8; 32],
}