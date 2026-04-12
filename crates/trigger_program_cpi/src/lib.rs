use bytemuck::{Pod, Zeroable};

pub const PLACE_TRIGGER_IX: u8 = 0;

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct PlaceTriggerOrderParams {
    pub client_order_id: u64,
    pub trigger_price: i64,
    pub size_lots: i64,
    pub expiry: i64, // unix ts, 0 = never
    pub market_index: u16,
    pub trigger_type: u8, // 0=StopLoss, 1=TakeProfit
    pub side: u8,         // 0=Buy, 1=Sell
    pub bump: u8,
    pub padding: [u8; 3],
}
