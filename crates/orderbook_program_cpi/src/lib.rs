use bytemuck::{Pod, Zeroable};

pub const CREATE_OPEN_ORDERS_ACCOUNT_IX: u8 = 1;
pub const INITIALIZE_FILLS_LOG_IX: u8 = 2;
pub const PLACE_ORDER_IX: u8 = 3;
pub const PLACE_TAKE_ORDER_IX: u8 = 4;
pub const SET_DELEGATE_IX: u8 = 11;

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct SetDelegateParams {
    pub delegate: [u8; 32],
}

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct CreateOpenOrdersAccountParams {
    pub owner: [u8; 32],
    pub bump: u8,
    pub padding: [u8; 7],
}

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct InitializeFillsLogParams {
    pub bump: u8,
    pub padding: [u8; 7],
    pub client_order_id: u64,
}

#[derive(Pod, Zeroable, Clone, Copy)]
#[repr(C)]
pub struct PlaceOrderParams {
    pub max_base_lots: i64,
    pub max_quote_lots: i64,
    pub client_order_id: u64,
    pub expiry_timestamp: u64,
    pub price_lots: i64,
    pub side: u8,
    pub order_type: u8,
    pub limit: u8,
    pub bump_fills_log: u8,
    pub padding: [u8; 4],
}

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
    pub bump_fills_log: u8,
    pub padding: [u8; 4],
}
