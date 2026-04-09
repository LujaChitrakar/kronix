use bytemuck::{Pod, Zeroable};

pub const PLACE_TAKE_ORDER_IX: u8 = 3;

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct PlaceTakeOrderParams {
    pub max_base_lots: i64,
    pub max_quote_lots: i64,
    pub client_order_id: u64,
    pub price_lots: i64,
    pub side: u8,
    pub order_type: u8,
    pub limit: u8,
    pub bump_position: u8,
    pub bump_user: u8,
    pub padding: [u8; 3],
}
